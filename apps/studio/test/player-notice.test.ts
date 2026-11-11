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

/** The notice text shown for a source whose adapter returned `notes`, in UI language `lang`. */
async function noticeFor(lang: string, notes: string[]): Promise<string | null | undefined> {
  history.replaceState(null, "", `/?lang=${lang}&src=https://example.test/loop.lottie`);
  const root = document.createElement("div");
  document.body.append(root);
  const { services } = fakeServices({
    manifest: { version: 1, entries: [] },
    examplesBase: "https://studio.test/examples/",
    fetch: async () => new Response(new Uint8Array([0x50, 0x4b, 0x03, 0x04])),
  });
  const load = services.load;
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
  return notice.querySelector(":scope > span")?.textContent;
}

it.each([
  // Like the Lottie adapter's result: plain-English notes Studio passes on.
  [
    "en",
    ["1 expression(s) were ignored.", "1 audio or data asset(s) were removed."],
    "Shown with some changes: 1 expression(s) were ignored. 1 audio or data asset(s) were removed.",
  ],
  // Font substitutions (Office and OpenDocument wordings) are reworded in the UI language.
  [
    "zh-CN",
    ["Fonts that are not installed are shown with open substitutes: Calibri → Carlito, SimSun → Noto Serif SC."],
    "部分内容有调整：本机缺少的字体已换成相近字体：Calibri → Carlito和SimSun → Noto Serif SC。",
  ],
  [
    "de",
    [
      "Fonts not installed on this device are shown with look-alikes (or the closest installed font): Aptos → a sans-serif font, Calibri -> Carlito and 2 more.",
    ],
    "Mit einigen Änderungen dargestellt: Auf diesem Gerät fehlende Schriften werden durch ähnliche ersetzt: Aptos → sans-serif, Calibri → Carlito und 2 weitere.",
  ],
])("tells the user (%s) what the adapter removed or approximated", async (lang, notes, expected) => {
  expect(await noticeFor(lang, notes)).toBe(expected);
});
