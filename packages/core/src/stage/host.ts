import { holdCssImages } from "./layers/still-css";
import { isSafeDeclaration } from "./sanitize";
import {
  adoptSheet,
  extractFontFaces,
  hostCss,
  type SheetHandle,
  STAGE_CSS,
  WORLD_FREEZE_CSS,
  worldCss,
} from "./styles";

/** Element structure of a mounted stage (all inside one closed shadow root). */
export interface StageDom {
  readonly host: HTMLElement;
  readonly root: ShadowRoot;
  /** Fade target for enter()/goLive() (the host itself carries !important resets). */
  readonly rootEl: HTMLElement;
  /** Viewport-sized element behind the content for plugin backdrops (WebGL scenes). */
  readonly backdrop: HTMLElement;
  readonly scroller: HTMLElement;
  /** Scroll extent: the world size times the view scale. */
  readonly sizer: HTMLElement;
  /** Shadow host of the world tree, sized to Blueprint.size and scaled. */
  readonly world: HTMLElement;
  /** Isolated tree for layers and Blueprint.css. */
  readonly worldRoot: ShadowRoot;
  readonly canvas: HTMLCanvasElement;
  readonly ui: HTMLElement;
  /** True while the host is in the document. */
  readonly attached: boolean;
  /** Settles once an animated Blueprint.background image shows its still copy (see still-css.ts); null when none. */
  readonly backgroundHeld: Promise<void> | null;
  /**
   * Building (false, the initial state) or live (true, an inline stage after go-live). While the
   * stage builds, the world is a visual replay: hidden from assistive technology and inert, so
   * nothing in it takes focus or input (the toolbar and its announcements stand in for it). Live,
   * it is a page again: read by screen readers, links and controls reachable with Tab, text
   * selectable and content animations running.
   */
  setLive(live: boolean): void;
  /** Removes the host from the document but keeps the tree (overlay go-live); attach() puts it back. */
  detach(): void;
  attach(): void;
  /** Removes the host, stylesheets and document-level font faces. */
  dispose(): void;
}

export interface DomOptions {
  mode: "overlay" | "inline";
  parent: HTMLElement;
  /** Opaque colour below the content background. */
  base: string;
  background: string;
  /**
   * Paint Blueprint.background on the backdrop instead of the scroller, so plugin backdrops
   * (WebGL scenes mounted into it) show through the content layer.
   */
  backgroundOnBackdrop: boolean;
  css: string | undefined;
  /** Default text colour for content without explicit colours. */
  textColor: string;
  /** Keyboard focus ring colour of the scroller. */
  focusColor: string;
}

const HOST_TAG = "swarmloom-stage";

function div(doc: Document, cls: string): HTMLDivElement {
  const el = doc.createElement("div");
  el.className = cls;
  return el;
}

/** Builds the isolated stage DOM and attaches it to `parent`. */
export function buildDom(o: DomOptions): StageDom {
  const doc = o.parent.ownerDocument;
  const host = doc.createElement(HOST_TAG);
  host.setAttribute("data-mode", o.mode);
  const root = host.attachShadow({ mode: "closed" });
  const sheets: SheetHandle[] = [];
  sheets.push(adoptSheet(root, hostCss(o.mode) + STAGE_CSS));

  const rootEl = div(doc, "root");
  rootEl.setAttribute("data-mode", o.mode);
  rootEl.style.background = o.base;
  if (isSafeDeclaration("color", o.focusColor)) rootEl.style.setProperty("--sl-focus", o.focusColor);
  const backdrop = div(doc, "backdrop");
  const scroller = div(doc, "scroller");
  // Inline stages are scrollable regions inside a page: keyboard users must be able to focus them.
  scroller.tabIndex = o.mode === "inline" ? 0 : -1;
  scroller.setAttribute("role", "region");
  scroller.setAttribute("aria-label", "SwarmLoom stage");
  let backgroundHeld: Promise<void> | null = null;
  if (isSafeDeclaration("background", o.background)) {
    const painted = o.backgroundOnBackdrop ? backdrop : scroller;
    painted.style.setProperty("background", o.background);
    backgroundHeld = holdCssImages(painted, doc);
  }
  const sizer = div(doc, "sizer");
  const world = div(doc, "world");
  const worldRoot = world.attachShadow({ mode: "closed" });
  const userCss = typeof o.css === "string" ? o.css : "";
  sheets.push(adoptSheet(worldRoot, `${worldCss(o.textColor)}\n${userCss}\n${WORLD_FREEZE_CSS}`));
  const canvas = doc.createElement("canvas");
  canvas.className = "canvas";
  canvas.setAttribute("aria-hidden", "true");
  const ui = div(doc, "ui");

  sizer.append(world);
  scroller.append(sizer);
  rootEl.append(backdrop, scroller, canvas, ui);
  root.append(rootEl);

  // Chromium ignores @font-face inside shadow trees: mirror them at document level.
  const faces = userCss ? extractFontFaces(userCss) : "";
  let fontSheet: SheetHandle | null = faces ? adoptSheet(doc, faces) : null;

  const setLive = (live: boolean): void => {
    if (!live && worldRoot.activeElement) {
      // Focus inside content that turns inert would fall back to <body>: keep it on the stage.
      scroller.focus({ preventScroll: true });
    }
    rootEl.toggleAttribute("data-live", live);
    world.toggleAttribute("data-live", live);
    world.toggleAttribute("inert", !live);
    if (live) world.removeAttribute("aria-hidden");
    else world.setAttribute("aria-hidden", "true");
  };
  setLive(false);

  let attached = false;
  let disposed = false;
  const attach = (): void => {
    if (attached || disposed) return;
    o.parent.append(host);
    attached = true;
    if (o.mode === "overlay") promoteToTopLayer(host);
  };
  const detach = (): void => {
    if (!attached) return;
    attached = false;
    try {
      if (host.matches(":popover-open")) host.hidePopover();
    } catch {
      // popover unsupported
    }
    host.remove();
  };
  attach();

  return {
    host,
    root,
    rootEl,
    backdrop,
    scroller,
    sizer,
    world,
    worldRoot,
    canvas,
    ui,
    backgroundHeld,
    get attached() {
      return attached;
    },
    attach,
    detach,
    setLive,
    dispose() {
      if (disposed) return;
      detach();
      disposed = true;
      for (const s of sheets) s();
      fontSheet?.();
      fontSheet = null;
    },
  };
}

