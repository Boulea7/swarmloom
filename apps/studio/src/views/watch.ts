import type { PlayerOptions, PlayerState } from "@swarmloom/core";
import type { AppContext, View } from "../context";
import { describeError } from "../errors";
import { type ExampleEntry, entriesForLocale } from "../examples/manifest";
import { formatById } from "../formats-meta";
import { portable, routeToUrl, type SourceRef } from "../route";
import { Session, type SessionPhase } from "../session";
import { decodeShare } from "../share";
import { nameOfRef, type OpenedSource, resolveSource } from "../source";
import { nextId } from "../ui/controls";
import { h, s } from "../ui/dom";
import { icon } from "../ui/icons";
import { qrCode } from "./qr";
import { buildShareLink, shareableSettings, shareRefusalKey } from "./share-link";
import { thumbnail } from "./thumb";

/**
 * Player options for a wrist: a few cursors, no name tags, no rulers or size badges (they would
 * cover a fifth of a small face), no toolbar, silent.
 */
export const WATCH_OVERRIDES: Partial<PlayerOptions> = {
  agents: 3,
  labels: "none",
  overlays: "minimal",
  controls: false,
  sound: false,
  finale: "none",
  follow: "tour",
};

/** Pause between two examples while cycling. */
const CYCLE_DELAY_MS = 2400;
/** Controls fade out this long after the last touch while playing. */
const CONTROLS_IDLE_MS = 2600;
/** Controls fade out this soon once playback starts or resumes: the wearer just asked to watch. */
const PLAY_IDLE_MS = 600;

type Item = {
  ref: SourceRef;
  title: string;
  entry?: ExampleEntry;
  /** The source read once, for a source no link can name (see openedOf in createWatch). */
  opened?: Promise<OpenedSource>;
};

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
  // Named by its reference where it can be (a URL's file name), else once it is read (see named).
  return [{ ref: source, title: nameOfRef(source, ctx.local) }, ...items];
}

