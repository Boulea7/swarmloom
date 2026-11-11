import { expect, it, vi } from "vitest";
import { mountStudio } from "../src/app";
import { fakeServices } from "./fakes";

// The German strings chunk fails to load, as it does offline before it was cached.
vi.mock("../src/i18n/messages/de", () => {
  throw new Error("offline");
});

it("switches the whole page to English when the chosen language cannot load", async () => {
  history.replaceState(null, "", "/?lang=de");
  const root = document.createElement("div");
  document.body.append(root);
  const { services } = fakeServices({ manifest: { version: 1, entries: [] }, examplesBase: "https://studio.test/x/" });
  const core = vi.fn((locale: string) => ({ locale, t: (key: string) => key }));
  const app = await mountStudio(root, { ...services, coreI18n: core });
  try {
    expect([document.documentElement.lang, app.context.i18n.locale]).toEqual(["en", "en"]);
    expect(core).toHaveBeenCalledWith("en");
  } finally {
    app.destroy();
    root.remove();
  }
});
