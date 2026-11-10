/**
 * Script of the install page (public/index.html, built to dist/install.js).
 *
 * The page works without it: the default bookmarklet is baked into the markup at build time and
 * the Chinese text shows by default. The script adds the language toggle, the copy button, the
 * options that rebuild the bookmarklet, and opens the guide for the visitor's mobile browser.
 *
 * It is loaded as a blocking script in `<head>` so the language applies before first paint.
 */
import { fillLoaderTemplate, toBookmarkletUrl } from "../bookmarklet-url";
import { type BookmarkletOptions, formatOptions } from "../options";
import { copyText } from "./copy";
import {
  applyLanguage,
  type InstallLang,
  installText,
  pickLanguage,
  readStoredLanguage,
  storeLanguage,
} from "./language";
import { detectMobileBrowser } from "./platform";

/** Minified loader with the options placeholder, injected by scripts/build.mjs. */
declare const __SWARMLOOM_LOADER_TEMPLATE__: string;

/** How long the copy feedback stays visible, ms. */
const STATUS_MS = 6000;

function element<T extends HTMLElement>(doc: Document, id: string, type: { new (): T; prototype: T }): T | null {
  const el = doc.getElementById(id);
  return el instanceof type ? el : null;
}

/** Reads the options form. Empty values mean "bundle default" and stay out of the bookmarklet. */
export function readOptions(form: HTMLFormElement): BookmarkletOptions {
  const data = new FormData(form);
  const speed = data.get("speed");
  return {
    speed: typeof speed === "string" && speed !== "" ? Number(speed) : undefined,
    sound: data.get("sound") === "0" ? false : undefined,
  };
}

/** Builds the `javascript:` URL for `options` from the loader template. */
export function bookmarkletFor(template: string, options: BookmarkletOptions): string {
  return toBookmarkletUrl(fillLoaderTemplate(template, formatOptions(options)));
}

function setupLanguage(win: Window, doc: Document): { current(): InstallLang } {
  const storage = () => win.localStorage;
  let lang = pickLanguage(win.location.search, readStoredLanguage(storage));
  applyLanguage(doc, lang);
  const ready = () => {
    const toggle = element(doc, "lang-toggle", HTMLButtonElement);
    toggle?.addEventListener("click", () => {
      lang = lang === "en" ? "zh-CN" : "en";
      applyLanguage(doc, lang);
      storeLanguage(storage, lang);
      const status = doc.getElementById("copy-status");
      if (status) status.textContent = "";
    });
  };
  onReady(doc, ready);
  return { current: () => lang };
}

function setupBookmarklet(win: Window, doc: Document, template: string, lang: () => InstallLang): void {
  const link = element(doc, "bm-link", HTMLAnchorElement);
  const code = element(doc, "bm-code", HTMLTextAreaElement);
  const size = doc.getElementById("bm-size");
  const copy = element(doc, "copy", HTMLButtonElement);
  const status = doc.getElementById("copy-status");
  const form = element(doc, "options-form", HTMLFormElement);
  if (!link || !code) {
    console.error("[swarmloom] install page markup is missing the bookmarklet link or code field");
    return;
  }
  let statusTimer = 0;

  form?.addEventListener("change", () => {
    let url: string;
    try {
      url = bookmarkletFor(template, readOptions(form));
    } catch (error) {
      // Keeps the previous bookmarklet: it is still valid, only without the new choice.
      console.error("[swarmloom] could not rebuild the bookmarklet", error);
      return;
    }
    link.href = url;
    code.value = url;
    if (size) size.textContent = (url.length / 1024).toFixed(1);
  });

  copy?.addEventListener("click", async () => {
    const ok = await copyText(code.value, code);
    if (!status) return;
    const text = installText(lang());
    status.textContent = ok ? text.copied : text.copyFailed;
    win.clearTimeout(statusTimer);
    if (ok) statusTimer = win.setTimeout(() => (status.textContent = ""), STATUS_MS);
  });
}

/** Opens the guide for the visitor's mobile browser and puts the mobile section first on touch screens. */
function setupPlatform(win: Window, doc: Document): void {
  const browser = detectMobileBrowser(win.navigator.userAgent, win.navigator.maxTouchPoints);
  const guide = browser ? element(doc, `browser-${browser}`, HTMLDetailsElement) : null;
  if (guide) guide.open = true;
  const touchOnly = win.matchMedia("(pointer: coarse)").matches && !win.matchMedia("(any-pointer: fine)").matches;
  const mobile = doc.getElementById("mobile");
  // Moved in the DOM rather than with CSS `order`, so focus order matches what is shown.
  if ((browser || touchOnly) && mobile?.parentElement) mobile.parentElement.prepend(mobile);
}

function onReady(doc: Document, fn: () => void): void {
  if (doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", fn, { once: true });
  else fn();
}

/**
 * Wires the install page; safe to call before the body is parsed.
 *
 * @param template Minified loader containing the options placeholder (see bookmarklet-url.ts).
 */
export function initInstallPage(win: Window, doc: Document, template: string): void {
  const language = setupLanguage(win, doc);
  onReady(doc, () => {
    setupBookmarklet(win, doc, template, language.current);
    setupPlatform(win, doc);
  });
}

// Undefined when the module is imported by tests: only the built page wires itself.
if (typeof __SWARMLOOM_LOADER_TEMPLATE__ === "string") initInstallPage(window, document, __SWARMLOOM_LOADER_TEMPLATE__);
