/**
 * .pptx bytes -> {@link Presentation}: slide order, backgrounds, master/layout decorations and
 * slide shapes, limited to `maxSlides`.
 */

import type { AssetStore } from "../shared/assets";
import { OfficeFormatError, throwIfAborted, yieldToEventLoop } from "../shared/errors";
import type { FontLog } from "../shared/fonts";
import { type Relationships, readRels } from "../shared/opc";
import { attr, boolAttr, kid, parseXml, path } from "../shared/xml";
import type { ZipArchive } from "../shared/zip";
import { type DrawContext, fillElement, fillFromRef, parseColorMap, resolveFill } from "./drawing";
import type { Fill, Presentation, SlideModel, SlideNode } from "./model";
import { type LayoutPart, PptxPackage } from "./package";
import { parseShapeTree, type ShapeScope } from "./shapes";

export interface ReadOptions {
  maxSlides: number;
  signal?: AbortSignal;
  /** Collects the typefaces of visible text. */
  fonts?: FontLog;
}

const WHITE: Fill = { kind: "solid", color: { r: 255, g: 255, b: 255, a: 1 } };

function imageResolver(pkg: PptxPackage, rels: Relationships, assets: AssetStore): DrawContext["image"] {
  return (rId) => {
    const rel = rels.get(rId);
    return rel && !rel.external ? (assets.image(pkg.zip, rel.target) ?? undefined) : undefined;
  };
}

function background(root: Element, ctx: DrawContext): Fill | undefined {
  const bg = path(root, "cSld", "bg");
  if (!bg) return undefined;
  const bgPr = kid(bg, "bgPr");
  if (bgPr) return resolveFill(fillElement(bgPr), ctx);
  return fillFromRef(kid(bg, "bgRef"), ctx);
}

function readSlide(
  pkg: PptxPackage,
  root: Element,
  part: string,
  number: number,
  assets: AssetStore,
  fonts: FontLog | undefined,
): SlideModel {
  const rels = readRels(pkg.zip, part);
  const layout = pkg.layoutFor(rels);
  if (!layout) throw new OfficeFormatError(`Slide ${number} has no layout`);
  const master = layout.master;
  const colorMap = parseColorMap(path(root, "clrMapOvr", "overrideClrMapping")) ?? layout.colorMap ?? master.colorMap;
  const ctxFor = (partRels: Relationships): DrawContext => ({
    theme: master.theme,
    colorMap,
    image: imageResolver(pkg, partRels, assets),
    fonts,
  });

  const fill =
    background(root, ctxFor(rels)) ??
    background(layout.root, ctxFor(layout.rels)) ??
    background(master.root, ctxFor(master.rels)) ??
    WHITE;

  const showMaster = attr(root, "showMasterSp") !== "0";
  const nodes: SlideNode[] = [];
  const scope = (partRels: Relationships, inherit: LayoutPart["placeholders"][], skip: boolean): ShapeScope => ({
    pkg,
    rels: partRels,
    master,
    inherit,
    skipPlaceholders: skip,
    draw: ctxFor(partRels),
    assets,
    slideNumber: number,
  });
  if (showMaster && layout.showMasterShapes) {
    nodes.push(...parseShapeTree(path(master.root, "cSld", "spTree"), scope(master.rels, [], true)));
  }
  if (showMaster) {
    nodes.push(...parseShapeTree(path(layout.root, "cSld", "spTree"), scope(layout.rels, [master.placeholders], true)));
  }
  nodes.push(
    ...parseShapeTree(path(root, "cSld", "spTree"), scope(rels, [layout.placeholders, master.placeholders], false)),
  );
  return { number, background: fill, nodes };
}

/**
 * Reads a presentation from an opened package. A slide that fails to parse becomes a
 * placeholder slide carrying the error, so one broken slide does not lose the deck.
 *
 * @throws OfficeFormatError when the package is not a presentation.
 */
export async function readPresentation(zip: ZipArchive, assets: AssetStore, opts: ReadOptions): Promise<Presentation> {
  const pkg = PptxPackage.open(zip);
  if (pkg.slideParts.length === 0) throw new OfficeFormatError("The presentation has no slides");
  const limit = Math.max(1, opts.maxSlides);
  const slides: SlideModel[] = [];
  let index = 0;
  for (; index < pkg.slideParts.length && slides.length < limit; index++) {
    throwIfAborted(opts.signal);
    const part = pkg.slideParts[index] as string;
    const number = slides.length + 1;
    try {
      const root = parseXml(zip.readText(part), part);
      if (boolAttr(root, "show", true)) slides.push(readSlide(pkg, root, part, number, assets, opts.fonts));
    } catch (error) {
      if (!(error instanceof OfficeFormatError)) throw error;
      slides.push({ number, background: WHITE, nodes: [], error: error.message });
    }
    if (index % 4 === 3) await yieldToEventLoop();
  }
  if (slides.length === 0) throw new OfficeFormatError("Every slide in the presentation is hidden");
  return {
    width: pkg.width,
    height: pkg.height,
    slides,
    droppedSlides: pkg.slideParts.length - index,
    title: pkg.title,
  };
}
