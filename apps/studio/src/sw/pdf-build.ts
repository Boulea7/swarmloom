/**
 * The pdf.js build Studio's PDF reader runs in this engine, so the service worker warms that build
 * only. Pure function over the engine's built-ins, no DOM or worker globals, so tests can import it.
 */

/** A pdf.js build the PDF reader loads (pdfjs-dist's `build/` or `legacy/build/`). */
export type PdfBuild = "modern" | "legacy";

/**
 * "modern" when the engine has every recent built-in the modern pdf.js build calls without
 * polyfills, the same test as adapter-pdf's `supportsModernBuild` (test/pwa.test.ts keeps the two
 * in step). A service worker runs on the page's engine and Studio polyfills none of these, so the
 * worker and the page pick the same build.
 */
export function pdfBuild(): PdfBuild {
  const P = Promise as unknown as { withResolvers?: unknown; try?: unknown };
  const M = Math as unknown as { sumPrecise?: unknown };
  const MapProto = Map.prototype as unknown as { getOrInsertComputed?: unknown };
  const U8 = Uint8Array as unknown as { fromBase64?: unknown; prototype: { toBase64?: unknown } };
  const modern = [
    P.withResolvers,
    P.try,
    M.sumPrecise,
    MapProto.getOrInsertComputed,
    U8.fromBase64,
    U8.prototype.toBase64,
  ].every((f) => typeof f === "function");
  return modern ? "modern" : "legacy";
}
