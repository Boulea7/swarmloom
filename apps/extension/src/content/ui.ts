/**
 * The extension's own in-page UI around the player: a status pill while the page is scanned and an
 * error panel with next steps. It lives in a closed shadow root on an element snapshot-dom ignores
 * (`data-swarmloom-ignore`), so it is never rebuilt by the swarm and page CSS cannot reach it.
 *
 * Like the stage (contracts/decisions-v1.md S01) the host enters the top layer as a manual popover
 * where supported, so an open modal dialog or fullscreen element of the page cannot cover it;
 * elsewhere the maximum z-index applies. A page modal still makes everything outside it inert, so
 * while one is open the error panel opens as a modal dialog itself to keep its buttons usable.
 */

/** Attribute snapshot-dom skips (with its subtree). */
export const IGNORE_ATTR = "data-swarmloom-ignore";
export const UI_TAG = "swarmloom-ui";

export interface PanelAction {
  label: string;
  primary?: boolean;
  run(): void;
}

export interface ErrorPanelSpec {
  title: string;
  message: string;
  actions: PanelAction[];
  /** Escape key. */
  onDismiss(): void;
}

export interface OverlayUi {
  /** Shows (or updates) the status pill, announced politely to screen readers. */
  showStatus(text: string): void;
  hideStatus(): void;
  /** Replaces any status with an error panel and moves focus to its primary action. */
  showError(spec: ErrorPanelSpec): void;
  /** Removes the UI and returns focus to where it was. Idempotent. */
  destroy(): void;
  /** Shadow root, exposed for tests (the root is closed to page scripts). */
  readonly root: ShadowRoot;
}

const CSS = `
:host { all: initial; position: fixed; inset: 0 auto auto 0; width: 0; height: 0; margin: 0; padding: 0;
  border: 0; background: transparent; overflow: visible; }
:host::backdrop { display: none; }
.wrap { position: fixed; inset: auto 16px 16px auto; z-index: 2147483647; display: flex; flex-direction: column;
  align-items: flex-end; gap: 8px; max-width: min(380px, calc(100vw - 32px));
  font: 14px/1.4 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: #0B0B12; }
.pill { display: flex; align-items: center; gap: 8px; padding: 8px 14px; border-radius: 999px; background: #FAFAFC;
  box-shadow: 0 4px 18px rgb(11 11 18 / 18%); border: 1px solid rgb(91 91 247 / 35%); }
.dot { width: 8px; height: 8px; border-radius: 50%; background: #5B5BF7; animation: pulse 1s ease-in-out infinite alternate; }
@keyframes pulse { from { opacity: .35; } to { opacity: 1; } }
@media (prefers-reduced-motion: reduce) { .dot { animation: none; } }
.panel { padding: 16px; border-radius: 14px; background: #FAFAFC; border: 1px solid rgb(255 79 123 / 45%);
  box-shadow: 0 8px 28px rgb(11 11 18 / 22%); color: inherit; font: inherit; }
dialog.panel { position: fixed; inset: auto 16px 16px auto; margin: 0; max-width: min(380px, calc(100vw - 32px));
  color: #0B0B12; }
dialog.panel::backdrop { background: transparent; }
.panel h2 { margin: 0 0 6px; font-size: 15px; font-weight: 650; }
.panel p { margin: 0 0 12px; overflow-wrap: anywhere; }
.actions { display: flex; flex-wrap: wrap; gap: 8px; }
button { font: inherit; min-height: 44px; padding: 0 14px; border-radius: 10px; cursor: pointer;
  border: 1px solid #5B5BF7; background: transparent; color: #3B3BD9; }
button.primary { background: #5B5BF7; color: #fff; }
button:focus-visible { outline: 3px solid #FF4F7B; outline-offset: 2px; }
@media (prefers-color-scheme: dark) {
  .wrap { color: #F2F2F7; }
  .pill, .panel { background: #17172A; }
  dialog.panel { color: #F2F2F7; }
  button { color: #B9B9FF; }
  button.primary { color: #fff; }
}
`;

