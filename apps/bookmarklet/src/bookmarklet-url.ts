/**
 * Helpers that turn the minified loader into the `javascript:` URL users save as a bookmark.
 * Shared by the build script, the install page and the tests.
 */

/** Upper bound for the default bookmarklet URL: strictly less than 1.5 KB (all ASCII, so bytes). */
export const MAX_BOOKMARKLET_LENGTH = 1535;

/** Value the loader template carries where the option string goes. */
export const OPTIONS_PLACEHOLDER = "__SWARMLOOM_OPTIONS__";

/**
 * Characters percent-encoded in the URL: controls and non-ASCII, plus "%" (browsers
 * percent-decode a javascript: URL before running it), "#" (fragment delimiter) and "\"
 * (some bookmark editors rewrite it). Spaces and the remaining printable ASCII stay raw: the
 * URL parser keeps or escapes them, and the browser percent-decodes the URL before running it
 * either way, so the code comes back unchanged.
 */
const UNSAFE = /[^\x20-\x7e]|[#%\\]/g;

/**
 * Turns minified loader code into a `javascript:` URL.
 * Percent-decoding the part after the scheme yields `code` again.
 */
export function toBookmarkletUrl(code: string): string {
  return `javascript:${code.replace(UNSAFE, (ch) => encodeURIComponent(ch))}`;
}

/**
 * Substitutes an option string (see options.ts) into a loader template built with
 * {@link OPTIONS_PLACEHOLDER}.
 *
 * @throws Error when the template does not contain the placeholder exactly once.
 */
export function fillLoaderTemplate(template: string, options: string): string {
  const token = JSON.stringify(OPTIONS_PLACEHOLDER);
  const at = template.indexOf(token);
  if (at < 0 || template.includes(token, at + 1)) {
    throw new Error(`loader template must contain ${token} exactly once`);
  }
  return template.slice(0, at) + JSON.stringify(options) + template.slice(at + token.length);
}
