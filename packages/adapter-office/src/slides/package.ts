/**
 * PresentationML package navigation: presentation part, slide order, layouts, masters and
 * themes (each parsed once and cached).
 */

import { OfficeFormatError } from "../shared/errors";
import { type Relationships, readRels, relOfType } from "../shared/opc";
import { attr, intAttr, kid, kids, nsAttr, path, readXml } from "../shared/xml";
import type { ZipArchive } from "../shared/zip";
import { type ColorMap, DEFAULT_COLOR_MAP, parseColorMap } from "./drawing";
import { parseTheme, type Theme } from "./theme";

/** Placeholder identity of a shape (`p:ph`). `type` defaults to "obj" as in the schema. */
export interface PlaceholderRef {
  type: string;
  idx?: string;
}

/** Placeholder shapes of a layout or master, for inheritance lookups. */
export interface PlaceholderIndex {
  byIdx: Map<string, Element>;
  byType: Map<string, Element>;
}

interface PartBase {
  part: string;
  root: Element;
  rels: Relationships;
}

export interface MasterPart extends PartBase {
  theme: Theme;
  colorMap: ColorMap;
  titleStyle?: Element;
  bodyStyle?: Element;
  otherStyle?: Element;
  placeholders: PlaceholderIndex;
}

export interface LayoutPart extends PartBase {
  master: MasterPart;
  placeholders: PlaceholderIndex;
  colorMap?: ColorMap;
  /** False when the layout hides the master's decorative shapes. */
  showMasterShapes: boolean;
}

const TITLE_TYPES = new Set(["title", "ctrTitle"]);
const OWN_TYPES = new Set(["dt", "ftr", "sldNum", "hdr"]);

/** Reads `p:ph` from a non-visual properties element. */
export function placeholderOf(nvPr: Element | undefined): PlaceholderRef | undefined {
  const ph = kid(nvPr, "ph");
  if (!ph) return undefined;
  return { type: attr(ph, "type") ?? "obj", idx: attr(ph, "idx") };
}

/** Placeholder family used for master text styles and master lookups. */
export function placeholderFamily(type: string): "title" | "body" | "other" {
  if (TITLE_TYPES.has(type)) return "title";
  if (OWN_TYPES.has(type)) return "other";
  return "body";
}

/** Finds the placeholder a shape inherits from: same idx first, then same type, then same family. */
export function findPlaceholder(index: PlaceholderIndex, ph: PlaceholderRef): Element | undefined {
  if (ph.idx !== undefined && ph.idx !== "0") {
    const byIdx = index.byIdx.get(ph.idx);
    if (byIdx) return byIdx;
  }
  const exact = index.byType.get(ph.type);
  if (exact) return exact;
  if (TITLE_TYPES.has(ph.type)) return index.byType.get("title") ?? index.byType.get("ctrTitle");
  if (OWN_TYPES.has(ph.type)) return undefined;
  return index.byType.get("body") ?? index.byType.get("obj");
}

function indexPlaceholders(root: Element): PlaceholderIndex {
  const index: PlaceholderIndex = { byIdx: new Map(), byType: new Map() };
  for (const shape of kids(path(root, "cSld", "spTree"))) {
    const nv = kids(shape).find((c) => c.localName.startsWith("nv"));
    const ph = placeholderOf(kid(nv, "nvPr"));
    if (!ph) continue;
    if (ph.idx !== undefined && !index.byIdx.has(ph.idx)) index.byIdx.set(ph.idx, shape);
    if (!index.byType.has(ph.type)) index.byType.set(ph.type, shape);
  }
  return index;
}

/** Shape tree and text-style access for one .pptx file. */
export class PptxPackage {
  private readonly masters = new Map<string, MasterPart>();
  private readonly layouts = new Map<string, LayoutPart>();
  private readonly themes = new Map<string, Theme>();
  private tableStylesRoot: Element | null | undefined;

  private constructor(
    readonly zip: ZipArchive,
    readonly presentationPart: string,
    /** Slide size in EMU. */
    readonly width: number,
    readonly height: number,
    /** Slide part names in presentation order (hidden slides excluded later by the reader). */
    readonly slideParts: string[],
    readonly defaultTextStyle: Element | undefined,
    readonly title: string | undefined,
  ) {}

