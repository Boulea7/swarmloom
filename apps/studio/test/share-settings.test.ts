import { afterEach, expect, it, vi } from "vitest";
import { mountStudio, type StudioApp } from "../src/app";
import { DEFAULT_SETTINGS } from "../src/settings";
import { decodeShare, encodeShare } from "../src/share";
import { fakeServices } from "./fakes";

let app: StudioApp | null = null;

afterEach(() => {
  app?.destroy();
  app = null;
  document.body.replaceChildren();
  history.replaceState(null, "", "/");
  vi.restoreAllMocks();
});

async function until<T>(probe: () => T | null | undefined): Promise<T> {
  for (let i = 0; i < 200; i++) {
    const value = probe();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("timed out");
}

const shared = { seed: 42, speed: 2, finale: "halo" } as const;
const { seed, speed, finale } = DEFAULT_SETTINGS;

/** Mounts Studio on a `#d=` link carrying {@link shared}, with the saved settings at their defaults. */
async function openLink() {
  const payload = await encodeShare({ name: "notes.md", text: "# N", settings: shared });
  history.replaceState(null, "", `/?lang=en#d=${payload}`);
  const root = document.createElement("div");
  document.body.append(root);
  const { services, log } = fakeServices({
    manifest: { version: 1, entries: [] },
    examplesBase: "https://studio.test/x/",
  });
  const studio = await mountStudio(root, services);
  app = studio;
  await until(() => root.querySelector(".play-big"));
  const byLabel = (label: string) => [...root.querySelectorAll("button")].find((b) => b.textContent === label);
  return { studio, log, byLabel };
}

it("shares a link's settings on, shows them, and lets Restore defaults clear them", async () => {
  const { studio, log, byLabel } = await openLink();
  // The settings panel shows what plays, not the saved defaults.
  expect(studio.context.settings).toMatchObject(shared);

  // Share again: the new link carries the same performance.
  const copied: string[] = [];
  vi.spyOn(navigator.clipboard, "writeText").mockImplementation(async (text) => void copied.push(text));
  byLabel("Share")?.click();
  const link = new URL(await until(() => copied[0]));
  expect((await decodeShare(new URLSearchParams(link.hash.slice(1)).get("d") ?? "")).settings).toEqual(shared);

  // Restore defaults while the saved settings already are the defaults.
  studio.context.toggleSettings();
  byLabel("Restore defaults")?.click();
  expect(studio.context.settings).toMatchObject({ seed, speed, finale });
  expect(log.players.at(-1)).toMatchObject({ seed, speed, finale });
});

it("leaves a link's settings behind with its view", async () => {
  const { studio } = await openLink();
  studio.context.navigate({ source: null });
  expect(studio.context.settings).toMatchObject({ seed, speed, finale });
});

it("takes speed, sound and tour changed on the player's toolbar into the panel, a share link and the next player", async () => {
  const { studio, log, byLabel } = await openLink();
  studio.context.toggleSettings();
  // What the toolbar and its shortcuts (3, M, T) call on the player.
  const player = log.created.at(-1);
  player?.setSpeed(3);
  player?.setSound(false);
  player?.setFollow("scroll");
  expect(studio.context.settings).toMatchObject({ speed: 3, sound: false, follow: "scroll" });
  // The open panel shows them.
  const checked = [...document.querySelectorAll<HTMLInputElement>(".panel-settings input[type=radio]:checked")];
  expect(checked.map((input) => input.value)).toEqual(expect.arrayContaining(["3", "scroll"]));

  const copied: string[] = [];
  vi.spyOn(navigator.clipboard, "writeText").mockImplementation(async (text) => void copied.push(text));
  byLabel("Share")?.click();
  const link = new URL(await until(() => copied[0]));
  const carried = (await decodeShare(new URLSearchParams(link.hash.slice(1)).get("d") ?? "")).settings;
  expect(carried).toMatchObject({ ...shared, speed: 3, follow: "scroll" });

  // A setting that needs a new player keeps the toolbar's choices.
  studio.context.updateSettings({ agents: 12 });
  expect(log.players.at(-1)).toMatchObject({ agents: 12, speed: 3, sound: false, follow: "scroll" });
});

it("brings an entry's URL settings back on Back, and drops the ones the user changed from its URL", async () => {
  history.replaceState(null, "", "/?lang=en&opening=1&live-top=1&intro=outline");
  const root = document.createElement("div");
  document.body.append(root);
  const { services } = fakeServices({ manifest: { version: 1, entries: [] }, examplesBase: "https://studio.test/x/" });
  const studio = await mountStudio(root, services);
  app = studio;
  const fromLink = { opening: true, liveTop: true, intro: "outline" } as const;
  studio.context.navigate({ source: null });
  studio.context.updateSettings({ opening: false, liveTop: false, intro: "warp" });
  expect(location.search).toBe("?lang=en");
  studio.context.toggleSettings();
  const opening = () =>
    [...document.querySelectorAll<HTMLInputElement>(".panel-settings .switch")].find(
      (input) => input.labels?.[0]?.textContent === "Show the original first",
    );

  history.back();
  await until(() => studio.context.settings.opening);
  expect(studio.context.settings).toMatchObject(fromLink);
  expect(opening()?.checked).toBe(true);
  history.forward();
  await until(() => !studio.context.settings.opening);
  expect(studio.context.settings).toMatchObject({ opening: false, liveTop: false, intro: "warp" });
});
