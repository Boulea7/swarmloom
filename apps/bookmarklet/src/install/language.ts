/**
 * Language of the install page. The markup carries both languages as `data-l="zh"` /
 * `data-l="en"` spans and style.css hides the inactive one based on `<html lang>`, so the page
 * reads correctly (in Chinese) even before or without this script.
 */

/** Languages of the install page; zh-CN is the default. */
export type InstallLang = "zh-CN" | "en";

/** localStorage key remembering an explicit choice made with the toggle. */
export const LANG_STORAGE_KEY = "swarmloom.bm.lang";

const TEXT: Record<InstallLang, { title: string; description: string; copied: string; copyFailed: string }> = {
  "zh-CN": {
    title: "SwarmLoom 书签版",
    description: "把 SwarmLoom 存成书签，在不能安装扩展的浏览器里，也能让一群光标重建当前网页。",
    copied: "已复制。按下面的步骤粘贴到书签里。",
    copyFailed: "没能自动复制。代码已选中，请长按或右键复制。",
  },
  en: {
    title: "SwarmLoom bookmarklet",
    description:
      "Save SwarmLoom as a bookmark and let a swarm of cursors rebuild the current page, even in browsers without extensions.",
    copied: "Copied. Paste it into a bookmark with the steps below.",
    copyFailed: "Couldn't copy automatically. The code is selected: long-press or right-click to copy it.",
  },
};

/** Strings the script sets at runtime (everything else is in the markup). */
export function installText(lang: InstallLang): (typeof TEXT)[InstallLang] {
  return TEXT[lang];
}

function normalize(value: string | null | undefined): InstallLang | null {
  if (!value) return null;
  const tag = value.toLowerCase();
  if (tag === "en" || tag.startsWith("en-")) return "en";
  if (tag === "zh" || tag.startsWith("zh-")) return "zh-CN";
  return null;
}

/**
 * Picks the page language: `?lang=` in the URL (so the English site can link here), then the
 * choice remembered from the toggle, then zh-CN.
 *
 * @param search `location.search` of the page.
 * @param stored Value stored under {@link LANG_STORAGE_KEY}, if any.
 */
export function pickLanguage(search: string, stored: string | null): InstallLang {
  return normalize(new URLSearchParams(search).get("lang")) ?? normalize(stored) ?? "zh-CN";
}

/** Shows `lang` on the page: `<html lang>` drives the CSS, plus the title and description. */
export function applyLanguage(doc: Document, lang: InstallLang): void {
  const text = TEXT[lang];
  doc.documentElement.lang = lang;
  doc.title = text.title;
  doc.querySelector('meta[name="description"]')?.setAttribute("content", text.description);
}

/** Reads the remembered choice; storage can be unavailable (private mode, blocked cookies). */
export function readStoredLanguage(storage: () => Storage): string | null {
  try {
    return storage().getItem(LANG_STORAGE_KEY);
  } catch {
    return null;
  }
}

/** Remembers the choice when storage is available; the toggle still works without it. */
export function storeLanguage(storage: () => Storage, lang: InstallLang): void {
  try {
    storage().setItem(LANG_STORAGE_KEY, lang);
  } catch {
    // Not persisted: the page falls back to zh-CN or ?lang= next time.
  }
}
