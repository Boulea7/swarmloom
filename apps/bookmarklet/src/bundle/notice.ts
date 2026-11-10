import type { NoticeMessages } from "./messages";

/** Options of {@link showNotice}. */
export interface NoticeOptions {
  doc: Document;
  messages: NoticeMessages;
  /** Extra line under the body, e.g. after the browser blocked the Studio tab. */
  hint?: string;
  /** "Open in Studio" pressed. The notice is already closed when this runs. */
  onStudio(): void;
  /** "Close" pressed or Escape. The notice is already closed when this runs. */
  onClose(): void;
}

/** A visible notice. */
export interface Notice {
  /** Removes the notice; safe to call more than once. */
  close(): void;
}

/** `id` of the notice host element. */
export const NOTICE_ID = "swarmloom-notice";

const CSS = `
.card{box-sizing:border-box;position:fixed;right:16px;bottom:max(16px,env(safe-area-inset-bottom));
max-width:min(380px,calc(100vw - 32px));padding:16px 18px;border-radius:14px;
background:#FAFAFC;color:#0B0B12;border:1px solid rgba(11,11,18,.12);box-shadow:0 12px 32px rgba(11,11,18,.18);
font:14px/1.5 system-ui,-apple-system,"Segoe UI","PingFang SC","Noto Sans SC","Microsoft YaHei",sans-serif;
text-align:start;letter-spacing:normal}
.title{margin:0 0 4px;font-weight:600;font-size:15px}
.body,.hint{margin:0 0 12px}
.hint{font-weight:600}
.actions{display:flex;flex-wrap:wrap;gap:8px}
button{font:inherit;font-weight:600;min-height:40px;padding:0 14px;border-radius:10px;cursor:pointer;
border:1px solid rgba(11,11,18,.12);background:transparent;color:inherit}
.primary{background:#5B5BF7;border-color:#5B5BF7;color:#fff}
button:focus-visible{outline:2px solid #5B5BF7;outline-offset:2px}
@media (prefers-color-scheme:dark){.card{background:#16161F;color:#F2F2F7;border-color:rgba(255,255,255,.14)}
button{border-color:rgba(255,255,255,.14)}}
@media (max-width:480px){.card{left:12px;right:12px;max-width:none}}
@media (prefers-reduced-motion:no-preference){.card{animation:swarmloom-in .2s ease-out}}
@keyframes swarmloom-in{from{opacity:0;transform:translateY(8px)}}
`;

/**
 * Applies the notice styles. Constructable style sheets are not subject to the page's
 * `style-src` policy; older browsers get a `<style>` element instead.
 */
function applyStyles(root: ShadowRoot, doc: Document): void {
  const view = doc.defaultView;
  if (view && "adoptedStyleSheets" in root && "replaceSync" in view.CSSStyleSheet.prototype) {
    // The sheet must be constructed in the realm of the document it is adopted into.
    const sheet = new view.CSSStyleSheet();
    sheet.replaceSync(CSS);
    root.adoptedStyleSheets = [sheet];
    return;
  }
  const style = doc.createElement("style");
  style.textContent = CSS;
  root.append(style);
}

function element<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  props: { className?: string; id?: string; text?: string },
): HTMLElementTagNameMap[K] {
  const el = doc.createElement(tag);
  if (props.className) el.className = props.className;
  if (props.id) el.id = props.id;
  if (props.text) el.textContent = props.text;
  return el;
}

/**
 * Shows the in-page failure notice in an isolated shadow root: a short explanation and
 * "Open in Studio" / "Close" buttons. Focus moves to "Open in Studio"; Escape closes.
 * Replaces a notice that is already visible.
 */
export function showNotice(options: NoticeOptions): Notice {
  const { doc, messages } = options;
  doc.getElementById(NOTICE_ID)?.remove();
  const host = element(doc, "div", { id: NOTICE_ID });
  // Inline styles beat page selectors that target the host element.
  host.style.cssText = "all:initial;position:fixed;z-index:2147483647";
  const root = host.attachShadow({ mode: "open" });
  applyStyles(root, doc);

  const card = element(doc, "div", { className: "card" });
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-labelledby", "title");
  card.setAttribute("aria-describedby", "body");
  card.append(
    element(doc, "p", { className: "title", id: "title", text: messages.title }),
    element(doc, "p", { className: "body", id: "body", text: messages.body }),
  );
  if (options.hint) {
    const hint = element(doc, "p", { className: "hint", text: options.hint });
    hint.setAttribute("role", "status");
    card.append(hint);
  }
  const studio = element(doc, "button", { className: "primary", text: messages.openStudio });
  const close = element(doc, "button", { text: messages.close });
  studio.type = close.type = "button";
  const actions = element(doc, "div", { className: "actions" });
  actions.append(studio, close);
  card.append(actions);
  root.append(card);

  let open = true;
  const dismiss = () => {
    if (!open) return;
    open = false;
    host.remove();
  };
  studio.addEventListener("click", () => {
    dismiss();
    options.onStudio();
  });
  close.addEventListener("click", () => {
    dismiss();
    options.onClose();
  });
  card.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    e.stopPropagation();
    dismiss();
    options.onClose();
  });
  doc.documentElement.append(host);
  studio.focus({ preventScroll: true });
  return { close: dismiss };
}
