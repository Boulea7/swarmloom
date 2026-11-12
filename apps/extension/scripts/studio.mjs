// Copies the Studio extension build (apps/studio, STUDIO_TARGET=extension) into the packages.
import { cpSync, existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** Entry pages a Studio extension build may have, in order of preference. */
export const STUDIO_ENTRIES = Object.freeze(["studio.html", "index.html"]);

/**
 * Local files an HTML page links with `src` or `href` (its scripts, stylesheets and icons), as paths
 * relative to the page's folder. URLs with a scheme, protocol-relative URLs and fragments are skipped.
 * @param {string} html
 * @returns {string[]}
 */
export function linkedFiles(html) {
  const out = new Set();
  for (const [, url = ""] of html.replace(/<!--[\s\S]*?-->/g, "").matchAll(/\b(?:src|href)\s*=\s*["']([^"']*)["']/gi)) {
    if (url === "" || /^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(url)) continue;
    const path = url.replace(/[?#].*$/, "").replace(/^\.\//, "");
    if (path !== "") out.add(path);
  }
  return [...out].sort();
}

/**
 * Copies a Studio build to `dest` and checks the copy is whole: its entry page and every local file
 * the page links. The Studio's Vite build empties its output folder before writing it, so a copy
 * taken while the Studio is being rebuilt misses files; that fails here instead of shipping a
 * broken `studio/`. Copy once and fan the copy out, so every target gets the same files.
 * @param {{ dir: string; entry: string }} studio
 * @param {string} dest
 */
export function copyStudio(studio, dest) {
  const incomplete = (/** @type {string} */ reason) =>
    new Error(
      `the Studio build in ${studio.dir} is incomplete (${reason}); it is probably being rebuilt. ` +
        "Build the Studio first (pnpm -F @swarmloom/studio build:extension), then the extension.",
    );
  try {
    cpSync(studio.dir, dest, { recursive: true });
  } catch (error) {
    throw incomplete(/** @type {Error} */ (error).message);
  }
  const page = join(dest, studio.entry);
  if (!existsSync(page)) throw incomplete(`no ${studio.entry}`);
  const missing = linkedFiles(readFileSync(page, "utf8")).filter((file) => !existsSync(join(dirname(page), file)));
  if (missing.length > 0) throw incomplete(`${studio.entry} links missing ${missing.join(", ")}`);
}
