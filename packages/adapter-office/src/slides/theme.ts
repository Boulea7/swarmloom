import { kid, kids, path } from "../shared/xml";

/** Major/minor typefaces of a theme font scheme. */
export interface ThemeFonts {
  latin?: string;
  ea?: string;
  cs?: string;
}

/** The parts of a DrawingML theme the slide renderer uses. */
export interface Theme {
  /** Scheme colour name (dk1, lt1, accent1, hlink, ...) -> colour element holding the value. */
  colors: Map<string, Element>;
  major: ThemeFonts;
  minor: ThemeFonts;
  /** fmtScheme lists; referenced by 1-based `idx` from shape styles. */
  fillStyles: Element[];
  lineStyles: Element[];
  effectStyles: Element[];
  /** Background fills, referenced by `idx` 1001+. */
  bgFillStyles: Element[];
}

export const EMPTY_THEME: Theme = {
  colors: new Map(),
  major: {},
  minor: {},
  fillStyles: [],
  lineStyles: [],
  effectStyles: [],
  bgFillStyles: [],
};

function fonts(el: Element | undefined): ThemeFonts {
  return {
    latin: kid(el, "latin")?.getAttribute("typeface") || undefined,
    ea: kid(el, "ea")?.getAttribute("typeface") || undefined,
    cs: kid(el, "cs")?.getAttribute("typeface") || undefined,
  };
}

/** Parses `a:theme`. Missing sections yield empty values. */
export function parseTheme(root: Element | undefined): Theme {
  if (!root) return EMPTY_THEME;
  const elements = kid(root, "themeElements");
  const colors = new Map<string, Element>();
  for (const entry of kids(kid(elements, "clrScheme"))) {
    const value = entry.firstElementChild;
    if (value) colors.set(entry.localName, value);
  }
  const fontScheme = kid(elements, "fontScheme");
  const fmt = kid(elements, "fmtScheme");
  return {
    colors,
    major: fonts(kid(fontScheme, "majorFont")),
    minor: fonts(kid(fontScheme, "minorFont")),
    fillStyles: kids(kid(fmt, "fillStyleLst")),
    lineStyles: kids(kid(fmt, "lnStyleLst")),
    effectStyles: kids(kid(fmt, "effectStyleLst")).map((s) => kid(s, "effectLst") ?? s),
    bgFillStyles: kids(path(fmt, "bgFillStyleLst")),
  };
}

/** Resolves `+mj-lt`, `+mn-ea`, ... theme font references; other names pass through. */
export function themeTypeface(theme: Theme, typeface: string | undefined): string | undefined {
  if (!typeface?.startsWith("+")) return typeface || undefined;
  const set = typeface.startsWith("+mj") ? theme.major : theme.minor;
  if (typeface.endsWith("-ea")) return set.ea || set.latin;
  if (typeface.endsWith("-cs")) return set.cs || set.latin;
  return set.latin;
}
