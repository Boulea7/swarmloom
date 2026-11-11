import { describe, expect, it } from "vitest";
import { detectBrowser } from "../src/client/detect";

const MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)";
const WIN = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)";

describe("detectBrowser", () => {
  it.each([
    [
      "Chrome via client hints",
      { ua: `${WIN} Chrome/140.0 Safari/537.36`, brands: ["Google Chrome", "Chromium"] },
      "chrome",
      "chromium",
    ],
    ["Edge via UA token", { ua: `${WIN} Chrome/140.0 Safari/537.36 Edg/140.0` }, "edge", "chromium"],
    ["Brave hides from the UA", { ua: `${WIN} Chrome/140.0 Safari/537.36`, brave: true }, "brave", "chromium"],
    ["Opera", { ua: `${WIN} Chrome/140.0 Safari/537.36 OPR/120.0` }, "opera", "chromium"],
    ["Vivaldi keeps the generic label", { ua: `${WIN} Chrome/140.0 Safari/537.36 Vivaldi/7.0` }, "generic", "chromium"],
    [
      "Firefox desktop",
      { ua: "Mozilla/5.0 (X11; Linux x86_64; rv:142.0) Gecko/20100101 Firefox/142.0" },
      "firefox",
      "firefox",
    ],
    [
      "Firefox Android uses the same package",
      { ua: "Mozilla/5.0 (Android 15; Mobile; rv:142.0) Gecko/142.0 Firefox/142.0" },
      "firefox",
      "firefox",
    ],
    ["Safari macOS", { ua: `${MAC} Version/18.4 Safari/605.1.15` }, "safari", "safari"],
    [
      "iPadOS reports a Mac UA with touch",
      { ua: `${MAC} Version/18.4 Safari/605.1.15`, maxTouchPoints: 5 },
      "safari",
      "safari",
    ],
    [
      "Chrome on iOS cannot run extensions",
      { ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) CriOS/140.0 Mobile/15E148" },
      "studio",
      "studio",
    ],
    [
      "Chrome Android gets the app",
      { ua: "Mozilla/5.0 (Linux; Android 15) Chrome/140.0 Mobile Safari/537.36", mobile: true },
      "studio",
      "studio",
    ],
  ])("%s", (_name, input, browser, channel) => {
    expect(detectBrowser(input)).toEqual({ browser, channel });
  });

  it("falls back to the generic label for unknown or malformed input", () => {
    expect(detectBrowser({ ua: "curl/8.0" })).toEqual({ browser: "generic", channel: null });
    const malformed = { ua: 42, brands: [null, 7] } as unknown as Parameters<typeof detectBrowser>[0];
    expect(detectBrowser(malformed)).toEqual({ browser: "generic", channel: null });
  });
});
