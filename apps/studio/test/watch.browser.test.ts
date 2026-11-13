import type { PlayerEvent } from "@swarmloom/core";
import { afterEach, expect, it } from "vitest";
import { cdp, page, userEvent } from "vitest/browser";
import "../src/styles/studio.css";
import { mountStudio, type StudioApp } from "../src/app";
import { routeToUrl } from "../src/route";
import type { OpenedSource } from "../src/source";
import { MIN_MODULE_PX, qrCode } from "../src/views/qr";
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
  { size: 100, phase: "idle", titled: false, square: true },
])("keeps every $phase control of a $size px face inside its safe area", async (row) => {
  const { size, phase, titled } = row;
  await page.viewport(size, size);
  try {
    const title = "Willkommen bei SwarmLoom: so entsteht eine Seite";
    const root = await mountWatch(row.square ? "?watch=1" : "?watch=1&round=1", phase === "playing", title);
    const face = root.querySelector<HTMLElement>(".view-watch");
    if (phase !== "idle") {
      root.querySelector<HTMLButtonElement>(".watch-play")?.click();
      await expect.poll(() => face?.dataset.phase).toBe(phase);
    }
    const safe = root.querySelector<HTMLElement>(".watch-safe")?.getBoundingClientRect();
    const heading = root.querySelector<HTMLElement>(".watch-title");
    if (!safe || !heading) throw new Error("no watch face");
    // Play, Next and phone always render; the title only where it fits (elsewhere it is a 1 px box
    // for screen readers). Without this, controls that all vanished would pass the bounds checks
    // below (no rects: top Infinity, bottom -Infinity).
    const shown = (el: Element) => el.getBoundingClientRect().width > 1;
    const buttons = [...root.querySelectorAll<HTMLElement>(".watch-play, .watch-actions > *")];
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
    expect([shown(heading), ...buttons.map(shown)]).toEqual([titled, true, true, true]);
  } finally {
    await page.viewport(414, 896);
  }
});

type AXNode = {
  nodeId: string;
  parentId?: string;
  ignored: boolean;
  role?: { value: string };
  name?: { value: string };
  description?: { value: string };
  properties?: { name: string; value: { value: unknown } }[];
};

/** What a screen reader gets from this test's frame: its accessibility tree (ignored nodes marked). */
async function axTree(): Promise<AXNode[]> {
  type Frame = { frame: { id: string; url: string }; childFrames?: Frame[] };
  const { frameTree } = (await cdp().send("Page.getFrameTree")) as { frameTree: Frame };
  const frames = (tree: Frame): Frame["frame"][] => [tree.frame, ...(tree.childFrames ?? []).flatMap(frames)];
  const frameId = frames(frameTree).find((frame) => frame.url === location.href)?.id;
  const { nodes } = (await cdp().send("Accessibility.getFullAXTree", { frameId })) as { nodes: AXNode[] };
  return nodes;
}

/** The text a screen reader reads, each with how it announces a change there: "polite", "off" or "none". */
async function spoken(): Promise<[string | undefined, unknown][]> {
  const nodes = await axTree();
  const byId = new Map(nodes.map((node) => [node.nodeId, node]));
  // The live region a text sits in sets the politeness, from the nearest ancestor that has one.
  const live = (node: AXNode | undefined): unknown =>
    node && (node.properties?.find((p) => p.name === "live")?.value.value ?? live(byId.get(node.parentId ?? "")));
  return nodes
    .filter((node) => !node.ignored && node.role?.value === "StaticText")
    .map((node) => [node.name?.value, live(node) ?? "none"]);
}

