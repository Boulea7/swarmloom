/**
 * Toolbar DOM: built once, then updated in place from a {@link ToolbarView}. Every write goes
 * through compare-before-write helpers, so an unchanged view costs no DOM mutation.
 */

import { h, setAttr, setHidden, setStyleVar, setText } from "./dom";
import { createIcon } from "./icons";
import { TOOLBAR_CSS } from "./styles";
import { SPEEDS, type ToolbarView } from "./view-model";

export const ELEMENT_NAME = "swarmloom-controls";

const SVG_NS = "http://www.w3.org/2000/svg";
const RING_R = 15;
const RING_C = 2 * Math.PI * RING_R;

export interface ToolbarText {
  toolbar: string;
  progress: string;
  speed: string;
  speedOption(speed: number): string;
  /** "Label (Key)" for tooltips. */
  shortcut(label: string, key: string): string;
  play: string;
  pause: string;
  sound: string;
  tapForSound: string;
  soundLocked: string;
  tour: string;
  tourHint: string;
  replay: string;
  goLive: string;
  goLiveHint: string;
  finish: string;
  /** Accessible name of the seek bar. */
  seek: string;
  close: string;
  record: string;
  keySpace: string;
  keyEsc: string;
  /** Locale-formatted percentage split into the number and the percent sign (rendered smaller). */
  percent(fraction: number): { number: string; unit: string; unitFirst: boolean };
}

interface Button {
  el: HTMLButtonElement;
  tip: HTMLElement;
}

interface LabelledButton extends Button {
  label: HTMLElement;
}

export interface ToolbarDom {
  /** The custom element appended to the UI layer; hosts the shadow root. */
  element: HTMLElement;
  root: ShadowRoot;
  dock: HTMLElement;
  bar: HTMLElement;
  /** Seek bar (a native range input across the top of the pill); hidden unless offered. */
  seek: HTMLInputElement;
  ring: { el: HTMLElement; fg: SVGCircleElement; pct: HTMLElement; check: SVGSVGElement; tip: HTMLElement };
  play: Button & { playIcon: SVGSVGElement; pauseIcon: SVGSVGElement };
  speedGroup: HTMLElement;
  speedRadios: HTMLButtonElement[];
  speedCycle: Button;
  sound: Button & { onIcon: SVGSVGElement; offIcon: SVGSVGElement; hint: HTMLElement };
  tour: LabelledButton;
  replay: LabelledButton;
  goLive: LabelledButton;
  finish: Button;
  record: Button;
  close: Button;
  separator: HTMLElement;
  live: HTMLElement;
}

function button(doc: Document, cmd: string, keys: string, children: Array<Node | string>, cls = "btn"): Button {
  const tip = h(doc, "span", { class: "tip", "aria-hidden": "true" });
  const el = h(
    doc,
    "button",
    { type: "button", class: cls, part: "button", "data-cmd": cmd, "aria-keyshortcuts": keys },
    [...children, tip],
  );
  return { el, tip };
}

function labelled(doc: Document, cmd: string, keys: string, icon: SVGSVGElement): LabelledButton {
  const label = h(doc, "span", { class: "label" });
  const b = button(doc, cmd, keys, [icon, label], "btn labelled");
  return { ...b, label };
}

function buildRing(doc: Document): ToolbarDom["ring"] {
  const svg = doc.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", "track");
  svg.setAttribute("viewBox", "0 0 36 36");
  svg.setAttribute("aria-hidden", "true");
  const circle = (cls: string): SVGCircleElement => {
    const c = doc.createElementNS(SVG_NS, "circle");
    c.setAttribute("class", cls);
    c.setAttribute("cx", "18");
    c.setAttribute("cy", "18");
    c.setAttribute("r", String(RING_R));
    return c;
  };
  const fg = circle("fg");
  fg.setAttribute("stroke-dasharray", RING_C.toFixed(3));
  fg.setAttribute("stroke-dashoffset", RING_C.toFixed(3));
  svg.append(circle("bg"), fg);
  const pct = h(doc, "span", { class: "pct", "aria-hidden": "true" }, [
    h(doc, "span", { class: "num" }),
    h(doc, "span", { class: "unit" }),
  ]);
  const check = createIcon(doc, "check");
  const tip = h(doc, "span", { class: "tip", "aria-hidden": "true" });
  const el = h(
    doc,
    "div",
    { class: "ring", part: "progress", role: "progressbar", "aria-valuemin": 0, "aria-valuemax": 100, tabindex: -1 },
    [svg, pct, check, tip],
  );
  return { el, fg, pct, check, tip };
}

