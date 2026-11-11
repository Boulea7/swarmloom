import {
  type AssetUrls,
  type ContentBudget,
  cleanFamily,
  DocumentError,
  descendants,
  type FontReport,
  parseXml,
  resolvePath,
  type ZipArchive,
} from "@swarmloom/adapter-odf/kit";
import DOMPurify, { type Config, type WindowLike } from "dompurify";
import { type Book, documentViewport } from "./book";
import { cleanDeclarations, type FontFaceSpec, scopeStylesheet } from "./css";

const FORMAT = "epub";
/** Largest content document read. */
const MAX_CHAPTER_CHARS = 4 * 1024 * 1024;
/** Largest image or font loaded from the archive. */
const MAX_ASSET_BYTES = 16 * 1024 * 1024;
const MAX_IMAGES = 120;
const MAX_FONTS = 16;

const FONT_MIME: Record<string, string> = { otf: "font/otf", ttf: "font/ttf", woff: "font/woff", woff2: "font/woff2" };

/** Elements whose children are walked one by one when trimming to the budget. */
const CONTAINERS = new Set(["div", "section", "article", "main", "aside", "header", "footer", "nav", "body"]);

const PURIFY_CONFIG: Config = {
  USE_PROFILES: { html: true, svg: true, mathMl: true },
  FORBID_TAGS: [
    "style",
    "link",
    "form",
    "input",
    "button",
    "select",
    "textarea",
    "video",
    "audio",
    "source",
    "track",
    "iframe",
    "object",
    "embed",
  ],
  FORBID_ATTR: ["srcset", "action", "formaction", "target", "ping"],
  ALLOW_DATA_ATTR: false,
};

/** SVG presentation attributes that take a url(): paint servers, filters, clips, masks, markers, cursors. */
const URL_PRESENTATION_ATTRS = [
  "fill",
  "stroke",
  "filter",
  "clip-path",
  "mask",
  "marker-start",
  "marker-mid",
  "marker-end",
  "cursor",
] as const;

/** Counters reported as quality notes. */
export interface BookStats {
  missingImages: number;
  scripts: number;
  obfuscatedFonts: number;
}

/** A rendered content document. */
export interface Chapter {
  /** Sanitised inner HTML of the body. */
  html: string;
  /** Classes for the `.epub-html` wrapper (style sheet scopes, the document's own html classes). */
  htmlClass: string;
  bodyClass: string;
  /** Fixed-layout viewport of the document, when declared. */
  viewport?: { w: number; h: number };
  /** No visible text and a single image: a cover or full-page picture. */
  pictureOnly?: string;
}

/**
 * Shared state while the chapters of one book render: the archive, blob URLs, scoped style
 * sheets (each sheet once, under its own class) and font faces to register.
 */
export class BookRenderer {
  private readonly purify: ReturnType<typeof DOMPurify>;
  private readonly sheets = new Map<string, string>();
  private readonly cssParts: string[] = [];
  private readonly fontSpecs = new Map<string, FontFaceSpec>();
  private images = 0;
  readonly stats: BookStats = { missingImages: 0, scripts: 0, obfuscatedFonts: 0 };
  /** Inert document: parsed content never loads anything. */
  private readonly inert: Document;

  constructor(
    private readonly zip: ZipArchive,
    private readonly book: Book,
    private readonly assets: AssetUrls,
    private readonly win: Window,
    private readonly fontReport: FontReport,
  ) {
    this.purify = DOMPurify(win as unknown as WindowLike);
    this.inert = win.document.implementation.createHTMLDocument("");
  }

  /** Scoped CSS of every style sheet used so far. */
  css(): string {
    return this.cssParts.join("");
  }

  /** Font faces declared by the book's style sheets (deduplicated, capped). */
  fonts(): FontFaceSpec[] {
    return [...this.fontSpecs.values()].slice(0, MAX_FONTS);
  }

  /** Blob URL of an image in the archive, or null (counted as missing). */
  image(path: string | null): string | null {
    if (!path || !this.zip.has(path) || (this.zip.size(path) ?? 0) > MAX_ASSET_BYTES || this.images >= MAX_IMAGES) {
      this.stats.missingImages++;
      return null;
    }
    const url = this.assets.image(this.zip.read(path), path);
    if (url) this.images++;
    else this.stats.missingImages++;
    return url;
  }

