import { lengthPx, percent } from "./kit/css";
import { a, child, children, isOdf, qualifiedName } from "./ns";

/** Property groups of an ODF style (`style:<kind>-properties`). */
export type PropKind =
  | "paragraph"
  | "text"
  | "table"
  | "table-column"
  | "table-row"
  | "table-cell"
  | "graphic"
  | "drawing-page"
  | "page-layout"
  | "header-footer"
  | "list-level";

/** Attribute values by conventional qualified name ("fo:font-size"), per property group. */
export type Props = Partial<Record<PropKind, ReadonlyMap<string, string>>>;

/** A style with its inheritance chain applied. */
export interface ResolvedStyle {
  family: string;
  name: string;
  props: Props;
  /** `style:list-style-name` of paragraph styles. */
  listStyle?: string;
  /** `style:master-page-name` of paragraph styles (starts a new page). */
  masterPage?: string;
}

interface RawStyle {
  family: string;
  name: string;
  parent?: string;
  props: Props;
  listStyle?: string;
  masterPage?: string;
}

/** A list level: numbered or bulleted, with its indent. */
export interface ListLevel {
  kind: "number" | "bullet" | "none";
  /** `style:num-format`: 1, a, A, i, I. */
  format?: string;
  bullet?: string;
  start: number;
  /** Left indent of the item text in px. */
  indent?: number;
}

/** Page geometry of a master page. */
export interface PageLayout {
  width: number;
  height: number;
  margin: { top: number; right: number; bottom: number; left: number };
  background?: string;
}

/** A master page: its layout plus header/footer content and (ODP) drawing elements. */
export interface MasterPage {
  name: string;
  layout: PageLayout;
  header?: Element;
  footer?: Element;
  /** The `style:master-page` element (ODP masters hold shapes). */
  el: Element;
  /** `draw:style-name` of an ODP master (drawing-page background). */
  drawStyle?: string;
}

/** A font declared in `office:font-face-decls`. */
export interface FontFace {
  family: string;
  generic?: "serif" | "sans-serif" | "monospace";
}

const GENERIC: Record<string, FontFace["generic"]> = {
  roman: "serif",
  swiss: "sans-serif",
  modern: "monospace",
};

const A4: PageLayout = {
  width: lengthPx("21cm") as number,
  height: lengthPx("29.7cm") as number,
  margin: { top: 76, right: 76, bottom: 76, left: 76 },
};

function readProps(styleEl: Element): Props {
  const props: Props = {};
  for (let c = styleEl.firstElementChild; c; c = c.nextElementSibling) {
    const m = /^(.*)-properties$/.exec(c.localName);
    if (!m) continue;
    const map = new Map<string, string>();
    for (const at of Array.from(c.attributes)) map.set(qualifiedName(at), at.value);
    // List-level label alignment and similar nested property elements are flattened into the group.
    for (let g = c.firstElementChild; g; g = g.nextElementSibling) {
      for (const at of Array.from(g.attributes)) if (!map.has(qualifiedName(at))) map.set(qualifiedName(at), at.value);
    }
    props[m[1] as PropKind] = map;
  }
  return props;
}

function fontSizePx(value: string | undefined, base: number | undefined): string | undefined {
  if (value === undefined) return undefined;
  const pct = percent(value);
  if (pct !== undefined) return `${(base ?? 16) * pct}px`;
  const n = lengthPx(value, "pt");
  return n === undefined ? undefined : `${n}px`;
}

/** Merges `child` over `parent`; relative font sizes are resolved against the parent. */
function mergeProps(parent: Props, own: Props): Props {
  const out: Props = { ...parent };
  for (const [kind, map] of Object.entries(own) as [PropKind, ReadonlyMap<string, string>][]) {
    const merged = new Map(parent[kind] ?? []);
    for (const [k, v] of map) {
      if (k === "fo:font-size" || k === "style:font-size-asian") {
        const base = lengthPx(merged.get(k) ?? parent.text?.get(k));
        const size = fontSizePx(v, base);
        if (size) merged.set(k, size);
      } else merged.set(k, v);
    }
    out[kind] = merged;
  }
  return out;
}

/**
 * The styles of one ODF document: common styles, the two sets of automatic styles (content.xml
 * and styles.xml use separate namespaces of names), default styles, list styles, page layouts,
 * master pages and font faces.
 */
