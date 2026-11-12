import { holdAllCssImages, stillImageSource } from "@swarmloom/core";
import { AnimationSeeker } from "./seek";

const SVG_NS = "http://www.w3.org/2000/svg";
const SMIL = new Set(["animate", "animateTransform", "animateMotion", "animateColor", "set"]);
/** Height difference (CSS px) up to which the live page still counts as the page that was woven. */
const SIZE_SLACK = 2;

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
 * stopping it right away cancels that start.
 */
function restMarquees(doc: Document): void {
  for (const marquee of Array.from(doc.getElementsByTagName("marquee"))) {
    // Marquees nested in one already replaced left the document with it.
    if (!marquee.isConnected) continue;
    const still = marquee.cloneNode(true) as HTMLMarqueeElement;
    marquee.replaceWith(still);
    for (const copy of [still, ...Array.from(still.getElementsByTagName("marquee"))]) copy.stop();
  }
}

/**
 * Shows every animated `<img>` of the live page as a still copy, as the stage shows its image layers
 * (core's stillImageSource: a GIF, APNG, WebP or AVIF animation at its first frame, an SVG without
 * its animation). An `<img>` plays them on the browser's clock, which no seek reaches. The copy has
 * the same pixel size, so nothing reflows (the adapter dropped `srcset`). Animated CSS images of its
 * elements (backgrounds, masks, border images, list markers) are overridden inline with still copies
 * the same way (core's holdAllCssImages); pseudo-elements keep theirs. Images the render page cannot
 * read (cross-origin files) keep their own clock.
 */
async function stillImages(page: LivePage, doc: Document): Promise<void> {
  await Promise.all([
    ...Array.from(page.document.images, async (img) => {
      const src = img.currentSrc || img.src;
      if (!src) return;
      const still = await stillImageSource(src, doc);
      if (still === src) return;
      img.src = still;
      await img.decode().catch(() => undefined);
    }),
    holdAllCssImages(page.document.querySelectorAll<HTMLElement>("*"), doc, true),
  ]);
}

/**
 * Shows the live page over the stage, scrolled so it covers exactly the part of the world the stage
 * shows (the frame keeps its size, so nothing reflows). Returns why it could not, or null.
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
 * live page an adapter kept (the real HTML page, its animations frozen at the captured pose) over
 * the stage, and from then on every frame pauses all Web Animations (document, stage subtrees, live
 * page) and the live page's SVG documents and seeks them to the transport time, so frames never
 * depend on wall time. The live page's `<marquee>` elements, which no seek reaches, stay still at
 * their captured resting pose, and its animated images show still copies ({@link LiveStage.holdImages}).
 * Plugin players (SMIL replay, Lottie) follow player time on their own.
 */
export class LiveStage {
  readonly #seeker = new AnimationSeeker();
  readonly #o: LiveStageOptions;
  #page: LivePage | null;
  #svgs: SVGSVGElement[] = [];
  #live = false;

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
        restMarquees(page.document);
        this.#svgs = animatedSvgs(page.document);
      }
    }
    this.sync(t);
  }

  /** Seeks every animation to transport time `t` (ms); does nothing before go live. */
  sync(t: number): void {
    if (!this.#live) return;
    this.#seeker.seekAnimations(this.#animations(), t);
    this.#seeker.seekSvgs(this.#svgs, t);
  }

  dispose(): void {
    this.#o.shadows.stop();
  }

  /** The stage world: the first watched root's host that sits in another watched root. */
  #world(): HTMLElement | null {
    const roots = this.#o.shadows.roots();
    const inner = roots.find((root) => roots.includes(root.host.getRootNode() as ShadowRoot));
    return (inner?.host as HTMLElement | undefined) ?? null;
  }

  *#animations(): Iterable<Animation> {
    yield* this.#o.document.getAnimations();
    for (const root of this.#o.shadows.roots()) yield* root.getAnimations();
    if (this.#page) yield* this.#page.document.getAnimations();
  }
}
