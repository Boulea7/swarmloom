import type { LoadedSource } from "@swarmloom/core";
import { afterEach, expect, it } from "vitest";
import { mountStudio, type StudioApp } from "../src/app";
import { fakeServices } from "./fakes";

let app: StudioApp | null = null;

afterEach(() => {
  app?.destroy();
  app = null;
  document.body.replaceChildren();
  history.replaceState(null, "", "/");
});

it("tells the user what the adapter removed or approximated", async () => {
  history.replaceState(null, "", "/?lang=en&src=https://example.test/loop.lottie");
  const root = document.createElement("div");
  document.body.append(root);
  const { services } = fakeServices({
    manifest: { version: 1, entries: [] },
    examplesBase: "https://studio.test/examples/",
    fetch: async () => new Response(new Uint8Array([0x50, 0x4b, 0x03, 0x04])),
  });
  const load = services.load;
  // Like the Lottie adapter's result: plain-English notes next to the blueprint.
  const notes = ["1 expression(s) were ignored.", "1 audio or data asset(s) were removed."];
  services.load = async (input, ctx): Promise<LoadedSource> => ({ ...(await load(input, ctx)), notes }) as LoadedSource;
  app = await mountStudio(root, services);

  const notice = await new Promise<HTMLElement>((resolve, reject) => {
    const start = Date.now();
    const poll = () => {
      const found = root.querySelector<HTMLElement>(".player-notice:not([hidden])");
      if (found) resolve(found);
      else if (Date.now() - start > 4000) reject(new Error("no notice"));
      else setTimeout(poll, 20);
    };
    poll();
  });
  expect(notice.querySelector(":scope > span")?.textContent).toBe(
    "Shown with some changes: 1 expression(s) were ignored. 1 audio or data asset(s) were removed.",
  );
});