/** Puts the overlay host in the top layer (above page dialogs/popovers open at capture time) when supported. */
function promoteToTopLayer(host: HTMLElement): void {
  if (typeof host.showPopover !== "function") return;
  try {
    host.setAttribute("popover", "manual");
    host.showPopover();
  } catch {
    host.removeAttribute("popover");
  }
}

/**
 * Overlay mode hides the page's own scrollbar while the stage covers it (one scrollbar, the
 * stage's), compensating the gutter so the page underneath does not reflow. Restores the exact
 * inline values it replaced.
 */
export class RootScrollLock {
  #saved: {
    overflow: string;
    overflowPri: string;
    htmlStyled: boolean;
    pad: string;
    padPri: string;
    bodyStyled: boolean;
  } | null = null;
  readonly #doc: Document;

  constructor(doc: Document) {
    this.#doc = doc;
  }

  lock(): void {
    if (this.#saved) return;
    const html = this.#doc.documentElement;
    const body = this.#doc.body;
    const win = this.#doc.defaultView;
    const gutter = win ? Math.max(0, win.innerWidth - html.clientWidth) : 0;
    this.#saved = {
      overflow: html.style.getPropertyValue("overflow"),
      overflowPri: html.style.getPropertyPriority("overflow"),
      htmlStyled: html.hasAttribute("style"),
      pad: body ? body.style.getPropertyValue("padding-right") : "",
      padPri: body ? body.style.getPropertyPriority("padding-right") : "",
      bodyStyled: body ? body.hasAttribute("style") : false,
    };
    if (gutter > 0 && body && win) {
      const current = Number.parseFloat(win.getComputedStyle(body).paddingRight) || 0;
      body.style.setProperty("padding-right", `${current + gutter}px`, "important");
    }
    html.style.setProperty("overflow", "hidden", "important");
  }

  unlock(): void {
    const s = this.#saved;
    if (!s) return;
    this.#saved = null;
    const html = this.#doc.documentElement;
    const body = this.#doc.body;
    restore(html, "overflow", s.overflow, s.overflowPri, s.htmlStyled);
    if (body) restore(body, "padding-right", s.pad, s.padPri, s.bodyStyled);
  }
}

/**
 * Puts one inline property back and drops the `style` attribute again when the element had none.
 * hasAttribute() comes first on purpose: Chromium writes CSSOM changes to the attribute lazily, and
 * removeAttribute() on a not-yet-written attribute is a no-op that later surfaces as `style=""`.
 */
function restore(el: HTMLElement, name: string, value: string, pri: string, hadStyle: boolean): void {
  if (value) el.style.setProperty(name, value, pri);
  else el.style.removeProperty(name);
  if (!hadStyle && el.style.length === 0 && el.hasAttribute("style")) el.removeAttribute("style");
}