/** True when the page shows a modal dialog, which makes every node outside it inert. */
function pageHasModal(doc: Document): boolean {
  try {
    return doc.querySelector("dialog:modal") !== null;
  } catch {
    return false; // `:modal` unsupported: no way to be blocked by one either.
  }
}

/** Creates the UI host on `doc.documentElement` (outside body, so page layout is untouched). */
export function createOverlayUi(doc: Document): OverlayUi {
  const host = doc.createElement(UI_TAG);
  host.setAttribute(IGNORE_ATTR, "");
  const root = host.attachShadow({ mode: "closed" });
  const style = doc.createElement("style");
  style.textContent = CSS;
  const wrap = doc.createElement("div");
  wrap.className = "wrap";
  root.append(style, wrap);
  const topLayer = typeof host.showPopover === "function";
  if (topLayer) host.setAttribute("popover", "manual");
  doc.documentElement.append(host);

  /** Moves the host to the top of the top layer (above a stage or dialog opened since). */
  function raise(): void {
    if (!topLayer || destroyed) return;
    try {
      if (host.matches(":popover-open")) host.hidePopover();
      host.showPopover();
    } catch {
      // Detached or refused: the z-index fallback still applies.
    }
  }

  const previousFocus = doc.activeElement instanceof HTMLElement ? doc.activeElement : null;
  let status: HTMLElement | null = null;
  let panel: HTMLElement | null = null;
  let keyHandler: ((e: KeyboardEvent) => void) | null = null;
  let destroyed = false;

  function clearPanel(): void {
    panel?.remove();
    panel = null;
    if (keyHandler) doc.removeEventListener("keydown", keyHandler, true);
    keyHandler = null;
  }

  return {
    root,
    showStatus(text) {
      if (destroyed) return;
      clearPanel();
      if (!status) {
        status = doc.createElement("div");
        status.className = "pill";
        status.setAttribute("role", "status");
        status.setAttribute("aria-live", "polite");
        const dot = doc.createElement("span");
        dot.className = "dot";
        dot.setAttribute("aria-hidden", "true");
        status.append(dot, doc.createElement("span"));
        wrap.append(status);
        raise();
      }
      const label = status.lastElementChild as HTMLElement;
      label.textContent = text;
    },
    hideStatus() {
      status?.remove();
      status = null;
    },
    showError(spec) {
      if (destroyed) return;
      this.hideStatus();
      clearPanel();
      const modal = pageHasModal(doc) && typeof doc.createElement("dialog").showModal === "function";
      panel = doc.createElement(modal ? "dialog" : "div");
      panel.className = "panel";
      panel.setAttribute("role", "alertdialog");
      panel.setAttribute("aria-labelledby", "swarmloom-error-title");
      panel.setAttribute("aria-describedby", "swarmloom-error-message");
      const title = doc.createElement("h2");
      title.id = "swarmloom-error-title";
      title.textContent = spec.title;
      const message = doc.createElement("p");
      message.id = "swarmloom-error-message";
      message.textContent = spec.message;
      const actions = doc.createElement("div");
      actions.className = "actions";
      let first: HTMLButtonElement | null = null;
      for (const action of spec.actions) {
        const button = doc.createElement("button");
        button.type = "button";
        button.textContent = action.label;
        if (action.primary) button.className = "primary";
        button.addEventListener("click", () => action.run());
        actions.append(button);
        if (!first || (action.primary && !first.classList.contains("primary"))) first = button;
      }
      panel.append(title, message, actions);
      wrap.append(panel);
      raise();
      if (modal) (panel as HTMLDialogElement).showModal();
      keyHandler = (e) => {
        if (e.key !== "Escape") return;
        e.stopPropagation();
        spec.onDismiss();
      };
      doc.addEventListener("keydown", keyHandler, true);
      first?.focus({ preventScroll: true });
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      const hadFocus = panel?.contains(root.activeElement) ?? false;
      clearPanel();
      host.remove();
      if (hadFocus && previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    },
  };
}
