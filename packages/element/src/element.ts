import type { AdapterContext, LoadedSource, Player, PlayerState, SourceInput } from "@swarmloom/core";
import { load } from "@swarmloom/formats";
import { ATTRIBUTES, type ElementConfig, PLAYER_ATTRIBUTES, readConfig, toPlayerOptions } from "./attributes";
import { runtime } from "./runtime";
import { STYLES } from "./styles";

/** Detail payloads of the events `<swarm-loom>` dispatches (all bubble and cross shadow boundaries). */
export interface SwarmLoomEventDetails {
  "swarm-state": { state: PlayerState };
  "swarm-progress": { built: number; total: number };
  /** The build finished (the finale may still be running). */
  "swarm-done": Record<string, never>;
  /** Loading or playback failed. Cancelable: `preventDefault()` hides the built-in message. */
  "swarm-error": { error: Error };
}

type Mode = "children" | "source";

interface Parts {
  root: HTMLElement;
  stage: HTMLElement;
  error: HTMLElement;
}

// Keep the module importable where HTMLElement does not exist (SSR, Node without a DOM).
const BaseElement: typeof HTMLElement =
  typeof HTMLElement === "undefined" ? (class {} as unknown as typeof HTMLElement) : HTMLElement;

const RUNNING: ReadonlySet<PlayerState> = new Set(["intro", "building"]);
const FINISHED: ReadonlySet<PlayerState> = new Set(["finale", "done"]);
/** Children are snapshotted once their images decode, or after this long. */
const IMAGE_WAIT_MS = 3000;

/**
 * Marks shadow parts that snapshot-dom must skip when it captures the element's own children
 * (`{ element: this }`): the stage (a previous replay, cursors) and the error banner are not content.
 */
const IGNORE_ATTR = "data-swarmloom-ignore";

function part(doc: Document, className: string, attrs: Record<string, string> = {}): HTMLElement {
  const el = doc.createElement("div");
  el.className = className;
  for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, value);
  return el;
}

/**
 * Builds the shadow tree with DOM calls rather than an innerHTML template, so extension store
 * linters (web-ext UNSAFE_VAR_ASSIGNMENT) have nothing to flag.
 */
function buildShadow(shadow: ShadowRoot): Parts {
  const doc = shadow.ownerDocument;
  const style = doc.createElement("style");
  style.textContent = STYLES;
  const root = part(doc, "root", { part: "root" });
  const content = part(doc, "content", { part: "content" });
  content.append(doc.createElement("slot"));
  const stage = part(doc, "stage", { part: "stage", [IGNORE_ATTR]: "" });
  const error = part(doc, "error", { part: "error", role: "alert", [IGNORE_ATTR]: "" });
  root.append(part(doc, "sizer"), content, stage, error);
  shadow.replaceChildren(style, root);
  return { root, stage, error };
}

function toError(reason: unknown): Error {
  return reason instanceof Error ? reason : new Error(String(reason));
}

/**
 * `<swarm-loom>`: a swarm of cursors rebuilds a file, URL or the element's own children.
 *
 * Attributes: `src` (URL to fetch, detect and load), `type` (format id, extension or MIME type that
 * overrides detection), `agents`, `speed`, `seed`, `theme`, `labels`, `finale`, `autoplay`,
 * `loop` (replay after N ms, default 1500), `controls`, `sound`, `inview` (start, and pause/resume,
 * with visibility), `reduced-motion` (`auto` | `true` | `false`).
 *
 * Without `src`, the light-DOM children are the content: they are snapshotted, covered by the stage
 * while the swarm builds them, and shown again on "go live". Events: `swarm-state`,
 * `swarm-progress`, `swarm-done`, `swarm-error` (see {@link SwarmLoomEventDetails}).
 */
export class SwarmLoomElement extends BaseElement {
  static get observedAttributes(): string[] {
    return [...ATTRIBUTES];
  }

  #parts: Parts | null = null;
  #player: Player | null = null;
  #loaded: LoadedSource | null = null;
  /** Source passed to load(); reused when the element is connected again. */
  #input: SourceInput | null = null;
  #controller: AbortController | null = null;
  #unsubscribe: (() => void)[] = [];
  #observer: IntersectionObserver | null = null;
  #visible = true;
  #playWhenReady = false;
  #pausedOffscreen = false;
  #finished = false;
  #loopTimer: ReturnType<typeof setTimeout> | undefined;
  #generation = 0;
  /** Bumped by every load request; a queued or waiting automatic load gives up when it changes. */
  #loadToken = 0;
  #rebuildQueued = false;
  /** Callers of load() made while disconnected, settled by the load that runs on connection. */
  #pending: { resolve(): void; reject(error: unknown): void }[] = [];
  /** Logical connection; teardown is deferred one microtask so moving the element keeps playback. */
  #connected = false;
  #ready: Promise<void> = Promise.resolve();

