import type { BoxLayer, CSSMap, ImageLayer, PathLayer, Rect, TextLayer } from "@swarmloom/core";
import { isHtmlElement, viewOf } from "../dom/env";
import { isVisibleColor } from "../util/color";
import { px } from "../util/css";
import { escapeText, safeImageUrl } from "../util/html";
import { emitBox } from "./box";
import { emitPlaceholder } from "./media";
import { type Placement, placeInset } from "./place";
import { type Capture, type Ctx, type ElInfo, emit } from "./state";
import { type BoxVisual, containerTextStyle, contentInsets, paintsBox, textPropsOf } from "./styles";

/** Default accent when `accent-color: auto` (matches common user-agent defaults). */
const DEFAULT_ACCENT = "rgb(0, 117, 255)";
const TRACK = "rgb(229, 229, 234)";
const TRACK_BORDER = "rgb(178, 178, 178)";
const METER = "rgb(46, 160, 67)";

const TEXT_INPUTS = new Set([
  "text",
  "search",
  "email",
  "url",
  "tel",
  "number",
  "password",
  "date",
  "time",
  "datetime-local",
  "month",
  "week",
]);
const BUTTON_INPUTS = new Set(["submit", "reset", "button"]);

function round(v: number): number {
  return Math.round(v * 100) / 100;
}

function accentOf(cs: CSSStyleDeclaration): string {
  const accent = cs.getPropertyValue("accent-color");
  return accent && accent !== "auto" ? accent : DEFAULT_ACCENT;
}

function isNative(cs: CSSStyleDeclaration): boolean {
  const a = cs.getPropertyValue("appearance") || cs.getPropertyValue("-webkit-appearance");
  return Boolean(a) && a !== "none";
}

function box(cap: Capture, ctx: Ctx, place: Placement, r: Rect, style: CSSMap, role?: string): string | null {
  const draft: Omit<BoxLayer, "id"> = { kind: "box", box: r, style: { "box-sizing": "border-box", ...style } };
  if (role) draft.role = role;
  if (place.transform) draft.transform = place.transform;
  return emit<BoxLayer>(cap, ctx, draft);
}

const MASK = "\u2022";

/**
 * The value a control shows in the snapshot. Secrets (passwords, card numbers, one-time codes) are
 * always masked with a fixed-length run; other values are masked character by character unless
 * `reveal` is set, keeping white space so line breaks and word shapes survive.
 */
export function displayValue(el: HTMLInputElement | HTMLTextAreaElement, reveal: boolean): string {
  const value = el.value ?? "";
  const type = el.localName === "input" ? (el as HTMLInputElement).type : "textarea";
  const auto = (el.getAttribute("autocomplete") ?? "").toLowerCase();
  if (type === "password" || auto.includes("cc-") || auto.includes("one-time-code") || auto.includes("password")) {
    return MASK.repeat(Math.min(value.length, 32));
  }
  return reveal ? value : value.replace(/\S/gu, MASK);
}

interface ControlText {
  text: string;
  placeholder: boolean;
  multiline: boolean;
  center?: boolean;
}

function emitControlText(cap: Capture, ctx: Ctx, info: ElInfo, t: ControlText, reserveRight = 0): void {
  if (!t.text.trim()) return;
  const content = placeInset(cap, ctx, info, contentInsets(info.cs));
  const b = content.box;
  const r = { x: b.x, y: b.y, w: Math.max(1, b.w - reserveRight), h: b.h };
  const style = containerTextStyle(textPropsOf(cap, info));
  style.overflow = "hidden";
  if (t.multiline) {
    style["white-space"] = "pre-wrap";
  } else {
    style["white-space"] = "pre";
    style.display = "flex";
    style["align-items"] = "center";
    if (t.center) style["justify-content"] = "center";
    else if (style["text-align"] === "center") style["justify-content"] = "center";
    else if (style["text-align"] === "right" || style["text-align"] === "end") style["justify-content"] = "flex-end";
  }
  let inner = escapeText(t.text);
  if (t.placeholder && isHtmlElement(info.el)) {
    const pc = viewOf(info.el).getComputedStyle(info.el, "::placeholder").color;
    if (pc && isVisibleColor(pc)) inner = `<span style="color:${pc}">${inner}</span>`;
  }
  const fontSize = round(px(info.cs.fontSize, 16));
  const draft: Omit<TextLayer, "id"> = {
    kind: "text",
    box: r,
    html: `<span>${inner}</span>`,
    text: t.text,
    style,
    fontSize,
    role: "input",
  };
  if (content.transform) draft.transform = content.transform;
  emit<TextLayer>(cap, ctx, draft);
}