  /** Bytes of a font file, with its MIME type, or null. */
  fontBytes(path: string): { bytes: Uint8Array; type: string } | null {
    const ext = /\.([a-z0-9]+)$/i.exec(path)?.[1]?.toLowerCase() ?? "";
    const type = FONT_MIME[ext];
    if (!type || !this.zip.has(path) || (this.zip.size(path) ?? 0) > MAX_ASSET_BYTES) return null;
    return { bytes: this.zip.read(path), type };
  }

  private resolveCssUrl = (href: string, base: string): string | null => {
    // Same-document references (SVG gradients, clip paths) never fetch anything.
    if (/^#[\w.:-]+$/.test(href)) return href;
    if (href.startsWith("data:image/") && href.length < 256 * 1024) return href;
    const path = resolvePath(base, href);
    return path && /\.(?:png|jpe?g|gif|webp|svg|bmp)$/i.test(path) ? this.image(path) : null;
  };

  private resolveFont = (href: string, base: string): string | null => {
    const path = resolvePath(base, href);
    if (!path || !this.zip.has(path)) return null;
    if (this.book.obfuscatedFonts.has(path)) {
      this.stats.obfuscatedFonts++;
      return null;
    }
    return path;
  };

  /** F01 stack for a book font-family value; fonts the book embeds keep their own face first. */
  private family = (value: string): string => {
    const parts = value.split(",").map((p) => cleanFamily(p.trim().replace(/^["']|["']$/g, "")));
    const generic = parts.find((p) => p === "serif" || p === "sans-serif" || p === "monospace") as
      | "serif"
      | "sans-serif"
      | "monospace"
      | undefined;
    const names = parts.filter(
      (p) => p !== "" && !/^(?:serif|sans-serif|monospace|cursive|fantasy|system-ui|inherit|initial|unset)$/i.test(p),
    );
    if (names.length === 0) return value.replace(/[;{}<>]/g, "");
    const embedded = names.filter((n) =>
      [...this.fontSpecs.values()].some((f) => f.family.toLowerCase() === n.toLowerCase()),
    );
    const stack = this.fontReport.useAll(
      names.filter((n) => !embedded.includes(n)),
      generic,
    );
    return embedded.length > 0 ? [...embedded.map((n) => `"${n}"`), stack].join(", ") : stack;
  };

  private addSheet(text: string, base: string, key: string): string {
    const known = this.sheets.get(key);
    if (known !== undefined) return known;
    const scope = `epub-s${this.sheets.size + 1}`;
    const sheet = scopeStylesheet(text, `.${scope}`, base, this.win, this.resolveCssUrl, this.resolveFont, this.family);
    for (const f of sheet.fonts) this.fontSpecs.set(`${f.family}|${f.weight ?? ""}|${f.style ?? ""}`, f);
    const cls = sheet.css ? scope : "";
    if (sheet.css) this.cssParts.push(sheet.css);
    this.sheets.set(key, cls);
    return cls;
  }

  private parse(path: string): Document {
    const text = this.zip.text(path);
    if (text.length > MAX_CHAPTER_CHARS) throw new DocumentError(FORMAT, "too-large", `${path} is too large`);
    try {
      return parseXml(text, {
        format: FORMAT,
        part: path,
        window: this.win,
        type: "application/xhtml+xml",
        stripDoctype: true,
      });
    } catch (error) {
      if (!(error instanceof DocumentError) || error.code !== "malformed") throw error;
      // Many books are tag soup with HTML entities; the HTML parser reads them like a browser would.
      const Parser = (this.win as unknown as { DOMParser: typeof DOMParser }).DOMParser;
      return new Parser().parseFromString(text, "text/html");
    }
  }

  /** Collects the style sheet scopes a document uses. */
  private styles(doc: Document, path: string): string[] {
    const classes: string[] = [];
    let inline = 0;
    for (const el of [
      ...descendants(doc.documentElement, null, "link"),
      ...descendants(doc.documentElement, null, "style"),
    ]) {
      if (el.localName === "link") {
        if (
          !/\bstylesheet\b/i.test(el.getAttribute("rel") ?? "") ||
          /\balternate\b/i.test(el.getAttribute("rel") ?? "")
        )
          continue;
        const sheetPath = resolvePath(path, el.getAttribute("href") ?? "");
        if (!sheetPath || !this.zip.has(sheetPath)) continue;
        classes.push(this.addSheet(this.zip.text(sheetPath), sheetPath, sheetPath));
      } else {
        classes.push(this.addSheet(el.textContent ?? "", path, `${path}#style${inline++}`));
      }
    }
    return classes.filter((c) => c);
  }

  /**
   * Rewrites resources of sanitised content: archive images to blob URLs, links and external
   * references removed. Besides `src` and `href` this covers inline styles, the HTML `background`
   * attribute and SVG presentation attributes, which DOMPurify keeps with any URL in them.
   */
  private rewrite(root: Element, path: string): void {
    for (const el of Array.from(root.querySelectorAll("*"))) {
      const style = el.getAttribute("style");
      if (style) el.setAttribute("style", cleanDeclarations(style, path, this.resolveCssUrl, this.family));
      for (const name of URL_PRESENTATION_ATTRS) {
        const value = el.getAttribute(name);
        if (value) el.setAttribute(name, cleanDeclarations(value, path, this.resolveCssUrl));
      }
      const background = el.getAttribute("background");
      if (background !== null) {
        const url = this.image(resolvePath(path, background));
        if (url) el.setAttribute("background", url);
        else el.removeAttribute("background");
      }
      const tag = el.localName;
      if (tag === "img") {
        const url = this.image(resolvePath(path, el.getAttribute("src") ?? ""));
        if (url) el.setAttribute("src", url);
        else el.remove();
      } else if (tag === "image") {
        const href =
          el.getAttribute("href") ??
          el.getAttributeNS("http://www.w3.org/1999/xlink", "href") ??
          el.getAttribute("xlink:href");
        const url = this.image(resolvePath(path, href ?? ""));
        el.removeAttributeNS("http://www.w3.org/1999/xlink", "href");
        el.removeAttribute("xlink:href");
        if (url) el.setAttribute("href", url);
        else el.remove();
      } else if (tag === "a") {
        el.removeAttribute("href");
        el.classList.add("epub-link");
      } else if (tag === "use") {
        const href = el.getAttribute("href") ?? el.getAttribute("xlink:href") ?? "";
        if (!href.startsWith("#")) el.remove();
      }
    }
  }

  /** Removes content past the budget, block by block (a block is never cut in the middle). */
  private trim(container: Element, budget: ContentBudget): void {
    for (const node of Array.from(container.childNodes)) {
      if (node.nodeType === 3) {
        const n = (node.nodeValue ?? "").trim().length;
        if (n === 0) continue;
        if (!budget.take(n)) node.remove();
        continue;
      }
      if (node.nodeType !== 1) {
        node.remove();
        continue;
      }
      const el = node as Element;
      if (budget.exhausted) {
        budget.take();
        el.remove();
      } else if (CONTAINERS.has(el.localName) && el.children.length > 0) {
        this.trim(el, budget);
        if (!el.textContent?.trim() && !el.querySelector("img,svg,hr,table")) el.remove();
      } else {
        budget.take((el.textContent ?? "").replace(/\s+/g, " ").trim().length);
      }
    }
  }

  /**
   * Renders one content document: parse, collect style sheets, sanitise with DOMPurify, rewrite
   * resources, trim to the budget.
   */
  chapter(path: string, budget: ContentBudget): Chapter {
    const doc = this.parse(path);
    const root = doc.documentElement;
    this.stats.scripts += descendants(root, null, "script").length;
    const sheetClasses = this.styles(doc, path);
    const body = descendants(root, null, "body")[0] ?? root;
    const holder = this.inert.createElement("div");
    for (const child of Array.from(body.childNodes)) holder.appendChild(this.inert.importNode(child, true));
    const clean = this.purify.sanitize(holder, { ...PURIFY_CONFIG, RETURN_DOM_FRAGMENT: true });
    const content = this.inert.createElement("div");
    content.append(clean);
    this.rewrite(content, path);
    const text = (content.textContent ?? "").trim();
    const images = content.querySelectorAll("img,image");
    let pictureOnly: string | undefined;
    if (text === "" && images.length === 1) {
      const only = images[0] as Element;
      pictureOnly = only.getAttribute("src") ?? only.getAttribute("href") ?? undefined;
    }
    this.trim(content, budget);
    const cleanClass = (v: string | null) => (v ?? "").replace(/[^\w\s-]/g, "").trim();
    const chapter: Chapter = {
      html: content.innerHTML,
      htmlClass: [...sheetClasses, cleanClass(root.getAttribute("class"))].filter((c) => c).join(" "),
      bodyClass: cleanClass(body === root ? "" : body.getAttribute("class")),
    };
    const viewport = documentViewport(doc);
    if (viewport) chapter.viewport = viewport;
    if (pictureOnly) chapter.pictureOnly = pictureOnly;
    return chapter;
  }
}
