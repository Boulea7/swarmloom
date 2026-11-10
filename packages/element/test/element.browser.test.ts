import type { Adapter, PlayerOptions, SourceInput } from "@swarmloom/core";
import type { FormatEntry } from "@swarmloom/formats";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { configure, define, runtime, type SwarmLoomElement } from "../src/index";
import { FakePlayer } from "./fake-player";

const players: FakePlayer[] = [];
const inputs: SourceInput[] = [];
const dispose = vi.fn();

function fakeAdapter(id: string): Adapter {
  return {
    id,
    label: id,
    extensions: [],
    mime: [],
    async load(input) {
      inputs.push(input);
      const blueprint = {
        version: 1 as const,
        source: { type: id },
        size: { w: 10, h: 10 },
        background: "#fff",
        layers: [],
      };
      return { blueprint, dispose };
    },
  };
}

const registry: FormatEntry[] = [
  { id: "dom", label: "Web page", extensions: [], mime: [], loader: async () => fakeAdapter("dom") },
  { id: "fake", label: "Fake", extensions: ["fake"], mime: ["text/x-fake"], loader: async () => fakeAdapter("fake") },
];

const original = { ...runtime };

function mount(html: string): SwarmLoomElement {
  const wrapper = document.createElement("div");
  wrapper.innerHTML = html;
  document.body.append(wrapper);
  return wrapper.querySelector("swarm-loom") as SwarmLoomElement;
}

function record(el: Element, types: string[]): { type: string; detail: unknown }[] {
  const log: { type: string; detail: unknown }[] = [];
  for (const type of types) el.addEventListener(type, (e) => log.push({ type, detail: (e as CustomEvent).detail }));
  return log;
}

beforeAll(() => {
  define();
  configure({
    formats: registry,
    createPlayer: (options: PlayerOptions) => {
      const player = new FakePlayer(options);
      players.push(player);
      return player;
    },
  });
});

afterAll(() => configure(original));

afterEach(() => {
  document.body.innerHTML = "";
  players.length = 0;
  inputs.length = 0;
  dispose.mockClear();
});

describe("<swarm-loom>", () => {
  it("builds its light-DOM children, emits events, loops and cleans up", async () => {
    const el = mount(`<swarm-loom autoplay loop="20" speed="2" labels="Ada,Linus"><h1>Hello</h1></swarm-loom>`);
    const log = record(el, ["swarm-state", "swarm-progress", "swarm-done"]);
    await vi.waitFor(() => expect(players).toHaveLength(1));
    const [player] = players as [FakePlayer];

    expect(inputs[0]?.element).toBe(el);
    expect(player.options).toMatchObject({ mode: "inline", speed: 2, labels: ["Ada", "Linus"], controls: false });
    expect(el.shadowRoot?.contains(player.options.host ?? null)).toBe(true);
    expect(player.calls).toEqual(["play"]);

    player.finish();
    await vi.waitFor(() => expect(player.calls).toContain("replay"));
    expect(log.map((e) => e.type)).toEqual([
      "swarm-state",
      "swarm-progress",
      "swarm-state",
      "swarm-done",
      "swarm-state",
    ]);
    expect(log[3]).toEqual({ type: "swarm-done", detail: {} });

    el.setAttribute("speed", "3");
    expect(player.speed).toBe(3);
    el.setAttribute("agents", "5");
    await vi.waitFor(() => expect(players).toHaveLength(2));
    expect(player.calls).toContain("destroy");
    expect(players[1]?.options.agents).toBe(5);

    el.remove();
    await vi.waitFor(() => expect(dispose).toHaveBeenCalledOnce());
    expect(players[1]?.state).toBe("destroyed");
  });

  it("keeps playing when moved within the document", async () => {
    const el = mount(`<swarm-loom autoplay><p>Hi</p></swarm-loom>`);
    await vi.waitFor(() => expect(players).toHaveLength(1));
    document.body.prepend(el);
    await new Promise((r) => setTimeout(r, 10));
    expect(players).toHaveLength(1);
    expect(players[0]?.state).toBe("building");
  });

  it("loads src with a type override and reports load errors", async () => {
    const el = mount(`<swarm-loom src="data:application/octet-stream,hello" type="fake"></swarm-loom>`);
    await vi.waitFor(() => expect(players).toHaveLength(1));
    expect(new TextDecoder().decode(inputs[0]?.bytes)).toBe("hello");
    expect(players[0]?.calls).toEqual([]);

    const errors = record(el, ["swarm-error"]);
    el.setAttribute("type", "nope");
    await vi.waitFor(() => expect(errors).toHaveLength(1));
    const error = (errors[0]?.detail as { error: Error & { code?: string } } | undefined)?.error;
    expect(error?.code).toBe("unsupported");
    const message = el.shadowRoot?.querySelector('[role="alert"]');
    expect(message?.textContent).toContain('Unknown format "nope"');
    expect(getComputedStyle(message as Element).display).toBe("block");
  });

  it("resolves load() made before connection once connected", async () => {
    const el = document.createElement("swarm-loom");
    let settled = false;
    const done = el.load({ name: "a.fake", text: "x" }).then(() => {
      settled = true;
    });
    await new Promise((r) => setTimeout(r, 10));
    expect(settled).toBe(false);
    document.body.append(el);
    await done;
    expect(players).toHaveLength(1);
    expect(inputs[0]).toMatchObject({ name: "a.fake" });
  });

  it("starts with inview when scrolled into view and pauses when it leaves", async () => {
    const el = mount(
      `<div style="height:3000px"></div><swarm-loom inview style="height:200px"><p>Below</p></swarm-loom>`,
    );
    await vi.waitFor(() => expect(players).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 50));
    expect(players[0]?.calls).toEqual([]);

    el.scrollIntoView({ block: "center" });
    await vi.waitFor(() => expect(players[0]?.calls).toEqual(["play"]));
    window.scrollTo(0, 0);
    await vi.waitFor(() => expect(players[0]?.calls).toEqual(["play", "pause"]));
    el.scrollIntoView({ block: "center" });
    await vi.waitFor(() => expect(players[0]?.calls).toEqual(["play", "pause", "resume"]));
  });
});
