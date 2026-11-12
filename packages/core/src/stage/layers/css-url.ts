/** CSS url() tokens, as still copies of animated images read and rewrite them (still-css.ts, still-svg.ts). */

/** A url() token: its double-quoted, single-quoted or bare value in groups 1 to 3. */
export const URL_TOKEN = /url\(\s*(?:"((?:[^"\\]|\\[\s\S])*)"|'((?:[^'\\]|\\[\s\S])*)'|([^)\s"']*))\s*\)/gi;

function unescapeCss(s: string): string {
  return s.replace(/\\(?:([0-9a-f]{1,6})\s?|([\s\S]))/gi, (_all, hex: string | undefined, ch: string | undefined) => {
    if (hex === undefined) return ch ?? "";
    const code = Number.parseInt(hex, 16);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "\ufffd";
  });
}

/** The URL a {@link URL_TOKEN} match names, from its three groups. */
export const urlOf = (dq: string | undefined, sq: string | undefined, bare: string | undefined): string =>
  unescapeCss(dq ?? sq ?? bare ?? "");

/** A url() token naming `url`. */
export function cssUrl(url: string): string {
  return `url("${url.replace(/[\\"]/g, "\\$&").replace(/\n/g, "\\a ")}")`;
}
