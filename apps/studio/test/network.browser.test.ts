import { load } from "@swarmloom/formats";
import { describe, expect, it } from "vitest";
import { EMPTY_MANIFEST } from "../src/examples/manifest";
import { Session } from "../src/session";
import { DEFAULT_SETTINGS } from "../src/settings";
import { fakeServices } from "./fakes";

const PAGE = '<!doctype html><title>Hello</title><p>Hello loom<img src="https://tracker.example/p.png" alt=""></p>';

describe("Studio network setting (decisions-v1 C03)", () => {
  it("keeps remote images out of an HTML page when web images and fonts are off", async () => {
    const { services } = fakeServices({ manifest: EMPTY_MANIFEST, examplesBase: location.origin });
    const host = document.createElement("div");
    document.body.append(host);
    // The real formats loader, wired as main.ts wires it; only the player is a fake.
    const session = new Session({
      services: { ...services, load: (input, ctx) => load(input, ctx) },
      host,
      ref: { kind: "file", name: "page.html" },
      local: { name: "page.html", text: PAGE },
      settings: { ...DEFAULT_SETTINGS, remoteAssets: false },
      locale: "en",
      scheme: "light",
      onPhase: () => undefined,
    });
    try {
      await session.open();
      const blueprint = JSON.stringify(session.loaded?.blueprint ?? null);
      expect(blueprint).toContain("Hello loom");
      expect(blueprint).not.toContain("tracker.example");
    } finally {
      session.destroy();
      host.remove();
    }
  });
});
