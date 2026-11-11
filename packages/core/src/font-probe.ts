/**
 * Which document faces the browser can actually draw, so a font substitution (decisions-v1 F01) is
 * reported only when it happens. Text widths on a canvas are compared with the generic families,
 * which sees installed fonts and loaded web fonts alike.
 */
import { cleanFontFamily, FONT_FALLBACKS, formatFontFamily } from "./fonts";

/** Text whose width differs between most Latin, CJK and Hangul faces and the generic families. */
const PROBE = "mmmmmmmmmmlli1WQ@永国あ한";
const BASES = ["monospace", "serif", "sans-serif"] as const;
const MAX_PROBED = 32;

/**
 * The names in `names` that `doc` cannot draw: neither the face nor another name of it (the F01
 * aliases, e.g. SimSun for 宋体) is installed or loaded. Returns [] when canvas text metrics are
 * unavailable (Node, test DOMs), so callers under-report instead of naming a substitution that
 * did not happen. At most 32 distinct names are probed.
 */
export function missingFonts(doc: Document, names: Iterable<string>): string[] {
  let ctx: CanvasRenderingContext2D | null = null;
  try {
    ctx = doc.createElement("canvas").getContext("2d");
  } catch {
    return [];
  }
  if (!ctx || typeof ctx.measureText !== "function") return [];
  const context = ctx;
  const width = (family: string): number => {
    context.font = `40px ${family}`;
    return context.measureText(PROBE).width;
  };
  const bases = BASES.map((generic) => [generic, width(generic)] as const);
  if (bases.every(([, w]) => !(w > 0))) return [];
  const out: string[] = [];
  for (const name of [...new Set(names)].slice(0, MAX_PROBED)) {
    const face = cleanFontFamily(name);
    if (!face) continue;
    const faces = [face, ...(FONT_FALLBACKS[face.toLowerCase()]?.aliases ?? [])];
    if (bases.every(([generic, w]) => width(formatFontFamily(faces, generic)) === w)) out.push(name);
  }
  return out;
}
