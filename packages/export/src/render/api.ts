import type {
  AdapterContext,
  LoadedSource,
  Player,
  PlayerOptions,
  RenderOfflineOptions,
  SoundEvent,
  SourceInput,
} from "@swarmloom/core";
import { base64ToBytes, bytesToBase64 } from "../base64";
import { RenderSession } from "../session";
import {
  type ParsedInit,
  parseInit,
  type RenderApi,
  type RenderInfo,
  type RenderInit,
  type RenderStep,
} from "./protocol";

/** Services the render page needs; injected so the protocol can be tested with fakes. */
export interface RenderDeps {
  /** Detects and loads the input (normally `load` from `@swarmloom/formats`). */
  load(input: SourceInput, ctx: AdapterContext, options: { format?: string }): Promise<LoadedSource>;
  createPlayer(options: PlayerOptions): Player;
  renderAudioWav(events: readonly SoundEvent[], durationMs: number, opts?: RenderOfflineOptions): Promise<Uint8Array>;
  /** Document the stage is mounted in. Default `globalThis.document`. */
  document?: Document;
}

const SAMPLE_RATE = 48_000;
const HOST_ID = "swarmloom-render";

interface Active {
  init: ParsedInit;
  loaded: LoadedSource;
  session: RenderSession;
  host: HTMLElement;
}

function toSourceInput({ input }: ParsedInit): { source: SourceInput; format?: string } {
  const source: SourceInput = { name: input.name };
  if (input.base64 !== undefined) source.bytes = base64ToBytes(input.base64);
  if (input.text !== undefined) source.text = input.text;
  if (input.url) source.url = input.url;
  if (input.type?.includes("/")) {
    source.type = input.type;
    return { source };
  }
  return { source, format: input.type || undefined };
}

/**
 * Width of the scrollbar gutter an inline stage reserves (thin, `scrollbar-gutter: stable`).
 * Chromium keeps reserving it when the render browser hides its scrollbars.
 */
function stageGutter(doc: Document): number {
  const probe = doc.createElement("div");
  probe.style.cssText =
    "position:absolute;visibility:hidden;width:100px;height:10px;overflow:hidden;" +
    "scrollbar-gutter:stable;scrollbar-width:thin";
  doc.body.append(probe);
  const gutter = probe.offsetWidth - probe.clientWidth;
  probe.remove();
  return Math.max(0, gutter);
}

/**
 * Mounts the stage host. It is wider than the frame by the stage's scrollbar gutter, so the gutter
 * lies past the right edge instead of showing as an empty strip, and the stage fits content laid
 * out at `width` at scale 1.
 */
function mountHost(doc: Document, width: number, height: number): HTMLElement {
  doc.getElementById(HOST_ID)?.remove();
  const root = doc.documentElement;
  root.style.cssText = `margin:0;padding:0;overflow:hidden;width:${width}px;height:${height}px`;
  doc.body.style.cssText = "margin:0;padding:0;overflow:hidden";
  const host = doc.createElement("div");
  host.id = HOST_ID;
  host.style.cssText = `position:fixed;left:0;top:0;width:${width + stageGutter(doc)}px;height:${height}px;overflow:hidden`;
  doc.body.append(host);
  return host;
}

/** SHA-256 (hex) of the blueprint's JSON; empty when the page has no Web Crypto (not a secure context). */
async function blueprintSha256(loaded: LoadedSource): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return "";
  const digest = await subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(loaded.blueprint)));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function playerOptions(init: ParsedInit, loaded: LoadedSource, host: HTMLElement): Omit<PlayerOptions, "clock"> {
  const options: Omit<PlayerOptions, "clock"> = {
    blueprint: loaded.blueprint,
    plugins: loaded.plugins,
    mode: "inline",
    host,
    seed: init.seed,
    theme: init.theme,
    follow: init.follow,
    reducedMotion: init.reducedMotion,
    controls: false,
    intro: true,
    sound: init.sound ? { enabled: true, pack: init.pack, bpm: init.bpm, beatSync: true } : false,
  };
  if (init.agents !== undefined) options.agents = init.agents;
  if (init.speed !== undefined) options.speed = init.speed;
  if (init.labels !== undefined) options.labels = init.labels;
  if (init.finale !== undefined) options.finale = init.finale;
  if (init.locale !== undefined) options.locale = init.locale;
  return options;
}

/**
 * Implements the headless render protocol (`window.__swarmloom`) the CLI drives frame by frame.
 *
 * One render at a time: `init()` loads the input and creates a player on a VirtualClock with the
 * toolbar off, `step()` advances it, `audioWav()` renders the soundtrack for the elapsed time and
 * `dispose()` releases everything. Errors reject with messages meant for the CLI user.
 */
export function createRenderApi(deps: RenderDeps): RenderApi {
  let active: Active | null = null;
  let initializing = false;

  const activeRender = (): Active => {
    if (!active) throw new Error("Call init() first");
    return active;
  };

  const dispose = (): void => {
    const current = active;
    active = null;
    if (!current) return;
    try {
      current.session.dispose();
    } finally {
      current.loaded.dispose?.();
      current.host.remove();
    }
  };

  return {
    async init(o: RenderInit): Promise<RenderInfo> {
      if (active || initializing) throw new Error("A render is already active; call dispose() first");
      initializing = true;
      const doc = deps.document ?? globalThis.document;
      let loaded: LoadedSource | null = null;
      let session: RenderSession | null = null;
      let host: HTMLElement | null = null;
      try {
        const init = parseInit(o);
        host = mountHost(doc, init.width, init.height);
        const { source, format } = toSourceInput(init);
        const dark =
          init.theme === "dark" ||
          (init.theme === "auto" && (doc.defaultView?.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false));
        const ctx: AdapterContext = {
          document: doc,
          width: init.width,
          theme: dark ? "dark" : "light",
          locale: init.locale,
        };
        loaded = await deps.load(source, ctx, { format });
        session = new RenderSession({
          player: playerOptions(init, loaded, host),
          tailMs: init.tail,
          cues: init.cues,
          createPlayer: deps.createPlayer,
          // Recoverable: the render goes on; the CLI echoes these with --verbose.
          onWarning: (error) => console.warn(`[swarmloom] ${error.message}`),
        });
        await session.start();
        const sha = await blueprintSha256(loaded);
        active = { init, loaded, session, host };
        const eta = session.player.eta();
        return {
          estimatedMs: Math.round((Number.isFinite(eta) && eta > 0 ? eta : 0) + init.tail),
          layers: loaded.blueprint.layers.length,
          blueprintSha256: sha,
        };
      } catch (error) {
        session?.dispose();
        loaded?.dispose?.();
        host?.remove();
        throw error;
      } finally {
        initializing = false;
      }
    },

    async step(ms: number): Promise<RenderStep> {
      return activeRender().session.step(ms);
    },

    async audioWav(): Promise<string> {
      const { init, session } = activeRender();
      if (session.elapsed <= 0) throw new Error("Nothing rendered yet: call step() before audioWav()");
      const events = init.sound ? session.soundLog : [];
      const sound = { enabled: true, pack: init.pack, bpm: init.bpm, beatSync: true };
      const wav = await deps.renderAudioWav(events, session.elapsed, { sampleRate: SAMPLE_RATE, channels: 2, sound });
      return bytesToBase64(wav);
    },

    async soundLog(): Promise<SoundEvent[]> {
      return activeRender().session.soundLog.map((event) => ({ ...event }));
    },

    dispose,
  };
}
