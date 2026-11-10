import { describe, expect, it } from "vitest";
import { encodeWav, type PcmSource } from "../../src/sound/wav";

function fakeBuffer(channels: Float32Array[], sampleRate = 48000): PcmSource {
  return {
    numberOfChannels: channels.length,
    length: channels[0]?.length ?? 0,
    sampleRate,
    getChannelData: (c) => channels[c] as Float32Array<ArrayBuffer>,
  };
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

describe("encodeWav", () => {
  it("writes a 16-bit PCM stereo RIFF header and interleaved samples", () => {
    const left = new Float32Array([0, 1, -1, 0.5, 2]);
    const right = new Float32Array([0, -0.5, Number.NaN, -2, 0.25]);
    const wav = encodeWav(fakeBuffer([left, right], 44100));
    const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);

    expect(wav.byteLength).toBe(44 + 5 * 2 * 2);
    expect(ascii(wav, 0, 4)).toBe("RIFF");
    expect(view.getUint32(4, true)).toBe(wav.byteLength - 8);
    expect(ascii(wav, 8, 8)).toBe("WAVEfmt ");
    expect(view.getUint32(16, true)).toBe(16);
    expect(view.getUint16(20, true)).toBe(1); // PCM
    expect(view.getUint16(22, true)).toBe(2); // channels
    expect(view.getUint32(24, true)).toBe(44100);
    expect(view.getUint32(28, true)).toBe(44100 * 4); // byte rate
    expect(view.getUint16(32, true)).toBe(4); // block align
    expect(view.getUint16(34, true)).toBe(16);
    expect(ascii(wav, 36, 4)).toBe("data");
    expect(view.getUint32(40, true)).toBe(5 * 4);

    const pcm = Array.from({ length: 10 }, (_, i) => view.getInt16(44 + i * 2, true));
    // L/R interleaved; out-of-range samples clip, NaN becomes silence.
    expect(pcm).toEqual([0, 0, 32767, -16384, -32768, 0, 16384, -32768, 32767, 8192]);
  });

  it("encodes an empty buffer as a bare header", () => {
    const wav = encodeWav(fakeBuffer([new Float32Array(0)], 8000));
    const view = new DataView(wav.buffer);
    expect(wav.byteLength).toBe(44);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(40, true)).toBe(0);
  });

  it("rejects values that are not audio buffers", () => {
    expect(() => encodeWav({} as AudioBuffer)).toThrow(TypeError);
    expect(() => encodeWav(null as unknown as AudioBuffer)).toThrow(TypeError);
    expect(() => encodeWav(fakeBuffer([new Float32Array(4)], 44100.5))).toThrow(RangeError);
    expect(() => encodeWav({ ...fakeBuffer([new Float32Array(4)]), numberOfChannels: 0 })).toThrow(RangeError);
    expect(() => encodeWav({ ...fakeBuffer([new Float32Array(2)]), length: 4 })).toThrow(RangeError);
  });
});