  /** The current player, or null before a source has loaded. */
  get player(): Player | null {
    return this.#player;
  }

  /** Resolves when the latest load or player rebuild has settled (it never rejects; see `swarm-error`). */
  get ready(): Promise<void> {
    return this.#ready;
  }

  connectedCallback(): void {
    if (this.#connected) return;
    this.#connected = true;
    this.#ensureShadow();
    this.#observe();
    this.#queueReload();
  }

  disconnectedCallback(): void {
    queueMicrotask(() => {
      if (this.isConnected || !this.#connected) return;
      this.#connected = false;
      this.#teardown();
    });
  }

  attributeChangedCallback(name: string, previous: string | null, value: string | null): void {
    if (previous === value || !this.#connected) return;
    if (name === "src" || name === "type") {
      this.#input = null;
      this.#queueReload();
    } else if (name === "speed") this.#player?.setSpeed(this.#config().speed);
    else if (name === "sound") this.#player?.setSound(this.#config().sound);
    else if (name === "inview") this.#observe();
    else if (name === "autoplay" && this.#config().autoplay) this.#autoplay();
    else if (PLAYER_ATTRIBUTES.has(name)) this.#queueRebuild();
  }

  /**
   * Loads a source (detected through `@swarmloom/formats`, or forced by the `type` attribute) and
   * starts playback when `autoplay`/`inview` is set. A source loaded this way takes precedence over
   * `src` and children until `src` or `type` changes. When the element is not connected, the source
   * is loaded (and the promise settles) once it is connected.
   *
   * @throws The load error (also dispatched as `swarm-error`).
   */
  load(input: SourceInput): Promise<void> {
    if (typeof input !== "object" || input === null) return Promise.reject(new TypeError("load() needs a SourceInput"));
    this.#input = input;
    if (!this.#connected) return new Promise((resolve, reject) => this.#pending.push({ resolve, reject }));
    this.#loadToken++;
    return this.#track(this.#start(input, input.element === this ? "children" : "source"));
  }

  /** Starts the build, resumes after pause, or replays a finished one. Queued until a source has loaded. */
  play(): void {
    const player = this.#player;
    this.#playWhenReady = !player;
    this.#pausedOffscreen = false;
    if (!player) return;
    if (player.state === "paused") player.resume();
    else if (player.state === "done" || player.state === "live") this.replay();
    else if (player.state === "idle") {
      player.play().then(
        () => this.#player === player && this.#markFinished(),
        (error: unknown) => this.#player === player && this.#fail(error),
      );
    }
  }

  pause(): void {
    this.#playWhenReady = false;
    this.#pausedOffscreen = false;
    if (this.#player && RUNNING.has(this.#player.state)) this.#player.pause();
  }

  /** Rebuilds from a blank stage. */
  replay(): void {
    clearTimeout(this.#loopTimer);
    if (!this.#player) return;
    this.#parts?.root.toggleAttribute("data-active", true);
    this.#finished = false;
    this.#player.replay();
  }

  #config(): ElementConfig {
    return readConfig((name) => this.getAttribute(name));
  }

  #ensureShadow(): Parts {
    if (this.#parts) return this.#parts;
    const shadow = this.shadowRoot ?? this.attachShadow({ mode: "open" });
    this.#parts = buildShadow(shadow);
    return this.#parts;
  }

  #track(task: Promise<void>): Promise<void> {
    this.#ready = task.catch(() => undefined);
    return task;
  }

  #queueReload(): void {
    const token = ++this.#loadToken;
    queueMicrotask(() => {
      if (!this.#connected || token !== this.#loadToken) return;
      const pending = this.#pending.splice(0);
      this.#track(this.#autoLoad(token)).then(
        () => {
          for (const p of pending) p.resolve();
        },
        (error: unknown) => {
          for (const p of pending) p.reject(error);
        },
      );
    });
  }

  #queueRebuild(): void {
    if (this.#rebuildQueued || !this.#loaded) return;
    this.#rebuildQueued = true;
    queueMicrotask(() => {
      this.#rebuildQueued = false;
      if (this.#connected && this.#loaded) this.#track(this.#createPlayer().catch((error) => this.#fail(error)));
    });
  }

  /** Loads, in order of precedence: the last load() input, `src`, then the light-DOM children. */
  async #autoLoad(token: number): Promise<void> {
    const current = (): boolean => this.#connected && token === this.#loadToken;
    const doc = this.ownerDocument;
    if (doc.readyState === "loading") {
      // Children are still being parsed when an early-defined element connects.
      await new Promise((resolve) => doc.addEventListener("DOMContentLoaded", resolve, { once: true }));
      if (!current()) return;
    }
    const src = this.getAttribute("src")?.trim();
    if (this.#input) return this.#start(this.#input, this.#input.element === this ? "children" : "source");
    if (src) return this.#start({ url: src }, "source");
    if (this.#hasChildren()) {
      await this.#childrenSettled();
      if (current()) return this.#start({ element: this }, "children");
    }
  }

  #hasChildren(): boolean {
    return Array.from(this.childNodes).some(
      (node) => node.nodeType === Node.ELEMENT_NODE || (node.nodeType === Node.TEXT_NODE && node.textContent?.trim()),
    );
  }

  /** Waits for web fonts and child images so the snapshot measures final layout. */
  async #childrenSettled(): Promise<void> {
    const images = Array.from(this.querySelectorAll("img")).filter((img) => !img.complete);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, IMAGE_WAIT_MS);
    });
    const settled = Promise.all([
      this.ownerDocument.fonts?.ready.catch(() => undefined),
      ...images.map((img) => img.decode().catch(() => undefined)),
    ]);
    await Promise.race([settled, timeout]);
    clearTimeout(timer);
  }

  #context(signal: AbortSignal): AdapterContext {
    const doc = this.ownerDocument;
    const theme = this.#config().theme;
    const dark =
      theme === "auto"
        ? (doc.defaultView?.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false)
        : theme === "dark";
    const locale = this.closest("[lang]")?.getAttribute("lang") || undefined;
    return {
      document: doc,
      width: Math.round(this.clientWidth) || 800,
      theme: dark ? "dark" : "light",
      locale,
      signal,
    };
  }

