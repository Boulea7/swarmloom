import { describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { createSound } from "../../src/sound";

describe("createSound in a real browser", () => {
  it("reports the autoplay lock, unlocks on any gesture and plays the chord it kept", async () => {
    // Test files share one runner page, and real key presses in earlier files give it sticky user
    // activation that this frame inherits, so a new context may already run. Suspending it first
    // reproduces the autoplay lock in any file order; the click below must still lift it.
    const ctx = new AudioContext({ latencyHint: "interactive" });
    await ctx.suspend();
    const sound = createSound({ enabled: true }, { createContext: () => ctx });
    expect(sound.locked).toBe(true);
    const changes: boolean[] = [];
    sound.onLockChange((locked) => changes.push(locked));

    sound.play({ t: 0, name: "key", pan: 0 }); // dropped while locked
    sound.play({ t: 20, name: "chord", pan: 0 }); // kept for the unlock
    await userEvent.click(document.body);
    // `state` can read "running" before the `statechange` that notifies listeners has fired.
    await vi.waitFor(() => expect(changes).toEqual([false]));
    expect(sound.locked).toBe(false);
    await vi.waitFor(() => expect(sound.levels()?.level).toBeGreaterThan(0.1), { timeout: 3000 });
    expect(sound.levels()?.bands).toHaveLength(16);

    sound.setEnabled(false);
    expect(sound.enabled).toBe(false);
    expect(sound.locked).toBe(false);
    sound.destroy();
    expect(sound.levels()).toBeNull();
  });

  it("analyses the microphone without playing it back, and reports denial", async () => {
    // A synthetic "microphone": a live audio track fed by an oscillator.
    const source = new AudioContext();
    const osc = source.createOscillator();
    const dest = source.createMediaStreamDestination();
    osc.connect(dest);
    osc.start();
    const [track] = dest.stream.getAudioTracks();
    const getUserMedia = vi.fn(async () => dest.stream);

    const sound = createSound({ enabled: false }, { microphone: { getUserMedia } });
    await expect(sound.useMicrophone(true)).resolves.toBe(true);
    expect(getUserMedia).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(sound.levels()?.level).toBeGreaterThan(0.1), { timeout: 3000 });
    await expect(sound.useMicrophone(false)).resolves.toBe(false);
    expect(track?.readyState).toBe("ended");
    sound.destroy();

    const denied = createSound(
      { enabled: false },
      { microphone: { getUserMedia: () => Promise.reject(new DOMException("denied", "NotAllowedError")) } },
    );
    await expect(denied.useMicrophone(true)).resolves.toBe(false);
    denied.destroy();
    await source.close();
  });
});
