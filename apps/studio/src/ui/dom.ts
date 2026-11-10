/**
 * Minimal typed DOM builders. Studio renders with plain DOM APIs: text always goes through
 * `textContent`, never `innerHTML`, so file names, titles and snippets from untrusted inputs
 * cannot inject markup.
 */

export type Child = Node | string | null | undefined | false;

type EventMap = HTMLElementEventMap;
type Handlers = { [E in keyof EventMap]?: (event: EventMap[E]) => void };

export interface Props {
  /** Space-separated class names. */
  class?: string;
  /** Attributes; `false`, `null` and `undefined` omit the attribute, `true` sets it empty. */
  attrs?: Record<string, string | number | boolean | null | undefined>;
  /** Data attributes without the `data-` prefix. */
  data?: Record<string, string | number | undefined>;
  /** Plain text content (set before children are appended). */
  text?: string;
  on?: Handlers;
}

function applyAttrs(el: Element, attrs: Props["attrs"]): void {
  if (!attrs) return;
  for (const [name, value] of Object.entries(attrs)) {
    if (value === false || value === null || value === undefined) continue;
    el.setAttribute(name, value === true ? "" : String(value));
  }
}

function append(el: Element, children: readonly Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child);
  }
}

/** Creates an HTML element with classes, attributes, listeners and children. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props.class) el.className = props.class;
  applyAttrs(el, props.attrs);
  if (props.data) {
    for (const [key, value] of Object.entries(props.data)) {
      if (value !== undefined) el.dataset[key] = String(value);
    }
  }
  if (props.text !== undefined) el.textContent = props.text;
  if (props.on) {
    for (const [type, fn] of Object.entries(props.on)) {
      if (fn) el.addEventListener(type, fn as EventListener);
    }
  }
  append(el, children);
  return el;
}

const SVG_NS = "http://www.w3.org/2000/svg";

/** Creates an SVG element with attributes and children. */
export function s<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number> = {},
  ...children: Child[]
): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, String(value));
  append(el, children);
  return el;
}

/** Removes every child of `el`. */
export function clear(el: Element): void {
  el.replaceChildren();
}

/** Formats a byte count for display, e.g. 1536 -> "1.5 KB". */
export function formatSize(bytes: number, locale: string): string {
  const units = ["B", "KB", "MB", "GB"] as const;
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  const digits = unit === 0 || value >= 100 ? 0 : 1;
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(value)} ${units[unit]}`;
}

/** True when focus is in a text field, where single-key shortcuts must not fire. */
export function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (target.closest("[contenteditable=''], [contenteditable='true']")) return true;
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  if (target instanceof HTMLInputElement) {
    return !["button", "checkbox", "radio", "range", "submit", "reset", "color", "file"].includes(target.type);
  }
  return false;
}