/**
 * Watch face (`?watch=1`, or a watch-sized screen): a static poster first, one big
 * play button, a progress ring, muted playback that cycles through the light examples, and a QR
 * code to continue on a phone. While a build plays or is paused, the controls sit small along the
 * bottom and fade soon after play. `?round=1` keeps the stage and every control inside the
 * inscribed square of a circular display.
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

  // Off screen on a small face and while a build plays, but always on the page: with the poster
  // decorative, it is what names the example to a screen reader (see advance for when it speaks).
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
  // A status: a link read after the dialog opens (a local file, pasted text, a handoff) says when
  // its code is ready or why there is none, while a screen reader's focus stays on Back.
  // Named by its own words, for when a notice takes focus to scroll (see drawQr).
  const qrCaptionId = nextId("watch-qr-caption");
  const qrCaption = h("p", {
    class: "watch-qr-caption",
    text: i18n.t("watch.scan"),
    attrs: { id: qrCaptionId, role: "status", "aria-labelledby": qrCaptionId },
  });
  /** Bumped per QR code shown, so a link that is read late never replaces a newer one. */
  let qrRequest = 0;
  /** What the open dialog shows (null: the link is still read), drawn again when its room changes. */
  let qrShown: { url: string } | { notice: string } | null = null;
  /** Ends the reads of sources still running when the face goes. */
  const lifetime = new AbortController();
  const back = h(
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
  );
  // A native modal <dialog>: while open, the covered player and the rest of the page are inert,
  // so Tab and screen readers stay inside it; Esc closes it like the Back button.
  const qr = h(
    "dialog",
    { class: "watch-qr", attrs: { "aria-label": i18n.t("watch.phone"), "aria-describedby": qrCaption.id } },
    qrBox,
    qrCaption,
    back,
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

  /** Shows the controls; unless `hold`, they fade `idleMs` later if still playing. */
  const showControls = (hold: boolean, idleMs = CONTROLS_IDLE_MS) => {
    root.dataset.controls = "shown";
    window.clearTimeout(idleTimer);
    if (hold) return;
    idleTimer = window.setTimeout(() => {
      if (root.dataset.playing === "true" && !keyboardFocus()) root.dataset.controls = "hidden";
    }, idleMs);
  };

  /**
   * Moves on to the next example a little after a build ends or fails. A pause holds the face on
   * the example, and a replay (a new run: the phase leaves "done") drops the pending move.
   */
  const syncCycle = () => {
    const due = phase === "error" || (phase === "done" && state !== "paused");
    if (!due) {
      window.clearTimeout(cycleTimer);
      cycleTimer = 0;
    } else if (cycleTimer === 0) {
      cycleTimer = window.setTimeout(() => {
        cycleTimer = 0;
        advance(false);
      }, CYCLE_DELAY_MS);
    }
  };

  function wake(): void {
    if (qr.open) return;
    showControls(root.dataset.playing !== "true");
  }

  /**
   * Reads a source no link can name (a local file, pasted text, a handoff) once, for all its plays
   * and its phone link: a handoff cannot be read twice. A failed read is tried again next time.
   */
  function openedOf(item: Item): Promise<OpenedSource> {
    if (!item.opened) {
      const opened = resolveSource(item.ref, { services: ctx.services, local: ctx.local, signal: lifetime.signal });
      item.opened = opened;
      opened.then(
        (source) => named(item, source.title),
        () => {
          if (item.opened === opened) item.opened = undefined;
        },
      );
    }
    return item.opened;
  }

  /** Gives `item` the title its source was read with, on the face too when it is the one shown. */
  function named(item: Item, name: string): void {
    if (!name || name === item.title || lifetime.signal.aborted) return;
    item.title = name;
    if (items[index] === item) title.textContent = name;
  }

  function load(item: Item, autostart: boolean): void {
    session?.destroy();
    host.replaceChildren();
    state = "idle";
    phase = "idle";
    syncCycle();
    setProgress(0);
    // The same title again (a retry after an error) is no news to a screen reader.
    if (title.textContent !== item.title) title.textContent = item.title;
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
      resolve: portable(item.ref) ? undefined : () => openedOf(item),
      onPhase: (next) => {
        phase = next;
        if (current.opened) named(item, current.opened.title);
        if (next === "ready") current.start();
        if (next === "done") setProgress(1);
        syncCycle();
        render();
        if (next === "playing") showControls(false, PLAY_IDLE_MS);
        if (next === "done" || next === "error") showControls(true);
      },
      onProgress: (built, total) => setProgress(total > 0 ? built / total : 0),
      onState: (next) => {
        state = next;
        syncCycle();
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
      showControls(false, PLAY_IDLE_MS);
    } else if (state === "done" || state === "live") {
      session.rebuild(true);
    } else if (state === "intro" || state === "building" || state === "finale") {
      player.pause();
      showControls(true);
    }
  }

  function advance(byUser: boolean): void {
    if (items.length === 0) return;
    // Next says the new title; the cycle after a build moves on quietly, as an auto-rotating
    // carousel does (WAI-ARIA APG), with the title there to read.
    title.setAttribute("aria-live", byUser ? "polite" : "off");
    index = (index + 1) % items.length;
    const item = items[index];
    if (item) load(item, engaged || byUser);
    if (byUser) engaged = true;
  }

  /**
   * The phone link for a source no link can name: like Share, small text travels in `#d=`. A
   * notice instead says why it cannot (binary, too large, a bookmarklet page, unreadable).
   */
  async function carriedLink(item: Item): Promise<{ url: string } | { notice: string }> {
    let opened: OpenedSource;
    try {
      opened = await openedOf(item);
    } catch (error) {
      return { notice: describeError(error, i18n, { formats: ctx.formatList(), label: item.title }) };
    }
    const link = await buildShareLink(opened, ctx.settings, ctx.shareUrl);
    if (link.ok) return { url: link.url };
    return { notice: i18n.t(shareRefusalKey(link.reason)) };
  }

  /**
   * The width in device pixels the open dialog draws a code at: its light box less the padding.
   * Lays the dialog out as for a code (box shown and empty, no notice, a caption that reads "scan")
   * to measure that room, and leaves it so for the caller to draw in. The caption is a status: its
   * words are written only when they change, or a screen reader hears them again. So it keeps them
   * and leaves the flow while an unspoken stand-in that reads "scan" takes its place.
   */
  function codeSide(): number {
    qrBox.hidden = false;
    qrBox.replaceChildren();
    qrCaption.removeAttribute("data-notice");
    qrCaption.style.position = "absolute";
    const ruler = h("p", { class: "watch-qr-caption", text: i18n.t("watch.scan"), attrs: { "aria-hidden": "true" } });
    qrCaption.after(ruler);
    const box = qrBox.getBoundingClientRect();
    const style = getComputedStyle(qrBox);
    const padding = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
    ruler.remove();
    qrCaption.style.removeProperty("position");
    return (Math.min(box.width, box.height) - padding) * devicePixelRatio;
  }

  /**
   * Shows the code for a link, a notice in its place, or (null) "getting the link ready" in its
   * place while the link is read. A link too long for a code this face draws with modules a phone
   * can scan (a long source URL, a large `#d=`, or a shorter link on a small face) gets a notice too.
   * Call with the dialog open: the code is sized to the room it gets there, and drawn again when
   * that room changes.
   */
  function drawQr(shown: { url: string } | { notice: string } | null): void {
    qrShown = shown;
    const scan = i18n.t("watch.scan");
    const code = shown && "url" in shown ? qrCode(shown.url, scan, codeSide()) : null;
    const notice = shown && "notice" in shown ? shown.notice : shown && !code ? i18n.t("watch.tooLong") : null;
    // "Getting ready" while the link is read, then the outcome. Any words but "scan" stand in the
    // code's place, where faces that leave out the caption under a code still show them.
    const caption = notice ?? (shown ? scan : i18n.t("watch.preparing"));
    qrBox.hidden = caption !== scan;
    qrBox.replaceChildren(...(code ? [code] : []));
    if (qrCaption.textContent !== caption) qrCaption.textContent = caption;
    qrCaption.toggleAttribute("data-notice", caption !== scan);
    // A notice scrolls when it is longer than its room (watch.css): a tab stop, so the arrow keys
    // scroll it in every engine, not only where a scroller is one (Safari's is not). Out of the Tab
    // order otherwise; focus left on the notice when a code takes its place goes to Back, as the
    // "scan" caption leaves the screen on a round or small face (watch.css) and its ring with it.
    qrCaption.tabIndex = caption !== scan ? 0 : -1;
    if (caption === scan && qrCaption.matches(":focus")) back.focus();
  }

  function showQr(): void {
    const item = items[index];
    const request = ++qrRequest;
    if (!qr.open) qr.showModal();
    // The phone plays the same show: every performance setting in effect here (saved or from this
    // link), not the wrist-only WATCH_OVERRIDES. A `#d=` payload's own settings win there as here.
    if (!item) drawQr({ url: ctx.shareUrl });
    else if (portable(item.ref)) {
      const overrides = shareableSettings(ctx.settings);
      drawQr({ url: routeToUrl({ source: item.ref, autoplay: true, overrides }, ctx.shareUrl) });
    } else {
      drawQr(null);
      void carriedLink(item).then((shown) => {
        if (request === qrRequest && qr.open) drawQr(shown);
      });
    }
    root.dataset.qr = "true";
    session?.player?.pause();
    back.focus();
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

  // A code sized for a larger face packs modules too small to scan once the face shrinks: draw it
  // again for the room it has now (a smaller code, or the too-long notice). The dialog's size is set
  // by the viewport alone, so drawing in it never sets this off again.
  const qrResize =
    typeof ResizeObserver === "function"
      ? new ResizeObserver(() => {
          if (qr.open) drawQr(qrShown);
        })
      : null;
  qrResize?.observe(qr);

  // The code is sized in device pixels: a window moved to a screen with another pixel ratio has the
  // same room in CSS pixels (no resize) but more or fewer pixels for each module. A resolution query
  // matches one ratio, so each change listens again for the new one.
  const watchPixelRatio = (): void => {
    if (typeof window.matchMedia !== "function") return;
    const ratio = window.matchMedia(`(resolution: ${devicePixelRatio}dppx)`);
    const changed = () => {
      if (qr.open) drawQr(qrShown);
      watchPixelRatio();
    };
    ratio.addEventListener("change", changed, { once: true, signal: lifetime.signal });
  };
  watchPixelRatio();

  const first = items[0];
  if (first) load(first, engaged);
  // A `#d=` payload holds its name: read it here (no network), not only once the wearer plays it.
  if (first?.ref.kind === "shared" && !first.title) {
    decodeShare(first.ref.payload).then(
      (shared) => named(first, shared.name),
      () => undefined, // A damaged payload says why when it plays.
    );
  }

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
      lifetime.abort();
      qrResize?.disconnect();
      window.clearTimeout(cycleTimer);
      window.clearTimeout(idleTimer);
      session?.destroy();
      session = null;
    },
  };
}
