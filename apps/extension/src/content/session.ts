/**
 * One swarm run inside a page: scan (snapshot), play, and clean up.
 *
 * The session object lives on the isolated-world global `__swarmloomSession` while it runs, which
 * is how a second injection (toolbar click, shortcut) finds and stops it. `stop()` is synchronous
 * and idempotent, and it always leaves the page exactly as it was: player destroyed, our UI
 * removed, the global deleted.
 */

import type { Blueprint, Player, PlayerOptions, PlayerState } from "@swarmloom/core";
import type { LaunchRequest, SessionStrings } from "../shared/messages";
import { seedFrom, toPlayerOptions } from "../shared/prefs";
import type { PosterShot } from "./poster";
import { createOverlayUi, type OverlayUi } from "./ui";

export type SessionPhase = "scanning" | PlayerState | "error" | "closed";

/** Options passed to snapshot-dom (contracts/snapshot.ts). */
export interface SnapshotRequest {
  origin: "document";
  prescroll: boolean;
  signal: AbortSignal;
  source: { type: string; url?: string; title?: string };
  screenshot?: PosterShot;
}

/** Everything the session needs from the outside; tests pass fakes. */
export interface SessionDeps {
  snapshot(root: Element | Document, opts: SnapshotRequest): Promise<Blueprint>;
  createPlayer(opts: PlayerOptions): Player;
  /** Media-only screenshot, or null. Only called when the launch allows captures. */
  capturePoster(root: Element | Document, signal: AbortSignal): Promise<PosterShot | null>;
  /** Opens the current page or a file picker in Studio (through the background). */
  openStudio(request: { src?: string; importFile?: boolean }): void;
  /** WebAudio is available in this page. */
  audioAvailable(): boolean;
}

export interface SwarmSession {
  readonly phase: SessionPhase;
  readonly error: string | null;
  readonly player: Player | null;
  readonly launch: LaunchRequest;
  /** Settles once the build started, failed or was stopped. */
  readonly ready: Promise<void>;
  stop(): void;
}

interface SessionScope {
  __swarmloomSession?: SwarmSession;
  __swarmloomTarget?: unknown;
}

function takeTarget(scope: SessionScope, doc: Document): Element | null {
  const target = scope.__swarmloomTarget;
  delete scope.__swarmloomTarget;
  return target && typeof target === "object" && (target as Node).nodeType === 1 && (target as Element).isConnected
    ? (target as Element).ownerDocument === doc
      ? (target as Element)
      : null
    : null;
}

/** Minimal view of the Navigation API (not in every browser yet). */
interface NavigationLike {
  addEventListener(type: "navigate", fn: (event: { destination?: { url?: unknown } }) => void): void;
  removeEventListener(type: "navigate", fn: (event: { destination?: { url?: unknown } }) => void): void;
}

/** Origin, path and query of `href`: what identifies "the same page" (the hash does not). */
function pageKey(href: string): string {
  try {
    const url = new URL(href);
    return url.origin + url.pathname + url.search;
  } catch {
    return href;
  }
}

/**
 * Ends the session when the page navigates (contracts/decisions-v1.md S03):
 * - `pagehide`: the page unloads or enters the back/forward cache. `end` undoes everything
 *   synchronously, so a page restored from the cache comes back clean and never resumes a swarm.
 * - `popstate` and the Navigation API `navigate` event: history moves and same-document route
 *   changes (`history.pushState`, SPA links). Only a different path or query counts; anchor jumps
 *   and hash-only updates keep the swarm running.
 * Returns the function that removes the listeners.
 */
export function endOnNavigation(view: Window | null, end: () => void): () => void {
  if (!view) return () => undefined;
  const start = pageKey(view.location.href);
  const moved = (href: unknown): boolean => typeof href !== "string" || pageKey(href) !== start;
  const onPageHide = (): void => end();
  const onPopState = (): void => {
    if (moved(view.location.href)) end();
  };
  const onNavigate = (event: { destination?: { url?: unknown } }): void => {
    if (moved(event?.destination?.url)) end();
  };
  view.addEventListener("pagehide", onPageHide);
  view.addEventListener("popstate", onPopState);
  const navigation = (view as unknown as { navigation?: Partial<NavigationLike> }).navigation;
  const nav = typeof navigation?.addEventListener === "function" ? (navigation as NavigationLike) : null;
  nav?.addEventListener("navigate", onNavigate);
  return () => {
    view.removeEventListener("pagehide", onPageHide);
    view.removeEventListener("popstate", onPopState);
    nav?.removeEventListener("navigate", onNavigate);
  };
}

function format(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => vars[name] ?? whole);
}

/** The running session in this frame, if any. */
export function currentSession(scope: object): SwarmSession | undefined {
  return (scope as SessionScope).__swarmloomSession;
}

/**
 * Starts a session and registers it on `scope`. Any previous session is stopped first, so there is
 * never more than one swarm per frame.
 */
