import type { MathResult } from "../render";

/** A font face to register in the layout document and to declare in the blueprint CSS. */
export interface FontFaceSpec {
  family: string;
  weight: string;
  style: string;
  /** data: URL of the woff2 file. */
  src: string;
}

/** KaTeX bound to its bundled style sheet and fonts. */
export interface MathEngine {
  /** Renders one formula to HTML (never throws; errors are returned). */
  render(tex: string, display: boolean): MathResult;
  /** Style sheet for the formulas in `html`, embedding only the font families they use. */
  assets(html: string): Promise<MathAssets>;
}

/** CSS and fonts for a set of rendered formulas. */
export interface MathAssets {
  css: string;
  fonts: FontFaceSpec[];
  /** Set when the style sheet or a font could not be loaded; formulas still render. */
  warning?: string;
}

/** Formulas longer than this are reported as errors instead of rendered. */
const MAX_TEX = 8000;

/**
 * Marks KaTeX's root element (`.katex`, or `.katex-display` in display mode) so snapshot-dom keeps
 * its markup: KaTeX positions glyphs with nested tables, struts and relative offsets that only its
 * own style sheet (passed on as Blueprint.css) can reproduce on the stage.
 */
function markVerbatim(html: string): string {
  return html.replace(/^<span class="([^"]*)"/, '<span class="$1" data-swarmloom-verbatim=""');
}

interface FaceRule {
  family: string;
  weight: string;
  style: string;
  stem: string;
}

interface FamilyRule {
  classes: string[];
  family: string;
}

/** Splits KaTeX's style sheet into font faces, class-to-family rules and the remaining CSS. */
export function parseKatexCss(css: string): { faces: FaceRule[]; rules: FamilyRule[]; rest: string } {
  const faces: FaceRule[] = [];
  const rest = css.replace(/@font-face\s*\{([^}]*)\}/g, (_whole, body: string) => {
    const family = /font-family:\s*([^;]+)/.exec(body)?.[1]?.trim().replace(/["']/g, "");
    const stem = /url\(\s*["']?fonts\/([\w-]+)\.woff2/.exec(body)?.[1];
    if (family && stem) {
      faces.push({
        family,
        stem,
        weight: /font-weight:\s*(\w+)/.exec(body)?.[1] ?? "400",
        style: /font-style:\s*(\w+)/.exec(body)?.[1] ?? "normal",
      });
    }
    return "";
  });
  const rules: FamilyRule[] = [];
  for (const m of rest.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = m[1] ?? "";
    const family = /(?:^|;)\s*font(?:-family)?:[^;]*?\b(KaTeX_\w+)/.exec(m[2] ?? "")?.[1];
    if (!family || selectors.trimStart().startsWith("@")) continue;
    for (const selector of selectors.split(",")) {
      const classes = Array.from(selector.matchAll(/\.([\w-]+)/g), (c) => c[1] as string);
      if (classes.length) rules.push({ classes, family });
    }
  }
  return { faces, rules, rest };
}

/** Class names used anywhere in an HTML string. */
function usedClasses(html: string): Set<string> {
  const used = new Set<string>();
  for (const m of html.matchAll(/class="([^"]*)"/g)) for (const c of (m[1] ?? "").split(/\s+/)) if (c) used.add(c);
  return used;
}

/** Font families a rendered HTML string needs, given the parsed KaTeX rules. KaTeX_Main is always included. */
export function familiesFor(html: string, rules: readonly FamilyRule[]): Set<string> {
  const used = usedClasses(html);
  const families = new Set(["KaTeX_Main"]);
  for (const rule of rules) if (rule.classes.every((c) => used.has(c))) families.add(rule.family);
  return families;
}

let pending: Promise<MathEngine> | undefined;

/** Loads KaTeX and its assets once (separate lazy chunks). Rejects when a chunk cannot be fetched. */
export function loadMath(): Promise<MathEngine> {
  pending ??= Promise.all([import("katex"), import("./katex-assets")])
    .then(([katex, assets]) => createMathEngine(katex.default, assets.katexCss, assets.KATEX_FONTS))
    .catch((error: unknown) => {
      pending = undefined;
      throw error;
    });
  return pending;
}

type Katex = typeof import("katex").default;

/**
 * Binds KaTeX to its style sheet and font loaders (keyed by file stem). Exposed so tests and
 * hosts with their own asset pipeline can supply the CSS; `loadMath` uses the bundled assets.
 */
export function createMathEngine(
  katex: Katex,
  css: string,
  fonts: Readonly<Record<string, () => Promise<{ default: string }>>>,
): MathEngine {
  const parsed = parseKatexCss(css);
  const fontCache = new Map<string, Promise<string>>();
  const loadFont = (stem: string): Promise<string> => {
    let p = fontCache.get(stem);
    if (!p) {
      const loader = fonts[stem];
      p = loader ? loader().then((m) => m.default) : Promise.reject(new Error(`unknown KaTeX font ${stem}`));
      fontCache.set(stem, p);
    }
    return p;
  };

  return {
    render(tex, display) {
      if (tex.length > MAX_TEX) return { error: `formula longer than ${MAX_TEX} characters` };
      try {
        const html = katex.renderToString(tex, {
          displayMode: display,
          output: "html",
          throwOnError: true,
          trust: false,
          strict: "ignore",
          maxSize: 40,
          maxExpand: 500,
        });
        return { html: markVerbatim(html) };
      } catch (error) {
        return { error: error instanceof Error ? error.message : String(error) };
      }
    },
    async assets(html) {
      const families = familiesFor(html, parsed.rules);
      const faces = parsed.faces.filter((f) => families.has(f.family));
      const loaded = await Promise.all(
        faces.map(async (f) => {
          try {
            return { ...f, src: await loadFont(f.stem) };
          } catch {
            return undefined;
          }
        }),
      );
      const specs: FontFaceSpec[] = [];
      let faceCss = "";
      let missing = parsed.faces.length === 0 ? 1 : 0;
      for (const f of loaded) {
        if (!f) {
          missing++;
          continue;
        }
        specs.push({ family: f.family, weight: f.weight, style: f.style, src: f.src });
        faceCss += `@font-face{font-family:${f.family};font-style:${f.style};font-weight:${f.weight};font-display:block;src:url(${f.src}) format("woff2")}`;
      }
      const warning = missing > 0 ? "math: KaTeX fonts unavailable, formulas use fallback fonts" : undefined;
      return { css: faceCss + parsed.rest, fonts: specs, ...(warning ? { warning } : {}) };
    },
  };
}
