import { attr, kids, readXml } from "./xml";
import type { ZipArchive } from "./zip";

/** One OPC relationship of a part. */
export interface Relationship {
  id: string;
  /** Last segment of the relationship type URI, e.g. "slideLayout", "image", "officeDocument". */
  type: string;
  /** Package part name (no leading slash), or the raw URI for external targets. */
  target: string;
  /** External targets are never fetched; they are kept only for reporting. */
  external: boolean;
}

export type Relationships = Map<string, Relationship>;

/** `ppt/slides/slide1.xml` -> `ppt/slides/_rels/slide1.xml.rels`; the package root uses `_rels/.rels`. */
export function relsPartFor(part: string): string {
  const slash = part.lastIndexOf("/");
  return `${part.slice(0, slash + 1)}_rels/${part.slice(slash + 1)}.rels`;
}

/**
 * Resolves a relationship target against its source part, OPC style.
 * Returns null when the target escapes the package root or is not a valid part name.
 */
export function resolvePartName(source: string, target: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(target.split("#")[0] ?? "");
  } catch {
    return null;
  }
  if (!decoded || decoded.includes("\\")) return null;
  const base = decoded.startsWith("/") ? [] : source.split("/").slice(0, -1);
  for (const segment of decoded.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (base.length === 0) return null;
      base.pop();
    } else {
      base.push(segment);
    }
  }
  return base.length ? base.join("/") : null;
}

/** Reads the relationships of `part` (empty map when it has none). Unsafe targets are dropped. */
export function readRels(zip: ZipArchive, part: string): Relationships {
  const rels: Relationships = new Map();
  const root = readXml(zip, part === "" ? "_rels/.rels" : relsPartFor(part));
  for (const rel of kids(root, "Relationship")) {
    const id = attr(rel, "Id");
    const rawType = attr(rel, "Type") ?? "";
    const rawTarget = attr(rel, "Target");
    if (!id || !rawTarget) continue;
    const type = rawType.slice(rawType.lastIndexOf("/") + 1);
    if (attr(rel, "TargetMode") === "External") {
      rels.set(id, { id, type, target: rawTarget, external: true });
      continue;
    }
    const target = resolvePartName(part, rawTarget);
    if (target) rels.set(id, { id, type, target, external: false });
  }
  return rels;
}

/** First internal relationship of a given type. */
export function relOfType(rels: Relationships, type: string): Relationship | undefined {
  for (const rel of rels.values()) if (rel.type === type && !rel.external) return rel;
  return undefined;
}
