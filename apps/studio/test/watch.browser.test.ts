import { afterEach, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
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

/**
 * Mounts the watch face at `query`, with two examples (so **Next** shows), the first called `title`.
 * With `hold`, the build keeps running, so the controls are due to fade; without, it finishes as
 * soon as it starts.
 */
async function mountWatch(query: string, hold = true, title = "Notes"): Promise<HTMLElement> {
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
  if (hold)
    fake.services.createPlayer = (options) =>
      new Proxy(createPlayer(options), {
        get: (player, key) =>
          key === "play"
            ? () => player.play().then(() => new Promise<void>(() => undefined))
            : Reflect.get(player, key),
      });
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
