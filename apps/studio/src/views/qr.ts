import { encode } from "uqr";
import { s } from "../ui/dom";

/**
 * The largest code drawn: version 20, 97 modules a side (101 with the quiet zone), which holds a
 * link of about 650 bytes at level M. A larger code (up to 181 modules for 2.3 KB) packs more than a
 * phone reads reliably off a watch face, however many pixels the face has.
 */
const MAX_VERSION = 20;

/**
 * The fewest device pixels a module may get on screen. Below one, crisp edges drop whole modules;
 * below two, modules land one or two pixels wide at random and a phone misreads them. A 200 px face
 * at 2x draws its code about 85 CSS px wide, so a version 15 or 16 code there (about 400 bytes); a
 * 100 px round face at 2x (about 37 CSS px) only fits a version 4 code, about 60 bytes.
 */
export const MIN_MODULE_PX = 2;

/** Light modules around the code, on each side. */
const BORDER = 2;

/**
 * Renders `text` as a QR code SVG (dark modules on a light quiet zone, as scanners expect, in both
 * themes). Built from one path of unit squares, so it stays crisp at any size. `side` is how many
 * device pixels the code gets on screen: a code is only as dense as gives every module
 * {@link MIN_MODULE_PX} of them, and never past {@link MAX_VERSION}. Returns null when `text` does
 * not fit such a code.
 */
export function qrCode(text: string, label: string, side = Number.POSITIVE_INFINITY): SVGSVGElement | null {
  // Version v is 17 + 4v modules a side, plus the quiet zone.
  const maxVersion = Math.min(MAX_VERSION, Math.floor((side / MIN_MODULE_PX - 17 - 2 * BORDER) / 4));
  if (!(maxVersion >= 1)) return null;
  let qr: ReturnType<typeof encode>;
  try {
    qr = encode(text, { ecc: "M", border: BORDER, maxVersion });
  } catch (error) {
    // uqr's only RangeError for these fixed options is "Data too long".
    if (error instanceof RangeError) return null;
    throw error;
  }
  let d = "";
  qr.data.forEach((row, y) => {
    row.forEach((dark, x) => {
      if (dark) d += `M${x} ${y}h1v1h-1z`;
    });
  });
  const svg = s("svg", {
    class: "qr",
    viewBox: `0 0 ${qr.size} ${qr.size}`,
    role: "img",
    "aria-label": label,
    "shape-rendering": "crispEdges",
  });
  svg.append(s("rect", { width: qr.size, height: qr.size, fill: "#fff" }), s("path", { d, fill: "#0b0b12" }));
  return svg;
}
