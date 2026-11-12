import { describe, expect, it } from "vitest";
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
    expect(animatedDataUrl(`data:image/gif;base64,${GIF_TWO_FRAMES}`)?.type).toBe("image/gif");
    expect(animatedDataUrl(`data:image/gif,${percent}`)?.bytes).toEqual(bytes(GIF_TWO_FRAMES));
    expect(animatedDataUrl(`data:image/gif;base64,${GIF_ONE_FRAME}`)).toBeNull();
    expect(animatedDataUrl(`data:image/png;base64,${PNG_STILL}`)).toBeNull();
  });
});
