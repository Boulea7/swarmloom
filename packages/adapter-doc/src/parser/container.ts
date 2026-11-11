import * as CFB from "cfb";
import { DocError } from "../errors";
import { ByteReader } from "./reader";

const CFB_MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1] as const;

/** True when `bytes` starts with the OLE compound file signature. */
export function isCompoundFile(bytes: Uint8Array): boolean {
  return bytes.length >= CFB_MAGIC.length && CFB_MAGIC.every((b, i) => bytes[i] === b);
}

/** The streams of a Word binary document that the parser reads. */
export interface WordStreams {
  word: ByteReader;
  /** Returns `0Table` or `1Table`; missing streams are a `corrupt` error. */
  table(which: 0 | 1): ByteReader;
  /** The optional `Data` stream (pictures, form data). */
  data: ByteReader | null;
}

function toBytes(content: CFB.CFB$Blob | undefined): Uint8Array | null {
  if (!content) return null;
  if (content instanceof Uint8Array) return content;
  if (Array.isArray(content)) return Uint8Array.from(content);
  return null;
}

/** Looks up a stream directly under the root storage (embedded objects may contain their own Word streams). */
function stream(container: CFB.CFB$Container, name: string): ByteReader | null {
  const entry = CFB.find(container, `/${name}`);
  // Entry type 2 is a stream; storages and the root have no content.
  if (entry?.type !== 2) return null;
  const bytes = toBytes(entry.content);
  return bytes ? new ByteReader(bytes, name) : null;
}

/**
 * Opens the OLE container and locates the Word streams.
 * Encrypted OOXML packages ("EncryptedPackage") are reported as encrypted rather than "not Word".
 */
export function openWordStreams(bytes: Uint8Array): WordStreams {
  if (!isCompoundFile(bytes)) throw new DocError("not-cfb");
  let container: CFB.CFB$Container;
  try {
    container = CFB.read(bytes, { type: "array" });
  } catch (cause) {
    throw new DocError("not-cfb", "the compound file container is damaged", { cause });
  }
  const word = stream(container, "WordDocument");
  if (!word) {
    if (CFB.find(container, "/EncryptedPackage")) throw new DocError("encrypted", "encrypted Office Open XML package");
    throw new DocError("not-word");
  }
  const tables = new Map<0 | 1, ByteReader | null>();
  return {
    word,
    data: stream(container, "Data"),
    table(which) {
      if (!tables.has(which)) tables.set(which, stream(container, `${which}Table`));
      const table = tables.get(which);
      if (!table) throw new DocError("corrupt", `the ${which}Table stream is missing`);
      return table;
    },
  };
}
