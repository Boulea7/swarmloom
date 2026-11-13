import { holdAllCssImages, holdSvgImages, stillImageSource } from "@swarmloom/core";
import { mayStartAnimations, readStyleFacts, type StyleFacts } from "@swarmloom/core/internal";
import { AnimationSeeker, freezeRunning } from "./seek";

const SVG_NS = "http://www.w3.org/2000/svg";
const SMIL = new Set(["animate", "animateTransform", "animateMotion", "animateColor", "set"]);
/** Height difference (CSS px) up to which the live page still counts as the page that was woven. */
const SIZE_SLACK = 2;
/**
 * Rounds of seeking what the last round's writes started ({@link LiveStage.sync}). What the last
 * round starts is seeked on the next frame, from its start then.
 */
const SETTLE_ROUNDS = 3;
/** Longest wait for the render page's next rendering update ({@link renderingUpdate}). */
const UPDATE_WAIT_MS = 1000;
/**
 * A scroll-state container query, whose state the engine takes at its rendering updates, from the
 * scroll offsets it sees then, not in a style or layout flush (see {@link cssTakesAtUpdate}).
 */
const SCROLL_STATE_QUERY = /scroll-state\(/i;
/**
 * `position-try` and `position-try-fallbacks` declarations and their values: the fallback an anchor
 * position takes (which `anchored()` container queries follow), also taken at a rendering update.
 */
const POSITION_TRY = /(?<![\w-])position-try(?:-fallbacks)?\s*:\s*([^;}]*)/gi;
/**
 * Values of {@link POSITION_TRY} that set no fallback: `none` and the CSS-wide keywords, which a reset
 * such as `all: unset` writes for every longhand when Chromium serialises it.
 */
const NO_FALLBACKS = /^(?:none|normal\s+none|initial|inherit|unset|revert|revert-layer)$/i;
/** Inline styles that can hold {@link POSITION_TRY} declarations. */
const POSITION_TRY_INLINE = '[style*="position-try" i]';

/**
 * Pose of the live page's infinite loops, as a fraction of one cycle: the render page's HTML adapter
 * freezes them there for the capture (its `infinitePhase`, see renderFormats), and go live freezes
 * the loops the page started since at the same pose.
 */
export const LIVE_LOOP_PHASE = 0.5;

/** The live page an adapter kept behind its capture (`LoadedHtml.live` of @swarmloom/adapter-html). */
export interface LivePage {
  /** Hidden, sandboxed frame showing the page with its animations frozen at the captured pose. */
  frame: HTMLIFrameElement;
  document: Document;
}

/** The live page of a loaded source, when its adapter kept one (read structurally, like the CLI reads the API). */
export function livePageOf(loaded: object): LivePage | null {
  const live = (loaded as { live?: { frame?: unknown; document?: unknown } }).live;
  const frame = live?.frame as HTMLIFrameElement | undefined;
  const doc = live?.document as Document | undefined;
  if (frame?.nodeType !== 1 || frame.localName !== "iframe" || doc?.nodeType !== 9) return null;
  return { frame, document: doc };
}

/** Shadow roots attached in a window while watched. */
export interface ShadowWatch {
  /** Roots whose host is still in the document, in creation order. */
  roots(): ShadowRoot[];
  /** Restores `attachShadow`. */
  stop(): void;
}

/**
 * Records every shadow root attached in `win` until `stop()`. The stage keeps its roots closed and
 * `document.getAnimations()` does not reach into shadow trees, so the render page, which owns its
 * document and nothing else attaches roots in it, watches `attachShadow` to find the stage world
 * and the animations of every layer subtree.
 */
export function watchShadowRoots(win: Window & typeof globalThis): ShadowWatch {
  const proto = win.Element.prototype;
  const original = proto.attachShadow;
  let roots: ShadowRoot[] = [];
  const watched = function (this: Element, init: ShadowRootInit): ShadowRoot {
    const root = original.call(this, init);
    roots.push(root);
    return root;
  };
  proto.attachShadow = watched;
  return {
    roots() {
      roots = roots.filter((root) => root.host.isConnected);
      return roots;
    },
    stop() {
      if (proto.attachShadow === watched) proto.attachShadow = original;
      roots = [];
    },
  };
}

