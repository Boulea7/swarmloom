import { afterEach, describe, expect, it } from "vitest";
import { capturePoster, findMediaElements } from "../src/content/poster";
import { installTracker, meaningfulBlock } from "../src/content/tracker";
import { createOverlayUi, UI_TAG } from "../src/content/ui";
import { GLOBALS } from "../src/shared/messages";

const scope = globalThis as unknown as Record<string, unknown>;

function mount(html: string): HTMLElement {
  const box = document.createElement("div");
  box.innerHTML = html;
  document.body.append(box);
  return box;
}

afterEach(() => {
  for (const el of document.querySelectorAll(`${UI_TAG}, [data-test]`)) el.remove();
  delete scope[GLOBALS.target];
});

describe("media poster", () => {
  it("hides everything but media while capturing and restores the page exactly", async () => {
    const box = mount(
      `<p data-test>text</p><canvas data-test width="120" height="80" style="visibility: inherit"></canvas>`,
    );
    const canvas = box.querySelector("canvas") as HTMLCanvasElement;
    const text = box.querySelector("p") as HTMLElement;
    expect(findMediaElements(document, window)).toContain(canvas);
    const sheets = document.adoptedStyleSheets.length;

    let during: string[] = [];
    const shot = await capturePoster(document, window, {
      capture: async () => {
        during = [getComputedStyle(text).visibility, getComputedStyle(canvas).visibility];
        return "data:image/png;base64,AAAA";
      },
    });
    expect(during).toEqual(["hidden", "visible"]);
    expect(shot).toMatchObject({ src: "data:image/png;base64,AAAA", scrollX: window.scrollX, dpr: devicePixelRatio });
    expect([getComputedStyle(text).visibility, canvas.style.visibility]).toEqual(["visible", "inherit"]);
    expect(document.adoptedStyleSheets).toHaveLength(sheets);
    box.remove();
  });

  it("skips the capture when there is no media", async () => {
    let called = false;
    const capture = async () => {
      called = true;
      return null;
    };
    const shot = await capturePoster(document, window, { capture });
    expect([shot, called]).toEqual([null, false]);
  });
});

describe("element tracker", () => {
  it("remembers the right-clicked element and widens it to a meaningful block", () => {
    const box = mount(
      `<section data-test style="width:300px;height:200px"><p>Some <b id="word">bold</b> words</p></section>`,
    );
    const word = box.querySelector("#word") as HTMLElement;
    const section = box.querySelector("section") as HTMLElement;
    expect(meaningfulBlock(word, document, window)).toBe(section);
    expect(meaningfulBlock(document.body, document, window)).toBeNull();

    const tracker = installTracker(scope, document, window, null);
    word.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, composed: true }));
    expect(tracker.resolve({})).toBe("found");
    expect(scope[GLOBALS.target]).toBe(section);
    box.remove();
  });

  it("falls back to a pick mode that Escape cancels", () => {
    const tracker = installTracker(scope, document, window, null);
    tracker.cancelPick();
    // The remembered element from the previous test is gone (disconnected).
    expect(tracker.resolve({ prompt: "Click a part of the page" })).toBe("picking");
    expect(tracker.picking).toBe(true);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(tracker.picking).toBe(false);
    expect(document.querySelector(UI_TAG)).toBeNull();
  });
});

describe("overlay ui", () => {
  it("focuses the primary action and restores focus on destroy", () => {
    const box = mount(`<button data-test id="before">before</button>`);
    const before = box.querySelector("button") as HTMLButtonElement;
    before.focus();
    const ui = createOverlayUi(document);
    let ran = "";
    ui.showError({
      title: "T",
      message: "M",
      actions: [
        { label: "Studio", run: () => (ran = "studio") },
        { label: "Retry", primary: true, run: () => (ran = "retry") },
      ],
      onDismiss: () => undefined,
    });
    const focused = ui.root.activeElement as HTMLButtonElement | null;
    expect(focused?.textContent).toBe("Retry");
    focused?.click();
    expect(ran).toBe("retry");
    ui.destroy();
    expect(document.activeElement).toBe(before);
    box.remove();
  });

  it("stays on top of, and usable over, a modal dialog the page has open (S01)", () => {
    const box = mount(
      `<dialog data-test style="width:100vw;height:100vh;max-width:none;max-height:none;margin:0">modal</dialog>`,
    );
    const dialog = box.querySelector("dialog") as HTMLDialogElement;
    dialog.showModal();
    const ui = createOverlayUi(document);
    ui.showStatus("Scanning");
    const host = document.querySelector(UI_TAG) as HTMLElement;
    expect(host.matches(":popover-open")).toBe(true);

    let ran = false;
    ui.showError({
      title: "T",
      message: "M",
      actions: [{ label: "Close", primary: true, run: () => (ran = true) }],
      onDismiss: () => undefined,
    });
    const button = ui.root.querySelector("button.primary") as HTMLButtonElement;
    const r = button.getBoundingClientRect();
    // Hit testing reaches our button, not the page's dialog (which would make it inert).
    expect(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)).toBe(host);
    button.click();
    expect(ran).toBe(true);
    ui.destroy();
    expect(dialog.open).toBe(true);
    dialog.close();
    box.remove();
  });
});
