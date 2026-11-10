import { describe, expect, it } from "vitest";
import { GECKO_ID, manifestFor, parseBrowsers } from "../scripts/manifest.mjs";

describe("extension manifests", () => {
  it("uses a service worker on Chromium/Safari and background scripts plus gecko settings on Firefox", () => {
    for (const browser of ["chrome", "edge", "safari"] as const) {
      expect(manifestFor(browser, "1.2.3").background).toEqual({ service_worker: "background.js" });
    }
    const firefox = manifestFor("firefox", "1.2.3");
    expect(firefox.background).toEqual({ scripts: ["background.js"] });
    expect(firefox).toMatchObject({
      manifest_version: 3,
      version: "1.2.3",
      browser_specific_settings: { gecko: { id: GECKO_ID }, gecko_android: {} },
    });
  });

  it("rejects unknown browsers", () => {
    expect(parseBrowsers("all")).toHaveLength(4);
    expect(() => parseBrowsers("chrome,netscape")).toThrow("netscape");
  });
});
