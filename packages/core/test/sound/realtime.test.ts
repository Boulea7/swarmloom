import { describe, expect, expectTypeOf, it, vi } from "vitest";
import type { CreateSoundFn, EncodeWavFn, QuantizeFn, RenderOfflineFn } from "../../src/internal";
import { createSound, encodeWav, quantize, renderOffline } from "../../src/sound";

describe("sound zone entry", () => {
  it("implements the internal seam signatures", () => {
    expectTypeOf(createSound).toExtend<CreateSoundFn>();
    expectTypeOf(quantize).toExtend<QuantizeFn>();
    expectTypeOf(renderOffline).toExtend<RenderOfflineFn>();
    expectTypeOf(encodeWav).toExtend<EncodeWavFn>();
  });
});

describe("createSound without Web Audio", () => {
  it("degrades to a silent engine instead of throwing", async () => {
    const gestureTarget = new EventTarget();
    const add = vi.spyOn(gestureTarget, "addEventListener");
    const sound = createSound({ enabled: true }, { createContext: () => null, gestureTarget, microphone: null });

    expect(sound.enabled).toBe(true);
    expect(sound.locked).toBe(false);
    expect(() => sound.play({ t: 0, name: "note", pan: 0 })).not.toThrow();
    await expect(sound.unlock()).resolves.toBeUndefined();
    expect(sound.levels()).toBeNull();
    await expect(sound.useMicrophone(true)).resolves.toBe(false);
    sound.setEnabled(false);
    expect(sound.enabled).toBe(false);
    sound.destroy();
    sound.destroy();
    expect(add).not.toHaveBeenCalled();
  });

  it("rejects a missing options object", () => {
    expect(() => createSound(null as never)).toThrow(TypeError);
  });
});
