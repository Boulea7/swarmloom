import { describe, expect, it, vi } from "vitest";
import { animatedBitmapType, animatedDataUrl } from "../../src/stage/layers/still-bitmap";

/** 1x1 GIF, red then blue, looping. */
const GIF_TWO_FRAMES =
  "R0lGODlhAQABAIABAP8AAAAA/yH/C05FVFNDQVBFMi4wAwEAAAAh+QQACgAAACwAAAAAAQABAAACAkQBACH5BAAKAAAALAAAAAABAAEAAAICTAEAOw==";
const GIF_ONE_FRAME = "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
/** 4x4 APNG and animated WebP (two frames each), as ffmpeg writes them. */
const APNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAACXBIWXMAAAABAAAAAQBPJcTWAAAACGFjVEwAAAACAAAAAPONk3AAAAAaZmNUTAAAAAAAAAAEAAAABAAAAAAAAAAAAAEACgAAV3ID4QAAABBJREFUeJxj/MuAACwMRHEANAcBC3iEuXMAAAAaZmNUTAAAAAEAAAAEAAAABAAAAAAAAAAAAAEACgAAzAHpNQAAABhmZEFUAAAAAnicY2Rg+McAAywMSAA3BwAyPgEMwWFfVwAAAABJRU5ErkJggg==";
const WEBP_ANIMATED =
  "UklGRoQAAABXRUJQVlA4WAoAAAACAAAAAwAAAwAAQU5JTQYAAAD/////AABBTk1GKAAAAAAAAAAAAAMAAAMAAGQAAAJWUDhMDwAAAC8DwAAABxD1j/4HIqL/AQBBTk1GKAAAAAAAAAAAAAMAAAMAAGQAAABWUDhMDwAAAC8DwAAABxDR//4HIqL/AQA=";
const PNG_STILL = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==";

const bytes = (base64: string): Uint8Array => Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
const base64 = (b: Uint8Array): string => {
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
};

describe("animated bitmaps", () => {
  it.each([
    { name: "a two-frame GIF", data: bytes(GIF_TWO_FRAMES), type: "image/gif" },
    { name: "an APNG", data: bytes(APNG), type: "image/png" },
    { name: "an animated WebP", data: bytes(WEBP_ANIMATED), type: "image/webp" },
    { name: "a one-frame GIF", data: bytes(GIF_ONE_FRAME), type: null },
    { name: "a still PNG", data: bytes(PNG_STILL), type: null },
    // The second frame is still to come.
    { name: "the first frame of a GIF", data: bytes(GIF_TWO_FRAMES).slice(0, 60), type: undefined },
  ])("reads $name from its leading bytes", ({ data, type }) => {
    expect(animatedBitmapType(data)).toBe(type);
  });

  it("finds animated data: URLs, base64 or percent-encoded, and leaves still ones alone", () => {
    const percent = Array.from(bytes(GIF_TWO_FRAMES), (b) => `%${b.toString(16).padStart(2, "0")}`).join("");
    const still = animatedDataUrl(`data:image/gif;base64,${GIF_TWO_FRAMES}`);
    expect(still?.type).toBe("image/gif");
    expect(animatedDataUrl(`data:image/gif,${percent}`)?.bytes).toEqual(still?.bytes);
    expect(animatedDataUrl(`data:image/gif;base64,${GIF_ONE_FRAME}`)).toBeNull();
    expect(animatedDataUrl(`data:image/png;base64,${PNG_STILL}`)).toBeNull();
  });

  it("cuts an animated GIF or APNG after its first frame, however large the file", () => {
    // A third GIF frame of 17 MB: past the most bytes read whole.
    const gif = bytes(GIF_TWO_FRAMES);
    const big = new Uint8Array(17 * 1024 * 1024 + gif.length + 16);
    big.set(gif.subarray(0, -1));
    let at = gif.length - 1;
    big.set([0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2], at);
    for (at += 11; at + 256 < big.length - 2; at += 256) big[at] = 255;
    big.set([0, 0x3b], at);
    for (const [src, type] of [
      [`data:image/gif;base64,${base64(big.subarray(0, at + 2))}`, "image/gif"],
      [`data:image/png;base64,${APNG}`, "image/png"],
    ] as const) {
      const still = animatedDataUrl(src);
      expect(still?.type).toBe(type);
      // One frame left, a few bytes long.
      expect(animatedBitmapType(still?.bytes ?? new Uint8Array())).toBeNull();
      expect(still?.bytes.length).toBeLessThan(200);
    }
  });

  it("decodes each character of a data: URL once while reading longer heads, across split escapes", () => {
    // An animated WebP header, then 300 KB of frame data: decoded whole, through four longer heads.
    const webp = new Uint8Array(300 * 1024);
    webp.set(bytes(WEBP_ANIMATED));
    for (let i = WEBP_ANIMATED.length; i < webp.length; i++) webp[i] = (i * 7919) % 251;
    const plain = base64(webp);
    // Base64 in lines, so heads end inside a quantum; escapes between plain letters, so inside an escape.
    const percent = Array.from(webp, (b) =>
      b >= 0x61 && b <= 0x7a ? String.fromCharCode(b) : `%${b.toString(16).padStart(2, "0")}`,
    );
    const atob = vi.spyOn(globalThis, "atob");
    const native = Uint8Array as unknown as { fromBase64?: (text: string) => Uint8Array };
    const fromBase64 = native.fromBase64 && vi.spyOn(native as Required<typeof native>, "fromBase64");
    try {
      expect(animatedDataUrl(`data:image/webp;base64,${plain.replace(/.{76}/g, "$&\n")}`)?.bytes).toEqual(webp);
      const calls = [...atob.mock.calls, ...(fromBase64 ? fromBase64.mock.calls : [])];
      expect(calls.reduce((sum, [text]) => sum + text.length, 0)).toBe(plain.length);
      expect(animatedDataUrl(`data:image/webp,${percent.join("")}`)?.bytes).toEqual(webp);
    } finally {
      atob.mockRestore();
      fromBase64?.mockRestore();
    }
  });
});
