import { createPlayer } from "@swarmloom/core";
import { describe, expect, it } from "vitest";
import { base64ToBytes, bytesToBase64, canRecordElement, createRenderApi, recordElement } from "../src/index";
import { watchShadowRoots } from "../src/render/live";

describe("export in Chromium", () => {
  it("detects live recording support", async () => {
    // Chromium ships getDisplayMedia, Region/Element Capture and MediaRecorder with WebM.
    expect(canRecordElement()).toBe(true);
    await expect(recordElement(document.createElement("div"))).rejects.toThrow("in the document");
  });

  it("round-trips multi-megabyte payloads through base64", () => {
    const bytes = new Uint8Array(3 << 20).map((_, i) => (i * 31) & 0xff);
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
  });

  it("gives the stage the whole frame width, with its scrollbar gutter past the right edge", async () => {
    const blueprint = {
      version: 1 as const,
      source: { type: "fake" },
      size: { w: 320, h: 400 },
      background: "#fff",
      layers: [],
    };
    const api = createRenderApi({
      load: async () => ({ blueprint }),
      createPlayer,
      renderAudioWav: async () => new Uint8Array(),
    });
    // The stage's shadow roots are closed: record them as they are attached.
    const shadows = watchShadowRoots(window);
    try {
      await api.init({ input: { name: "a.md", text: "# Hi" }, width: 320, height: 200, fps: 25, sound: false });
      const scroller = shadows
        .roots()
        .map((root) => root.querySelector<HTMLElement>(".scroller"))
        .find((el) => el !== null);
      if (!scroller) throw new Error("No stage scroller in the render host");
      // The real inline scroller reserves its gutter, and the host is widened by exactly that much.
      expect(scroller.offsetWidth).toBeGreaterThan(scroller.clientWidth);
      expect(scroller.clientWidth).toBe(320);
    } finally {
      api.dispose();
      shadows.stop();
    }
  });
});
