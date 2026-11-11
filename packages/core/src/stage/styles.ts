import { UI_FONT_STACK } from "../cursor/sprite";

/**
 * Host rules; `!important` inside the shadow tree beats any page rule or inline style on the host.
 * State attributes set by the stage:
 *  - data-passive: the stage does not take pointer input (overlay before enter(), while going live);
 *  - data-autoheight: inline host inside a container without a height; sized by the world's aspect ratio.
 */
export function hostCss(mode: "overlay" | "inline"): string {
  const common =
    "all:initial!important;display:block!important;margin:0!important;padding:0!important;border:0!important;" +
    "background:transparent!important;overflow:hidden!important;contain:strict!important;" +
    "max-width:none!important;max-height:none!important;min-width:0!important;min-height:0!important;" +
    "color-scheme:normal!important;visibility:visible!important;";
  const place =
    mode === "overlay"
      ? "position:fixed!important;inset:0!important;width:100%!important;height:100%!important;" +
        "z-index:2147483647!important;"
      : "position:relative!important;width:100%!important;height:100%!important;";
  return (
    `:host{${common}${place}}` +
    ":host([data-passive]){pointer-events:none!important}" +
    ":host([data-autoheight]){height:auto!important;aspect-ratio:var(--sl-ratio,16/9)!important;" +
    "max-height:100vh!important}"
  );
}

/**
 * Outer shadow root: viewport chrome (scroller, canvas, UI layer).
 * The UI layer itself never takes pointer input; toolbar elements opt in with `pointer-events:auto`,
 * so wheel and touch over empty stage areas reach the scroller.
 * Rebuilt content is a replay, not a live page: it takes no pointer input until an inline stage
 * goes live (data-live), when text becomes selectable and links usable.
 * Overlay scrollers keep the default scrollbar and no reserved gutter: it appears exactly when the page had one,
 * so content stays aligned with the page underneath. Inline scrollers reserve it, so the fit-to-width
 * scale cannot oscillate as the scrollbar comes and goes.
 * The world isolates its own stacking context, so layer z-indexes stay under the cursor canvas
 * even when it has no transform (scale 1, no centring).
 * No transitions or animations: every fade is driven by engine time (deterministic exports).
 */
export const STAGE_CSS = `
.root{position:absolute;inset:0;overflow:hidden;font:400 13px/1.4 ${UI_FONT_STACK};
  -webkit-text-size-adjust:100%;text-size-adjust:100%;-webkit-tap-highlight-color:transparent}
.backdrop{position:absolute;inset:0;pointer-events:none}
.scroller{position:absolute;inset:0;overflow:auto;overscroll-behavior:contain;
  background-attachment:local!important;outline:none}
.root[data-mode=inline] .scroller{overflow-x:hidden;scrollbar-gutter:stable;scrollbar-width:thin}
.root[data-mode=inline] .scroller:focus-visible{outline:2px solid var(--sl-focus,#5B5BF7);outline-offset:-2px}
.sizer{position:relative;overflow:hidden;overflow:clip}
.world{position:absolute;left:0;top:0;transform-origin:0 0;display:block;pointer-events:none;isolation:isolate}
.root[data-live] .world{pointer-events:auto}
.canvas{position:absolute;left:0;top:0;pointer-events:none;display:block}
.ui{position:absolute;inset:0;pointer-events:none}
`;

/** World shadow root base rules, inserted before Blueprint.css so content rules can refine them. */
export function worldCss(textColor: string): string {
  return `
:host{all:initial;display:block;font-family:${UI_FONT_STACK};color:${textColor};
  -webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
.sl-k,.sl-s{position:absolute;box-sizing:border-box;margin:0;padding:0;border:0}
.sl-k{overflow:hidden;overflow:clip}
.sl-c{position:absolute;left:0;top:0;width:100%;height:100%;box-sizing:border-box;margin:0}
.sl-g{position:absolute;inset:0;box-sizing:border-box;pointer-events:none}
.sl-m{display:flex;align-items:center;justify-content:center;gap:8px;overflow:hidden;
  font:500 12px/1.3 ${UI_FONT_STACK};letter-spacing:0.01em;text-align:center}
.sl-m i{display:block;width:0;height:0;border-style:solid;border-width:6px 0 6px 10px;
  border-color:transparent transparent transparent currentColor;flex:none}
sl-h{visibility:hidden}
`;
}

/**
 * Appended after Blueprint.css: content animations and transitions run on wall-clock time, so they
 * are frozen while the stage builds (deterministic exports, invariant I2). An inline stage that
 * went live (data-live on the world host) lets them run again.
 */
export const WORLD_FREEZE_CSS = `
:host(:not([data-live])) *,:host(:not([data-live])) *::before,:host(:not([data-live])) *::after{
  animation-play-state:paused!important;transition:none!important}
`;

/** Extracts @font-face blocks; Chromium ignores @font-face declared inside shadow roots. */
export function extractFontFaces(css: string): string {
  const out: string[] = [];
  const re = /@font-face\s*\{[^{}]*\}/gi;
  for (let m = re.exec(css); m; m = re.exec(css)) out.push(m[0]);
  return out.join("\n");
}

/** Removes a stylesheet added by adoptSheet(). */
export type SheetHandle = () => void;

type SheetTarget = ShadowRoot | Document;

/**
 * Adds `css` to a shadow root or document: a constructable stylesheet when supported (works under
 * strict CSP), else a <style> element. Sheets with @import (ignored by replaceSync) use <style>.
 */
export function adoptSheet(target: SheetTarget, css: string): SheetHandle {
  const isDoc = target.nodeType === 9;
  const doc = isDoc ? (target as Document) : (target.ownerDocument as Document);
  const Ctor = doc.defaultView?.CSSStyleSheet;
  if (Ctor && "adoptedStyleSheets" in target && "replaceSync" in Ctor.prototype && !/@import/i.test(css)) {
    try {
      const sheet = new Ctor();
      sheet.replaceSync(css);
      target.adoptedStyleSheets = [...target.adoptedStyleSheets, sheet];
      return () => {
        target.adoptedStyleSheets = target.adoptedStyleSheets.filter((s) => s !== sheet);
      };
    } catch {
      // fall through to <style>
    }
  }
  const style = doc.createElement("style");
  style.textContent = css;
  if (isDoc) ((target as Document).head ?? (target as Document).documentElement).append(style);
  else target.append(style);
  return () => style.remove();
}
