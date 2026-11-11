import type { ShadowWatch } from "../render/live";

/** A `prefers-reduced-motion` test and the value it tests (none: the boolean form). */
const MOTION_TEST = /\(\s*prefers-reduced-motion\s*(?::\s*(reduce|no-preference)\s*)?\)/gi;
const MENTIONS_MOTION = /prefers-reduced-motion/i;
/** Media conditions that never and always hold, valid wherever a media feature is. */
const NEVER = "(width < 0px)";
const ALWAYS = "(width >= 0px)";

/**
 * `query` with every `prefers-reduced-motion` test answered as `no-preference`, the value the CLI's
 * browser context emulates: the `no-preference` test always holds, the `reduce` and boolean tests
 * never do. Everything else in the query is left as it is.
 */
export function withoutReducedMotion(query: string): string {
  return query.replace(MOTION_TEST, (_test, value: string | undefined) =>
    value?.toLowerCase() === "no-preference" ? ALWAYS : NEVER,
  );
}

function neutralize(media: MediaList | null | undefined): void {
  const text = media?.mediaText;
  if (media && text && MENTIONS_MOTION.test(text)) media.mediaText = withoutReducedMotion(text);
}

function neutralizeSheet(sheet: CSSStyleSheet): void {
  neutralize(sheet.media);
  let rules: CSSRuleList;
  try {
    rules = sheet.cssRules;
  } catch {
    return; // Cross-origin sheets keep their rules private.
  }
  neutralizeRules(rules);
}

function neutralizeRules(rules: CSSRuleList): void {
  for (const rule of Array.from(rules)) {
    // CSSRule.IMPORT_RULE and MEDIA_RULE; constructor checks would fail across windows.
    if (rule.type === 3) {
      neutralize((rule as CSSImportRule).media);
      const imported = (rule as CSSImportRule).styleSheet;
      if (imported) neutralizeSheet(imported);
    } else if (rule.type === 4) {
      neutralize((rule as CSSMediaRule).media);
    }
    if ("cssRules" in rule) neutralizeRules((rule as CSSGroupingRule).cssRules);
  }
}

/** Pins the export frame's `prefers-reduced-motion` to `no-preference`. */
export interface MotionPin {
  /** Rewrites the reduced-motion tests of every style sheet the frame has now; run before each capture. */
  sweep(): void;
  /** Restores `matchMedia` and stops watching for frames. */
  stop(): void;
}

/**
 * Makes the export frame show what the CLI shows: its browser context emulates
 * `prefers-reduced-motion: no-preference`, while a frame in the page follows the host's setting, so
 * adapters that ask (the 3D finale orbit) and pages with `@media (prefers-reduced-motion)` rules
 * would draw differently for users with reduced motion on. Scripts get a `matchMedia` that answers
 * `no-preference`; while the host asks for reduced motion, the reduced-motion tests of style sheets
 * (the frame, the watched shadow roots and same-origin child frames such as the HTML adapter's
 * capture page, swept once that has loaded) are rewritten to their `no-preference` result.
 */
export function pinMotionPreference(win: Window & typeof globalThis, shadows: ShadowWatch): MotionPin {
  const original = win.matchMedia;
  const pinned = (query: string): MediaQueryList => original.call(win, withoutReducedMotion(String(query)));
  win.matchMedia = pinned;

  const sweep = (): void => {
    if (!original.call(win, "(prefers-reduced-motion: reduce)").matches) return;
    const roots: (Document | ShadowRoot)[] = [win.document, ...shadows.roots()];
    for (let i = 0; i < roots.length; i++) {
      const root = roots[i];
      for (const sheet of [...Array.from(root.styleSheets), ...root.adoptedStyleSheets]) neutralizeSheet(sheet);
      for (const frame of Array.from(root.querySelectorAll("iframe"))) {
        if (frame.contentDocument) roots.push(frame.contentDocument);
      }
    }
  };
  // Adapters lay pages out in child frames during init(); their styles must be pinned before the capture.
  const observer = new win.MutationObserver((records) => {
    for (const record of records) {
      for (const node of Array.from(record.addedNodes)) {
        if (node.nodeType === 1 && (node as Element).localName === "iframe") node.addEventListener("load", sweep);
      }
    }
    sweep();
  });
  observer.observe(win.document, { childList: true, subtree: true });

  return {
    sweep,
    stop() {
      observer.disconnect();
      if (win.matchMedia === pinned) win.matchMedia = original;
    },
  };
}
