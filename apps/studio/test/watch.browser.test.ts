import { afterEach, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import "../src/styles/studio.css";
import { mountStudio, type StudioApp } from "../src/app";
import { fakeServices } from "./fakes";

let app: StudioApp | null = null;

afterEach(() => {
  app?.destroy();
  app = null;
  document.body.replaceChildren();
  history.replaceState(null, "", location.pathname);
});

it("keeps focus inside the watch QR dialog until it closes", async () => {
  history.replaceState(null, "", `${location.pathname}?watch=1&round=1`);
  const root = document.createElement("div");
  document.body.append(root);
  const manifest = {
    version: 1 as const,
    entries: [{ id: "notes", path: "notes.md", format: "markdown", title: "Notes", size: 64, group: "notes" }],
  };
  app = await mountStudio(root, fakeServices({ manifest, examplesBase: `${location.origin}/examples/` }).services);

  const qr = root.querySelector<HTMLElement>(".watch-qr");
  const phone = root.querySelector<HTMLButtonElement>(".watch-actions button:last-child");
  phone?.click();
  const back = qr?.querySelector("button");
  expect(qr?.matches(":modal")).toBe(true);
  expect(document.activeElement).toBe(back);
  // Everything behind the dialog is inert, so neither Tab nor focus() reaches the covered controls.
  for (const covered of [
    root.querySelector<HTMLElement>(".watch-play"),
    root.querySelector<HTMLElement>(".skip-link"),
  ]) {
    covered?.focus();
    expect(document.activeElement).toBe(back);
  }

  await userEvent.keyboard("{Escape}");
  expect(qr?.matches(":modal")).toBe(false);
  expect(root.querySelector(".view-watch")?.getAttribute("data-qr")).toBe("false");
  expect(document.activeElement).toBe(phone);
});

it("keeps the faded watch controls on screen while one has keyboard focus", async () => {
  history.replaceState(null, "", `${location.pathname}?watch=1`);
  const root = document.createElement("div");
  document.body.append(root);
  const manifest = {
    version: 1 as const,
    entries: [{ id: "notes", path: "notes.md", format: "markdown", title: "Notes", size: 64, group: "notes" }],
  };
  const fake = fakeServices({
    manifest,
    examplesBase: `${location.origin}/examples/`,
    fetch: async () => new Response("# Notes\n"),
  });
  // A build that keeps running, so the controls are due to fade.
  const createPlayer = fake.services.createPlayer;
  fake.services.createPlayer = (options) =>
    new Proxy(createPlayer(options), {
      get: (player, key) =>
        key === "play" ? () => player.play().then(() => new Promise<void>(() => undefined)) : Reflect.get(player, key),
    });
  app = await mountStudio(root, fake.services);

  const play = root.querySelector<HTMLButtonElement>(".watch-play");
  for (let i = 0; i < 4 && document.activeElement !== play; i++) await userEvent.keyboard("{Tab}");
  expect(play?.matches(":focus-visible")).toBe(true);
  await userEvent.keyboard("{Enter}");
  const face = root.querySelector<HTMLElement>(".view-watch");
  await expect.poll(() => face?.dataset.playing).toBe("true");
  await new Promise((resolve) => setTimeout(resolve, 2900)); // past the 2.6 s fade-out delay
  expect([face?.dataset.controls, document.activeElement]).toEqual(["shown", play]);
});
