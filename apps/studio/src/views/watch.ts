import type { PlayerOptions, PlayerState } from "@swarmloom/core";
import type { AppContext, View } from "../context";
import { type ExampleEntry, entriesForLocale } from "../examples/manifest";
import { formatById } from "../formats-meta";
import { restorable, routeToUrl, type SourceRef } from "../route";
import { Session, type SessionPhase } from "../session";
import { h, s } from "../ui/dom";
import { icon } from "../ui/icons";
import { qrCode } from "./qr";
import { thumbnail } from "./thumb";

/** Player options for a wrist: a few cursors, no name tags, no toolbar, silent. */
export const WATCH_OVERRIDES: Partial<PlayerOptions> = {
  agents: 3,
  labels: "none",
  controls: false,
  sound: false,
  finale: "none",
  follow: "tour",
};

/** Pause between two examples while cycling. */
const CYCLE_DELAY_MS = 2400;
/** Controls fade out this long after the last touch while playing. */
const CONTROLS_IDLE_MS = 2600;

type Item = { ref: SourceRef; title: string; entry?: ExampleEntry };

/** What the watch cycles through: the requested source first, then the light examples. */
function playlist(ctx: AppContext): Item[] {
  const examples = entriesForLocale(ctx.services.manifest, ctx.i18n.locale, ctx.formats).filter(
    (e) => formatById(e.format)?.light,
  );
  const items: Item[] = examples.map((entry) => ({
    ref: { kind: "example", id: entry.id },
    title: entry.title,
    entry,
  }));
  const source = ctx.route.source;
  if (!source) return items;
  if (source.kind === "example") {
    const at = items.findIndex((i) => i.ref.kind === "example" && i.ref.id === source.id);
    if (at > 0) items.unshift(...items.splice(at, 1));
    if (at >= 0) return items;
    const entry = ctx.services.manifest.entries.find((e) => e.id === source.id);
    return [{ ref: source, title: entry?.title ?? source.id, entry }, ...items];
  }
  return [{ ref: source, title: ctx.local?.name ?? "" }, ...items];
}

/**
 * Watch face (`?watch=1`, or a watch-sized screen): a static poster first, one big
 * play button, a progress ring, muted playback that cycles through the light examples, and a QR
 * code to continue on a phone. `?round=1` keeps everything inside the inscribed square of a
 * circular display.
 */
