import { encode } from "uqr";
import { s } from "../ui/dom";

/**
 * Renders `text` as a QR code SVG (dark modules on a light quiet zone, as scanners expect, in both
 * themes). Built from one path of unit squares, so it stays crisp at any size.
 */
export function qrCode(text: string, label: string): SVGSVGElement {
  const qr = encode(text, { ecc: "M", border: 2 });
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
