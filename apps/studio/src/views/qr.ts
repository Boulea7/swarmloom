import { encode } from "uqr";
import { s } from "../ui/dom";

/**
 * The largest code drawn: version 20, 97 modules a side (101 with the quiet zone), which holds a
 * link of about 650 bytes at level M. A 200 px watch face shows its code about 100 CSS px wide, so
 * that is about two device pixels a module at 2x; a larger code (up to 181 modules for 2.3 KB)
 * draws its modules too small and uneven for a phone to scan off the face.
 */
const MAX_VERSION = 20;

/**
 * Renders `text` as a QR code SVG (dark modules on a light quiet zone, as scanners expect, in both
 * themes). Built from one path of unit squares, so it stays crisp at any size. Returns null when
 * `text` does not fit a code of {@link MAX_VERSION}.
 */
export function qrCode(text: string, label: string): SVGSVGElement | null {
  let qr: ReturnType<typeof encode>;
  try {
    qr = encode(text, { ecc: "M", border: 2, maxVersion: MAX_VERSION });
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
