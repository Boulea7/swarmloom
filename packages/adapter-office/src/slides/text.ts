/**
 * DrawingML text bodies with PowerPoint's inheritance chain:
 * presentation defaults -> master text styles -> master/layout placeholder list styles ->
 * shape list style -> paragraph properties -> run properties.
 */

import type { Rgba } from "../shared/color";
import { fontStack, hasCjk } from "../shared/fonts";
import { attr, boolAttr, intAttr, kid, kids } from "../shared/xml";
import { colorIn, type DrawContext, fillElement, resolveFill, schemeColor } from "./drawing";
import type { Bullet, RunStyle, Spacing, TextBody, TextParagraph, TextRun } from "./model";
import { themeTypeface } from "./theme";

/** Where a text body inherits from. Arrays run from lowest to highest priority. */
export interface TextChain {
  /** List-style elements (`p:defaultTextStyle`, `p:titleStyle`, `a:lstStyle`, ...). */
  lists: (Element | undefined)[];
  /** `a:bodyPr` elements. */
  bodyPrs: (Element | undefined)[];
  /** Text colour and typeface from the shape style (`a:fontRef`), or a table style. */
  override?: { color?: Rgba; typeface?: string; bold?: boolean };
  placeholder?: string;
  slideNumber: number;
  /** Insets used when no bodyPr sets them (table cells use their margins), EMU. */
  insets?: { l: number; t: number; r: number; b: number };
}

type BulletDef = { kind: "none" } | { kind: "char"; char: string } | { kind: "auto"; scheme: string; startAt: number };

interface RunProps {
  sz?: number;
  b?: boolean;
  i?: boolean;
  u?: boolean;
  strike?: boolean;
  color?: Rgba;
  latin?: string;
  ea?: string;
  baseline?: number;
  cap?: "none" | "all" | "small";
  highlight?: Rgba;
}

interface ParaProps {
  align?: TextParagraph["align"];
  marL?: number;
  indent?: number;
  rtl?: boolean;
  lnSpc?: Spacing;
  spcBef?: Spacing;
  spcAft?: Spacing;
  bullet?: BulletDef;
  buFont?: string;
  buColor?: Rgba;
  buScale?: number;
  run: RunProps;
}

const ALIGN: Readonly<Record<string, TextParagraph["align"]>> = {
  l: "left",
  ctr: "center",
  r: "right",
  just: "justify",
  dist: "justify",
  justLow: "justify",
  thaiDist: "justify",
};

const DEFAULT_INSETS = { l: 91440, t: 45720, r: 91440, b: 45720 };

/** Symbol-font bullet characters mapped to Unicode look-alikes. */
const SYMBOL_BULLETS: Readonly<Record<string, string>> = {
  "§": "▪",
  Ø: "➢",
  ü: "✓",
  q: "❑",
  u: "◆",
  v: "❖",
  n: "■",
  l: "●",
  "·": "•",
};

function defined<T extends object>(target: T, source: Partial<T>): T {
  for (const [k, v] of Object.entries(source)) {
    if (v !== undefined) (target as Record<string, unknown>)[k] = v;
  }
  return target;
}

function spacing(el: Element | undefined): Spacing | undefined {
  if (!el) return undefined;
  const p = kid(el, "spcPct");
  if (p) return { pct: intAttr(p, "val", 100000) / 100000 };
  const pts = kid(el, "spcPts");
  if (pts) return { pts: intAttr(pts, "val", 0) / 100 };
  return undefined;
}

function readRun(el: Element | undefined, ctx: DrawContext): RunProps {
  if (!el) return {};
  const u = attr(el, "u");
  const strike = attr(el, "strike");
  const sz = intAttr(el, "sz");
  const baseline = intAttr(el, "baseline");
  const cap = attr(el, "cap");
  const fill = resolveFill(fillElement(el), ctx);
  const color = fill?.kind === "solid" ? fill.color : fill?.kind === "gradient" ? fill.first : undefined;
  return {
    sz: sz !== undefined && sz > 0 ? sz / 100 : undefined,
    b: boolAttr(el, "b"),
    i: boolAttr(el, "i"),
    u: u === undefined ? undefined : u !== "none",
    strike: strike === undefined ? undefined : strike !== "noStrike",
    color,
    latin: kid(el, "latin")?.getAttribute("typeface") || undefined,
    ea: kid(el, "ea")?.getAttribute("typeface") || undefined,
    baseline: baseline !== undefined ? baseline / 1000 : undefined,
    cap: cap === "all" || cap === "small" || cap === "none" ? cap : undefined,
    highlight: colorIn(kid(el, "highlight"), ctx),
  };
}

function readBullet(el: Element): BulletDef | undefined {
  let def: BulletDef | undefined;
  for (const c of kids(el)) {
    if (c.localName === "buNone") def = { kind: "none" };
    else if (c.localName === "buChar") def = { kind: "char", char: attr(c, "char") ?? "•" };
    else if (c.localName === "buAutoNum") {
      def = { kind: "auto", scheme: attr(c, "type") ?? "arabicPeriod", startAt: intAttr(c, "startAt", 1) };
    } else if (c.localName === "buBlip") def = { kind: "char", char: "•" };
  }
  return def;
}

