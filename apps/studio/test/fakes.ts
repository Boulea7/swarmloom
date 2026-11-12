import type { LoadedSource, Player, PlayerEvent, PlayerOptions, PlayerState, SourceInput } from "@swarmloom/core";
import type { ExampleManifest } from "../src/examples/manifest";
import { formatOfName } from "../src/formats-meta";
import type { StudioLoadContext, StudioServices } from "../src/services";
import { CURSOR_PALETTE, decorCursor } from "../src/ui/brand";

/**
 * Test doubles for the packages Studio drives. Core's player is still a stub on main, so tests and
 * the screenshot page mount Studio with a fake player that shows the input in the stage host.
 */

export interface FakeLog {
  loads: SourceInput[];
  contexts: StudioLoadContext[];
  players: PlayerOptions[];
  /** The players handed out, in order (a test drives the newest as its toolbar would). */
  created: Player[];
  calls: string[];
}

type Listener = (event: PlayerEvent) => void;

const AGENTS = ["Ada", "Lin", "Kai", "Mo", "Ren"];

/** What the fake stage shows: the image itself for images and SVG, text lines otherwise. */
function preview(input: SourceInput, urls: string[]): HTMLElement {
  const doc = document.createElement("div");
  doc.className = "fake-doc";
  const type = formatOfName(input.name ?? "")?.id;
  if (type === "svg" || type === "image") {
    const blob = input.bytes
      ? new Blob([input.bytes as BlobPart])
      : new Blob([input.text ?? ""], { type: "image/svg+xml" });
    const url = URL.createObjectURL(type === "svg" ? new Blob([blob], { type: "image/svg+xml" }) : blob);
    urls.push(url);
    const img = document.createElement("img");
    img.src = url;
    img.alt = "";
    doc.append(img);
    return doc;
  }
  for (const width of [62, 94, 88, 71, 90, 54, 83, 77]) {
    const line = document.createElement("span");
    line.className = "fake-line";
    line.style.width = `${width}%`;
    doc.append(line);
  }
  return doc;
}

const FAKE_CSS = `
.fake-stage{position:absolute;inset:0;display:grid;place-items:center;padding:4%;overflow:hidden;background:var(--stage-bg,transparent)}
.fake-doc{display:grid;gap:14px;align-content:center;justify-items:center;width:min(760px,100%);max-height:100%;padding:6%;border-radius:10px;background:var(--surface);box-shadow:var(--shadow-md)}
.fake-doc img{display:block;max-width:100%;max-height:min(520px,60dvh);object-fit:contain}
.fake-line{display:block;justify-self:start;height:10px;border-radius:5px;background:var(--line-strong)}
.fake-stage .decor-cursor{position:absolute}
`;

/**
 * A player double: it renders a static preview with a few cursors and walks through the states.
 * `seekable` adds a logging seek() (off by default so screenshots keep the plain progress bar).
 */
export function fakePlayer(
  options: PlayerOptions,
  log: FakeLog,
  input: SourceInput | undefined,
  seekable = false,
): Player {
  const listeners = new Map<string, Set<Listener>>();
  const urls: string[] = [];
  let state: PlayerState = "idle";
  const progress = { built: 0, total: 48 };
  const emit = (event: PlayerEvent) => {
    for (const fn of listeners.get(event.type) ?? []) fn(event);
  };
  const setState = (next: PlayerState) => {
    state = next;
    emit({ type: "state", state: next });
  };
  // Like the engine, a changed speed, sound or follow mode is reported (the toolbar changes them).
  const sound = typeof options.sound === "object" ? options.sound.enabled !== false : options.sound !== false;
  const live = { speed: options.speed ?? 1, sound, follow: options.follow ?? "scroll" };
  const change = (patch: Partial<typeof live>) => {
    const next = { ...live, ...patch };
    if (next.speed === live.speed && next.sound === live.sound && next.follow === live.follow) return;
    Object.assign(live, next);
    emit({ type: "settings", ...live });
  };

  const host = options.host;
  if (host) {
    const style = document.createElement("style");
    style.textContent = FAKE_CSS;
    const stage = document.createElement("div");
    stage.className = "fake-stage";
    stage.dataset.fakeStage = options.blueprint.source.type;
    stage.append(style, preview(input ?? {}, urls));
    AGENTS.forEach((name, i) => {
      const cursor = decorCursor(name, CURSOR_PALETTE[i % CURSOR_PALETTE.length] ?? "#5B5BF7");
      cursor.style.left = `${18 + ((i * 17) % 64)}%`;
      cursor.style.top = `${22 + ((i * 29) % 56)}%`;
      stage.append(cursor);
    });
    host.append(stage);
  }

  const call = (name: string) => log.calls.push(name);
  return {
    get state() {
      return state;
    },
    progress,
    soundLog: [],
    async play() {
      call("play");
      setState("building");
      progress.built = Math.round(progress.total * 0.62);
      emit({ type: "progress", ...progress });
    },
    pause: () => {
      call("pause");
      setState("paused");
    },
    resume: () => {
      call("resume");
      setState("building");
    },
    setSpeed: (speed) => {
      call(`speed:${speed}`);
      change({ speed });
    },
    setSound: (on) => {
      call(`sound:${on}`);
      change({ sound: on });
    },
    setFollow: (mode) => {
      call(`follow:${mode}`);
      change({ follow: mode });
    },
    replay: () => call("replay"),
    goLive: () => call("goLive"),
    destroy() {
      call("destroy");
      for (const url of urls) URL.revokeObjectURL(url);
      host?.querySelector(".fake-stage")?.remove();
      state = "destroyed";
    },
    on(type, fn) {
      const set = listeners.get(type) ?? new Set<Listener>();
      listeners.set(type, set);
      set.add(fn as Listener);
      return () => set.delete(fn as Listener);
    },
    eta: () => 12_000,
    ready: async () => undefined,
    ...(seekable ? { seek: (t: number) => call(`seek:${t}`) } : {}),
  };
}

export interface FakeServicesOptions {
  manifest: ExampleManifest;
  examplesBase: string;
  target?: StudioServices["target"];
  /** Replaces the network; defaults to the real fetch (examples come from the dev server). */
  fetch?: typeof fetch;
  /** Players support seek(). */
  seekable?: boolean;
}

/** Studio services with a fake loader and player; everything they receive is logged. */
export function fakeServices(options: FakeServicesOptions): { services: StudioServices; log: FakeLog } {
  const log: FakeLog = { loads: [], contexts: [], players: [], created: [], calls: [] };
  let lastInput: SourceInput | undefined;
  const services: StudioServices = {
    target: options.target ?? "web",
    manifest: options.manifest,
    examplesBase: options.examplesBase,
    fetch: options.fetch ?? ((input, init) => fetch(input, init)),
    async load(input, ctx): Promise<LoadedSource> {
      log.loads.push(input);
      log.contexts.push(ctx);
      lastInput = input;
      const type = formatOfName(input.name ?? "")?.id ?? "html";
      return {
        blueprint: {
          version: 1,
          source: { type, name: input.name },
          size: { w: 1200, h: 800 },
          background: "transparent",
          layers: [],
        },
      };
    },
    createPlayer(playerOptions) {
      log.players.push(playerOptions);
      const player = fakePlayer(playerOptions, log, lastInput, options.seekable);
      log.created.push(player);
      return player;
    },
  };
  return { services, log };
}