export function startSession(scope: object, doc: Document, launch: LaunchRequest, deps: SessionDeps): SwarmSession {
  const s = scope as SessionScope;
  s.__swarmloomSession?.stop();

  const strings: SessionStrings = launch.strings;
  const abort = new AbortController();
  let phase: SessionPhase = "scanning";
  let error: string | null = null;
  let player: Player | null = null;
  let ui: OverlayUi | null = createOverlayUi(doc);
  const unsubscribe: (() => void)[] = [];
  // Registered first so a navigation during the scan also ends the session.
  unsubscribe.push(endOnNavigation(doc.defaultView, () => stop()));
  // A function, not an inline comparison: `phase` changes across awaits and in callbacks.
  const closed = (): boolean => phase === "closed";

  const stop = (): void => {
    if (phase === "closed") return;
    phase = "closed";
    abort.abort();
    for (const off of unsubscribe.splice(0)) off();
    const p = player;
    player = null;
    try {
      p?.destroy();
    } catch (e) {
      console.warn("SwarmLoom: player.destroy failed", e);
    }
    ui?.destroy();
    ui = null;
    if (s.__swarmloomSession === session) delete s.__swarmloomSession;
  };

  const fail = (message: string, kind: "empty" | "failed"): void => {
    if (phase === "closed") return;
    phase = "error";
    error = message;
    const p = player;
    player = null;
    try {
      p?.destroy();
    } catch {
      // The panel below is what matters now.
    }
    const href = doc.location?.href;
    ui?.showError({
      title: strings.errorTitle,
      message: kind === "empty" ? strings.errorEmpty : format(strings.errorFailed, { message }),
      actions: [
        {
          label: strings.errorRetry,
          primary: true,
          run: () => {
            stop();
            startSession(scope, doc, launch, deps);
          },
        },
        {
          label: strings.errorStudio,
          run: () => {
            deps.openStudio(href?.startsWith("http") ? { src: href } : { importFile: true });
            stop();
          },
        },
        { label: strings.errorClose, run: stop },
      ],
      onDismiss: stop,
    });
  };

  async function run(): Promise<void> {
    ui?.showStatus(strings.statusScanning);
    const root: Element | Document = launch.kind === "element" ? (takeTarget(s, doc) ?? doc) : doc;
    const screenshot = launch.capture ? await deps.capturePoster(root, abort.signal).catch(() => null) : null;
    if (closed()) return;
    const request: SnapshotRequest = {
      origin: "document",
      prescroll: root === doc,
      signal: abort.signal,
      source: { type: "dom", url: doc.location?.href, title: doc.title || undefined },
      ...(screenshot ? { screenshot } : {}),
    };
    const blueprint = await deps.snapshot(root, request);
    if (closed()) return;
    if (!blueprint || !Array.isArray(blueprint.layers) || blueprint.layers.length === 0) {
      fail("empty", "empty");
      return;
    }
    ui?.hideStatus();
    const options: PlayerOptions = {
      ...toPlayerOptions(launch.prefs, {
        audio: deps.audioAvailable(),
        locale: launch.locale,
        seed: seedFrom(doc.location?.href ?? ""),
      }),
      messages: launch.playerMessages,
      blueprint,
      onLive: stop,
      onClose: stop,
    };
    const created = deps.createPlayer(options);
    if (closed()) {
      created.destroy();
      return;
    }
    player = created;
    phase = created.state;
    // Esc always ends the swarm and restores the page (the overlay covers it meanwhile).
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) stop();
    };
    doc.addEventListener("keydown", onKey, true);
    unsubscribe.push(() => doc.removeEventListener("keydown", onKey, true));
    unsubscribe.push(
      created.on("state", (e) => {
        if (phase === "closed" || phase === "error") return;
        phase = e.state;
        if (e.state === "destroyed") stop();
      }),
      created.on("error", (e) => console.warn("SwarmLoom:", e.error)),
    );
    // play() resolves when the build is complete; the session is "started" as soon as it runs.
    void created.play().catch((e: unknown) => fail(e instanceof Error ? e.message : String(e), "failed"));
  }

  let ready: Promise<void> = Promise.resolve();
  const session: SwarmSession = {
    get phase() {
      return phase;
    },
    get error() {
      return error;
    },
    get player() {
      return player;
    },
    get ready() {
      return ready;
    },
    launch,
    stop,
  };
  s.__swarmloomSession = session;
  ready = run().catch((e: unknown) => {
    if (abort.signal.aborted) return;
    fail(e instanceof Error ? e.message : String(e), "failed");
  });
  return session;
}

/** Stops the running session, or starts one. Returns the new session, or null when it stopped one. */
export function toggleSession(
  scope: object,
  doc: Document,
  launch: LaunchRequest,
  deps: SessionDeps,
): SwarmSession | null {
  const running = currentSession(scope);
  if (running && running.phase !== "closed") {
    running.stop();
    return null;
  }
  return startSession(scope, doc, launch, deps);
}