function emitCheck(cap: Capture, ctx: Ctx, info: ElInfo, place: Placement, radio: boolean): void {
  const el = info.el as HTMLInputElement;
  const b = place.box;
  const accent = accentOf(info.cs);
  const checked = el.checked === true;
  const indeterminate = !radio && el.indeterminate === true;
  const on = checked || indeterminate;
  const shape: CSSMap = {
    border: `1px solid ${on ? accent : "rgb(118, 118, 118)"}`,
    "border-radius": radio ? "50%" : "3px",
    background: on && !radio ? accent : "rgb(255, 255, 255)",
  };
  const id = box(cap, ctx, place, b, shape, "input");
  if (!on) return;
  const child = { ...ctx, parentId: id ?? ctx.parentId };
  if (radio) {
    const d = Math.max(2, Math.min(b.w, b.h) * 0.5);
    const dot = { x: b.x + (b.w - d) / 2, y: b.y + (b.h - d) / 2, w: d, h: d };
    box(cap, child, place, dot, { background: accent, "border-radius": "50%" });
    return;
  }
  const { x, y, w, h } = b;
  const d = indeterminate
    ? `M${round(x + w * 0.25)} ${round(y + h * 0.5)}H${round(x + w * 0.75)}`
    : `M${round(x + w * 0.24)} ${round(y + h * 0.52)}L${round(x + w * 0.42)} ${round(y + h * 0.7)}L${round(x + w * 0.77)} ${round(y + h * 0.31)}`;
  const draft: Omit<PathLayer, "id"> = {
    kind: "path",
    box: b,
    d,
    stroke: "rgb(255, 255, 255)",
    strokeWidth: round(Math.max(1.5, w * 0.14)),
    fill: "none",
    attrs: { "stroke-linecap": "round", "stroke-linejoin": "round" },
  };
  emit<PathLayer>(cap, child, draft);
}

function fraction(value: number, min: number, max: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(min) || !Number.isFinite(max) || max <= min) return 0;
  return Math.min(1, Math.max(0, (value - min) / (max - min)));
}

function emitRange(cap: Capture, ctx: Ctx, info: ElInfo, place: Placement): void {
  const el = info.el as HTMLInputElement;
  const b = place.box;
  const accent = accentOf(info.cs);
  const f = fraction(Number(el.value), Number(el.min || 0), Number(el.max || 100));
  const thumb = Math.min(16, b.h);
  const trackH = Math.max(2, Math.min(4, b.h / 3));
  const ty = b.y + (b.h - trackH) / 2;
  const usable = Math.max(0, b.w - thumb);
  const track = { x: b.x, y: ty, w: b.w, h: trackH };
  const id = box(cap, ctx, place, track, { background: TRACK, "border-radius": `${trackH}px` }, "input");
  const child = { ...ctx, parentId: id ?? ctx.parentId };
  const filled = thumb / 2 + usable * f;
  if (filled > 0)
    box(
      cap,
      child,
      place,
      { x: b.x, y: ty, w: filled, h: trackH },
      { background: accent, "border-radius": `${trackH}px` },
    );
  const tx = b.x + usable * f;
  box(
    cap,
    child,
    place,
    { x: tx, y: b.y + (b.h - thumb) / 2, w: thumb, h: thumb },
    { background: accent, "border-radius": "50%" },
  );
}

function emitBar(cap: Capture, ctx: Ctx, info: ElInfo, place: Placement): void {
  const el = info.el as HTMLProgressElement | HTMLMeterElement;
  const b = place.box;
  const isMeter = info.el.localName === "meter";
  const max = Number(el.getAttribute("max") ?? (isMeter ? 1 : 1));
  const min = isMeter ? Number(el.getAttribute("min") ?? 0) : 0;
  const raw = el.getAttribute("value");
  const f = raw === null && !isMeter ? 0 : fraction(Number(raw ?? 0), min, max);
  const radius = `${round(Math.min(b.h / 2, 6))}px`;
  const id = box(
    cap,
    ctx,
    place,
    b,
    { background: TRACK, border: `1px solid ${TRACK_BORDER}`, "border-radius": radius },
    "input",
  );
  if (f <= 0) return;
  const child = { ...ctx, parentId: id ?? ctx.parentId };
  const color = isMeter ? METER : accentOf(info.cs);
  box(cap, child, place, { x: b.x, y: b.y, w: b.w * f, h: b.h }, { background: color, "border-radius": radius });
}