  async #start(input: SourceInput, mode: Mode): Promise<void> {
    this.#controller?.abort();
    this.#stopPlayback();
    const controller = new AbortController();
    this.#controller = controller;
    const { signal } = controller;
    const parts = this.#ensureShadow();
    parts.root.dataset.mode = mode;
    this.#setError(null);
    this.setAttribute("aria-busy", "true");
    try {
      const loaded = await load(input, this.#context(signal), {
        registry: runtime.formats,
        format: mode === "source" ? this.getAttribute("type")?.trim() || undefined : undefined,
        maxBytes: runtime.maxBytes,
        signal,
      });
      if (signal.aborted) {
        loaded.dispose?.();
        return;
      }
      this.#loaded = loaded;
      await this.#createPlayer();
    } catch (error) {
      if (signal.aborted) return;
      this.#fail(error);
      throw error;
    } finally {
      if (this.#controller === controller) this.removeAttribute("aria-busy");
    }
  }

  async #createPlayer(): Promise<void> {
    const loaded = this.#loaded;
    const parts = this.#parts;
    if (!loaded || !parts) return;
    this.#stopPlayer();
    const generation = this.#generation;
    const config = this.#config();
    // A stage attaches its own shadow root, so every player gets a fresh host element.
    const stage = parts.stage.cloneNode(false) as HTMLElement;
    // Children mode: the real children stay readable to assistive technology; the replay is decoration.
    if (parts.root.dataset.mode === "children") stage.setAttribute("aria-hidden", "true");
    else stage.removeAttribute("aria-hidden");
    parts.stage.replaceWith(stage);
    parts.stage = stage;
    parts.root.toggleAttribute("data-active", true);
    const options = toPlayerOptions(config, { blueprint: loaded.blueprint, plugins: loaded.plugins, host: stage });
    let player: Player;
    try {
      player = await runtime.createPlayer(options);
    } catch (error) {
      parts.root.removeAttribute("data-active");
      throw error;
    }
    if (generation !== this.#generation || this.#loaded !== loaded) {
      player.destroy();
      return;
    }
    this.#player = player;
    this.#finished = false;
    this.#unsubscribe = [
      player.on("state", (e) => this.#onState(e.state)),
      player.on("progress", (e) => this.#emit("swarm-progress", { built: e.built, total: e.total })),
      player.on("error", (e) => this.#fail(e.error)),
    ];
    if (config.autoplay || config.inview || this.#playWhenReady) this.#autoplay();
  }

  #autoplay(): void {
    if (!this.#visible) {
      this.#playWhenReady = true;
      return;
    }
    this.play();
  }

  #onState(state: PlayerState): void {
    this.#emit("swarm-state", { state });
    if (RUNNING.has(state)) this.#finished = false;
    else if (FINISHED.has(state)) this.#markFinished();
    else if (state === "live" && this.#parts?.root.dataset.mode === "children") {
      // Hand the real, interactive children back.
      this.#parts.root.removeAttribute("data-active");
    }
  }

  #markFinished(): void {
    if (this.#finished) return;
    this.#finished = true;
    this.#emit("swarm-done", {});
    const delay = this.#config().loop;
    if (delay === null) return;
    clearTimeout(this.#loopTimer);
    this.#loopTimer = setTimeout(() => {
      if (this.#connected && this.#finished && this.#player?.state !== "live") this.replay();
    }, delay);
  }

  #observe(): void {
    const wanted = this.#config().inview && typeof IntersectionObserver !== "undefined";
    if (!wanted) {
      this.#observer?.disconnect();
      this.#observer = null;
      this.#onVisibility(true);
      return;
    }
    if (this.#observer) return;
    this.#visible = false;
    // Any part inside the upper 85% of the viewport counts, so very tall elements still start.
    this.#observer = new IntersectionObserver(
      (entries) => this.#onVisibility(entries[entries.length - 1]?.isIntersecting ?? false),
      { rootMargin: "0px 0px -15% 0px" },
    );
    this.#observer.observe(this);
  }

  #onVisibility(visible: boolean): void {
    this.#visible = visible;
    const player = this.#player;
    if (!player) return;
    if (!visible) {
      if (this.#config().inview && RUNNING.has(player.state)) {
        player.pause();
        this.#pausedOffscreen = true;
      }
    } else if (this.#playWhenReady) this.play();
    else if (this.#pausedOffscreen && player.state === "paused") {
      this.#pausedOffscreen = false;
      player.resume();
    }
  }

  #fail(reason: unknown): void {
    const error = toError(reason);
    const event = new CustomEvent("swarm-error", {
      detail: { error },
      bubbles: true,
      composed: true,
      cancelable: true,
    });
    this.#setError(this.dispatchEvent(event) ? error.message : null);
  }

  #setError(message: string | null): void {
    if (!this.#parts) return;
    this.#parts.error.textContent = message ?? "";
    this.#parts.root.toggleAttribute("data-error", Boolean(message));
  }

  #emit<K extends keyof SwarmLoomEventDetails>(type: K, detail: SwarmLoomEventDetails[K]): void {
    this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
  }

  #stopPlayer(): void {
    this.#generation++;
    clearTimeout(this.#loopTimer);
    for (const off of this.#unsubscribe) off();
    this.#unsubscribe = [];
    const player = this.#player;
    this.#player = null;
    this.#finished = false;
    this.#parts?.root.removeAttribute("data-active");
    try {
      player?.destroy();
    } catch (error) {
      this.#fail(error);
    }
  }

  #stopPlayback(): void {
    this.#stopPlayer();
    const loaded = this.#loaded;
    this.#loaded = null;
    try {
      loaded?.dispose?.();
    } catch (error) {
      this.#fail(error);
    }
  }

  #teardown(): void {
    this.#loadToken++;
    this.#controller?.abort();
    this.#controller = null;
    this.#stopPlayback();
    this.#observer?.disconnect();
    this.#observer = null;
    this.#visible = true;
    this.#playWhenReady = false;
    this.#pausedOffscreen = false;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "swarm-loom": SwarmLoomElement;
  }
  interface HTMLElementEventMap {
    "swarm-state": CustomEvent<SwarmLoomEventDetails["swarm-state"]>;
    "swarm-progress": CustomEvent<SwarmLoomEventDetails["swarm-progress"]>;
    "swarm-done": CustomEvent<SwarmLoomEventDetails["swarm-done"]>;
    "swarm-error": CustomEvent<SwarmLoomEventDetails["swarm-error"]>;
  }
}