  /** @throws OfficeFormatError when the package is not a presentation. */
  static open(zip: ZipArchive): PptxPackage {
    const rootRels = readRels(zip, "");
    const main = relOfType(rootRels, "officeDocument");
    const presentationPart = main?.target ?? "ppt/presentation.xml";
    const root = readXml(zip, presentationPart);
    if (root?.localName !== "presentation") {
      throw new OfficeFormatError("This file is not a PowerPoint presentation");
    }
    const rels = readRels(zip, presentationPart);
    const size = kid(root, "sldSz");
    const width = intAttr(size, "cx", 12192000);
    const height = intAttr(size, "cy", 6858000);
    if (width <= 0 || height <= 0 || width > 51206400 || height > 51206400) {
      throw new OfficeFormatError("The presentation has an invalid slide size");
    }
    const slideParts: string[] = [];
    for (const id of kids(kid(root, "sldIdLst"), "sldId")) {
      const rel = rels.get(nsAttr(id, "id") ?? "");
      if (rel && !rel.external && zip.has(rel.target)) slideParts.push(rel.target);
    }
    const core = relOfType(rootRels, "core-properties");
    const coreRoot = core ? readXml(zip, core.target) : undefined;
    const title = kids(coreRoot, "title")[0]?.textContent?.trim() || undefined;
    return new PptxPackage(zip, presentationPart, width, height, slideParts, kid(root, "defaultTextStyle"), title);
  }

  /** The layout a slide uses (via its relationships), with its master. */
  layoutFor(rels: Relationships): LayoutPart | undefined {
    const rel = relOfType(rels, "slideLayout");
    return rel ? this.layout(rel.target) : undefined;
  }

  private layout(part: string): LayoutPart | undefined {
    const cached = this.layouts.get(part);
    if (cached) return cached;
    const root = readXml(this.zip, part);
    if (!root) return undefined;
    const rels = readRels(this.zip, part);
    const masterRel = relOfType(rels, "slideMaster");
    const master = masterRel ? this.master(masterRel.target) : undefined;
    if (!master) return undefined;
    const layout: LayoutPart = {
      part,
      root,
      rels,
      master,
      placeholders: indexPlaceholders(root),
      colorMap: parseColorMap(path(root, "clrMapOvr", "overrideClrMapping")),
      showMasterShapes: attr(root, "showMasterSp") !== "0",
    };
    this.layouts.set(part, layout);
    return layout;
  }

  private master(part: string): MasterPart | undefined {
    const cached = this.masters.get(part);
    if (cached) return cached;
    const root = readXml(this.zip, part);
    if (!root) return undefined;
    const rels = readRels(this.zip, part);
    const themeRel = relOfType(rels, "theme");
    const txStyles = kid(root, "txStyles");
    const master: MasterPart = {
      part,
      root,
      rels,
      theme: this.theme(themeRel?.target),
      colorMap: parseColorMap(kid(root, "clrMap")) ?? DEFAULT_COLOR_MAP,
      titleStyle: kid(txStyles, "titleStyle"),
      bodyStyle: kid(txStyles, "bodyStyle"),
      otherStyle: kid(txStyles, "otherStyle"),
      placeholders: indexPlaceholders(root),
    };
    this.masters.set(part, master);
    return master;
  }

  private theme(part: string | undefined): Theme {
    const key = part ?? "";
    let theme = this.themes.get(key);
    if (!theme) {
      theme = parseTheme(part ? readXml(this.zip, part) : undefined);
      this.themes.set(key, theme);
    }
    return theme;
  }

  /** `a:tblStyle` with the given id from ppt/tableStyles.xml, if the file defines it. */
  tableStyle(styleId: string | undefined): Element | undefined {
    if (!styleId) return undefined;
    if (this.tableStylesRoot === undefined) {
      const rel = relOfType(readRels(this.zip, this.presentationPart), "tableStyles");
      this.tableStylesRoot = (rel ? readXml(this.zip, rel.target) : undefined) ?? null;
    }
    return kids(this.tableStylesRoot ?? undefined, "tblStyle").find((s) => attr(s, "styleId") === styleId);
  }
}