/** Creates the toolbar element (not yet attached) with its shadow root and static structure. */
export function buildToolbar(doc: Document, chrome: "light" | "dark"): ToolbarDom {
  const element = doc.createElement(ELEMENT_NAME);
  element.dataset.chrome = chrome;
  const root = element.attachShadow({ mode: "open" });

  const ring = buildRing(doc);
  const playIcon = createIcon(doc, "play");
  const pauseIcon = createIcon(doc, "pause");
  const play = { ...button(doc, "togglePlay", "Space", [playIcon, pauseIcon]), playIcon, pauseIcon };

  const speedRadios = SPEEDS.map((speed) =>
    h(
      doc,
      "button",
      { type: "button", class: "btn", role: "radio", "data-cmd": `speed:${speed}`, "aria-keyshortcuts": String(speed) },
      [`${speed}×`],
    ),
  );
  const speedGroup = h(doc, "div", { class: "speed", role: "radiogroup" }, speedRadios);
  const speedCycle = button(doc, "speedCycle", "1 2 3", [h(doc, "span", { class: "cycle" })]);

  const onIcon = createIcon(doc, "soundOn");
  const offIcon = createIcon(doc, "soundOff");
  const hint = h(doc, "span", { class: "hint" });
  const sound = { ...button(doc, "toggleSound", "M", [onIcon, offIcon, hint]), onIcon, offIcon, hint };

  const tour = labelled(doc, "toggleTour", "T", createIcon(doc, "tour"));
  const replay = labelled(doc, "replay", "R", createIcon(doc, "replay"));
  const goLive = labelled(doc, "goLive", "L", createIcon(doc, "goLive"));
  const finish = button(doc, "finish", "F", [createIcon(doc, "finish")]);
  const record = button(doc, "record", "", [createIcon(doc, "record")]);
  const close = button(doc, "close", "Escape", [createIcon(doc, "close")]);
  const separator = h(doc, "span", { class: "sep", "aria-hidden": "true" });
  const seek = h(doc, "input", { type: "range", class: "seek", part: "seek", min: 0, max: 0, step: 1, hidden: true });

  const bar = h(doc, "div", { class: "bar", part: "toolbar", role: "toolbar", "aria-orientation": "horizontal" }, [
    seek,
    ring.el,
    play.el,
    speedGroup,
    speedCycle.el,
    sound.el,
    tour.el,
    finish.el,
    replay.el,
    goLive.el,
    record.el,
    separator,
    close.el,
  ]);
  const dock = h(doc, "div", { class: "dock", part: "dock" }, [bar]);
  const live = h(doc, "div", { class: "sr", role: "status", "aria-live": "polite", "aria-atomic": "true" });
  const style = h(doc, "style", {}, [TOOLBAR_CSS]);
  root.append(style, dock, live);

  return {
    element,
    root,
    dock,
    bar,
    seek,
    ring,
    play,
    speedGroup,
    speedRadios,
    speedCycle,
    sound,
    tour,
    replay,
    goLive,
    finish,
    record,
    close,
    separator,
    live,
  };
}

function name(b: Button, label: string, tip: string): void {
  setAttr(b.el, "aria-label", label);
  setText(b.tip, tip);
}

