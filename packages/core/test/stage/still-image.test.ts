import { afterEach, expect, it, vi } from "vitest";
import { stillImageSource } from "../../src/stage/layers/still-image";

const PNG_STILL = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==";
const GIF_ONE_FRAME = "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

const svg = (body: string): string =>
  `data:image/svg+xml;base64,${btoa(`<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10">${body}</svg>`)}`;

afterEach(() => {
  vi.restoreAllMocks();
});

it.each([
  {
    name: "an animated SVG, copied at once",
    src: svg('<rect width="10" height="10"><animate attributeName="x" to="5" dur="1s"/></rect>'),
    copied: true,
  },
  {
    name: "a still SVG embedding a still PNG",
    src: svg(`<image href="data:image/png;base64,${PNG_STILL}" width="10" height="10"/>`),
    copied: false,
  },
  { name: "a still GIF", src: `data:image/gif;base64,${GIF_ONE_FRAME}`, copied: false },
])("a data: URL ($name) is decoded once, however often it is mounted again", ({ src, copied }) => {
  const decode = vi.spyOn(globalThis, "atob");
  const first = stillImageSource(src, document);
  expect(typeof first).toBe("string");
  expect(first !== src).toBe(copied);
  const calls = decode.mock.calls.length;
  expect(calls).toBeGreaterThan(0);
  // A replay, a seek back or a virtualised re-mount asks again.
  expect(stillImageSource(src, document)).toBe(first);
  expect(decode).toHaveBeenCalledTimes(calls);
});
