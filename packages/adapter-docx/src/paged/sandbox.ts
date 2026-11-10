/** A hidden, style-isolated layout box of fixed width, mirroring the sandbox snapshot-dom lays content out in. */
export interface Sandbox {
  /** Content container; its top-left is the blueprint origin. */
  readonly root: HTMLElement;
  /** Holds the <style> elements; kept apart from `root` so serializing content does not copy styles. */
  readonly styles: HTMLElement;
  readonly width: number;
  /** Adds a style sheet to the sandbox. */
  addCss(css: string): void;
  /** The concatenated CSS of every <style> element in `styles` (including ones a renderer added). */
  css(): string;
  dispose(): void;
}

/**
 * Host and root rules of the measuring sandbox. They mirror the sandbox snapshot-dom lays content out
 * in (an `all: initial` host, so nothing is inherited from the page, and a root with a 16px system-ui
 * base): content measured here then wraps exactly as it does when it is snapshotted.
 */
function hostCss(width: number): string {
  return [
    `:host{all:initial!important;display:block!important;position:absolute!important;left:-200000px!important;top:0!important;width:${width}px!important;visibility:hidden!important;contain:layout style!important;pointer-events:none!important}`,
    `.swl-sandbox-root{display:block;box-sizing:border-box;width:${width}px;margin:0;padding:0;font:16px/1.5 system-ui,sans-serif;color:CanvasText;background:transparent;overflow-wrap:break-word}`,
    ".swl-sandbox-root img,.swl-sandbox-root svg,.swl-sandbox-root video{max-width:100%}",
  ].join("\n");
}

/**
 * Creates an off-screen sandbox in `doc`: an open shadow root (isolated from the host page's CSS,
 * inheriting nothing from it) on a host that is laid out but invisible and inert.
 */
export function createSandbox(doc: Document, width: number): Sandbox {
  const host = doc.createElement("div");
  host.setAttribute("aria-hidden", "true");
  host.setAttribute("data-swarmloom-sandbox", "");
  host.inert = true;
  host.style.cssText = `position:absolute;left:-200000px;top:0;width:${width}px;visibility:hidden;pointer-events:none;contain:layout style;`;
  const shadow = host.attachShadow({ mode: "open" });
  const base = doc.createElement("style");
  base.textContent = hostCss(width);
  const styles = doc.createElement("div");
  styles.style.display = "none";
  const root = doc.createElement("div");
  root.className = "swl-sandbox-root";
  shadow.append(base, styles, root);
  (doc.body ?? doc.documentElement).append(host);
  return {
    root,
    styles,
    width,
    addCss(css) {
      const style = doc.createElement("style");
      style.textContent = css;
      styles.append(style);
    },
    css() {
      return Array.from(styles.querySelectorAll("style"), (s) => s.textContent ?? "").join("\n");
    },
    dispose() {
      host.remove();
    },
  };
}

const SHEET_ATTR = "data-swl-sheet";

/**
 * Rebuilds the content of `root` from its own serialized HTML, so the DOM that is measured is the one
 * snapshot-dom builds from the same markup. Renderers create DOM trees that HTML parsing restructures
 * (docx-preview puts a picture's <div> inside a <p>, which the parser splits into two paragraphs);
 * without this the sheets would be measured on a different layout than the one snapshotted.
 * Returns the sheets found again in the rebuilt content, in the order given.
 */
export function reparseContent(root: HTMLElement, pages: Iterable<Element>): HTMLElement[] {
  const list = Array.from(pages);
  for (const [i, page] of list.entries()) page.setAttribute(SHEET_ATTR, String(i));
  const template = root.ownerDocument.createElement("template");
  template.innerHTML = root.innerHTML;
  root.replaceChildren(template.content);
  const found: (HTMLElement | undefined)[] = new Array(list.length);
  for (const el of Array.from(root.querySelectorAll<HTMLElement>(`[${SHEET_ATTR}]`))) {
    const index = Number(el.getAttribute(SHEET_ATTR));
    el.removeAttribute(SHEET_ATTR);
    if (Number.isInteger(index) && index >= 0 && index < list.length && !found[index]) found[index] = el;
  }
  for (const page of list) page.removeAttribute(SHEET_ATTR);
  return found.filter((el): el is HTMLElement => el !== undefined);
}

const ASSET_TIMEOUT_MS = 3000;

function withTimeout(promise: Promise<unknown>, ms: number): Promise<unknown> {
  // setTimeout here bounds a loading wait, not animation timing, so it does not affect determinism.
  return Promise.race([promise.catch(() => undefined), new Promise((resolve) => setTimeout(resolve, ms))]);
}

/** Waits (bounded) for web fonts and image decoding inside `root`, so measurements match the final layout. */
export async function waitForAssets(root: HTMLElement): Promise<void> {
  const doc = root.ownerDocument;
  const images = Array.from(root.querySelectorAll("img"), (img) => (img.complete ? Promise.resolve() : img.decode()));
  const fonts = doc.fonts ? doc.fonts.ready : Promise.resolve();
  await withTimeout(Promise.all([fonts, ...images.map((p) => p.catch(() => undefined))]), ASSET_TIMEOUT_MS);
}