/** Outermost `<svg>` elements of `doc` that hold SMIL animation (each is one time container). */
function animatedSvgs(doc: Document): SVGSVGElement[] {
  const found: SVGSVGElement[] = [];
  for (const el of Array.from(doc.getElementsByTagNameNS(SVG_NS, "svg"))) {
    const svg = el as SVGSVGElement;
    if (svg.ownerSVGElement) continue;
    if (Array.from(svg.getElementsByTagNameNS(SVG_NS, "*")).some((child) => SMIL.has(child.localName))) {
      found.push(svg);
    }
  }
  return found;
}

/**
 * Stops every `<marquee>` of `doc` at its resting (unscrolled) pose, the pose the capture shows.
 * Chromium scrolls a marquee with an animation inside its UA shadow tree, which neither
 * `getAnimations()` nor the seek reaches, so it would scroll on wall time and `stop()` alone would
 * keep a wall-time pose. A fresh copy is unscrolled until the start its insertion scheduled runs;
 * stopping it right away cancels that start. WebKit lays a copy out at its start position, off the
 * edge, and starts it on that first layout, which a stop() before it misses; a zero scroll amount
 * keeps the copy unscrolled there and changes nothing elsewhere.
 */
function restMarquees(doc: Document): void {
  for (const marquee of Array.from(doc.getElementsByTagName("marquee"))) {
    // Marquees nested in one already replaced left the document with it.
    if (!marquee.isConnected) continue;
    const still = marquee.cloneNode(true) as HTMLMarqueeElement;
    const copies = [still, ...Array.from(still.getElementsByTagName("marquee"))];
    for (const copy of copies) copy.setAttribute("scrollamount", "0");
    marquee.replaceWith(still);
    for (const copy of copies) copy.stop();
  }
}

/**
 * Shows every animated `<img>` of the live page as a still copy, as the stage shows its image layers
 * (core's stillImageSource: a GIF, APNG, WebP or AVIF animation at its first frame, an SVG without
 * its animation). An `<img>` plays them on the browser's clock, which no seek reaches. The copy has
 * the same pixel size, so nothing reflows (the adapter dropped `srcset`). Animated CSS images of its
 * elements (backgrounds, masks, border images, list markers) are overridden inline with still copies
 * the same way (core's holdAllCssImages); pseudo-elements keep theirs. The `<image>` and `<feImage>`
 * elements of its inline SVG show still copies too (core's holdSvgImages), and so do video posters
 * and image buttons (`<input type="image">`), which `document.images` leaves out. Images the render
 * page cannot read (cross-origin files) keep their own clock.
 */
async function stillImages(page: LivePage, doc: Document): Promise<void> {
  const posters = page.document.querySelectorAll("video[poster]");
  const buttons = page.document.querySelectorAll("input[type=image][src]");
  await Promise.all([
    ...Array.from(page.document.images, async (img) => {
      const src = img.currentSrc || img.src;
      if (!src) return;
      const still = await stillImageSource(src, doc);
      if (still === src) return;
      img.src = still;
      await img.decode().catch(() => undefined);
    }),
    ...Array.from(posters, (video) => stillAttribute(video, "poster", doc)),
    ...Array.from(buttons, (input) => stillAttribute(input, "src", doc)),
    holdAllCssImages(page.document.querySelectorAll<HTMLElement>("*"), doc, true),
    holdSvgImages(page.document, doc),
  ]);
}

/**
 * Points the image URL attribute `name` of `el` (a video's `poster`, an image button's `src`) at its
 * still copy, then waits until the copy is decoded in the page, so the element paints it at once.
 * Neither element has a `decode()` of its own.
 */
async function stillAttribute(el: Element, name: "poster" | "src", doc: Document): Promise<void> {
  const raw = el.getAttribute(name)?.trim();
  if (!raw) return;
  let src: string;
  try {
    src = new URL(raw, el.baseURI).href;
  } catch {
    return;
  }
  const still = await stillImageSource(src, doc);
  if (still === src) return;
  el.setAttribute(name, still);
  const probe = el.ownerDocument.createElement("img");
  probe.src = still;
  await probe.decode().catch(() => undefined);
}

/** The interface name of a CSSOM object, which works across frames (unlike `instanceof`). */
function kind(rule: CSSRule): string {
  return Object.prototype.toString.call(rule).slice(8, -1);
}

/**
 * Whether CSS text (rules or a `style` attribute) holds state the engine takes at its rendering
 * updates: a scroll-state query or anchor position fallbacks. A match elsewhere, as in a string,
 * only makes a step wait for nothing.
 */
function cssTakesAtUpdate(text: string): boolean {
  if (SCROLL_STATE_QUERY.test(text)) return true;
  for (const [, value = ""] of text.matchAll(POSITION_TRY)) {
    if (!NO_FALLBACKS.test(value.replace(/!\s*important\s*$/i, "").trim())) return true;
  }
  return false;
}

