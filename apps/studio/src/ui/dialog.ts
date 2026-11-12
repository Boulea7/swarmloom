import { button } from "./controls";
import { h } from "./dom";

export interface PanelOptions {
  /** Visible heading; also the accessible name. */
  title: string;
  closeLabel: string;
  /** Extra class names, e.g. "panel-settings". */
  class?: string;
  /** Called after the panel closed (Esc, close button, backdrop or `close()`). */
  onClose?: () => void;
}

/**
 * A panel built on the native `<dialog>`: modal (`showModal`, focus trapped, page inert, Esc) for
 * dialogs and phone bottom sheets, or non-modal (`show`) for the desktop settings drawer.
 * Focus returns to whatever was focused before it opened.
 */
export interface Panel {
  readonly root: HTMLDialogElement;
  /** Scrollable content area. */
  readonly body: HTMLElement;
  readonly isOpen: boolean;
  readonly isModal: boolean;
  open(modal: boolean): void;
  close(): void;
  destroy(): void;
}

/** The topmost open modal dialog, or null. Everything outside it is inert and covered. */
export function topModal(doc: Document): HTMLDialogElement | null {
  try {
    const open = doc.querySelectorAll<HTMLDialogElement>("dialog:modal");
    return open[open.length - 1] ?? null;
  } catch {
    // `:modal` is unknown to the selector engine: there is nothing to route around.
    return null;
  }
}

let panelIds = 0;

/** Creates a closed panel; append `root` anywhere in the document. */
export function createPanel(o: PanelOptions): Panel {
  panelIds += 1;
  const titleId = `panel-title-${panelIds}`;
  const body = h("div", { class: "panel-body" });
  const closeButton = button({
    label: o.closeLabel,
    icon: "close",
    iconOnly: true,
    variant: "ghost",
    class: "panel-close",
  });
  const root = h(
    "dialog",
    { class: `panel ${o.class ?? ""}`.trim(), attrs: { "aria-labelledby": titleId } },
    h("div", { class: "panel-grip", attrs: { "aria-hidden": "true" } }),
    h(
      "header",
      { class: "panel-head" },
      h("h2", { class: "panel-title", attrs: { id: titleId }, text: o.title }),
      closeButton,
    ),
    body,
  );
  let returnFocus: HTMLElement | null = null;
  let modal = false;

  const close = () => {
    if (root.open) root.close();
  };
  closeButton.addEventListener("click", close);
  root.addEventListener("close", () => {
    root.classList.remove("is-modal");
    const target = returnFocus;
    returnFocus = null;
    if (target?.isConnected) target.focus({ preventScroll: true });
    o.onClose?.();
  });
  // A click on the backdrop lands on the dialog element itself, outside its content box.
  root.addEventListener("click", (event) => {
    if (!modal || event.target !== root) return;
    const r = root.getBoundingClientRect();
    const inside =
      event.clientX >= r.left && event.clientX <= r.right && event.clientY >= r.top && event.clientY <= r.bottom;
    if (!inside) close();
  });

  return {
    root,
    body,
    get isOpen() {
      return root.open;
    },
    get isModal() {
      return root.open && modal;
    },
    open(asModal) {
      // Already open: keep its mode; switching would race with the asynchronous close event.
      if (root.open) return;
      const active = root.ownerDocument.activeElement;
      returnFocus = active instanceof HTMLElement && !root.contains(active) ? active : returnFocus;
      modal = asModal;
      root.classList.toggle("is-modal", asModal);
      if (asModal) root.showModal();
      else root.show();
      const first = root.querySelector<HTMLElement>(
        "[autofocus], .panel-body :is(input, select, button, textarea, [tabindex='0'])",
      );
      (first ?? closeButton).focus({ preventScroll: true });
    },
    close,
    destroy() {
      returnFocus = null;
      if (root.open) root.close();
      root.remove();
    },
  };
}
