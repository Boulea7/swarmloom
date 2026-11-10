import { describe, expect, it } from "vitest";
import { base64ToBytes, bytesToBase64, canRecordElement, recordElement } from "../src/index";

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
});
