import { describe, expect, it } from "vitest";
import { parseLabels, parseLoop, readConfig } from "../src/attributes";
import { define, SwarmLoomElement, TAG_NAME } from "../src/index";

const config = (attrs: Record<string, string>) => readConfig((name) => attrs[name] ?? null);

describe("attributes", () => {
  it("falls back to player defaults when absent", () => {
    expect(config({})).toEqual({
      agents: undefined,
      speed: 1,
      seed: undefined,
      theme: "auto",
      labels: undefined,
      finale: undefined,
      controls: false,
      sound: false,
      reducedMotion: "auto",
      autoplay: false,
      inview: false,
      loop: null,
    });
  });

  it("parses valid values", () => {
    expect(
      config({
        agents: "24",
        speed: "2.5",
        seed: "7",
        theme: "DARK",
        labels: "roles",
        finale: "halo",
        controls: "",
        sound: "true",
        "reduced-motion": "",
        autoplay: "autoplay",
        inview: "",
        loop: "4000",
      }),
    ).toEqual({
      agents: 24,
      speed: 2.5,
      seed: 7,
      theme: "dark",
      labels: "roles",
      finale: "halo",
      controls: true,
      sound: true,
      reducedMotion: true,
      autoplay: true,
      inview: true,
      loop: 4000,
    });
    expect(config({ agents: "auto" }).agents).toBe("auto");
    expect(parseLabels("Ada, Linus ,,Grace")).toEqual(["Ada", "Linus", "Grace"]);
  });

  it("rejects or clamps invalid values", () => {
    const c = config({ agents: "-3", speed: "abc", seed: "1.5", theme: "neon", finale: "boom", controls: "false" });
    expect(c).toMatchObject({
      agents: undefined,
      speed: 1,
      seed: undefined,
      theme: "auto",
      finale: undefined,
      controls: false,
    });
    expect(config({ agents: "5000", speed: "100" })).toMatchObject({ agents: 128, speed: 8 });
    expect(parseLoop("")).toBe(1500);
    expect(parseLoop("off")).toBeNull();
    expect(parseLoop("-1")).toBe(1500);
  });
});

describe("define", () => {
  it("registers <swarm-loom> idempotently", () => {
    expect(define()).toBe(SwarmLoomElement);
    expect(define()).toBe(SwarmLoomElement);
    expect(document.createElement(TAG_NAME)).toBeInstanceOf(SwarmLoomElement);
  });

  it("refuses a tag owned by another class", () => {
    const registry = { get: () => class {}, define: () => undefined } as unknown as CustomElementRegistry;
    expect(() => define(registry)).toThrow("already defined by another class");
  });
});
