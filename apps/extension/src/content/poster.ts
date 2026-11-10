/**
 * Media-only screenshot for posters.
 *
 * WebGL canvases, playing videos and cross-origin iframes cannot be read from the DOM. To give
 * snapshot-dom a picture of them, the page is hidden for one or two frames except those elements,
 * the background captures the visible tab, and everything is restored. snapshot-dom then crops the
 * media rectangles out of that shot. Only media pixels are ever used; the rest of the frame is
 * blank page background by construction.
 */

/** Shape of `SnapshotOptions.screenshot` (contracts/snapshot.ts). */
export interface PosterShot {
  src: string;
  scrollX: number;
  scrollY: number;
  dpr: number;
}

const MIN_SIZE = 48;
const MAX_MEDIA = 64;
/** Upper bound on elements visited while looking for open shadow roots. */
const MAX_WALK = 50_000;
const FRAME_TIMEOUT_MS = 120;
const HIDE_CSS = "html, html * { visibility: hidden !important; transition: none !important; }";

function isMediaCandidate(el: Element): boolean {
  const tag = el.localName;
  if (tag === "video") return (el as HTMLVideoElement).readyState >= 2;
  if (tag === "canvas" || tag === "embed" || tag === "object") return true;
  if (tag === "iframe") {
    try {
      // Same-origin frames are readable by snapshot-dom; only opaque ones need pixels.
      return (el as HTMLIFrameElement).contentDocument === null;
    } catch {
      return true;
    }
  }
  return false;
}

function inViewport(el: Element, width: number, height: number): boolean {
  const r = el.getBoundingClientRect();
  return r.width >= MIN_SIZE && r.height >= MIN_SIZE && r.right > 0 && r.bottom > 0 && r.left < width && r.top < height;
}

/**
 * Finds visible media elements under `root` (including open shadow roots) that need pixels.
 * Bounded in both the number of visited elements and returned results.
 */
export function findMediaElements(root: Document | Element, view: Window): Element[] {
  const found: Element[] = [];
  const doc = root.nodeType === 9 ? (root as Document) : (root.ownerDocument as Document);
  const start = root.nodeType === 9 ? (root as Document).documentElement : (root as Element);
  if (!start) return found;
  const width = view.innerWidth;
  const height = view.innerHeight;
  const stack: Node[] = [start];
  let visited = 0;
  while (stack.length > 0 && visited < MAX_WALK && found.length < MAX_MEDIA) {
    const scopeRoot = stack.pop() as Node;
    const walker = doc.createTreeWalker(scopeRoot, 1 /* NodeFilter.SHOW_ELEMENT */);
    for (let node = walker.currentNode; node; node = walker.nextNode() as Node) {
      if (++visited > MAX_WALK || found.length >= MAX_MEDIA) break;
      if (node.nodeType !== 1) continue;
      const el = node as Element;
      if (el.shadowRoot) stack.push(el.shadowRoot);
      if (isMediaCandidate(el) && inViewport(el, width, height)) found.push(el);
    }
  }
  return found;
}

interface SavedStyle {
  el: HTMLElement | SVGElement;
  value: string;
  priority: string;
}

/**
 * Hides everything except `media` and returns a restore function. Uses a constructable style sheet
 * (CSSOM, unaffected by page CSP) with a `<style>` fallback, plus inline `visibility: visible` on
 * the media elements (works inside shadow roots too). Restoring is verified: it returns false when
 * something could not be put back.
 */
export function hideAllButMedia(doc: Document, media: readonly Element[]): () => boolean {
  const saved: SavedStyle[] = [];
  for (const el of media) {
    const styled = el as HTMLElement;
    if (!styled.style) continue;
    saved.push({
      el: styled,
      value: styled.style.getPropertyValue("visibility"),
      priority: styled.style.getPropertyPriority("visibility"),
    });
    styled.style.setProperty("visibility", "visible", "important");
  }

  let sheet: CSSStyleSheet | null = null;
  let styleEl: HTMLStyleElement | null = null;
  try {
    sheet = new CSSStyleSheet();
    sheet.replaceSync(HIDE_CSS);
    doc.adoptedStyleSheets = [...doc.adoptedStyleSheets, sheet];
  } catch {
    sheet = null;
    styleEl = doc.createElement("style");
    styleEl.textContent = HIDE_CSS;
    (doc.head ?? doc.documentElement).append(styleEl);
  }

  let restored = false;
  return () => {
    if (restored) return true;
    restored = true;
    let ok = true;
    if (sheet) {
      const s = sheet;
      doc.adoptedStyleSheets = doc.adoptedStyleSheets.filter((x) => x !== s);
      ok &&= !doc.adoptedStyleSheets.includes(s);
    }
    if (styleEl) {
      styleEl.remove();
      ok &&= !styleEl.isConnected;
    }
    for (const { el, value, priority } of saved) {
      if (value) el.style.setProperty("visibility", value, priority);
      else el.style.removeProperty("visibility");
      ok &&= el.style.getPropertyValue("visibility") === value;
    }
    return ok;
  };
}

function nextFrame(view: Window): Promise<void> {
  return new Promise((resolve) => {
    // rAF does not fire in hidden tabs; the timeout keeps the capture from hanging.
    const timer = view.setTimeout(resolve, FRAME_TIMEOUT_MS);
    view.requestAnimationFrame(() => {
      view.clearTimeout(timer);
      resolve();
    });
  });
}

export interface PosterDeps {
  /** Asks the background for `tabs.captureVisibleTab`; resolves to a data URL or null. */
  capture(): Promise<string | null>;
}

/**
 * Captures a media-only screenshot of the viewport, or null when there is no media to crop, the
 * capture failed, or the page scrolled or zoomed while capturing (the crop would be misaligned).
 */
export async function capturePoster(
  root: Document | Element,
  view: Window,
  deps: PosterDeps,
  signal?: AbortSignal,
): Promise<PosterShot | null> {
  const doc = root.nodeType === 9 ? (root as Document) : (root.ownerDocument as Document);
  const media = findMediaElements(root, view);
  if (media.length === 0 || signal?.aborted) return null;
  const before = {
    x: view.scrollX,
    y: view.scrollY,
    w: view.innerWidth,
    h: view.innerHeight,
    dpr: view.devicePixelRatio,
  };
  const restore = hideAllButMedia(doc, media);
  let src: string | null = null;
  try {
    await nextFrame(view);
    await nextFrame(view);
    if (!signal?.aborted) src = await deps.capture();
  } catch {
    src = null;
  } finally {
    if (!restore()) console.warn("SwarmLoom: page styles were not fully restored after the poster capture");
  }
  const stable =
    view.scrollX === before.x &&
    view.scrollY === before.y &&
    view.innerWidth === before.w &&
    view.innerHeight === before.h &&
    view.devicePixelRatio === before.dpr;
  if (!src || !stable || signal?.aborted) return null;
  return { src, scrollX: before.x, scrollY: before.y, dpr: before.dpr };
}
