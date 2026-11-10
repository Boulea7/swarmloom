/**
 * Full-document renderer. Pure: given the copy and a render context it returns the HTML string
 * that Vite then post-processes (module bundling, CSS inlining).
 */

import { LOCALE_TAG, sitePath } from "../config";
import type { SiteCopy } from "../content/types";
import { cursorSvg } from "./art/cursor";
import { type MarkRenderer, markRenderer } from "./art/logo";
import { cursorColor } from "./art/palette";
import type { RenderContext } from "./context";
import { renderHead } from "./head";
import { esc } from "./html";
import { icon } from "./icons";
import { linksFor } from "./links";
import { film, formats } from "./sections/media";
import { footer, how, install, makers, platforms } from "./sections/story";
import { hero, nav, skipLink } from "./sections/top";

function documentShell(lang: string, head: string, body: string, bodyClass: string): string {
  return `<!doctype html>
<html lang="${lang}" data-browser="generic" data-channel="">
  <head>
    ${head}
  </head>
  <body class="${bodyClass}">
${body}
  </body>
</html>
`;
}

function markFor(ctx: RenderContext): MarkRenderer {
  if (!ctx.brand.logo) return markRenderer(null);
  return markRenderer({ light: sitePath(ctx.base, "brand/logo.svg"), dark: sitePath(ctx.base, "brand/logo-dark.svg") });
}

/** Renders a locale's home page. */
export function renderHome(copy: SiteCopy, ctx: RenderContext): string {
  const links = linksFor(copy.locale, ctx.base);
  const head = renderHead({ copy, ctx, indexable: true });
  const mark = markFor(ctx);
  const body = [
    skipLink(copy),
    nav(copy, links, mark),
    '<main id="main" tabindex="-1">',
    hero(copy, links),
    film(copy, ctx.media, ctx.base),
    formats(copy, links, ctx.media, ctx.base),
    how(copy),
    platforms(copy),
    makers(copy),
    install(copy, links),
    "</main>",
    footer(copy, links, mark),
  ].join("\n");
  return documentShell(LOCALE_TAG[copy.locale], head, body, `page-home lang-${copy.locale}`);
}

/**
 * Renders the shared 404 page. GitHub Pages serves one 404.html for every locale, so the message
 * is bilingual: the primary locale first, the secondary below it in its own `lang`.
 */
export function renderNotFound(primary: SiteCopy, secondary: SiteCopy, ctx: RenderContext): string {
  const links = linksFor(primary.locale, ctx.base);
  const otherLinks = linksFor(secondary.locale, ctx.base);
  const head = renderHead({
    copy: primary,
    ctx,
    title: `${primary.notFound.title} · SwarmLoom`,
    indexable: false,
  });
  const lost = [0, 3, 5]
    .map((c, i) => `<span class="lost lost-${i}" aria-hidden="true">${cursorSvg(cursorColor(c), 30)}</span>`)
    .join("");
  const body = [
    skipLink(primary),
    nav(primary, links, markFor(ctx)),
    `<main id="main" class="nf" tabindex="-1">
  <div class="wrap nf-in">
    <div class="nf-art" aria-hidden="true"><span class="nf-code display">404</span>${lost}</div>
    <h1 class="h2 display">${esc(primary.notFound.title)}</h1>
    <p class="lead">${esc(primary.notFound.body)}</p>
    <p class="nf-alt" lang="${LOCALE_TAG[secondary.locale]}">${esc(secondary.notFound.title)} ${esc(secondary.notFound.body)}</p>
    <div class="nf-ctas">
      <a class="btn btn-primary" href="${links.home}">${esc(primary.notFound.home)}${icon("arrow-right", { size: 18 })}</a>
      <a class="btn btn-secondary" href="${otherLinks.home}" lang="${LOCALE_TAG[secondary.locale]}" hreflang="${LOCALE_TAG[secondary.locale]}">${esc(secondary.notFound.home)}</a>
    </div>
  </div>
</main>`,
  ].join("\n");
  return documentShell(LOCALE_TAG[primary.locale], head, body, `page-404 lang-${primary.locale}`);
}
