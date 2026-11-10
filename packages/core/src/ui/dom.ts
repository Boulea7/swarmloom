/**
 * Minimal DOM helpers for the toolbar. Writers compare before writing so a refresh that changes
 * nothing touches nothing (no style recalculation, no mutation records).
 */

export type Attrs = Readonly<Record<string, string | number | boolean | null | undefined>>;

/** Creates an element with attributes (`true` = present, false/null/undefined = absent) and children. */
export function h<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  attrs: Attrs = {},
  children: ReadonlyArray<Node | string> = [],
): HTMLElementTagNameMap[K] {
  const el = doc.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) setAttr(el, name, value);
  for (const child of children) el.append(child);
  return el;
}

/** Sets or removes an attribute only when it differs from the current value. */
export function setAttr(el: Element, name: string, value: string | number | boolean | null | undefined): void {
  if (value === false || value === null || value === undefined) {
    if (el.hasAttribute(name)) el.removeAttribute(name);
    return;
  }
  const next = value === true ? "" : String(value);
  if (el.getAttribute(name) !== next) el.setAttribute(name, next);
}

export function setText(el: Node, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}

export function setHidden(el: HTMLElement | SVGElement, hidden: boolean): void {
  setAttr(el, "hidden", hidden);
}

export function setStyleVar(el: HTMLElement, name: `--${string}`, value: string | null): void {
  if (value === null) {
    if (el.style.getPropertyValue(name) !== "") el.style.removeProperty(name);
  } else if (el.style.getPropertyValue(name) !== value) {
    el.style.setProperty(name, value);
  }
}

/** Elements that take text input; shortcuts never fire while one of them has focus. */
export function isEditable(node: EventTarget | null | undefined): boolean {
  if (!node || typeof (node as Element).tagName !== "string") return false;
  const el = node as HTMLElement;
  const tag = el.tagName.toUpperCase();
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag === "INPUT") return !NON_TEXT_INPUTS.has(((el as HTMLInputElement).type || "text").toLowerCase());
  if (el.isContentEditable) return true;
  const editable = el.getAttribute("contenteditable");
  if (editable !== null && editable !== "false") return true;
  return TEXT_ROLES.has(el.getAttribute("role") ?? "");
}

/** Elements whose own Space/Enter activation must win over a shortcut. */
export function isActivatable(node: EventTarget | null | undefined): boolean {
  if (!node || typeof (node as Element).tagName !== "string") return false;
  const el = node as HTMLElement;
  const tag = el.tagName.toUpperCase();
  if (tag === "BUTTON" || tag === "SUMMARY" || (tag === "A" && el.hasAttribute("href"))) return true;
  if (tag === "INPUT") return NON_TEXT_INPUTS.has(((el as HTMLInputElement).type || "").toLowerCase());
  return ACTIVATABLE_ROLES.has(el.getAttribute("role") ?? "");
}

const NON_TEXT_INPUTS = new Set(["button", "submit", "reset", "checkbox", "radio", "range", "color", "file", "image"]);
const TEXT_ROLES = new Set(["textbox", "searchbox", "combobox", "spinbutton"]);
const ACTIVATABLE_ROLES = new Set(["button", "link", "checkbox", "radio", "switch", "menuitem", "option", "tab"]);