function readPara(el: Element | undefined, ctx: DrawContext): ParaProps {
  if (!el) return { run: {} };
  const buClr = kid(el, "buClr");
  const buSz = kid(el, "buSzPct");
  return {
    align: ALIGN[attr(el, "algn") ?? ""],
    marL: intAttr(el, "marL"),
    indent: intAttr(el, "indent"),
    rtl: boolAttr(el, "rtl"),
    lnSpc: spacing(kid(el, "lnSpc")),
    spcBef: spacing(kid(el, "spcBef")),
    spcAft: spacing(kid(el, "spcAft")),
    bullet: readBullet(el),
    buFont: kid(el, "buFont")?.getAttribute("typeface") || undefined,
    buColor: colorIn(buClr, ctx),
    buScale: buSz ? intAttr(buSz, "val", 100000) / 100000 : undefined,
    run: readRun(kid(el, "defRPr"), ctx),
  };
}

function mergePara(base: ParaProps, over: ParaProps): ParaProps {
  const { run, ...rest } = over;
  const merged = defined({ ...base, run: { ...base.run } }, rest);
  defined(merged.run, run);
  return merged;
}

/** Effective paragraph properties of `level` (0-based) through the inherited list styles. */
function levelProps(lists: (Element | undefined)[], level: number, ctx: DrawContext): ParaProps {
  let props: ParaProps = { run: {} };
  const name = `lvl${level + 1}pPr`;
  for (const list of lists) {
    if (!list) continue;
    props = mergePara(props, readPara(kid(list, "defPPr"), ctx));
    props = mergePara(props, readPara(kid(list, name), ctx));
  }
  return props;
}

const ROMAN: readonly [number, string][] = [
  [1000, "m"],
  [900, "cm"],
  [500, "d"],
  [400, "cd"],
  [100, "c"],
  [90, "xc"],
  [50, "l"],
  [40, "xl"],
  [10, "x"],
  [9, "ix"],
  [5, "v"],
  [4, "iv"],
  [1, "i"],
];

function roman(n: number): string {
  let out = "";
  let rest = Math.max(1, Math.min(n, 3999));
  for (const [value, digits] of ROMAN) {
    while (rest >= value) {
      out += digits;
      rest -= value;
    }
  }
  return out;
}

function alpha(n: number): string {
  let out = "";
  let rest = Math.max(1, n);
  while (rest > 0) {
    rest--;
    out = String.fromCharCode(97 + (rest % 26)) + out;
    rest = Math.floor(rest / 26);
  }
  return out;
}

/** Formats an auto-number like PowerPoint's `buAutoNum` schemes (arabicPeriod, romanUcParenR, ...). */
export function autoNumber(scheme: string, n: number): string {
  let core: string;
  if (scheme.startsWith("romanUc")) core = roman(n).toUpperCase();
  else if (scheme.startsWith("romanLc")) core = roman(n);
  else if (scheme.startsWith("alphaUc")) core = alpha(n).toUpperCase();
  else if (scheme.startsWith("alphaLc")) core = alpha(n);
  else core = String(n);
  if (scheme.endsWith("ParenBoth")) return `(${core})`;
  if (scheme.endsWith("ParenR")) return `${core})`;
  if (scheme.endsWith("Period")) return `${core}.`;
  if (scheme.endsWith("Minus")) return `- ${core} -`;
  return core;
}

function runFaces(props: RunProps, ctx: DrawContext): { latin?: string; ea?: string } {
  return {
    latin: themeTypeface(ctx.theme, props.latin ?? "+mn-lt"),
    ea: themeTypeface(ctx.theme, props.ea ?? "+mn-ea"),
  };
}

/** Records the face a visible run is shown in: the East Asian one for CJK text, else Latin. */
function logFaces(props: RunProps, text: string, ctx: DrawContext): void {
  if (!ctx.fonts) return;
  const { latin, ea } = runFaces(props, ctx);
  if (hasCjk(text) && ea) ctx.fonts.add(ea);
  if (/[\u0021-\u024f]/.test(text) || !ea) ctx.fonts.add(latin);
}

function runStyle(props: RunProps, ctx: DrawContext, fallbackColor: Rgba): RunStyle {
  const { latin, ea } = runFaces(props, ctx);
  return {
    sizePt: props.sz ?? 18,
    bold: props.b ?? false,
    italic: props.i ?? false,
    underline: props.u ?? false,
    strike: props.strike ?? false,
    color: props.color ?? fallbackColor,
    font: fontStack(latin, ea !== latin ? ea : undefined),
    baseline: props.baseline ?? 0,
    caps: props.cap ?? "none",
    highlight: props.highlight,
  };
}

interface BodyProps {
  insets: TextBody["insets"];
  anchor: TextBody["anchor"];
  wrap: boolean;
  fontScale: number;
  lineReduction: number;
  vertical?: TextBody["vertical"];
}

