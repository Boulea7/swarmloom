import { afterEach, expect, it, vi } from "vitest";
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

it("does not take the view back from a user who moved on before the launched file arrived", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  try {
    history.replaceState(null, "", "/?lang=en&launch=1");
    const root = document.createElement("div");
    document.body.append(root);
    const { services } = fakeServices({
      manifest: { version: 1, entries: [] },
      examplesBase: "https://studio.test/x/",
    });
    let consumer: Consumer | undefined;
    const queue = { setConsumer: (fn: Consumer) => (consumer = fn) };
    services.onLaunch = launchHandler({ launchQueue: queue } as unknown as Window);
    app = await mountStudio(root, services);

    let deliver: (file: File) => void = () => {};
    const getFile = () => new Promise<File>((resolve) => (deliver = resolve));
    consumer?.({ files: [{ getFile } as unknown as FileSystemFileHandle] });
    // Meanwhile the user opens a file of their own from home.
    const mine = { name: "mine.md", text: "# Mine" };
    app.context.navigate({ source: { kind: "file", name: mine.name }, autoplay: true }, { local: mine });

    // The wait for the OS no longer sends the user home.
    await vi.advanceTimersByTimeAsync(4000);
    expect(location.search).toContain("file=mine.md");
    // The late file is offered, not forced over the user's choice.
    deliver(new File(["# Late"], "late-launch.md", { type: "text/markdown" }));
    await vi.advanceTimersByTimeAsync(0);
    expect(location.search).toContain("file=mine.md");
    expect(root.querySelector(".toast-text")?.textContent).toContain("late-launch.md");
    root.querySelector<HTMLButtonElement>(".toast-action")?.click();
    expect(location.search).toContain("file=late-launch.md");
  } finally {
    vi.useRealTimers();
  }
});