/** Applies a view to the DOM. Writes only what changed. */
export function renderToolbar(dom: ToolbarDom, view: ToolbarView, text: ToolbarText, compact: boolean): void {
  setAttr(dom.element, "data-compact", compact);
  setAttr(dom.element, "data-phase", view.phase);
  setAttr(dom.bar, "aria-label", text.toolbar);

  const finished = view.phase === "done" || view.phase === "live";
  const ring = dom.ring;
  setAttr(ring.el, "aria-label", text.progress);
  setAttr(ring.el, "aria-valuenow", view.percent);
  setAttr(ring.el, "aria-valuetext", view.progressText);
  setAttr(ring.fg, "stroke-dashoffset", (RING_C * (1 - view.fraction)).toFixed(3));
  const pct = text.percent(view.percent / 100);
  const [num, unit] = ring.pct.children as unknown as [HTMLElement, HTMLElement];
  setText(num, pct.number);
  setText(unit, pct.unit);
  setAttr(ring.pct, "data-unit-first", pct.unitFirst);
  setHidden(ring.pct, finished);
  setHidden(ring.check, !finished);
  setText(ring.tip, view.progressText);

  setHidden(dom.play.el, !view.play.visible);
  name(dom.play, view.play.label, text.shortcut(view.play.label, text.keySpace));
  setHidden(dom.play.playIcon, view.play.icon !== "play");
  setHidden(dom.play.pauseIcon, view.play.icon !== "pause");

  setHidden(dom.speedGroup, !view.speed.visible || compact);
  setAttr(dom.speedGroup, "aria-label", text.speed);
  for (const radio of dom.speedRadios) {
    const speed = Number(radio.dataset.cmd?.split(":")[1]);
    setAttr(radio, "aria-checked", speed === view.speed.value ? "true" : "false");
    setAttr(radio, "aria-label", text.speedOption(speed));
  }
  setHidden(dom.speedCycle.el, !view.speed.visible || !compact);
  const speedLabel = `${text.speed}: ${formatSpeed(view.speed.value)}`;
  name(dom.speedCycle, speedLabel, text.shortcut(speedLabel, "1 / 2 / 3"));
  setText(dom.speedCycle.el.firstChild as HTMLElement, formatSpeed(view.speed.value));

  const sound = dom.sound;
  setHidden(sound.el, !view.sound.visible);
  setAttr(sound.el, "aria-pressed", view.sound.on ? "true" : "false");
  setAttr(sound.el, "class", view.sound.hint ? "btn locked" : "btn");
  name(sound, view.sound.label, view.sound.hint ? text.soundLocked : text.shortcut(text.sound, "M"));
  setHidden(sound.onIcon, !view.sound.on);
  setHidden(sound.offIcon, view.sound.on);
  setHidden(sound.hint, !view.sound.hint);
  setText(sound.hint, text.tapForSound);

  setHidden(dom.tour.el, !view.tour.visible);
  setAttr(dom.tour.el, "aria-pressed", view.tour.on ? "true" : "false");
  name(dom.tour, text.tour, text.shortcut(text.tourHint, "T"));
  setText(dom.tour.label, text.tour);

  setHidden(dom.replay.el, !view.replay);
  setAttr(dom.replay.el, "class", finished ? "btn labelled" : "btn");
  name(dom.replay, text.replay, text.shortcut(text.replay, "R"));
  setText(dom.replay.label, text.replay);
  setHidden(dom.replay.label, !finished);

  setHidden(dom.goLive.el, !view.goLive.visible);
  setAttr(dom.goLive.el, "class", view.goLive.primary ? "btn labelled primary" : "btn");
  name(dom.goLive, text.goLive, text.shortcut(text.goLiveHint, "L"));
  setText(dom.goLive.label, text.goLive);
  // While building, go live is a quiet icon; once done it becomes the labelled primary action.
  setHidden(dom.goLive.label, !view.goLive.primary);

  setHidden(dom.finish.el, !view.finish);
  name(dom.finish, text.finish, text.shortcut(text.finish, "F"));

  // The pill makes room for the seek bar across its top.
  setAttr(dom.bar, "data-seek", view.seek.visible);
  renderSeek(dom.seek, view.seek, text.seek);

  setHidden(dom.record.el, !view.record);
  name(dom.record, text.record, text.record);

  setHidden(dom.close.el, !view.close);
  name(dom.close, text.close, text.shortcut(text.close, text.keyEsc));
  setHidden(dom.separator, !view.close);
}

/**
 * Writes the seek bar. The value goes through the `value` property (the attribute stops applying
 * once the user moved the thumb), after `max` so it is not clamped to a stale range.
 */
function renderSeek(input: HTMLInputElement, seek: ToolbarView["seek"], label: string): void {
  setHidden(input, !seek.visible);
  if (!seek.visible) return;
  setAttr(input, "aria-label", label);
  setAttr(input, "max", seek.max);
  const value = String(Math.min(seek.max, Math.max(0, seek.value)));
  if (input.value !== value) input.value = value;
  setAttr(input, "aria-valuetext", seek.text);
  setStyleVar(input, "--sl-seek", `${((100 * Number(value)) / Math.max(1, seek.max)).toFixed(2)}%`);
}

export function formatSpeed(speed: number): string {
  return `${Number.isInteger(speed) ? speed : speed.toFixed(1)}×`;
}

/** Focusable toolbar items in visual order (visibility derived from `hidden`, no layout reads). */
export function focusableItems(dom: ToolbarDom): HTMLElement[] {
  const items: HTMLElement[] = [dom.ring.el, dom.play.el];
  if (!dom.speedGroup.hidden) items.push(...dom.speedRadios);
  items.push(
    dom.speedCycle.el,
    dom.sound.el,
    dom.tour.el,
    dom.finish.el,
    dom.replay.el,
    dom.goLive.el,
    dom.record.el,
    dom.close.el,
  );
  return items.filter((el) => !el.hidden);
}