function bodyProps(chain: TextChain): BodyProps {
  const insets = { ...(chain.insets ?? DEFAULT_INSETS) };
  let anchor: TextBody["anchor"] = "top";
  let wrap = true;
  let fontScale = 1;
  let lineReduction = 0;
  let vertical: TextBody["vertical"];
  for (const el of chain.bodyPrs) {
    if (!el) continue;
    insets.l = intAttr(el, "lIns", insets.l);
    insets.t = intAttr(el, "tIns", insets.t);
    insets.r = intAttr(el, "rIns", insets.r);
    insets.b = intAttr(el, "bIns", insets.b);
    const a = attr(el, "anchor");
    if (a) anchor = a === "ctr" ? "middle" : a === "b" ? "bottom" : "top";
    const w = attr(el, "wrap");
    if (w) wrap = w !== "none";
    const v = attr(el, "vert");
    if (v) vertical = v === "horz" ? undefined : v === "vert270" ? "sideways-lr" : "vertical-rl";
    const norm = kid(el, "normAutofit");
    if (norm) {
      fontScale = intAttr(norm, "fontScale", 100000) / 100000;
      lineReduction = intAttr(norm, "lnSpcReduction", 0) / 100000;
    } else if (kid(el, "noAutofit") || kid(el, "spAutoFit")) {
      fontScale = 1;
      lineReduction = 0;
    }
  }
  return { insets, anchor, wrap, fontScale, lineReduction, vertical };
}

/**
 * Builds a text body, or returns undefined when it has no visible characters
 * (empty placeholders only show prompt text while editing).
 */
export function buildTextBody(txBody: Element | undefined, chain: TextChain, ctx: DrawContext): TextBody | undefined {
  if (!txBody) return undefined;
  const lists = [...chain.lists, kid(txBody, "lstStyle")];
  const body = bodyProps({ ...chain, bodyPrs: [...chain.bodyPrs, kid(txBody, "bodyPr")] });
  const defaultColor: Rgba = schemeColor("tx1", ctx) ?? { r: 0, g: 0, b: 0, a: 1 };
  const counters: (number | undefined)[] = [];
  const paragraphs: TextParagraph[] = [];
  let visible = false;

  for (const p of kids(txBody, "p")) {
    const pPr = kid(p, "pPr");
    const level = Math.min(8, Math.max(0, intAttr(pPr, "lvl", 0)));
    let props = levelProps(lists, level, ctx);
    const o = chain.override;
    if (o) props = mergePara(props, { run: { color: o.color, latin: o.typeface, b: o.bold } });
    props = mergePara(props, readPara(pPr, ctx));

    const runs: TextRun[] = [];
    let firstStyle: RunStyle | undefined;
    for (const r of kids(p)) {
      if (r.localName !== "r" && r.localName !== "br" && r.localName !== "fld") continue;
      const runProps = { ...props.run, ...stripUndefined(readRun(kid(r, "rPr"), ctx)) };
      const style = runStyle(runProps, ctx, defaultColor);
      if (r.localName === "br") {
        runs.push({ br: true, style });
        continue;
      }
      let text = kid(r, "t")?.textContent ?? "";
      if (r.localName === "fld" && attr(r, "type") === "slidenum") text = String(chain.slideNumber);
      if (!text) continue;
      firstStyle ??= style;
      if (/\S/.test(text)) {
        visible = true;
        logFaces(runProps, text, ctx);
      }
      runs.push({ text, style });
    }
    const endStyle = runStyle(
      { ...props.run, ...stripUndefined(readRun(kid(p, "endParaRPr"), ctx)) },
      ctx,
      defaultColor,
    );

    counters.length = level + 1;
    let bullet: Bullet | undefined;
    const def = props.bullet;
    const hasText = runs.some((r) => "text" in r);
    // Auto numbers count only non-empty paragraphs; any other bullet at this level restarts them.
    if (def?.kind !== "auto") counters[level] = undefined;
    else if (hasText) counters[level] = (counters[level] ?? def.startAt - 1) + 1;
    if (hasText && def && def.kind !== "none") {
      const base = firstStyle ?? endStyle;
      const face = props.buFont ? themeTypeface(ctx.theme, props.buFont) : undefined;
      const symbolic = face !== undefined && /wingdings|symbol|webdings/i.test(face);
      const char = def.kind === "char" ? def.char : autoNumber(def.scheme, counters[level] ?? def.startAt);
      bullet = {
        text: symbolic ? (SYMBOL_BULLETS[char] ?? "•") : char,
        color: props.buColor ?? base.color,
        font: symbolic || !face ? base.font : fontStack(face),
        scale: props.buScale ?? 1,
      };
    }

    paragraphs.push({
      align: props.align ?? "left",
      marL: props.marL ?? 0,
      indent: props.indent ?? 0,
      rtl: props.rtl ?? false,
      lineSpacing: props.lnSpc ?? { pct: 1 },
      spaceBefore: props.spcBef ?? { pts: 0 },
      spaceAfter: props.spcAft ?? { pts: 0 },
      bullet,
      runs,
      endStyle,
      level,
    });
  }
  if (!visible) return undefined;
  return { paragraphs, ...body, placeholder: chain.placeholder };
}

function stripUndefined(props: RunProps): RunProps {
  return defined({} as RunProps, props);
}
