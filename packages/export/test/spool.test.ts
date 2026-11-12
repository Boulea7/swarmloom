// @vitest-environment node
import { EncodedPacket, type StreamTargetChunk } from "mediabunny";
import { describe, expect, it } from "vitest";
import { BlobSink, PART_BYTES, PacketSpool } from "../src/browser/spool";

/** `size` bytes that tell packets apart. */
function bytes(size: number, seed: number): Uint8Array<ArrayBuffer> {
  return Uint8Array.from({ length: size }, (_, i) => (i * 31 + seed) & 0xff);
}

describe("packet spool", () => {
  it("keeps encoded frames in Blob parts and gives them back in order", async () => {
    const spool = new PacketSpool<EncodedVideoChunkMetadata>();
    // About three parts of frames, one frame larger than a part, and the decoder config on frame 0 only.
    const sizes = [...Array.from({ length: 24 }, (_, i) => 500_000 + i), PART_BYTES + 7, 1000];
    const config = { decoderConfig: { codec: "vp09.00.10.08" } };
    sizes.forEach((size, i) => {
      spool.add(new EncodedPacket(bytes(size, i), i === 0 ? "key" : "delta", i / 30, 1 / 30), i === 0 ? config : {});
      // What waits in script memory never reaches a part's size, however much was encoded.
      expect(spool.heldBytes).toBeLessThanOrEqual(PART_BYTES);
    });
    expect([spool.count, spool.meta]).toEqual([sizes.length, config]);

    let i = 0;
    for await (const packet of spool.packets()) {
      expect([packet.type, packet.timestamp, packet.duration]).toEqual([i === 0 ? "key" : "delta", i / 30, 1 / 30]);
      expect(Buffer.from(packet.data).equals(bytes(sizes[i], i))).toBe(true);
      i++;
    }
    expect(i).toBe(sizes.length);
  });
});

describe("blob sink", () => {
  it("appends writes and splices a write over earlier bytes in place", async () => {
    const sink = new BlobSink();
    const writer = sink.writable.getWriter();
    const write = (data: number[], position: number) =>
      writer.write({ type: "write", data: Uint8Array.from(data), position } satisfies StreamTargetChunk);
    await write([1, 2, 3, 4], 0);
    await write([5, 6, 7, 8], 4);
    // A header patched at the end, inside the first write and across the two.
    await write([9], 1);
    await write([10, 11], 3);
    // A gap reads as zeros.
    await write([12], 10);
    await writer.close();
    expect(sink.size).toBe(11);
    const blob = sink.blob("video/mp4");
    expect(blob.type).toBe("video/mp4");
    expect([...new Uint8Array(await blob.arrayBuffer())]).toEqual([1, 9, 3, 10, 11, 6, 7, 8, 0, 0, 12]);
  });
});
