import { RootScrollLock } from "./host";

/**
 * What an overlay stage does to the live page while it covers it (decisions-v1 S01, behaviour
 * spec section 15): the page's own scrollbar is hidden, every child of <body> becomes `inert` (the
 * stage host lives under <html>, so it stays interactive), and the element that had focus gets it
 * back when the page is released. Every change is undone exactly; elements that were already
 * inert stay inert.
 */
export class PageGuard {
  readonly #doc: Document;
  readonly #lock: RootScrollLock;
  readonly #inerted: HTMLElement[] = [];
  #focus: HTMLElement | SVGElement | null = null;
  #engaged = false;

  constructor(doc: Document) {
    this.#doc = doc;
    this.#lock = new RootScrollLock(doc);
  }

  get engaged(): boolean {
    return this.#engaged;
  }

  /** Locks the page behind `host`. Idempotent. */
  engage(host: Element): void {
    if (this.#engaged) return;
    this.#engaged = true;
    const active = this.#doc.activeElement;
    this.#focus = active && active !== this.#doc.body && hasFocus(active) ? active : null;
    this.#lock.lock();
    const body = this.#doc.body;
    if (!body) return;
    for (let el = body.firstElementChild; el; el = el.nextElementSibling) {
      if (el === host || !isHtml(el) || el.inert) continue;
      el.inert = true;
      this.#inerted.push(el);
    }
  }

  /** Undoes engage(); `restoreFocus` returns focus to the element focused before (go live, close). */
  release(restoreFocus: boolean): void {
    if (!this.#engaged) return;
    this.#engaged = false;
    for (const el of this.#inerted) el.inert = false;
    this.#inerted.length = 0;
    this.#lock.unlock();
    const focus = this.#focus;
    this.#focus = null;
    if (restoreFocus && focus?.isConnected) {
      try {
        focus.focus({ preventScroll: true });
      } catch {
        // element no longer focusable
      }
    }
  }
}

function isHtml(el: Element): el is HTMLElement {
  return "inert" in el && typeof (el as HTMLElement).focus === "function";
}

function hasFocus(el: Element): el is HTMLElement | SVGElement {
  return typeof (el as HTMLElement).focus === "function";
}
