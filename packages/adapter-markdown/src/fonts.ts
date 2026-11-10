import type { FontFaceSpec } from "./math/index";

const registered = new WeakMap<Document, Map<string, Promise<void>>>();

/**
 * Registers fonts in a document's FontFaceSet and waits until they are decoded. Fonts declared
 * only inside a shadow root are ignored by some engines, so the layout sandbox (and a stage in the
 * same document) get them through the document instead. Returns warnings for fonts that failed.
 */
export async function registerFonts(doc: Document, fonts: readonly FontFaceSpec[]): Promise<string[]> {
  const view = doc.defaultView as (Window & { FontFace?: typeof FontFace }) | null;
  const Face = view?.FontFace;
  if (!Face || !doc.fonts || fonts.length === 0) return [];
  let perDoc = registered.get(doc);
  if (!perDoc) {
    perDoc = new Map();
    registered.set(doc, perDoc);
  }
  const warnings: string[] = [];
  const loads: Promise<void>[] = [];
  for (const f of fonts) {
    const key = `${f.family}|${f.weight}|${f.style}`;
    let load = perDoc.get(key);
    if (!load) {
      const face = new Face(f.family, `url(${f.src})`, { weight: f.weight, style: f.style, display: "block" });
      doc.fonts.add(face);
      load = face.load().then(
        () => undefined,
        () => {
          perDoc?.delete(key);
          warnings.push(`font ${f.family} ${f.weight} ${f.style} could not be decoded`);
        },
      );
      perDoc.set(key, load);
    }
    loads.push(load);
  }
  await Promise.all(loads);
  return warnings;
}
