// Validates the build options of the bookmarklet (see build.mjs).

/** Pages base the bookmarklet is published under by default. */
export const DEFAULT_BASE = "https://boulea7.github.io/swarmloom/";

/** Studio location relative to the bundle (<base>bm/swarm.js -> <base>studio/). Relative keeps the URL short. */
export const DEFAULT_STUDIO = "../studio/?from=bookmarklet";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

function parseHttpUrl(name, text, base) {
  let url;
  try {
    url = new URL(text, base);
  } catch {
    throw new Error(`${name} is not a valid URL: ${text}`);
  }
  const local = url.protocol === "http:" && LOCAL_HOSTS.has(url.hostname);
  if (url.protocol !== "https:" && !local) {
    throw new Error(`${name} must use https (http is allowed for localhost only): ${url.href}`);
  }
  return url;
}

/**
 * @param {{ base?: string; studio?: string }} input
 * @returns {{ bundleUrl: string; studioUrl: string; studioHref: string }}
 *   bundleUrl: absolute URL of swarm.js; studioUrl: as baked into the loader (relative to the bundle
 *   or absolute); studioHref: absolute Studio URL without the query, for links on the install page.
 */
export function resolveBuildConfig(input) {
  const baseText = input.base || DEFAULT_BASE;
  const base = parseHttpUrl("--base", baseText.endsWith("/") ? baseText : `${baseText}/`);
  if (base.search || base.hash) throw new Error(`--base must not have a query or fragment: ${base.href}`);
  const bundleUrl = new URL("bm/swarm.js", base).href;
  const studioUrl = input.studio || DEFAULT_STUDIO;
  const studio = parseHttpUrl("--studio", studioUrl, bundleUrl);
  if (studio.searchParams.get("from") !== "bookmarklet") {
    throw new Error(`--studio must carry ?from=bookmarklet so the Studio asks for the page: ${studio.href}`);
  }
  studio.search = "";
  studio.hash = "";
  return { bundleUrl, studioUrl, studioHref: studio.href };
}