export class OdfStyles {
  private readonly common = new Map<string, RawStyle>();
  private readonly contentAuto = new Map<string, RawStyle>();
  private readonly stylesAuto = new Map<string, RawStyle>();
  private readonly defaults = new Map<string, Props>();
  private readonly lists = new Map<string, Element>();
  private readonly layouts = new Map<string, Element>();
  private readonly masters = new Map<string, MasterPage>();
  private readonly fonts = new Map<string, FontFace>();
  private readonly resolved = new Map<string, ResolvedStyle>();
  private firstMaster?: string;

  /**
   * @param contentRoot The `office:document-content` (or flat `office:document`) element.
   * @param stylesRoot The `office:document-styles` element of styles.xml, when separate.
   */
  constructor(contentRoot: Element, stylesRoot?: Element) {
    for (const root of stylesRoot ? [stylesRoot, contentRoot] : [contentRoot]) {
      const own = root === contentRoot ? this.contentAuto : this.stylesAuto;
      this.readFonts(child(root, "office", "font-face-decls"));
      this.readGroup(child(root, "office", "styles"), this.common);
      // In a flat document the automatic styles serve both content and master pages.
      this.readGroup(child(root, "office", "automatic-styles"), stylesRoot ? own : this.contentAuto);
      if (!stylesRoot) this.readGroup(child(root, "office", "automatic-styles"), this.stylesAuto);
    }
    for (const root of stylesRoot ? [stylesRoot, contentRoot] : [contentRoot]) {
      this.readMasters(child(root, "office", "master-styles"));
    }
  }

