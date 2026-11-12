import { EncodedPacket, type PacketType, type StreamTargetChunk } from "mediabunny";

/**
 * Bytes per Blob part, for spooled packets and for the written file: what an export holds in script
 * memory at a time. Blob data lives outside the script heap, and the browser may page it to disk.
 */
export const PART_BYTES = 4 * 2 ** 20;

const EMPTY = new Blob([]);

interface SpooledPacket {
  part: number;
  offset: number;
  size: number;
  type: PacketType;
  timestamp: number;
  duration: number;
}

/**
 * Encoded packets parked in Blob parts until the file is muxed, so a long export does not keep its
 * whole video in script memory while the soundtrack is still unknown.
 */
export class PacketSpool<Meta extends { decoderConfig?: unknown }> {
  readonly #parts: Blob[] = [];
  readonly #packets: SpooledPacket[] = [];
  readonly #staging = new Uint8Array(PART_BYTES);
  #used = 0;
  #meta: Meta | undefined;

  /** Packets added so far. */
  get count(): number {
    return this.#packets.length;
  }

  /** Packet bytes still in script memory, waiting to fill a part. */
  get heldBytes(): number {
    return this.#used;
  }

  /** The encoder's metadata with the first decoder config, which the muxer needs with the first packet. */
  get meta(): Meta | undefined {
    return this.#meta;
  }

  add(packet: EncodedPacket, meta?: Meta): void {
    if (!this.#meta && meta?.decoderConfig) this.#meta = meta;
    const { data } = packet;
    if (this.#used + data.byteLength > PART_BYTES) this.#seal();
    const part = this.#parts.length;
    const offset = this.#used;
    if (data.byteLength > PART_BYTES) {
      this.#parts.push(new Blob([data.slice()]));
    } else {
      this.#staging.set(data, offset);
      this.#used += data.byteLength;
    }
    const { type, timestamp, duration } = packet;
    this.#packets.push({ part, offset, size: data.byteLength, type, timestamp, duration });
  }

  /** The packets in the order they were added, reading each part once and then letting it go. */
  async *packets(): AsyncGenerator<EncodedPacket> {
    this.#seal();
    let current = -1;
    let bytes = new Uint8Array(0);
    for (const p of this.#packets) {
      if (p.part !== current) {
        if (current >= 0) this.#parts[current] = EMPTY;
        current = p.part;
        bytes = new Uint8Array(await this.#parts[current].arrayBuffer());
      }
      yield new EncodedPacket(bytes.subarray(p.offset, p.offset + p.size), p.type, p.timestamp, p.duration);
    }
    if (current >= 0) this.#parts[current] = EMPTY;
  }

  /** Moves the staged bytes into a part (the Blob copies them, so the staging buffer is reused). */
  #seal(): void {
    if (this.#used === 0) return;
    this.#parts.push(new Blob([this.#staging.subarray(0, this.#used)]));
    this.#used = 0;
  }
}

/**
 * Gathers a Mediabunny `StreamTarget`'s writes into Blob parts, so the finished file is never one
 * script buffer (nor copied into one). A write over earlier bytes, such as a size or the MP4 index
 * written at the end, is spliced in by Blob slices, which share their data.
 */
export class BlobSink {
  #parts: Blob[] = [];
  #size = 0;
  readonly writable = new WritableStream<StreamTargetChunk>({
    write: ({ data, position }) => this.#write(data, position),
  });

  get size(): number {
    return this.#size;
  }

  blob(type: string): Blob {
    return new Blob(this.#parts, { type });
  }

  #write(data: Uint8Array<ArrayBuffer>, position: number): void {
    const part = new Blob([data]);
    const end = position + data.byteLength;
    if (position >= this.#size) {
      // Positions skipped over read as zeros, as in a file.
      if (position > this.#size) this.#parts.push(new Blob([new Uint8Array(position - this.#size)]));
      this.#parts.push(part);
    } else {
      const whole = new Blob(this.#parts);
      this.#parts = [whole.slice(0, position), part, whole.slice(end)];
    }
    this.#size = Math.max(this.#size, end);
  }
}
