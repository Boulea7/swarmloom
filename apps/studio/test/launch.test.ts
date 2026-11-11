import { afterEach, expect, it } from "vitest";
import { mountStudio, type StudioApp } from "../src/app";
import { launchHandler } from "../src/pwa";
import { fakeServices } from "./fakes";

let app: StudioApp | null = null;

afterEach(() => {
  app?.destroy();
  app = null;
  document.body.replaceChildren();
  history.replaceState(null, "", "/");
});

type Consumer = (params: { files: readonly FileSystemFileHandle[] }) => void;

it.each([
  ["the OS refuses the handle", () => Promise.reject(new Error("Permission denied")), "Permission denied"],
  ["the file is empty", () => Promise.resolve(new File([], "empty.lottie")), "This file is empty."],
])("leaves ?launch=1 for home and says why when %s", async (_, getFile, reason) => {
  history.replaceState(null, "", "/?lang=en&launch=1");
  const root = document.createElement("div");
  document.body.append(root);
  const { services } = fakeServices({ manifest: { version: 1, entries: [] }, examplesBase: "https://studio.test/x/" });
  let consumer: Consumer | undefined;
  const queue = { setConsumer: (fn: Consumer) => (consumer = fn) };
  services.onLaunch = launchHandler({ launchQueue: queue } as unknown as Window);
  app = await mountStudio(root, services);

  consumer?.({ files: [{ getFile } as unknown as FileSystemFileHandle] });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(root.querySelector(".toast-text")?.textContent).toContain(reason);
  expect(location.search).toBe("?lang=en");
  expect(document.documentElement.dataset.view).toBe("home");
});
