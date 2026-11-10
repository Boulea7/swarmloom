import { describe, expect, it } from "vitest";
import { exportFrames, recordElement, renderAudioWav } from "../src/index";

describe("@swarmloom/export", () => {
  it("exposes stubs that reject until implemented", async () => {
    await expect(renderAudioWav([], 1000)).rejects.toThrow("not implemented yet");
    await expect(recordElement(document.body)).rejects.toThrow("not implemented yet");
    expect(exportFrames).toBeTypeOf("function");
  });
});
