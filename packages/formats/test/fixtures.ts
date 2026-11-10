/** Byte builders for detection tests: tiny but structurally valid ZIP and CFB containers. */

export const ascii = (s: string): number[] => Array.from(s, (c) => c.charCodeAt(0));

export const bytes = (...parts: (string | number[])[]): Uint8Array =>
  Uint8Array.from(parts.flatMap((p) => (typeof p === "string" ? ascii(p) : p)));

const le = (value: number, size: 2 | 4): number[] =>
  Array.from({ length: size }, (_, i) => Math.floor(value / 2 ** (8 * i)) & 0xff);

export interface ZipEntry {
  name: string;
  data?: string;
  /** General purpose flags (bit 0 = encrypted). */
  flags?: number;
}

/** Stored (uncompressed) ZIP with local headers, central directory and end record. */
export function makeZip(entries: readonly ZipEntry[], { central = true } = {}): Uint8Array {
  const local: number[] = [];
  const directory: number[] = [];
  for (const { name, data = "", flags = 0 } of entries) {
    const offset = local.length;
    const common = [
      ...le(flags, 2),
      ...le(0, 2),
      ...le(0, 4),
      ...le(0, 4),
      ...le(data.length, 4),
      ...le(data.length, 4),
    ];
    local.push(...le(0x04034b50, 4), ...le(20, 2), ...common, ...le(name.length, 2), ...le(0, 2), ...ascii(name));
    local.push(...ascii(data));
    directory.push(...le(0x02014b50, 4), ...le(20, 2), ...le(20, 2), ...common, ...le(name.length, 2));
    directory.push(...le(0, 2), ...le(0, 2), ...le(0, 2), ...le(0, 2), ...le(0, 4), ...le(offset, 4), ...ascii(name));
  }
  if (!central) return Uint8Array.from(local);
  const end = [...le(0x06054b50, 4), 0, 0, 0, 0, ...le(entries.length, 2), ...le(entries.length, 2)];
  end.push(...le(directory.length, 4), ...le(local.length, 4), 0, 0);
  return Uint8Array.from([...local, ...directory, ...end]);
}

export interface CfbStream {
  name: string;
  /** Stream content placed in regular sectors (>= 4096 bytes keeps it out of the mini stream). */
  content?: Uint8Array;
}

/** Version 3 compound file (512-byte sectors): FAT in sector 0, directory in sector 1, streams after. */
export function makeCfb(streams: readonly CfbStream[]): Uint8Array {
  const SECTOR = 512;
  const END = 0xfffffffe;
  const header = new Uint8Array(SECTOR).fill(0);
  header.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  const view = new DataView(header.buffer);
  view.setUint16(0x18, 0x3e, true);
  view.setUint16(0x1a, 3, true);
  view.setUint16(0x1c, 0xfffe, true);
  view.setUint16(0x1e, 9, true);
  view.setUint16(0x20, 6, true);
  view.setUint32(0x2c, 1, true);
  view.setUint32(0x30, 1, true);
  view.setUint32(0x38, 4096, true);
  view.setUint32(0x3c, END, true);
  view.setUint32(0x44, END, true);
  for (let i = 0; i < 109; i++) view.setUint32(0x4c + i * 4, i === 0 ? 0 : 0xffffffff, true);

  const fat = new DataView(new ArrayBuffer(SECTOR));
  for (let i = 0; i < SECTOR / 4; i++) fat.setUint32(i * 4, 0xffffffff, true);
  fat.setUint32(0, 0xfffffffd, true);
  fat.setUint32(4, END, true);

  const dir = new Uint8Array(SECTOR);
  const dirView = new DataView(dir.buffer);
  const data: Uint8Array[] = [];
  let next = 2;
  const entries: CfbStream[] = [{ name: "Root Entry" }, ...streams];
  entries.slice(0, 4).forEach((entry, index) => {
    const at = index * 128;
    for (let i = 0; i < entry.name.length; i++) dirView.setUint16(at + i * 2, entry.name.charCodeAt(i), true);
    dirView.setUint16(at + 0x40, (entry.name.length + 1) * 2, true);
    dir[at + 0x42] = index === 0 ? 5 : 2;
    const content = entry.content ?? new Uint8Array(0);
    const sectors = Math.ceil(content.length / SECTOR);
    dirView.setUint32(at + 0x74, sectors ? next : END, true);
    dirView.setUint32(at + 0x78, content.length, true);
    for (let s = 0; s < sectors; s++) fat.setUint32((next + s) * 4, s === sectors - 1 ? END : next + s + 1, true);
    if (sectors) {
      const padded = new Uint8Array(sectors * SECTOR);
      padded.set(content);
      data.push(padded);
      next += sectors;
    }
  });
  const parts = [header, new Uint8Array(fat.buffer), dir, ...data];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** Start of a WordDocument stream: FIB identifier plus flags (0x0100 = fEncrypted). */
export function wordStream(flags: number): Uint8Array {
  const stream = new Uint8Array(4096);
  const view = new DataView(stream.buffer);
  view.setUint16(0, 0xa5ec, true);
  view.setUint16(0x0a, flags, true);
  return stream;
}