/** Whether `sheet` or a sheet it imports holds {@link cssTakesAtUpdate} rule text; true when it cannot be read. */
function sheetTakesAtUpdate(sheet: CSSStyleSheet, seen: Set<CSSStyleSheet>): boolean {
  if (seen.has(sheet)) return false;
  seen.add(sheet);
  let rules: CSSRuleList;
  try {
    rules = sheet.cssRules;
  } catch {
    // Another origin's sheet: it may hold anything.
    return true;
  }
  for (const rule of Array.from(rules)) {
    const type = kind(rule);
    if (type === "CSSImportRule") {
      const imported = (rule as CSSImportRule).styleSheet;
      if (imported && sheetTakesAtUpdate(imported, seen)) return true;
    } else if (type !== "CSSFontFaceRule" && cssTakesAtUpdate(rule.cssText)) {
      // A rule's text holds its prelude and the rules nested in it; a font face's holds its sources.
      return true;
    }
  }
  return false;
}

/**
 * Whether the style sheets or inline styles of `doc` hold rules whose state the engine takes at its
 * rendering updates ({@link cssTakesAtUpdate}).
 */
function takesAtUpdate(doc: Document): boolean {
  const inline = Array.from(doc.querySelectorAll(POSITION_TRY_INLINE));
  if (inline.some((el) => cssTakesAtUpdate(el.getAttribute("style") ?? ""))) return true;
  const seen = new Set<CSSStyleSheet>();
  const sheets = [...Array.from(doc.styleSheets), ...(doc.adoptedStyleSheets ?? [])];
  return sheets.some((sheet) => sheetTakesAtUpdate(sheet as CSSStyleSheet, seen));
}

/**
 * Resolves once the next rendering update of the page of `doc` is over: the engine lays the page
 * out after the animation frame callbacks and starts there what it takes at that update, so a task
 * queued from one runs after all that (as the raster export's `renderingUpdate` waits). At once when
 * the document is hidden, which takes none, or its window has no animation frames; after
 * {@link UPDATE_WAIT_MS} at the latest.
 */
function renderingUpdate(doc: Document): Promise<void> {
  const win = doc.defaultView;
  if (!win || typeof win.requestAnimationFrame !== "function" || doc.visibilityState === "hidden") {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const timer = win.setTimeout(resolve, UPDATE_WAIT_MS);
    win.requestAnimationFrame(() => {
      win.setTimeout(() => {
        win.clearTimeout(timer);
        resolve();
      }, 0);
    });
  });
}

/**
 * Shows the live page over the stage, scrolled so it covers exactly the part of the world the stage
 * shows (the frame keeps its size, so nothing reflows). Returns why it could not, or null.
 *
 * The frame's box is painted `Canvas`, the colour a browser tab paints under a page: a frame's
 * canvas stays transparent where the page paints no background of its own (no html or body
 * background), and the stage's frozen copy of the page under it would show through, every element
 * twice. The box only shows when the page and the frame element use the same colour scheme; when
 * they differ, the browser paints the canvas in the page's `Canvas` itself (CSS Color Adjust 1, as
 * Chromium does). Either way the page sits on its own canvas colour.
 */
function showLivePage(page: LivePage, world: HTMLElement | null, host: HTMLElement): string | null {
  const win = page.frame.contentWindow;
  if (!world || !win || !page.frame.isConnected) return "the stage world or the page frame is gone";
  const root = page.document.documentElement;
  const pageHeight = Math.max(root.scrollHeight, page.document.body?.scrollHeight ?? 0, win.innerHeight);
  if (Math.abs(pageHeight - world.offsetHeight) > SIZE_SLACK) {
    return `the page is ${pageHeight} px tall but was woven at ${world.offsetHeight} px`;
  }
  const rect = world.getBoundingClientRect();
  const view = host.getBoundingClientRect();
  const scale = world.offsetWidth > 0 ? rect.width / world.offsetWidth : 1;
  // "instant" overrides a page-level `scroll-behavior: smooth`, which would scroll on wall time
  // and leave scrollX/scrollY (read below) at their old values.
  const left = (view.left - rect.left) / scale;
  const top = (view.top - rect.top) / scale;
  win.scrollTo({ left, top, behavior: "instant" as ScrollBehavior });
  const style = page.frame.style;
  style.left = `${rect.left + win.scrollX * scale}px`;
  style.top = `${rect.top + win.scrollY * scale}px`;
  style.transformOrigin = "0 0";
  style.transform = scale === 1 ? "" : `scale(${scale})`;
  style.backgroundColor = "Canvas";
  style.zIndex = "2147483647";
  return null;
}

