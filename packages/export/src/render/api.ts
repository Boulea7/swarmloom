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
import { blueprintSha256 } from "./digest";
import { LiveStage, livePageOf, watchShadowRoots } from "./live";
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
  /**
   * Detects and loads the input (normally `load` from `@swarmloom/formats`). `height` is the frame
   * height, the viewport height for adapters that lay out pages. An HTML adapter that keeps its live
   * page (`LoadedHtml.live`) gets it shown on go live.
   */
  load(input: SourceInput, ctx: AdapterContext, options: { format?: string; height: number }): Promise<LoadedSource>;
  createPlayer(options: PlayerOptions): Player;
  renderAudioWav(events: readonly SoundEvent[], durationMs: number, opts?: RenderOfflineOptions): Promise<Uint8Array>;
  /** Document the stage is mounted in. Default `globalThis.document`. */
  document?: Document;
  /**
   * Resolve `init()` and each `step()` only after the page's next few animation frames, so the
   * browser has painted, rastered and shown the new state before the driver takes a screenshot (the
   * CLI). Default false: a driver that draws the frames itself (Studio's in-page export) needs no paint.
   */
  awaitPaint?: boolean;
}

const SAMPLE_RATE = 48_000;
const HOST_ID = "swarmloom-render";
/** Animation frames init() and step() wait for with `awaitPaint` (see {@link paintFrames}). */
const PAINT_FRAMES = 3;
/** Longest wait for those frames (a hidden page gets none). */
const FRAME_WAIT_MS = 1000;

interface Active {
  init: ParsedInit;
  loaded: LoadedSource;
  session: RenderSession;
  live: LiveStage;
  host: HTMLElement;
  /** Window whose animation frames init() and step() wait for, or null when they do not wait. */
  paint: Window | null;
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

/**
 * Resolves after the page's next PAINT_FRAMES animation frames, after FRAME_WAIT_MS at the latest.
 *
 * The first frame paints the state a step left. Chromium rasters and activates that commit before
 * it starts another main frame, so by the later frames the regular raster workers have drawn it.
 * A screenshot requested before that forces the commit through a different raster path, and only
 * sometimes, by timing: rounded corners and other anti-aliased edges then came out a shade apart
 * between two runs of the same render (one frame in a few hundred at --scale 0.5, 2.5 or 3).
 */
function paintFrames(view: Window | null): Promise<void> {
  if (!view || typeof view.requestAnimationFrame !== "function") return Promise.resolve();
  return new Promise((resolve) => {
    const timer = view.setTimeout(resolve, FRAME_WAIT_MS);
    const frame = (left: number): void => {
      if (left > 0) {
        view.requestAnimationFrame(() => frame(left - 1));
        return;
      }
      view.clearTimeout(timer);
      resolve();
    };
    frame(PAINT_FRAMES);
  });
}

function playerOptions(
  init: ParsedInit,
  loaded: LoadedSource,
  host: HTMLElement,
  onLive: () => void,
): Omit<PlayerOptions, "clock"> {
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
    onLive,
  };
  if (init.agents !== undefined) options.agents = init.agents;
  if (init.speed !== undefined) options.speed = init.speed;
  if (init.labels !== undefined) options.labels = init.labels;
  if (init.overlays !== undefined) options.overlays = init.overlays;
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
 *
 * Unless `live` is off or `reducedMotion` is on, the player goes live once the finale settles; from
 * the moment the stage is live every step also seeks the page's animations to the frame time
 * (see {@link LiveStage}), so the tail plays the finished page deterministically.
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
      current.live.dispose();
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
      let live: LiveStage | null = null;
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
        loaded = init.blueprint
          ? { blueprint: init.blueprint }
          : await deps.load(source, ctx, { format, height: init.height });
        // Recoverable: the render goes on; the CLI echoes these with --verbose.
        const warn = (message: string) => console.warn(`[swarmloom] ${message}`);
        const view = doc.defaultView as (Window & typeof globalThis) | null;
        if (!view) throw new Error("The render page has no window");
        // Watch from before the player exists: the stage attaches its world's shadow root right away.
        const stage = new LiveStage({
          document: doc,
          host,
          shadows: watchShadowRoots(view),
          page: livePageOf(loaded),
          onWarning: warn,
        });
        live = stage;
        const started = new RenderSession({
          player: playerOptions(init, loaded, host, () => stage.goLive(started.elapsed)),
          tailMs: init.tail,
          live: init.live && !init.reducedMotion,
          cues: init.cues,
          createPlayer: deps.createPlayer,
          onWarning: (error) => warn(error.message),
        });
        session = started;
        await session.start();
        const sha = await blueprintSha256(loaded.blueprint, init.input.url);
        const paint = deps.awaitPaint ? view : null;
        active = { init, loaded, session, live: stage, host, paint };
        await paintFrames(paint);
        const eta = session.player.eta();
        return {
          estimatedMs: Math.round((Number.isFinite(eta) && eta > 0 ? eta : 0) + init.tail),
          layers: loaded.blueprint.layers.length,
          blueprintSha256: sha,
        };
      } catch (error) {
        session?.dispose();
        live?.dispose();
        loaded?.dispose?.();
        host?.remove();
        throw error;
      } finally {
        initializing = false;
      }
    },

    async step(ms: number): Promise<RenderStep> {
      const { session, live, paint } = activeRender();
      const status = await session.step(ms);
      live.sync(session.elapsed);
      await paintFrames(paint);
      return status;
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
