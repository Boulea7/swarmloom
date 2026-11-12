import type { PlayerEvent } from "@swarmloom/core";
import { afterEach, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import "../src/styles/studio.css";
import { mountStudio, type StudioApp } from "../src/app";
import { routeToUrl } from "../src/route";
import type { OpenedSource } from "../src/source";
import { qrCode } from "../src/views/qr";
import { buildShareLink } from "../src/views/share-link";
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

it("hands the phone the settings the watch plays with, not the wrist-only ones", async () => {
  history.replaceState(
    null,
    "",
    `${location.pathname}?watch=1&example=notes&opening=1&live-top=1&intro=outline&speed=3`,
  );
  const root = document.createElement("div");
  document.body.append(root);
  const manifest = {
    version: 1 as const,
    entries: [{ id: "notes", path: "notes.md", format: "markdown", title: "Notes", size: 64, group: "notes" }],
  };
  app = await mountStudio(root, fakeServices({ manifest, examplesBase: `${location.origin}/examples/` }).services);

  root.querySelector<HTMLButtonElement>(".watch-actions button:last-child")?.click();
  // The rest at their defaults too: the phone's own saved settings must not replace them.
  const overrides = {
    agents: "auto",
    speed: 3,
    seed: 1,
    labels: "names",
    finale: "flock",
    intro: "outline",
    follow: "tour",
    opening: true,
    liveTop: true,
  } as const;
  const url = routeToUrl(
    { source: { kind: "example", id: "notes" }, autoplay: true, overrides },
    `${location.origin}${location.pathname}`,
  );
  // The QR code is drawn from the link alone: the same modules mean the same link.
  const modules = (svg: Element | null | undefined) => svg?.querySelector("path")?.getAttribute("d");
  expect(modules(root.querySelector(".watch-qr svg"))).toBe(modules(qrCode(url, "")));
});

/**
 * Mounts the watch face at `query`, with two examples (so **Next** shows), the first called `title`.
 * With `hold`, the build keeps running, so the controls are due to fade; without, it finishes as
 * soon as it starts. A player state instead ends the first build in that state, as the engine
 * reports "finale" or "done" (a resume after a pause returns there), and holds every later one.
 */
async function mountWatch(
  query: string,
  hold: boolean | "finale" | "done" = true,
  title = "Notes",
): Promise<HTMLElement> {
  history.replaceState(null, "", `${location.pathname}${query}`);
  const root = document.createElement("div");
  document.body.append(root);
  const manifest = {
    version: 1 as const,
    entries: [
      { id: "notes", path: "notes.md", format: "markdown", title, size: 64, group: "notes" },
      { id: "more", path: "more.md", format: "markdown", title: "More", size: 64, group: "more" },
    ],
  };
  const fake = fakeServices({
    manifest,
    examplesBase: `${location.origin}/examples/`,
    fetch: async () => new Response("# Notes\n"),
  });
  const createPlayer = fake.services.createPlayer;
  let end = typeof hold === "string" ? hold : undefined;
  if (hold)
    fake.services.createPlayer = (options) => {
      const finish = end;
      end = undefined;
      let report: ((event: PlayerEvent) => void) | undefined;
      return new Proxy(createPlayer(options), {
        get: (player, key) => {
          if (key === "on")
            return (type: PlayerEvent["type"], fn: (event: PlayerEvent) => void) => {
              if (type === "state") report = fn;
              return player.on(type, fn);
            };
          if (key === "play")
            return () =>
              player
                .play()
                .then(() => (finish ? report?.({ type: "state", state: finish }) : new Promise<void>(() => undefined)));
          if (key === "resume" && finish) return () => report?.({ type: "state", state: finish });
          return Reflect.get(player, key);
        },
      });
    };
  app = await mountStudio(root, fake.services);
  return root;
}

it("keeps the faded watch controls on screen while one has keyboard focus", async () => {
  const root = await mountWatch("?watch=1");

  const play = root.querySelector<HTMLButtonElement>(".watch-play");
  for (let i = 0; i < 4 && document.activeElement !== play; i++) await userEvent.keyboard("{Tab}");
  expect(play?.matches(":focus-visible")).toBe(true);
  await userEvent.keyboard("{Enter}");
  const face = root.querySelector<HTMLElement>(".view-watch");
  await expect.poll(() => face?.dataset.playing).toBe("true");
  await new Promise((resolve) => setTimeout(resolve, 2900)); // past the 2.6 s fade-out delay
  expect([face?.dataset.controls, document.activeElement]).toEqual(["shown", play]);
});

it.each([
  { press: "pause", end: "finale", phase: "done" },
  { press: "replay", end: "done", phase: "playing" },
] as const)("stays on the example when the wearer presses $press at the end", async ({ press, end, phase }) => {
  const root = await mountWatch("?watch=1", end);
  const face = root.querySelector<HTMLElement>(".view-watch");
  const title = root.querySelector(".watch-title");
  const play = root.querySelector<HTMLButtonElement>(".watch-play");
  const example = title?.textContent;
  play?.click();
  await expect.poll(() => face?.dataset.phase).toBe("done");
  play?.click();
  await new Promise((resolve) => setTimeout(resolve, 2900)); // past the 2.4 s move to the next example
  expect([title?.textContent, face?.dataset.phase]).toEqual([example, phase]);
  if (press !== "pause") return;
  play?.click(); // resume: the finale plays out and the face moves on again
  await expect.poll(() => title?.textContent, { timeout: 4000 }).not.toBe(example);
});

it("plays a round face inside its inscribed square and clears the controls soon after resume", async () => {
  const root = await mountWatch("?watch=1&round=1");
  const face = root.querySelector<HTMLElement>(".view-watch");
  const play = root.querySelector<HTMLButtonElement>(".watch-play");
  play?.click();
  await expect.poll(() => face?.dataset.playing).toBe("true");
  const outer = root.querySelector(".watch-face")?.getBoundingClientRect().width ?? 0;
  const stage = root.querySelector(".watch-stage")?.getBoundingClientRect().width ?? 0;
  expect(stage / outer).toBeCloseTo(1 / Math.SQRT2, 2);

  play?.click(); // pause
  play?.click(); // resume
  expect(face?.dataset.controls).toBe("shown");
  await new Promise((resolve) => setTimeout(resolve, 1000)); // well before the 2.6 s fade after a touch
  expect(face?.dataset.controls).toBe("hidden");
});

it.each([
  { size: 180, phase: "idle", titled: true },
  { size: 180, phase: "done", titled: true },
  { size: 140, phase: "idle", titled: false },
  { size: 100, phase: "idle", titled: false },
  { size: 140, phase: "playing", titled: false },
  { size: 100, phase: "playing", titled: false },
])("keeps every $phase control of a $size px round face inside its inscribed square", async (row) => {
  const { size, phase, titled } = row;
  await page.viewport(size, size);
  try {
    const title = "Willkommen bei SwarmLoom: so entsteht eine Seite";
    const root = await mountWatch("?watch=1&round=1", phase === "playing", title);
    const face = root.querySelector<HTMLElement>(".view-watch");
    if (phase !== "idle") {
      root.querySelector<HTMLButtonElement>(".watch-play")?.click();
      await expect.poll(() => face?.dataset.phase).toBe(phase);
    }
    const safe = root.querySelector<HTMLElement>(".watch-safe")?.getBoundingClientRect();
    const heading = root.querySelector<HTMLElement>(".watch-title");
    if (!safe || !heading) throw new Error("no watch face");
    // Play, Next and phone always render; the title only where it fits. Without this, controls that
    // all vanished would pass the bounds checks below (no rects: top Infinity, bottom -Infinity).
    const shown = (el: Element) => el.getClientRects().length > 0;
    const buttons = [...root.querySelectorAll<HTMLElement>(".watch-play, .watch-actions > *")];
    expect([shown(heading), ...buttons.map(shown)]).toEqual([titled, true, true, true]);
    // A long title keeps to one line.
    const line = parseFloat(getComputedStyle(heading).lineHeight);
    if (titled) expect(heading.getBoundingClientRect().height).toBeLessThan(line * 2);
    const controls = [...root.querySelectorAll<HTMLElement>(".watch-safe > *, .watch-actions > *")]
      .filter(shown)
      .map((el) => el.getBoundingClientRect());
    const bounds = {
      top: Math.min(...controls.map((r) => r.top)),
      right: Math.max(...controls.map((r) => r.right)),
      bottom: Math.max(...controls.map((r) => r.bottom)),
      left: Math.min(...controls.map((r) => r.left)),
    };
    expect(bounds.top).toBeGreaterThanOrEqual(safe.top - 0.5);
    expect(bounds.right).toBeLessThanOrEqual(safe.right + 0.5);
    expect(bounds.bottom).toBeLessThanOrEqual(safe.bottom + 0.5);
    expect(bounds.left).toBeGreaterThanOrEqual(safe.left - 0.5);
  } finally {
    await page.viewport(414, 896);
  }
});

it("keeps the title and small buttons on a dark backing over a finished page", async () => {
  const root = await mountWatch("?watch=1&round=1", false);
  const face = root.querySelector<HTMLElement>(".view-watch");
  root.querySelector<HTMLButtonElement>(".watch-play")?.click();
  await expect.poll(() => face?.dataset.phase).toBe("done");
  // The poster is gone and the finished page, often white, sits right behind the end card.
  const probe = face?.appendChild(document.createElement("i"));
  probe?.style.setProperty("background-color", "var(--watch-scrim)");
  const scrim = probe && getComputedStyle(probe).backgroundColor;
  const covered = [...root.querySelectorAll<HTMLElement>(".watch-title, .watch-actions .watch-icon-btn")];
  expect(covered.map((el) => getComputedStyle(el).backgroundColor)).toEqual(covered.map(() => scrim));
});

// A local file or pasted text has no address the phone could open: it travels in the link, as with Share.
it("hands the phone a local file inside the link, not the bare Studio page", async () => {
  history.replaceState(null, "", `${location.pathname}?watch=1`);
  const root = document.createElement("div");
  document.body.append(root);
  const manifest = { version: 1 as const, entries: [] };
  app = await mountStudio(root, fakeServices({ manifest, examplesBase: `${location.origin}/examples/` }).services);
  const local = { name: "notes.md", text: "# Notes\n" };
  app.context.navigate({ source: { kind: "file", name: local.name }, autoplay: true }, { local });
  root.querySelector<HTMLButtonElement>(".watch-actions button:last-child")?.click();

  const opened = { ref: { kind: "file", name: local.name }, name: local.name, text: local.text } as OpenedSource;
  const link = await buildShareLink(opened, app.context.settings, `${location.origin}${location.pathname}`);
  if (!link.ok) throw new Error(link.reason);
  const modules = (svg: Element | null | undefined) => svg?.querySelector("path")?.getAttribute("d");
  await expect.poll(() => modules(root.querySelector(".watch-qr svg"))).toBe(modules(qrCode(link.url, "")));
});

it.each([
  { size: 100, round: true },
  { size: 140, round: true },
  { size: 200, round: false },
])("keeps the QR dialog of a $size px face (round: $round) inside its safe area", async ({ size, round }) => {
  await page.viewport(size, size);
  try {
    const root = await mountWatch(round ? "?watch=1&round=1" : "?watch=1", false);
    root.querySelector<HTMLButtonElement>(".watch-actions button:last-child")?.click();
    const dialog = root.querySelector<HTMLElement>(".watch-qr");
    const code = root.querySelector(".watch-qr svg")?.getBoundingClientRect();
    if (!dialog || !code) throw new Error("no QR code");
    const box = dialog.getBoundingClientRect();
    const safe = parseFloat(getComputedStyle(dialog).paddingTop);
    expect(dialog.scrollHeight).toBeLessThanOrEqual(dialog.clientHeight);
    // Nothing reaches past the safe area, where the circle or the dialog would crop the finder patterns.
    const parts = [code, ...[...dialog.children].map((el) => el.getBoundingClientRect())].filter((r) => r.height);
    for (const part of parts) {
      expect(part.top).toBeGreaterThanOrEqual(box.top + safe - 0.5);
      expect(part.bottom).toBeLessThanOrEqual(box.bottom - safe + 0.5);
    }
    // ...and the code stays large enough to scan.
    expect(code.width).toBeGreaterThanOrEqual(0.4 * (box.height - 2 * safe));
  } finally {
    await page.viewport(414, 896);
  }
});