/** What {@link LiveStage} works on. */
export interface LiveStageOptions {
  document: Document;
  /** Element the stage is mounted in. */
  host: HTMLElement;
  /** Shadow roots of the stage (watched while the player was created and since). */
  shadows: ShadowWatch;
  /** The live page behind an HTML capture, swapped in over the stage on go live. */
  page: LivePage | null;
  /** Recoverable problems (the live page could not be shown). */
  onWarning?: (message: string) => void;
}

/**
 * The render page's side of go live. Once the stage is live (`PlayerOptions.onLive`) it shows the
 * live page an adapter kept (the real HTML page, its animations frozen at the captured pose, and any
 * it started since frozen by the same rule then) over the stage, and from then on every frame pauses
 * all Web Animations (document, stage subtrees, live page) and the live page's SVG documents and
 * seeks them to the transport time ({@link LiveStage.sync}), also the ones the page's next rendering
 * update starts ({@link LiveStage.settle}), so frames never depend on wall time. The live page's
 * `<marquee>` elements, which no seek reaches, stay still at their captured resting pose, and its
 * animated images show still copies ({@link LiveStage.holdImages}). Plugin players (SMIL replay,
 * Lottie) follow player time on their own.
 */
export class LiveStage {
  readonly #seeker = new AnimationSeeker();
  readonly #o: LiveStageOptions;
  #page: LivePage | null;
  #svgs: SVGSVGElement[] = [];
  #live = false;
  /** What the styles of each document and shadow root let a seek start ({@link LiveStage.sync}). */
  readonly #facts = new WeakMap<Document | ShadowRoot, StyleFacts>();
  /**
   * Transport time the live page was shown and scrolled at, until the {@link LiveStage.settle} of
   * that frame: it waits whatever the page's styles, and what the frame finds the page started is
   * anchored at this time.
   */
  #shownAt: number | null = null;
  /** Whether the live page's styles hold rules the engine takes at its rendering updates, once read. */
  #atUpdate: boolean | null = null;

  constructor(options: LiveStageOptions) {
    this.#o = options;
    this.#page = options.page;
  }

  /** True once {@link goLive} ran. */
  get live(): boolean {
    return this.#live;
  }

