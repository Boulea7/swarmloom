import { corrupt } from "../errors";

/**
 * Bounds-checked little-endian view over one stream. Every read validates the range,
 * so a malformed offset in the file becomes a `corrupt` DocError instead of garbage.
 */
export class ByteReader {
  readonly bytes: Uint8Array;
  readonly name: string;
  private readonly view: DataView;

  constructor(bytes: Uint8Array, name: string) {
    this.bytes = bytes;
    this.name = name;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  get length(): number {
    return this.bytes.length;
  }

  /** Throws unless [offset, offset + size) lies inside the stream. */
  check(offset: number, size: number, what: string): void {
    if (!Number.isInteger(offset) || !Number.isInteger(size) || offset < 0 || size < 0 || offset + size > this.length) {
      throw corrupt(`${what} at ${offset}+${size} is outside the ${this.name} stream (${this.length} bytes)`);
    }
  }

  has(offset: number, size: number): boolean {
    return Number.isInteger(offset) && offset >= 0 && size >= 0 && offset + size <= this.length;
  }

  u8(offset: number): number {
    this.check(offset, 1, "byte");
    return this.view.getUint8(offset);
  }

  u16(offset: number): number {
    this.check(offset, 2, "uint16");
    return this.view.getUint16(offset, true);
  }

  i16(offset: number): number {
    this.check(offset, 2, "int16");
    return this.view.getInt16(offset, true);
  }

  u32(offset: number): number {
    this.check(offset, 4, "uint32");
    return this.view.getUint32(offset, true);
  }

  i32(offset: number): number {
    this.check(offset, 4, "int32");
    return this.view.getInt32(offset, true);
  }

  /** Zero-copy sub-range. */
  slice(offset: number, size: number, what: string): Uint8Array {
    this.check(offset, size, what);
    return this.bytes.subarray(offset, offset + size);
  }

  /** UTF-16LE string of `chars` code units. */
  utf16(offset: number, chars: number): string {
    return UTF16.decode(this.slice(offset, chars * 2, "UTF-16 text"));
  }
}

export const UTF16 = new TextDecoder("utf-16le");
/** "Compressed" Word text is always code page 1252 (MS-DOC 2.4.2), never the system code page. */
export const CP1252 = new TextDecoder("windows-1252");
