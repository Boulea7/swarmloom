import { h } from "./dom";
import { type IconName, icon } from "./icons";

let uid = 0;
/** Unique id for label/control pairs. */
export function nextId(prefix: string): string {
  uid += 1;
  return `${prefix}-${uid}`;
}

export type ButtonVariant = "primary" | "secondary" | "ghost" | "quiet";

export interface ButtonOptions {
  label: string;
  icon?: IconName;
  variant?: ButtonVariant;
  /** Icon-only button: the label becomes the accessible name and tooltip. */
  iconOnly?: boolean;
  /** Keyboard hint shown in the tooltip, e.g. "E". */
  shortcut?: string;
  type?: "button" | "submit";
  onClick?: (event: MouseEvent) => void;
  class?: string;
}

/** One button vocabulary for the whole app: same shape, sizes and states everywhere. */
export function button(o: ButtonOptions): HTMLButtonElement {
  const variant = o.variant ?? "secondary";
  const classes = ["btn", `btn-${variant}`, o.iconOnly ? "btn-icon" : "", o.class ?? ""].filter(Boolean).join(" ");
  const title = o.iconOnly ? (o.shortcut ? `${o.label} (${o.shortcut})` : o.label) : undefined;
  const el = h(
    "button",
    {
      class: classes,
      attrs: {
        type: o.type ?? "button",
        "aria-label": o.iconOnly ? o.label : undefined,
        title,
        "aria-keyshortcuts": o.shortcut,
      },
      on: o.onClick ? { click: o.onClick } : undefined,
    },
    o.icon ? icon(o.icon, o.iconOnly ? 20 : 18) : null,
    o.iconOnly ? null : h("span", { class: "btn-label", text: o.label }),
  );
  return el;
}

export interface Choice<T extends string> {
  value: T;
  label: string;
}

/**
 * Segmented control built from native radio inputs, so arrow keys, form semantics and screen
 * readers work without extra code.
 */
export function segmented<T extends string>(o: {
  legend: string;
  name: string;
  choices: readonly Choice<T>[];
  value: T | undefined;
  onChange: (value: T) => void;
}): HTMLFieldSetElement {
  const group = h("div", { class: "segmented" });
  for (const choice of o.choices) {
    const id = nextId(o.name);
    const input = h("input", {
      attrs: { type: "radio", name: o.name, id, value: choice.value, checked: choice.value === o.value },
      on: { change: () => o.onChange(choice.value) },
    });
    group.append(input, h("label", { attrs: { for: id }, text: choice.label }));
  }
  return h("fieldset", { class: "field" }, h("legend", { class: "field-label", text: o.legend }), group);
}

/** Switch: a checkbox with `role="switch"`, label on the left and an optional hint below. */
export function toggle(o: {
  label: string;
  checked: boolean;
  onChange: (on: boolean) => void;
  hint?: string;
}): HTMLElement {
  const id = nextId("switch");
  const hintId = o.hint ? `${id}-hint` : undefined;
  const input = h("input", {
    class: "switch",
    attrs: { type: "checkbox", role: "switch", id, checked: o.checked, "aria-describedby": hintId },
    on: { change: (e) => o.onChange((e.currentTarget as HTMLInputElement).checked) },
  });
  const row = h(
    "div",
    { class: "field-row" },
    h("label", { class: "field-label", attrs: { for: id }, text: o.label }),
    input,
  );
  return h(
    "div",
    { class: "field" },
    row,
    o.hint ? h("p", { class: "field-hint", attrs: { id: hintId }, text: o.hint }) : null,
  );
}

/** Native select with a label; keeps platform pickers on touch devices. */
export function select<T extends string>(o: {
  label: string;
  choices: readonly Choice<T>[];
  value: T;
  onChange: (value: T) => void;
  inline?: boolean;
}): HTMLElement {
  const id = nextId("select");
  const el = h("select", {
    class: "select",
    attrs: { id },
    on: { change: (e) => o.onChange((e.currentTarget as HTMLSelectElement).value as T) },
  });
  for (const choice of o.choices) {
    el.append(h("option", { attrs: { value: choice.value, selected: choice.value === o.value }, text: choice.label }));
  }
  return h(
    "div",
    { class: o.inline ? "field field-row" : "field" },
    h("label", { class: "field-label", attrs: { for: id }, text: o.label }),
    el,
  );
}

/** Range slider with a live value readout. */
export function range(o: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  format: (value: number) => string;
  onInput: (value: number) => void;
  disabled?: boolean;
}): { root: HTMLElement; input: HTMLInputElement; setDisabled(disabled: boolean): void } {
  const id = nextId("range");
  const output = h("output", { class: "field-value", attrs: { for: id }, text: o.format(o.value) });
  const input = h("input", {
    class: "range",
    attrs: { type: "range", id, min: o.min, max: o.max, step: o.step, value: o.value, disabled: o.disabled },
    on: {
      input: (e) => {
        const value = Number((e.currentTarget as HTMLInputElement).value);
        output.textContent = o.format(value);
        o.onInput(value);
      },
    },
  });
  const root = h(
    "div",
    { class: "field" },
    h("div", { class: "field-head" }, h("label", { class: "field-label", attrs: { for: id }, text: o.label }), output),
    input,
  );
  return {
    root,
    input,
    setDisabled(disabled) {
      input.disabled = disabled;
      root.classList.toggle("is-disabled", disabled);
    },
  };
}