export function createWatch(ctx: AppContext): View {
  const { i18n } = ctx;
  const items = playlist(ctx);
  let index = 0;
  let session: Session | null = null;
  let phase: SessionPhase | "idle" = "idle";
  let state: PlayerState = "idle";
  /** Once the wearer pressed play, later examples start on their own. */
  let engaged = ctx.route.autoplay;
  let cycleTimer = 0;
  let idleTimer = 0;

  const host = h("div", { class: "watch-stage", data: { stageHost: "" } });
  const poster = h("div", { class: "watch-poster" });
  const ringFill = s("circle", { class: "watch-ring-fill", cx: 50, cy: 50, r: 48.5, pathLength: 100 });
  const ring = s(
    "svg",
    { class: "watch-ring", viewBox: "0 0 100 100", "aria-hidden": "true" },
    s("circle", { class: "watch-ring-track", cx: 50, cy: 50, r: 48.5 }),
    ringFill,
  );
  const barFill = h("span", { class: "watch-bar-fill" });
  const bar = h("div", { class: "watch-bar", attrs: { "aria-hidden": "true" } }, barFill);
  const progress = h("div", {
    class: "visually-hidden",
    attrs: {
      role: "progressbar",
      "aria-label": i18n.t("watch.progress"),
      "aria-valuemin": 0,
      "aria-valuemax": 100,
      "aria-valuenow": 0,
    },
  });

  const title = h("p", { class: "watch-title" });
  const playIcon = h("span", { class: "watch-play-icon" }, icon("play", 34));
  const play = h(
    "button",
    {
      class: "watch-play",
      attrs: { type: "button", "aria-label": i18n.t("watch.play") },
      on: {
        click: (e) => {
          e.stopPropagation();
          toggle();
        },
      },
    },
    playIcon,
  );
  const next = h(
    "button",
    {
      class: "watch-icon-btn",
      attrs: { type: "button", "aria-label": i18n.t("watch.next") },
      on: {
        click: (e) => {
          e.stopPropagation();
          advance(true);
        },
      },
    },
    icon("next", 18),
  );
  const phone = h(
    "button",
    {
      class: "watch-icon-btn",
      attrs: { type: "button", "aria-label": i18n.t("watch.phone") },
      on: {
        click: (e) => {
          e.stopPropagation();
          showQr();
        },
      },
    },
    icon("phone", 18),
  );
  const actions = h("div", { class: "watch-actions" }, items.length > 1 ? next : null, phone);
  // Keyboard users bring the faded controls back: a control with focus is never left hidden.
  const safe = h(
    "div",
    { class: "watch-safe", on: { focusin: () => wake(), focusout: () => wake(), keydown: () => wake() } },
    title,
    play,
    actions,
  );

  const qrBox = h("div", { class: "watch-qr-code" });
  // A native modal <dialog>: while open, the covered player and the rest of the page are inert,
  // so Tab and screen readers stay inside it; Esc closes it like the Back button.
  const qr = h(
    "dialog",
    { class: "watch-qr", attrs: { "aria-label": i18n.t("watch.scan") } },
    qrBox,
    h("p", { class: "watch-qr-caption", text: i18n.t("watch.scan") }),
    h(
      "button",
      {
        class: "watch-icon-btn",
        attrs: { type: "button", "aria-label": i18n.t("watch.back") },
        on: {
          click: (e) => {
            e.stopPropagation();
            hideQr();
          },
        },
      },
      icon("close", 18),
    ),
  );

  const face = h(
    "div",
    { class: "watch-face", on: { click: () => wake() } },
    host,
    poster,
    ring,
    bar,
    safe,
    qr,
    progress,
  );
  const root = h(
    "main",
    {
      class: "view view-watch",
      attrs: { id: "main", tabindex: -1 },
      data: { round: ctx.route.round ? "true" : "false", controls: "shown" },
    },
    face,
  );

  if (items.length === 0) {
    title.textContent = i18n.t("watch.empty");
    play.hidden = true;
    actions.hidden = true;
  }

  const setProgress = (fraction: number) => {
    const f = Math.max(0, Math.min(1, fraction));
    ringFill.style.strokeDashoffset = String(100 - f * 100);
    // A round line cap would draw a dot at zero progress.
    ringFill.style.opacity = f > 0 ? "1" : "0";
    barFill.style.transform = `scaleX(${f})`;
    progress.setAttribute("aria-valuenow", String(Math.round(f * 100)));
  };

  const render = () => {
    const playing = state === "intro" || state === "building" || state === "finale";
    root.dataset.phase = phase;
    root.dataset.playing = playing ? "true" : "false";
    playIcon.replaceChildren(icon(playing ? "pause" : "play", 34));
    play.setAttribute("aria-label", i18n.t(playing ? "watch.pause" : "watch.play"));
    poster.hidden = phase === "playing" || phase === "done";
  };

  /** A control shows a keyboard focus ring: fading the controls would hide where focus is. */
  const keyboardFocus = () => {
    try {
      return safe.querySelector(":focus-visible") !== null;
    } catch {
      // No `:focus-visible` (old engines): fade as before.
      return false;
    }
  };

  const showControls = (hold: boolean) => {
    root.dataset.controls = "shown";
    window.clearTimeout(idleTimer);
    if (hold) return;
    idleTimer = window.setTimeout(() => {
      if (root.dataset.playing === "true" && !keyboardFocus()) root.dataset.controls = "hidden";
    }, CONTROLS_IDLE_MS);
  };

  function wake(): void {
    if (qr.open) return;
    showControls(root.dataset.playing !== "true");
  }

  function load(item: Item, autostart: boolean): void {
    window.clearTimeout(cycleTimer);
    session?.destroy();
    host.replaceChildren();
    state = "idle";
    phase = "idle";
    setProgress(0);
    title.textContent = item.title;
    poster.replaceChildren(
      item.entry ? thumbnail(item.entry, ctx.services.examplesBase) : h("div", { class: "thumb" }),
    );
    render();
    showControls(true);
    if (!autostart) return;
    const current = new Session({
      services: ctx.services,
      host,
      ref: item.ref,
      local: ctx.local,
      settings: ctx.settings,
      locale: i18n.locale,
      scheme: ctx.scheme,
      overrides: WATCH_OVERRIDES,
      onPhase: (next) => {
        phase = next;
        if (next === "ready") current.start();
        if (next === "done") {
          setProgress(1);
          cycleTimer = window.setTimeout(() => advance(false), CYCLE_DELAY_MS);
        }
        if (next === "error") cycleTimer = window.setTimeout(() => advance(false), CYCLE_DELAY_MS);
        render();
        if (next === "playing") showControls(false);
        if (next === "done" || next === "error") showControls(true);
      },
      onProgress: (built, total) => setProgress(total > 0 ? built / total : 0),
      onState: (next) => {
        state = next;
        render();
      },
    });
    session = current;
    void current.open();
  }

  function toggle(): void {
    const item = items[index];
    if (!item) return;
    const player = session?.player;
    if (!session || phase === "idle" || phase === "error") {
      engaged = true;
      load(item, true);
      return;
    }
    if (!player) return;
    if (state === "paused") {
      player.resume();
      showControls(false);
    } else if (state === "done" || state === "live") {
      session.rebuild(true);
    } else if (state === "intro" || state === "building" || state === "finale") {
      player.pause();
      showControls(true);
    }
  }

  function advance(byUser: boolean): void {
    if (items.length === 0) return;
    index = (index + 1) % items.length;
    const item = items[index];
    if (item) load(item, engaged || byUser);
    if (byUser) engaged = true;
  }

  function phoneUrl(): string {
    const item = items[index];
    const ref = item?.ref;
    if (!ref || !restorable(ref)) return ctx.appUrl;
    return routeToUrl({ source: ref, autoplay: true }, ctx.appUrl);
  }

  function showQr(): void {
    qrBox.replaceChildren(qrCode(phoneUrl(), i18n.t("watch.scan")));
    if (!qr.open) qr.showModal();
    root.dataset.qr = "true";
    session?.player?.pause();
    qr.querySelector("button")?.focus();
  }

  function hideQr(): void {
    if (qr.open) qr.close();
    root.dataset.qr = "false";
    if (phone.isConnected) phone.focus();
  }

  // The browser can close the dialog itself (Esc, Android back); sync the face when it does.
  qr.addEventListener("close", () => {
    if (root.dataset.qr === "true") hideQr();
  });

  const first = items[0];
  if (first) load(first, engaged);

  return {
    root,
    onKey(event) {
      if (qr.open) {
        if (event.key !== "Escape") return false;
        hideQr();
        return true;
      }
      if ((event.key === "n" || event.key === "N" || event.key === "ArrowRight") && !event.metaKey && !event.ctrlKey) {
        advance(true);
        return true;
      }
      if (event.key === " " && event.target === document.body) {
        toggle();
        return true;
      }
      return false;
    },
    destroy() {
      window.clearTimeout(cycleTimer);
      window.clearTimeout(idleTimer);
      session?.destroy();
      session = null;
    },
  };
}
