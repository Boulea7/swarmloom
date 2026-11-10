/**
 * Small helpers shared by the extension pages (options, welcome, notice, demo). Pages are static
 * HTML with `data-i18n` attributes; strings come from the bundled catalogs so the language
 * preference applies immediately, without reloading the extension.
 */

import { type ExtensionApi, getApi } from "../shared/api";
import { browserLanguages, createTranslator, type MessageKey, resolveLocale, type Translator } from "../shared/i18n";
import { loadPrefs, type Prefs } from "../shared/prefs";

export interface PageContext {
  api: ExtensionApi | null;
  prefs: Prefs;
  tr: Translator;
}

/** Loads preferences and the translator for a page. */
export async function pageContext(): Promise<PageContext> {
  const api = getApi();
  const prefs = await loadPrefs(api);
  return { api, prefs, tr: createTranslator(resolveLocale(prefs.locale, browserLanguages())) };
}

/**
 * Fills `[data-i18n]` text and `[data-i18n-attr="attr:key;attr:key"]` attributes, and sets the
 * document language. Unknown keys are left untouched.
 */
export function applyI18n(root: ParentNode & Node, tr: Translator): void {
  const doc = root.ownerDocument ?? (root as Document);
  doc.documentElement.lang = tr.locale;
  for (const el of root.querySelectorAll<HTMLElement>("[data-i18n]")) {
    el.textContent = tr.t(el.dataset.i18n as MessageKey);
  }
  for (const el of root.querySelectorAll<HTMLElement>("[data-i18n-attr]")) {
    for (const pair of (el.dataset.i18nAttr ?? "").split(";")) {
      const [attr, key] = pair.split(":").map((x) => x.trim());
      if (attr && key) el.setAttribute(attr, tr.t(key as MessageKey));
    }
  }
  const title = doc.querySelector("title[data-i18n]");
  if (title) doc.title = title.textContent ?? doc.title;
}

/** `document.getElementById` that fails loudly when the page markup and script disagree. */
export function byId<T extends HTMLElement = HTMLElement>(id: string, doc: Document = document): T {
  const el = doc.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el as T;
}

/** Formats a shortcut for display ("Alt+Shift+W" -> "Alt + Shift + W"; Mac symbols stay as-is). */
export function displayShortcut(shortcut: string): string {
  return shortcut.includes("+") ? shortcut.split("+").join(" + ") : shortcut;
}

/** The bound shortcut of the toggle command, or "" when unbound or unsupported. */
export async function toggleShortcut(api: ExtensionApi | null): Promise<string> {
  try {
    const commands = (await api?.commands?.getAll?.()) ?? [];
    const toggle = commands.find((c) => c.name === "_execute_action" || c.name === "_execute_browser_action");
    return toggle?.shortcut ?? "";
  } catch {
    return "";
  }
}

/** Runs `fn` once the DOM is ready (module scripts are deferred, but keep it explicit). */
export function onReady(fn: () => void | Promise<void>): void {
  const run = () => {
    Promise.resolve(fn()).catch((e: unknown) => console.error("SwarmLoom:", e));
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", run, { once: true });
  else run();
}
