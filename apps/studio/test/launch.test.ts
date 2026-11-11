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

it("leaves ?launch=1 for home and says why when the launched file cannot be read", async () => {
  history.replaceState(null, "", "/?lang=en&launch=1");
  const root = document.createElement("div");
  document.body.append(root);
  const { services } = fakeServices({ manifest: { version: 1, entries: [] }, examplesBase: "https://studio.test/x/" });
  let consumer: ((files: Promise<File[]>) => void) | undefined;
  services.onLaunch = (fn) => {
    consumer = fn;
  };
  app = await mountStudio(root, services);

  consumer?.(Promise.resolve([new File([], "empty.lottie")]));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(root.querySelector(".toast-text")?.textContent).toBe("This file is empty.");
  expect(location.search).toBe("?lang=en");
  expect(document.documentElement.dataset.view).toBe("home");
});