  private readFonts(decls: Element | undefined): void {
    if (!decls) return;
    for (const face of children(decls, "style", "font-face")) {
      const name = a(face, "style:name");
      const family = (a(face, "svg:font-family") ?? name ?? "").replace(/^['"]|['"]$/g, "");
      if (!name || !family) continue;
      const generic = GENERIC[a(face, "style:font-family-generic") ?? ""];
      this.fonts.set(name, generic ? { family, generic } : { family });
    }
  }

  private readGroup(group: Element | undefined, into: Map<string, RawStyle>): void {
    if (!group) return;
    for (let el = group.firstElementChild; el; el = el.nextElementSibling) {
      if (isOdf(el, "style", "style")) {
        const family = a(el, "style:family") ?? "";
        const name = a(el, "style:name");
        if (!name) continue;
        const raw: RawStyle = { family, name, props: readProps(el) };
        const parent = a(el, "style:parent-style-name");
        const list = a(el, "style:list-style-name");
        const master = a(el, "style:master-page-name");
        if (parent) raw.parent = parent;
        if (list) raw.listStyle = list;
        if (master) raw.masterPage = master;
        into.set(`${family}/${name}`, raw);
      } else if (isOdf(el, "style", "default-style")) {
        this.defaults.set(a(el, "style:family") ?? "", readProps(el));
      } else if (isOdf(el, "text", "list-style")) {
        const name = a(el, "style:name");
        if (name) this.lists.set(name, el);
      } else if (isOdf(el, "style", "page-layout")) {
        const name = a(el, "style:name");
        if (name) this.layouts.set(name, el);
      }
    }
  }

  private readMasters(group: Element | undefined): void {
    if (!group) return;
    for (const el of children(group, "style", "master-page")) {
      const name = a(el, "style:name");
      if (!name || this.masters.has(name)) continue;
      const master: MasterPage = { name, el, layout: this.pageLayout(a(el, "style:page-layout-name")) };
      const header = child(el, "style", "header");
      const footer = child(el, "style", "footer");
      const drawStyle = a(el, "draw:style-name");
      if (header && a(header, "style:display") !== "false") master.header = header;
      if (footer && a(footer, "style:display") !== "false") master.footer = footer;
      if (drawStyle) master.drawStyle = drawStyle;
      this.masters.set(name, master);
      this.firstMaster ??= name;
    }
  }

  private pageLayout(name: string | null): PageLayout {
    const el = name ? this.layouts.get(name) : undefined;
    const p = el ? readProps(el)["page-layout"] : undefined;
    if (!p) return A4;
    const len = (k: string, fallback: number) => lengthPx(p.get(k) ?? p.get("fo:margin")) ?? fallback;
    const width = lengthPx(p.get("fo:page-width")) ?? A4.width;
    const height = lengthPx(p.get("fo:page-height")) ?? A4.height;
    const layout: PageLayout = {
      width: Math.max(96, Math.min(width, 4000)),
      height: Math.max(96, Math.min(height, 6000)),
      margin: {
        top: len("fo:margin-top", 0),
        right: len("fo:margin-right", 0),
        bottom: len("fo:margin-bottom", 0),
        left: len("fo:margin-left", 0),
      },
    };
    const bg = p.get("fo:background-color");
    if (bg && bg !== "transparent") layout.background = bg;
    return layout;
  }

  /** Font face by `style:name`. */
  font(name: string | undefined | null): FontFace | undefined {
    return name ? this.fonts.get(name) : undefined;
  }

  /** The master page by name, else the first one, else an A4 page without margins. */
  master(name?: string | null): MasterPage | undefined {
    return (
      (name ? this.masters.get(name) : undefined) ?? (this.firstMaster ? this.masters.get(this.firstMaster) : undefined)
    );
  }

  /** Default page layout (of the first master page). */
  defaultLayout(): PageLayout {
    return this.master()?.layout ?? A4;
  }

  /** Default properties of a family (`style:default-style`). */
  defaultProps(family: string): Props {
    return this.defaults.get(family) ?? {};
  }

  /**
   * Resolves a style with its parents and the family default.
   *
   * @param scope "content" for references from content.xml, "styles" for master pages in styles.xml.
   */
  resolve(
    family: string,
    name: string | null | undefined,
    scope: "content" | "styles" = "content",
  ): ResolvedStyle | undefined {
    if (!name) return undefined;
    const key = `${scope}:${family}/${name}`;
    const hit = this.resolved.get(key);
    if (hit) return hit;
    const auto = scope === "content" ? this.contentAuto : this.stylesAuto;
    const chain: RawStyle[] = [];
    let raw = auto.get(`${family}/${name}`) ?? this.common.get(`${family}/${name}`);
    // Parents of automatic styles are common styles; cycles and absurd depths are cut.
    for (let depth = 0; raw && depth < 32 && !chain.includes(raw); depth++) {
      chain.unshift(raw);
      raw = raw.parent ? this.common.get(`${family}/${raw.parent}`) : undefined;
    }
    if (chain.length === 0) return undefined;
    let props = this.defaultProps(family);
    let listStyle: string | undefined;
    for (const s of chain) {
      props = mergeProps(props, s.props);
      listStyle = s.listStyle ?? listStyle;
    }
    // Only the style itself (not its parents) starts a new page.
    const masterPage = chain[chain.length - 1]?.masterPage;
    const style: ResolvedStyle = { family, name, props };
    if (listStyle) style.listStyle = listStyle;
    if (masterPage) style.masterPage = masterPage;
    this.resolved.set(key, style);
    return style;
  }

  /** A level (1-based) of a list style; levels past the defined ones reuse the last. */
  listLevel(listStyle: string | undefined, level: number): ListLevel {
    const el = listStyle ? this.lists.get(listStyle) : undefined;
    const levels = el ? Array.from(el.children).filter((c) => /^list-level-style-/.test(c.localName)) : [];
    const match =
      levels.find((l) => Number(a(l, "text:level")) === level) ?? levels[Math.min(level, levels.length) - 1];
    if (!match) return { kind: "bullet", bullet: "\u2022", start: 1 };
    const props = readProps(match)["list-level"];
    const indent = lengthPx(props?.get("fo:margin-left")) ?? lengthPx(props?.get("text:space-before"));
    const base = indent === undefined ? {} : { indent };
    if (match.localName === "list-level-style-number") {
      const format = a(match, "style:num-format") ?? "1";
      return {
        kind: format === "" ? "none" : "number",
        format,
        start: Number(a(match, "text:start-value") ?? 1) || 1,
        ...base,
      };
    }
    if (match.localName === "list-level-style-bullet") {
      return { kind: "bullet", bullet: a(match, "text:bullet-char") ?? "\u2022", start: 1, ...base };
    }
    return { kind: "none", start: 1, ...base };
  }
}
