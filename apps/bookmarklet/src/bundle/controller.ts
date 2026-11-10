import type { Blueprint, BlueprintSource, Player, PlayerOptions, PlayerState } from "@swarmloom/core";
import { handoffToStudio } from "../handoff";
import { type BookmarkletOptions, parseOptions } from "../options";
import { type BookmarkletHandle, type BookmarkletState, SCRIPT_ID } from "../protocol";
import { serializePage } from "../serialize";
import { noticeMessages } from "./messages";
import { watchNavigation } from "./navigation";
import { type Notice, showNotice } from "./notice";

/** Snapshot function the controller needs (the real one is `snapshot` from `@swarmloom/snapshot-dom`). */
export type SnapshotFn = (root: Document, opts: { source: BlueprintSource; signal: AbortSignal }) => Promise<Blueprint>;

/** Collaborators of {@link createController}; tests pass fakes. */
export interface ControllerDeps {
  win: Window;
  doc: Document;
  snapshot: SnapshotFn;
  createPlayer: (options: PlayerOptions) => Player;
  /** Absolute Studio URL used when the user hands the page over from the failure notice. */
  studioUrl: URL;
}

/** Player states in which a rebuild is still in progress, so a toggle stops it. */
const IN_PROGRESS: ReadonlySet<PlayerState> = new Set(["idle", "intro", "building", "paused", "finale"]);

/** FNV-1a: a stable 32-bit seed from the page URL, so each page gets its own choreography. */
function hashSeed(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

function playerOptions(blueprint: Blueprint, o: BookmarkletOptions, seed: number, onClose: () => void): PlayerOptions {
  return {
    blueprint,
    mode: "overlay",
    controls: true,
    seed: o.seed ?? seed,
    speed: o.speed,
    sound: o.sound,
    agents: o.agents,
    labels: o.labels,
    finale: o.finale,
    theme: o.theme,
    follow: o.follow,
    locale: o.locale,
    onClose,
  };
}

/**
 * Creates the hosted bundle's controller: snapshot the page, rebuild it in an overlay player
 * with the built-in toolbar, and on failure offer to hand a copy to the Studio.
 *
 * Runs are numbered; every async continuation checks that its run is still current, so a
 * toggle during the snapshot cancels cleanly. Leaving the page (or a single-page app route
 * change) ends whatever runs, see {@link watchNavigation}.
 */
export function createController(deps: ControllerDeps): BookmarkletHandle {
  const { win, doc } = deps;
  let state: BookmarkletState = "idle";
  let run = 0;
  let abort: AbortController | null = null;
  let player: Player | null = null;
  let notice: Notice | null = null;
  let locale: string | undefined;

  const teardown = () => {
    run++;
    abort?.abort();
    abort = null;
    notice?.close();
    notice = null;
    const current = player;
    player = null;
    if (current && current.state !== "destroyed") {
      try {
        current.destroy();
      } catch (error) {
        console.warn("[swarmloom] destroying the player failed", error);
      }
    }
    state = "idle";
  };

  watchNavigation(win, () => {
    if (state !== "idle") teardown();
  });

  const offerStudio = (hint?: string) => {
    notice = showNotice({
      doc,
      messages: noticeMessages(locale),
      hint,
      onStudio: () => {
        notice = null;
        // The notice is gone before serializing, so the copy does not contain it.
        const payload = serializePage(win, doc, "manual");
        if (handoffToStudio(win, deps.studioUrl, payload)) state = "idle";
        else offerStudio(noticeMessages(locale).popupBlocked);
      },
      onClose: () => {
        notice = null;
        state = "idle";
      },
    });
  };

  const fail = (id: number, error: unknown) => {
    if (id !== run) return;
    console.error("[swarmloom] rebuilding this page failed", error);
    teardown();
    state = "failed";
    offerStudio();
  };

  const start = async (raw: string | null | undefined) => {
    teardown();
    const id = run;
    const { options, problems } = parseOptions(raw);
    if (problems.length) console.warn(`[swarmloom] ignored options: ${problems.join("; ")}`);
    locale = options.locale ?? win.navigator.language;
    // Whatever a previous click left behind (pending script, "Open in Studio" button).
    doc.getElementById(SCRIPT_ID)?.remove();
    state = "starting";
    abort = new AbortController();
    try {
      const blueprint = await deps.snapshot(doc, {
        source: { type: "dom", url: doc.URL, title: doc.title },
        signal: abort.signal,
      });
      if (id !== run) return;
      const created = deps.createPlayer(
        playerOptions(blueprint, options, hashSeed(doc.URL), () => {
          if (player === created) teardown();
        }),
      );
      player = created;
      state = "running";
      created.on("error", (e) => console.warn("[swarmloom] player error", e.error));
      await created.play();
    } catch (error) {
      fail(id, error);
    }
  };

  return {
    get state() {
      return state;
    },
    toggle(raw) {
      const inProgress = state === "starting" || (state === "running" && player && IN_PROGRESS.has(player.state));
      if (inProgress) teardown();
      else void start(raw);
    },
  };
}
