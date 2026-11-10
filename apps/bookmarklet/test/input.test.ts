import { describe, expect, it } from "vitest";
import { detectMobileBrowser } from "../src/install/platform";
import { formatOptions, parseOptions } from "../src/options";
import { MSG_PAGE, parsePagePayload } from "../src/protocol";

const page = {
  type: MSG_PAGE,
  v: 1,
  reason: "blocked",
  url: "https://example.com/a",
  html: "<html></html>",
  viewport: { x: 0, y: 120, w: 390, h: 844, dpr: 3 },
};

describe("bookmarklet options", () => {
  it("round-trips valid options and drops invalid or unknown entries", () => {
    const text = formatOptions({ speed: 2, sound: false, agents: "auto", labels: "roles", seed: 7 });
    expect(text).toBe("speed=2&sound=0&agents=auto&labels=roles&seed=7");
    expect(parseOptions(text)).toEqual({
      options: { speed: 2, sound: false, agents: "auto", labels: "roles", seed: 7 },
      problems: [],
    });

    const parsed = parseOptions("speed=9&agents=1.5&theme=neon&future=1&locale=zh-CN");
    expect(parsed.options).toEqual({ locale: "zh-CN" });
    expect(parsed.problems).toHaveLength(3);
    expect(parseOptions("x".repeat(600)).problems).toEqual(["options string too long"]);
    expect(() => formatOptions({ speed: 0 })).toThrow(RangeError);
  });
});

describe("page payload", () => {
  it("accepts a well-formed payload and rejects malformed ones", () => {
    expect(parsePagePayload(page)).toEqual({ ok: true, payload: page });
    const cases: [unknown, string][] = [
      ["swarmloom:page", "not a page message"],
      [{ ...page, v: 2 }, "unsupported version 2"],
      [{ ...page, reason: "other" }, "invalid reason"],
      [{ ...page, url: "/relative" }, "invalid url"],
      [{ ...page, html: "" }, "missing html"],
      [{ ...page, viewport: { ...page.viewport, w: 0 } }, "invalid viewport"],
      [{ ...page, viewport: { ...page.viewport, dpr: Number.NaN } }, "invalid viewport"],
    ];
    for (const [data, error] of cases) expect(parsePagePayload(data)).toEqual({ ok: false, error });
  });
});

describe("install page browser guess", () => {
  const android = "Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 (KHTML, like Gecko)";
  const iphone = "Mozilla/5.0 (iPhone; CPU iPhone OS 26_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko)";
  const mac = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)";
  it.each([
    ["Chrome Android", `${android} Chrome/142.0 Mobile Safari/537.36`, 5, "chrome"],
    ["Samsung Internet", `${android} SamsungBrowser/28.0 Chrome/130.0 Mobile Safari/537.36`, 5, "samsung"],
    ["Firefox Android", "Mozilla/5.0 (Android 15; Mobile; rv:144.0) Gecko/144.0 Firefox/144.0", 5, "firefox"],
    ["Safari iPhone", `${iphone} Version/26.1 Mobile/15E148 Safari/604.1`, 5, "ios"],
    ["Safari iPad (desktop UA)", `${mac} Version/26.1 Safari/605.1.15`, 5, "ios"],
    ["Chrome iPhone", `${iphone} CriOS/142.0 Mobile/15E148 Safari/604.1`, 5, null],
    ["Edge Android", `${android} Chrome/142.0 Mobile Safari/537.36 EdgA/142.0`, 5, null],
    ["Safari Mac", `${mac} Version/26.1 Safari/605.1.15`, 0, null],
  ])("%s", (_name, ua, touch, expected) => {
    expect(detectMobileBrowser(ua, touch)).toBe(expected);
  });
});