function emitChevron(cap: Capture, ctx: Ctx, info: ElInfo, place: Placement): number {
  const content = placeInset(cap, ctx, info, contentInsets(info.cs)).box;
  const b = place.box;
  const size = Math.min(10, Math.max(6, content.h * 0.45));
  const cy = b.y + b.h / 2;
  const x0 = b.x + b.w - px(info.cs.borderRightWidth) - 6 - size;
  const d = `M${round(x0)} ${round(cy - size / 4)}L${round(x0 + size / 2)} ${round(cy + size / 4)}L${round(x0 + size)} ${round(cy - size / 4)}`;
  const draft: Omit<PathLayer, "id"> = {
    kind: "path",
    box: { x: x0, y: cy - size / 4, w: size, h: size / 2 },
    d,
    stroke: info.cs.color,
    strokeWidth: 1.5,
    fill: "none",
    attrs: { "stroke-linecap": "round", "stroke-linejoin": "round" },
  };
  if (place.transform) draft.transform = place.transform;
  emit<PathLayer>(cap, ctx, draft);
  return size + 8;
}

/**
 * Emits a form control as boxes + text (+ small paths for chevrons and check marks). Values are
 * read from the live control; secrets are masked.
 */
export function emitFormControl(cap: Capture, ctx: Ctx, info: ElInfo, place: Placement, v: BoxVisual): void {
  const el = info.el;
  const tag = el.localName;
  const cs = info.cs;
  if (tag === "progress" || tag === "meter") {
    if (isNative(cs) || !paintsBox(v)) emitBar(cap, ctx, info, place);
    else emitBox(cap, ctx, info, place, v);
    return;
  }
  if (tag === "input") {
    const input = el as HTMLInputElement;
    const type = (input.type || "text").toLowerCase();
    if (type === "hidden") return;
    if ((type === "checkbox" || type === "radio") && isNative(cs)) {
      emitCheck(cap, ctx, info, place, type === "radio");
      return;
    }
    if (type === "range" && isNative(cs)) {
      emitRange(cap, ctx, info, place);
      return;
    }
    if (type === "image") {
      const src = safeImageUrl(input.getAttribute("src") ?? "", el.baseURI);
      if (src) {
        emit<ImageLayer>(cap, ctx, { kind: "image", box: place.box, src, fit: "fill" });
        return;
      }
    }
    const own = paintsBox(v) || v.anySide ? emitBox(cap, ctx, info, place, v) : null;
    const inner = { ...ctx, parentId: own ?? ctx.parentId };
    if (type === "color") {
      const c = placeInset(cap, inner, info, contentInsets(cs)).box;
      box(cap, inner, place, c, { background: input.value || "#000000", "border-radius": "2px" });
      return;
    }
    if (BUTTON_INPUTS.has(type)) {
      const label = input.value || (type === "submit" ? "Submit" : type === "reset" ? "Reset" : "");
      emitControlText(cap, inner, info, { text: label, placeholder: false, multiline: false, center: true });
      return;
    }
    if (type === "file") {
      emitControlText(cap, inner, info, { text: "Choose file", placeholder: false, multiline: false });
      return;
    }
    if (TEXT_INPUTS.has(type) || !type) {
      const value = displayValue(input, cap.opts.showFormValues);
      const ph = input.getAttribute("placeholder") ?? "";
      emitControlText(cap, inner, info, { text: value || ph, placeholder: !value, multiline: false });
    }
    return;
  }
  if (tag === "textarea") {
    const ta = el as HTMLTextAreaElement;
    const own = paintsBox(v) || v.anySide ? emitBox(cap, ctx, info, place, v) : null;
    const value = displayValue(ta, cap.opts.showFormValues);
    const ph = ta.getAttribute("placeholder") ?? "";
    emitControlText(cap, { ...ctx, parentId: own ?? ctx.parentId }, info, {
      text: value || ph,
      placeholder: !value,
      multiline: true,
    });
    return;
  }
  if (tag === "select") {
    const select = el as HTMLSelectElement;
    const own = paintsBox(v) || v.anySide ? emitBox(cap, ctx, info, place, v) : null;
    const inner = { ...ctx, parentId: own ?? ctx.parentId };
    const listbox = select.multiple || select.size > 1;
    const chosen = Array.from(select.selectedOptions ?? []).map((o) => o.label || o.text);
    if (listbox) {
      const lines = Array.from(select.options)
        .slice(0, 50)
        .map((o) => o.label || o.text);
      emitControlText(cap, inner, info, { text: lines.join("\n"), placeholder: false, multiline: true });
      return;
    }
    const reserve = isNative(cs) ? emitChevron(cap, inner, info, place) : 0;
    emitControlText(cap, inner, info, { text: chosen[0] ?? "", placeholder: false, multiline: false }, reserve);
    return;
  }
  emitPlaceholder(cap, ctx, info, place, tag);
}
