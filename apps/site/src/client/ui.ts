/** Copy buttons and the format strip arrows. */

import { announce } from "./env";

/**
 * Copies text to the clipboard. Falls back to a hidden textarea + execCommand on insecure origins
 * or older engines. Resolves false when both paths fail.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Permission denied or unavailable: try the legacy path below.
  }
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.append(area);
  area.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  area.remove();
  return ok;
}

/** Wires every `[data-copy="<id>"]` button to copy the text of `#<id>`. */
export function initCopy(): void {
  const timers = new WeakMap<HTMLElement, number>();
  document.addEventListener("click", async (event) => {
    const button = (event.target as Element | null)?.closest<HTMLButtonElement>("button[data-copy]");
    if (!button) return;
    const source = document.getElementById(button.dataset.copy ?? "");
    const label = button.querySelector<HTMLElement>("[data-copy-label]");
    const scope = button.closest<HTMLElement>("[data-copy-scope]");
    if (!source || !label || !scope) return;
    const idle = label.dataset.idle ?? label.textContent ?? "";
    label.dataset.idle = idle;
    const ok = await copyText(source.textContent ?? "");
    const message = (ok ? scope.dataset.copied : scope.dataset.copyFailed) ?? "";
    label.textContent = message;
    button.classList.toggle("is-done", ok);
    button.classList.toggle("is-failed", !ok);
    announce(message);
    if (!ok) {
      // Select the snippet so the visitor can copy it by hand.
      const range = document.createRange();
      range.selectNodeContents(source);
      const selection = getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    }
    clearTimeout(timers.get(button));
    timers.set(
      button,
      window.setTimeout(() => {
        label.textContent = idle;
        button.classList.remove("is-done", "is-failed");
      }, 1800),
    );
  });
}

/** Previous/next buttons for the horizontally scrolling format strip. */
export function initStrip(): void {
  const strip = document.querySelector<HTMLElement>("[data-strip]");
  const prev = document.querySelector<HTMLButtonElement>("[data-strip-prev]");
  const next = document.querySelector<HTMLButtonElement>("[data-strip-next]");
  if (!strip || !prev || !next) return;
  const update = (): void => {
    const max = strip.scrollWidth - strip.clientWidth - 2;
    prev.disabled = strip.scrollLeft <= 2;
    next.disabled = strip.scrollLeft >= max;
  };
  const page = (direction: 1 | -1): void => {
    const card = strip.querySelector<HTMLElement>(".fmt");
    const step = card ? card.getBoundingClientRect().width + 20 : strip.clientWidth * 0.8;
    const count = Math.max(1, Math.floor(strip.clientWidth / step));
    strip.scrollBy({ left: direction * step * count, behavior: "smooth" });
  };
  prev.addEventListener("click", () => page(-1));
  next.addEventListener("click", () => page(1));
  let frame = 0;
  strip.addEventListener(
    "scroll",
    () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    },
    { passive: true },
  );
  new ResizeObserver(update).observe(strip);
  update();
}
