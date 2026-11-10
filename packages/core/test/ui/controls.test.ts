import { afterEach, describe, expect, it, vi } from "vitest";
import { createI18n } from "../../src/i18n/index";
import type { Controls } from "../../src/internal";
import { createControls, type ToolbarOptions } from "../../src/ui/index";
import { commandForKey } from "../../src/ui/keyboard";
import { createFakePlayer } from "./fake-player";

describe("commandForKey", () => {
  it.each([
    [{ key: "Escape" }, { kind: "close" }],
    [{ key: " " }, { kind: "togglePlay" }],
    [{ key: "m" }, { kind: "toggleSound" }],
    [{ key: "T" }, { kind: "toggleTour" }],
    [{ key: "2" }, { kind: "speed", speed: 2 }],
    [{ key: "r" }, { kind: "replay" }],
    [{ key: "l" }, { kind: "goLive" }],
    [{ key: "f" }, { kind: "finish" }],
    // Non-Latin layouts fall back to the physical key.
    [{ key: "ь", code: "KeyM" }, { kind: "toggleSound" }],
    [
      { key: "&", code: "Digit1" },
      { kind: "speed", speed: 1 },
    ],
  ])("%o -> %o", (input, expected) => {
    expect(commandForKey(input)).toEqual(expected);
  });

  it.each([
    { key: "m", ctrlKey: true },
    { key: "m", metaKey: true },
    { key: "m", altKey: true },
    { key: "M", shiftKey: true },
    { key: "m", repeat: true },
    { key: "m", isComposing: true },
    { key: "4" },
    { key: "Enter" },
  ])("ignores %o", (input) => {
    expect(commandForKey(input)).toBeNull();
  });
});

