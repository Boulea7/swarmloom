import { topModal } from "./dialog";
import { h } from "./dom";
import { type IconName, icon } from "./icons";

/** Short, non-blocking status messages, announced politely to screen readers. */
export interface Toaster {
  readonly root: HTMLElement;
  show(message: string, opts?: { icon?: IconName; action?: { label: string; run: () => void }; ms?: number }): void;
  destroy(): void;
}

const DEFAULT_MS = 3600;

/**
 * Creates the toast region; append `root` once per document. While a modal dialog is open (the
 * phone settings sheet, the export dialog) the region moves into it, since the rest of the page is
 * inert and covered there, and moves back when that dialog closes.
 */
export function createToaster(): Toaster {
  const root = h("div", { class: "toasts", attrs: { role: "status", "aria-live": "polite" } });
  let timer = 0;
  /** Where the region lives while no modal dialog is open (its page parent, kept on the first move). */
  let home: ParentNode | null = null;
  const clear = () => {
    window.clearTimeout(timer);
    root.replaceChildren();
  };
  /** Moves the region into the topmost modal dialog, or back to the page once none is open. */
  const place = () => {
    const target = topModal(root.ownerDocument) ?? home;
    if (!target || root.parentNode === target) return;
    if (root.parentNode && !root.parentElement?.closest("dialog")) home = root.parentNode;
    target.append(root);
    if (target instanceof HTMLDialogElement) {
      target.addEventListener("close", () => root.parentNode === target && place(), { once: true });
    }
  };
  return {
    root,
    show(message, opts = {}) {
      clear();
      place();
      const action = opts.action;
      const toast = h(
        "div",
        { class: "toast" },
        opts.icon ? icon(opts.icon, 18) : null,
        h("span", { class: "toast-text", text: message }),
        action
          ? h("button", {
              class: "toast-action",
              attrs: { type: "button" },
              text: action.label,
              on: {
                click: () => {
                  clear();
                  action.run();
                },
              },
            })
          : null,
      );
      root.append(toast);
      // Messages with an action stay until used or replaced.
      if (!action) timer = window.setTimeout(clear, opts.ms ?? DEFAULT_MS);
    },
    destroy() {
      clear();
      home = null;
      root.remove();
    },
  };
}
