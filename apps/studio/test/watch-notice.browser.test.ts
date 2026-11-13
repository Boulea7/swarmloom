import { afterEach, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import "../src/styles/studio.css";
import { mountStudio, type StudioApp } from "../src/app";
import { fakeServices } from "./fakes";

/**
 * The watch QR dialog's cases that also run in Firefox and WebKit (vitest.config.ts): keyboard focus
 * and scrolling differ by engine there, and watch.browser.test.ts uses Chromium's CDP elsewhere.
 */

let app: StudioApp | null = null;

afterEach(() => {
  app?.destroy();
  app = null;
  document.body.replaceChildren();
  history.replaceState(null, "", location.pathname);
});

// The smallest round face holds three lines of notice above the close button: the rest scrolls, by
// keyboard too in engines that make no scroller a tab stop (WebKit), so the notice is one itself.
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
    expect(notice.getAttribute("tabindex")).toBe("0");
    await userEvent.keyboard("{Shift>}{Tab}{/Shift}");
    expect(document.activeElement).toBe(notice);
    await userEvent.keyboard("{End}");
    await expect.poll(() => notice.scrollTop + notice.clientHeight).toBeGreaterThanOrEqual(notice.scrollHeight - 1);
  } finally {
    await page.viewport(414, 896);
  }
});
