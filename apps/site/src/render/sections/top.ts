/** Skip link, navigation and hero. */

import type { CtaKey, HeadlineRun, SiteCopy } from "../../content/types";
import { cursorSvg } from "../art/cursor";
import { logoMark, type MarkRenderer } from "../art/logo";
import { cursorColor, tagTextColor } from "../art/palette";
import { AGENT_NAMES } from "../art/scenes";
import { esc } from "../html";
import { icon } from "../icons";
import type { Links } from "../links";

const CTA_KEYS: readonly CtaKey[] = ["generic", "chrome", "edge", "brave", "opera", "firefox", "safari", "studio"];

/**
 * A parked cursor with a name tag. The tag text comes from a data attribute rendered through CSS
 * `content`, so it never pollutes the heading text that search engines and screen readers read.
 */
function decoCursor(kind: string, colorIndex: number, nameIndex: number): string {
  const color = cursorColor(colorIndex);
  const name = AGENT_NAMES[nameIndex % AGENT_NAMES.length] as string;
  return (
    `<span class="deco deco-${kind}" aria-hidden="true" data-deco data-name="${esc(name)}" ` +
    `style="--c:${color};--ct:${tagTextColor(color)}">${cursorSvg(color, 26)}</span>`
  );
}

function headlineRun(run: HeadlineRun): string {
  if (!run.selected) return esc(run.text);
  return (
    `<span class="sel">${esc(run.text)}` +
    '<span class="sel-box" aria-hidden="true" data-deco><i></i><i></i><i></i><i></i></span>' +
    `${decoCursor("mira", 0, 0)}</span>`
  );
}

export function skipLink(copy: SiteCopy): string {
  return `<a class="skip" href="#main">${esc(copy.skipLink)}</a>`;
}

export function nav(copy: SiteCopy, links: Links, mark: MarkRenderer = logoMark): string {
  const n = copy.nav;
  const otherLang = copy.locale === "zh" ? "en" : "zh-CN";
  const zhName = copy.locale === "zh" ? '<span class="brand-zh">群织</span>' : "";
  return `<header class="nav" data-nav>
  <div class="nav-in wrap">
    <a class="brand" href="${links.home}" aria-label="${esc(n.home)}">${mark()}<span class="wordmark">SwarmLoom</span>${zhName}</a>
    <nav class="nav-links" aria-label="${esc(n.label)}">
      <ul>
        <li class="nav-anchor"><a href="#film">${esc(n.film)}</a></li>
        <li class="nav-anchor"><a href="#formats">${esc(n.formats)}</a></li>
        <li class="nav-anchor"><a href="#platforms">${esc(n.platforms)}</a></li>
        <li><a href="${links.docs}">${esc(n.docs)}</a></li>
        <li><a href="${links.repo}" rel="noopener">${esc(n.github)}</a></li>
      </ul>
    </nav>
    <a class="lang" href="${links.otherHome}" hreflang="${otherLang}" lang="${otherLang}" aria-label="${esc(n.otherLocale)}">${icon("translate", { size: 18 })}<span>${esc(n.otherLocaleShort)}</span></a>
  </div>
</header>`;
}

export function hero(copy: SiteCopy, links: Links): string {
  const h = copy.hero;
  const [first = [], ...rest] = h.lines;
  const line1 =
    `<span class="line">${first.map(headlineRun).join("")}` +
    `<span class="caret-anchor" aria-hidden="true" data-deco><span class="caret"></span>${decoCursor("kai", 1, 1)}</span></span>`;
  const others = rest.map((runs) => `<span class="line">${runs.map(headlineRun).join("")}</span>`).join("");
  const labels = CTA_KEYS.map((key) => `<span class="cta-label" data-b="${key}">${esc(h.cta[key])}</span>`).join("");
  return `<section class="hero" aria-labelledby="hero-title" data-hero>
  <div class="hero-in wrap">
    <div class="hero-copy" data-hero-copy>
      <h1 id="hero-title" class="hero-title display">${line1}${others}</h1>
      <p class="hero-sub">${esc(h.sub)}</p>
      <div class="hero-ctas">
        <a class="btn btn-primary" href="#install" data-cta>${labels}${icon("arrow-right", { size: 18 })}</a>
        <a class="btn btn-secondary" href="${links.studio}">${esc(h.tryOnline)}${icon("arrow-up-right", { size: 18 })}</a>
        ${decoCursor("lin", 2, 2)}
      </div>
    </div>
    <button class="replay" type="button" data-replay data-label-replay="${esc(h.replay)}" data-label-reduced="${esc(h.replayReduced)}" hidden>${icon("arrow-counter-clockwise", { size: 16 })}<span data-replay-label>${esc(h.replay)}</span></button>
  </div>
</section>`;
}