describe("createControls", () => {
  let controls: Controls | undefined;
  afterEach(() => {
    controls?.destroy();
    controls = undefined;
    document.body.replaceChildren();
  });

  const mount = (over: Partial<ToolbarOptions> = {}, state: Parameters<typeof createFakePlayer>[0] = "building") => {
    const fake = createFakePlayer(state);
    const host = document.createElement("div");
    document.body.append(host);
    const onUnlockSound = vi.fn();
    controls = createControls({
      host,
      player: fake.player,
      i18n: createI18n("en"),
      chrome: "dark",
      soundLocked: () => false,
      onUnlockSound,
      keyboard: "window",
      ...over,
    });
    const shadow = host.querySelector("swarmloom-controls")?.shadowRoot;
    if (!shadow) throw new Error("toolbar not mounted");
    return { ...fake, host, shadow, onUnlockSound };
  };

  const press = (key: string, target: EventTarget = document.body, init: KeyboardEventInit = {}) => {
    const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, composed: true, ...init });
    target.dispatchEvent(event);
    return event;
  };

  it("dispatches the keyboard map to the player and consumes handled keys", () => {
    const { player } = mount();
    expect(press(" ").defaultPrevented).toBe(true);
    expect(player.pause).toHaveBeenCalledTimes(1);
    press("2");
    expect(player.setSpeed).toHaveBeenLastCalledWith(2);
    press("m");
    expect(player.setSound).toHaveBeenLastCalledWith(false);
    press("t");
    expect(player.setFollow).toHaveBeenLastCalledWith("tour");
    press("t");
    expect(player.setFollow).toHaveBeenLastCalledWith("scroll");
    press("r");
    expect(player.replay).toHaveBeenCalledTimes(1);
    press("l");
    expect(player.goLive).toHaveBeenCalledTimes(1);
    // Without Player.finish() the F key is not consumed.
    expect(press("f").defaultPrevented).toBe(false);
    press("Escape");
    expect(player.destroy).toHaveBeenCalledTimes(1);
  });

  it("offers finish now while building when the player supports it", () => {
    const fake = createFakePlayer("building");
    const finish = vi.fn();
    const { shadow } = mount({ player: Object.assign(fake.player, { finish }) });
    const button = shadow.querySelector<HTMLButtonElement>('[data-cmd="finish"]');
    expect(button?.hidden).toBe(false);
    expect(button?.getAttribute("aria-label")).toBe("Finish now");
    expect(press("f").defaultPrevented).toBe(true);
    button?.click();
    expect(finish).toHaveBeenCalledTimes(2);
  });

  it("ignores shortcuts in text fields, with modifiers, and when the phase does not offer them", () => {
    const { player, setState } = mount();
    const input = document.createElement("input");
    document.body.append(input);
    input.focus();
    expect(press(" ", input).defaultPrevented).toBe(false);
    press("m", input);
    press("r", document.body, { ctrlKey: true });
    expect(player.pause).not.toHaveBeenCalled();
    expect(player.setSound).not.toHaveBeenCalled();
    expect(player.replay).not.toHaveBeenCalled();

    setState("done");
    expect(press("2").defaultPrevented).toBe(false);
    expect(player.setSpeed).not.toHaveBeenCalled();
  });

  it("routes the first sound press to unlock while the browser blocks audio", () => {
    const { player, onUnlockSound, shadow } = mount({ soundLocked: () => true });
    const sound = shadow.querySelector<HTMLButtonElement>('[data-cmd="toggleSound"]');
    expect(sound?.getAttribute("aria-label")).toBe("Tap for sound");
    sound?.click();
    expect(onUnlockSound).toHaveBeenCalledTimes(1);
    expect(player.setSound).not.toHaveBeenCalled();
  });

  it("keeps sound on when the unlock lands between the press and the click", () => {
    let locked = true;
    const { player, onUnlockSound, shadow } = mount({ soundLocked: () => locked });
    const sound = shadow.querySelector<HTMLButtonElement>('[data-cmd="toggleSound"]');
    sound?.dispatchEvent(new Event("pointerdown", { bubbles: true, composed: true }));
    locked = false; // the page-wide gesture listener resumed audio before the click arrived
    sound?.click();
    expect(onUnlockSound).toHaveBeenCalledTimes(1);
    expect(player.setSound).not.toHaveBeenCalled();
    sound?.dispatchEvent(new Event("pointerdown", { bubbles: true, composed: true }));
    sound?.click();
    expect(player.setSound).toHaveBeenLastCalledWith(false);
  });

  it("mirrors engine settings, exposes toolbar semantics and cleans up on destroy", () => {
    const settings = { speed: 3, sound: true, follow: "tour" as const };
    const { shadow, host, listenerCount } = mount({ settings: () => settings });
    const bar = shadow.querySelector('[role="toolbar"]');
    expect(bar?.getAttribute("aria-label")).toBe("Build controls");
    expect(shadow.querySelector('[role="radio"][aria-checked="true"]')?.textContent).toBe("3×");
    expect(shadow.querySelector('[data-cmd="toggleTour"]')?.getAttribute("aria-pressed")).toBe("true");
    expect(shadow.querySelector('[role="status"][aria-live="polite"]')).not.toBeNull();
    expect(shadow.querySelectorAll('[tabindex="0"]')).toHaveLength(1);

    controls?.destroy();
    expect(host.querySelector("swarmloom-controls")).toBeNull();
    expect(listenerCount()).toBe(0);
  });

  it("announces start, halfway and done once per run", async () => {
    const { shadow, setProgress, setState } = mount({}, "idle");
    const live = shadow.querySelector('[role="status"]');
    const frame = () => new Promise((r) => setTimeout(r, 260));
    setState("building");
    setProgress(0, 10);
    await frame();
    expect(live?.textContent).toBe("Building 10 layers");
    setProgress(5, 10);
    await frame();
    expect(live?.textContent).toBe("Halfway there");
    setState("done");
    await frame();
    expect(live?.textContent).toBe("Build complete");
  });

  it("rejects malformed options", () => {
    const fake = createFakePlayer();
    const base = {
      host: document.createElement("div"),
      player: fake.player,
      i18n: createI18n("en"),
      chrome: "light" as const,
      soundLocked: () => false,
      onUnlockSound: () => {},
    };
    expect(() => createControls({ ...base, host: null as unknown as HTMLElement })).toThrow(TypeError);
    expect(() => createControls({ ...base, player: {} as typeof fake.player })).toThrow(TypeError);
  });
});
