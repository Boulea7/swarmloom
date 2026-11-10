import { h } from "./dom";
import { type IconName, icon } from "./icons";

/** Short, non-blocking status messages, announced politely to screen readers. */
export interface Toaster {
  readonly root: HTMLElement;
  show(message: string, opts?: { icon?: IconName; action?: { label: string; run: () => void }; ms?: number }): void;
  destroy(): void;
}

const DEFAULT_MS = 3600;

/** Creates the toast region; append `root` once per document. */
export function createToaster(): Toaster {
  const root = h("div", { class: "toasts", attrs: { role: "status", "aria-live": "polite" } });
  let timer = 0;
  const clear = () => {
    window.clearTimeout(timer);
    root.replaceChildren();
  };
  return {
    root,
    show(message, opts = {}) {
      clear();
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
      root.remove();
    },
  };
}