  /**
   * Swaps the live page's animated images for still copies (see stillImages). Await it before the
   * first frame: the copies are decoded or fetched asynchronously, and go live only shows the page.
   */
  async holdImages(): Promise<void> {
    if (this.#page) await stillImages(this.#page, this.#o.document);
  }

  /** The stage went live at transport time `t` (ms): swaps the live page in and seeks everything to `t`. */
  goLive(t: number): void {
    if (this.#live) return;
    this.#live = true;
    const page = this.#page;
    if (page) {
      const problem = showLivePage(page, this.#world(), this.#o.host);
      if (problem) {
        this.#page = null;
        this.#o.onWarning?.(`the live page stays hidden: ${problem}`);
      } else {
        this.#shownAt = t;
        restMarquees(page.document);
        this.#svgs = animatedSvgs(page.document);
        // The capture froze every animation of the page, but the page may have started more since
        // (sections with `content-visibility: auto` the browser laid out later, the marquees just
        // replaced) that run on wall time: freeze those by the same rule before the seek anchors them.
        freezeRunning(page.document.getAnimations(), LIVE_LOOP_PHASE);
      }
    }
    this.sync(t);
  }

  /**
   * Seeks every animation to transport time `t` (ms); does nothing before go live.
   *
   * The seeked values can start transitions and animations elsewhere: an element inherits a new
   * value, or a container takes a new size and a container query now matches. Those appear at the
   * next style and layout update, and until a seek reaches them they would run on wall time (the
   * screenshot, the rasterizer's reads of the frame). So the seek makes that update right away, reads
   * the animations again and seeks what started at `t` as well, from its start, a few rounds deep.
   * Reading them is the costly part of a seek (Chromium sorts them by tree order), so only a
   * document whose styles let a seek start something ({@link mayStartAnimations}: its keyframes
   * animate a value that a transition or a container there can take, which fades and pulses do
   * not) is read again: the render page with its stage roots, or the live page (also when it
   * holds SMIL animation, whose seek can render elements again).
   *
   * On the frame that went live, when it comes engine ticks after go live, a rendering update between
   * those ticks may already have taken the go-live scroll: what the live page started since is first
   * seeked from its start at the go-live time, as {@link settle} seeks it (from the same read).
   */
  sync(t: number): void {
    if (!this.#live) return;
    const shownAt = this.#shownAt;
    if (shownAt !== null && t > shownAt) {
      const page = [...this.#animations(false, true)];
      this.#seeker.seekNew(page, t, shownAt);
      this.#seeker.seekAnimations([...this.#animations(true, false), ...page], t);
    } else {
      this.#seeker.seekAnimations(this.#animations(), t);
    }
    this.#seeker.seekSvgs(this.#svgs, t);
    const scopes = [this.#o.document, ...this.#o.shadows.roots()];
    const stage = mayStartAnimations(scopes.map((scope) => this.#styles(scope)));
    const page =
      this.#page !== null && (this.#svgs.length > 0 || mayStartAnimations([this.#styles(this.#page.document)]));
    if (!stage && !page) return;
    for (let round = 0; round < SETTLE_ROUNDS; round++) {
      this.#layout();
      if (this.#seeker.seekNew(this.#animations(stage, page), t) === 0) break;
    }
  }

  /**
   * Seeks what the page's next rendering update starts to transport time `t` (ms), from its start;
   * call it after {@link sync}, before the frame is painted or read. Does nothing before go live or
   * without the live page.
   *
   * Some state the engine takes only at a rendering update, from the layout and scroll offsets it
   * sees then (a scroll-state query that sticks a header once go live scrolls the page, the
   * fallback an anchor-positioned tooltip flips to). A transition or animation that starts there
   * is not there for {@link sync} to read: it would run on wall time through the screenshot or the
   * rasterizer's reads, then jump back to its start at the next frame's seek. So this waits for that
   * update, reads the live page's animations again and seeks what started, from its start at `t`,
   * as long as an update starts more (a few rounds); the stage under the live page is not read again.
   * On the frame that went live, the go-live scroll set them off, so they start at the go-live time,
   * which can be engine ticks before `t`: a frame then shows what the same time shows at any frame
   * rate.
   * It waits on the frame that went live, which showed and scrolled the page, and on later frames
   * only while the live page's styles hold such rules ({@link cssTakesAtUpdate}: a reset such as
   * `all: unset` sets no fallback; a seek that moves the layout can change that state too);
   * otherwise it resolves at once, and so it does in a hidden document, which takes no
   * rendering updates.
   */
  async settle(t: number): Promise<void> {
    const page = this.#page;
    if (!this.#live || !page) return;
    const shownAt = this.#shownAt;
    this.#shownAt = null;
    this.#atUpdate ??= takesAtUpdate(page.document);
    if (shownAt === null && !this.#atUpdate) return;
    const from = shownAt ?? t;
    for (let round = 0; round < SETTLE_ROUNDS; round++) {
      await renderingUpdate(this.#o.document);
      if (this.#seeker.seekNew(this.#animations(false, true), t, from) === 0) break;
    }
  }

  dispose(): void {
    this.#o.shadows.stop();
  }

  /**
   * Lays out the render page and the live page. `getAnimations()` flushes style, but an element in a
   * size container takes its style from the container's laid-out size, which not every engine
   * resolves in a style flush. The frame needs this layout anyway.
   */
  #layout(): void {
    void this.#o.document.documentElement?.getBoundingClientRect();
    void this.#page?.document.documentElement?.getBoundingClientRect();
  }

  /** The stage world: the first watched root's host that sits in another watched root. */
  #world(): HTMLElement | null {
    const roots = this.#o.shadows.roots();
    const inner = roots.find((root) => roots.includes(root.host.getRootNode() as ShadowRoot));
    return (inner?.host as HTMLElement | undefined) ?? null;
  }

  /** What the styles of `scope` let a seek start, read the first time it is asked. */
  #styles(scope: Document | ShadowRoot): StyleFacts {
    let facts = this.#facts.get(scope);
    if (!facts) {
      facts = readStyleFacts(scope);
      this.#facts.set(scope, facts);
    }
    return facts;
  }

  /** The animations of the render page and its stage roots (`stage`) and of the live page (`page`). */
  *#animations(stage = true, page = true): Iterable<Animation> {
    if (stage) {
      yield* this.#o.document.getAnimations();
      for (const root of this.#o.shadows.roots()) yield* root.getAnimations();
    }
    if (page && this.#page) yield* this.#page.document.getAnimations();
  }
}
