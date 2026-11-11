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