// The poster is decorative: off screen or not, the title is what names the example to a screen
// reader, and Next says the new one.
it("names the example to a screen reader on a face too small for its title", async () => {
  await page.viewport(140, 140);
  try {
    const root = await mountWatch("?watch=1&round=1");
    const face = root.querySelector<HTMLElement>(".view-watch");
    const title = root.querySelector(".watch-title");
    const first = title?.textContent;
    expect(await spoken()).toContainEqual([first, "none"]);
    root.querySelector<HTMLButtonElement>(".watch-actions button:first-child")?.click();
    await expect.poll(() => face?.dataset.phase).toBe("playing");
    expect(title?.textContent).not.toBe(first);
    expect(await spoken()).toContainEqual([title?.textContent, "polite"]);
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

// A source URL may run to 4096 characters and a #d= payload to 16 KB; a QR code holds about 2.3 KB.
// A small face draws a code too small to scan sooner: 400 characters fit a code, not its 37 px there.
it.each([
  { length: 3000, size: 0, dpr: 1 },
  { length: 400, size: 100, dpr: 2 },
])("says a $length-character link is too long for a QR code instead of throwing", async ({ length, size, dpr }) => {
  if (size) {
    await page.viewport(size, size);
    await cdp().send("Emulation.setDeviceMetricsOverride", {
      width: size,
      height: size,
      deviceScaleFactor: dpr,
      mobile: false,
    });
  }
  try {
    const src = `http://example.invalid/${"a".repeat(length)}`;
    history.replaceState(null, "", `${location.pathname}?watch=1&round=1&src=${encodeURIComponent(src)}`);
    const root = document.createElement("div");
    document.body.append(root);
    const manifest = { version: 1 as const, entries: [] };
    const fetch = async () => new Response("", { status: 404 });
    app = await mountStudio(
      root,
      fakeServices({ manifest, examplesBase: `${location.origin}/examples/`, fetch }).services,
    );
    root.querySelector<HTMLButtonElement>(".watch-actions button:last-child")?.click();

    expect(root.querySelector(".watch-qr")?.matches(":modal")).toBe(true);
    expect(root.querySelector(".watch-qr svg.qr")).toBeNull();
    expect(root.querySelector(".watch-qr-caption")?.textContent).toBe(app.context.i18n.t("watch.tooLong"));
  } finally {
    if (size) {
      await cdp().send("Emulation.clearDeviceMetricsOverride");
      await page.viewport(414, 896);
    }
  }
});

// The smallest round face holds three lines of notice above the close button: the rest scrolls.
it("scrolls a notice too long for the smallest face to its end", async () => {
  await page.viewport(100, 100);
  try {
    const src = `http://example.invalid/${"a".repeat(3000)}`;
    history.replaceState(null, "", `${location.pathname}?watch=1&round=1&lang=de&src=${encodeURIComponent(src)}`);
    const root = document.createElement("div");
    document.body.append(root);
    const manifest = { version: 1 as const, entries: [] };
    const fetch = async () => new Response("", { status: 404 });
    app = await mountStudio(
      root,
      fakeServices({ manifest, examplesBase: `${location.origin}/examples/`, fetch }).services,
    );
    root.querySelector<HTMLButtonElement>(".watch-actions button:last-child")?.click();

    const dialog = root.querySelector<HTMLElement>(".watch-qr");
    const notice = root.querySelector<HTMLElement>(".watch-qr-caption[data-notice]");
    if (!dialog || !notice) throw new Error("no notice");
    expect(notice.textContent).toBe("Dieser Link ist zu lang für einen QR-Code.");
    expect(notice.scrollHeight).toBeGreaterThan(notice.clientHeight);
    const box = dialog.getBoundingClientRect();
    const safe = parseFloat(getComputedStyle(dialog).paddingTop);
    const shown = notice.getBoundingClientRect();
    expect(shown.top).toBeGreaterThanOrEqual(box.top + safe - 0.5);
    expect(shown.bottom).toBeLessThanOrEqual(box.bottom - safe + 0.5);
    await userEvent.wheel(notice, { delta: { y: 100 } });
    await expect.poll(() => notice.scrollTop + notice.clientHeight).toBeGreaterThanOrEqual(notice.scrollHeight - 1);
  } finally {
    await page.viewport(414, 896);
  }
});

// A QR code holds 2.3 KB, but past ~650 bytes its modules get too small to scan off a watch face.
it("keeps the watch QR code small enough to scan, with a notice for a longer #d= link", async () => {
  history.replaceState(null, "", `${location.pathname}?watch=1`);
  const root = document.createElement("div");
  document.body.append(root);
  const manifest = { version: 1 as const, entries: [] };
  app = await mountStudio(root, fakeServices({ manifest, examplesBase: `${location.origin}/examples/` }).services);
  // 1000 characters that barely compress: a link of about 1.2 KB, a valid share but past the cap.
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let x = 1;
  const text = Array.from({ length: 1000 }, () => {
    x = (x * 48271) % 2147483647;
    return chars[x % 62];
  }).join("");
  const local = { name: "notes.md", text };
  const opened = { ref: { kind: "file", name: local.name }, name: local.name, text } as OpenedSource;
  expect((await buildShareLink(opened, app.context.settings, `${location.origin}${location.pathname}`)).ok).toBe(true);
  app.context.navigate({ source: { kind: "file", name: local.name }, autoplay: true }, { local });
  root.querySelector<HTMLButtonElement>(".watch-actions button:last-child")?.click();

  const caption = root.querySelector(".watch-qr-caption");
  await expect.poll(() => caption?.textContent).toBe(app.context.i18n.t("watch.tooLong"));
  expect(root.querySelector(".watch-qr svg.qr")).toBeNull();
});

// Watches this small have dense screens: three device pixels a CSS pixel, two on larger faces.
it.each([
  { size: 100, round: true, dpr: 3 },
  { size: 140, round: true, dpr: 3 },
  { size: 200, round: false, dpr: 2 },
])("keeps the QR dialog of a $size px face (round: $round) inside its safe area", async ({ size, round, dpr }) => {
  await page.viewport(size, size);
  await cdp().send("Emulation.setDeviceMetricsOverride", {
    width: size,
    height: size,
    deviceScaleFactor: dpr,
    mobile: false,
  });
  try {
    const root = await mountWatch(round ? "?watch=1&round=1" : "?watch=1", false);
    root.querySelector<HTMLButtonElement>(".watch-actions button:last-child")?.click();
    const dialog = root.querySelector<HTMLElement>(".watch-qr");
    const svg = root.querySelector<SVGSVGElement>(".watch-qr svg.qr");
    const code = svg?.getBoundingClientRect();
    if (!dialog || !svg || !code) throw new Error("no QR code");
    const box = dialog.getBoundingClientRect();
    const safe = parseFloat(getComputedStyle(dialog).paddingTop);
    expect(dialog.scrollHeight).toBeLessThanOrEqual(dialog.clientHeight);
    // Nothing reaches past the safe area, where the circle or the dialog would crop the finder patterns.
    const parts = [code, ...[...dialog.children].map((el) => el.getBoundingClientRect())].filter((r) => r.height);
    for (const part of parts) {
      expect(part.top).toBeGreaterThanOrEqual(box.top + safe - 0.5);
      expect(part.bottom).toBeLessThanOrEqual(box.bottom - safe + 0.5);
    }
    // ...and the code stays large enough to scan: it fills its room, with modules a phone can read.
    expect(code.width).toBeGreaterThanOrEqual(0.4 * (box.height - 2 * safe));
    expect((code.width * devicePixelRatio) / svg.viewBox.baseVal.width).toBeGreaterThanOrEqual(MIN_MODULE_PX);
  } finally {
    await cdp().send("Emulation.clearDeviceMetricsOverride");
    await page.viewport(414, 896);
  }
});
