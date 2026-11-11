import type { PlayerOptions } from "@swarmloom/core";
import { describe, expect, it } from "vitest";
import { base64ToBytes, bytesToBase64, canRecordElement, createRenderApi, recordElement } from "../src/index";
import { ClockPlayer } from "./fake-player";

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
      createPlayer: (options: PlayerOptions) => new ClockPlayer(options),
      renderAudioWav: async () => new Uint8Array(),
    });
    await api.init({ input: { name: "a.md", text: "# Hi" }, width: 320, height: 200, fps: 25, sound: false });
    try {
      // The inline stage's scroller rules (core stage styles): it reserves a thin, stable gutter.
      const scroller = document.createElement("div");
      scroller.style.cssText =
        "position:absolute;inset:0;overflow:auto;overflow-x:hidden;scrollbar-gutter:stable;scrollbar-width:thin";
      document.getElementById("swarmloom-render")?.append(scroller);
      expect(scroller.offsetWidth).toBeGreaterThan(scroller.clientWidth);
      expect(scroller.clientWidth).toBe(320);
    } finally {
      api.dispose();
    }
  });
});
