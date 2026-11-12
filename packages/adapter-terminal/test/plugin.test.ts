import { describe, expect, it } from "vitest";
import type { ScreenEvent } from "../src/model";
import { promptOnly } from "../src/plugin";

const out = (...data: string[]): ScreenEvent[] => data.map((d, i): ScreenEvent => [i * 20, "o", d, 0]);

describe("promptOnly", () => {
  it.each([
    [["\r\n", "> "], true],
    [["\r\n\r\n\u001b[1m> \u001b[0m"], true],
    [["\r\nline 1\r\n", "> "], false],
    [["\r\n", "a".repeat(10), "b".repeat(7)], false],
  ])("%j is a continuation prompt: %s", (data, want) => {
    expect(promptOnly(out(...data), 0, data.length)).toBe(want);
  });

  it("stops at the first event that settles the answer (long output steps start without a stall)", () => {
    const events = out("\r\nline 1\r\n", "never read");
    Object.defineProperty(events, 1, {
      get() {
        throw new Error("read past the answer");
      },
    });
    expect(promptOnly(events, 0, events.length)).toBe(false);
  });
});
