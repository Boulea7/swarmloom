import type { MeasureText } from "./layout";

/**
 * Text measurement backed by a 2D canvas of `doc`. Returns undefined when the document has no
 * canvas support (e.g. a non-rendering DOM); callers then fall back to estimates.
 */
export function canvasMeasurer(doc: Document): MeasureText | undefined {
  let ctx: CanvasRenderingContext2D | null = null;
  try {
    ctx = doc.createElement("canvas").getContext("2d");
  } catch {
    return undefined;
  }
  if (!ctx || typeof ctx.measureText !== "function") return undefined;
  const c = ctx;
  return (text, font) => {
    c.font = font;
    return c.measureText(text).width;
  };
}

/** Advance width of one monospace column divided by the font size, measured with `measure`. */
export function monoCharRatio(measure: MeasureText | undefined, fontFamily: string): number {
  if (!measure) return 0.6;
  const sample = "0123456789abcdefghijklmnopqrstuvwxyz{}()=;";
  const ratio = measure(sample, `100px ${fontFamily}`) / sample.length / 100;
  // A proportional fallback font or a broken measurement: use the common monospace ratio.
  return Number.isFinite(ratio) && ratio > 0.4 && ratio < 0.8 ? ratio : 0.6;
}
