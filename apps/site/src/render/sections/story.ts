/** How it works, Everywhere, For makers, Install and the footer. */

import { CONTACT_EMAIL } from "../../config";
import { DEVICE_IDS } from "../../content/formats";
import type { AvailItem, AvailStatus, MakerCard, SiteCopy } from "../../content/types";
import { deviceSize, deviceSvg } from "../art/devices";
import { howArt } from "../art/how";
import { logoMark, type MarkRenderer } from "../art/logo";
import { webScene } from "../art/scenes";
import { highlight } from "../code";
import { esc } from "../html";
import { icon } from "../icons";
import { isExternal, type Links } from "../links";

export function how(copy: SiteCopy): string {
  const art = howArt();
  const steps = [...copy.how.steps, copy.how.export];
  const items = steps
    .map(
      (step, i) => `<li class="how-step${i === 3 ? " how-export" : ""}" style="--i:${i}">
        <div class="how-node">${art[i]}</div>
        <h3 class="how-name">${esc(step.name)}</h3>
        <p class="how-line">${esc(step.line)}</p>
      </li>`,
    )
    .join("\n      ");
  return `<section class="how" aria-labelledby="how-title">
  <div class="wrap">
    <h2 id="how-title" class="h2 display" data-reveal>${esc(copy.how.title)}</h2>
    <ol class="how-steps" data-how>
      ${items}
    </ol>
  </div>
</section>`;
}

function chip(item: AvailItem, status: Record<AvailStatus, string>): string {
  if (!item.status) return `<li>${esc(item.name)}</li>`;
  return `<li class="is-${item.status}">${esc(item.name)}<span class="chip-tag">${esc(status[item.status])}</span></li>`;
}

export function platforms(copy: SiteCopy): string {
  const p = copy.platforms;
  const devices = DEVICE_IDS.map((id) => {
    const { w } = deviceSize(id);
    return `<li class="dv dv-${id}" style="--w:${w}"><figure>${deviceSvg(id, p.devices[id])}<figcaption>${esc(p.devices[id])}</figcaption></figure></li>`;
  }).join("");
  const groups = p.groups
    .map(
      (group) => `<div class="avail-group" data-reveal>
        <dt>${esc(group.name)}${group.note ? ` <span class="avail-note">${esc(group.note)}</span>` : ""}</dt>
        <dd><ul class="chips">${group.items.map((item) => chip(item, p.status)).join("")}</ul></dd>
      </div>`,
    )
    .join("\n      ");
  return `<section class="platforms" id="platforms" aria-labelledby="platforms-title">
  <div class="wrap platforms-head" data-reveal>
    <h2 id="platforms-title" class="h2 display">${esc(p.title)}</h2>
    <p class="lead">${esc(p.sub)}</p>
  </div>
  <div class="wrap">
    <ul class="lineup" aria-label="${esc(p.lineupLabel)}">${devices}</ul>
    <dl class="avail">
      ${groups}
    </dl>
  </div>
</section>`;
}

function codeBlock(card: MakerCard, id: string, copy: SiteCopy): string {
  const label = copy.locale === "zh" ? `${copy.makers.copy}：${card.title}` : `${copy.makers.copy}: ${card.title}`;
  return `<div class="code">
          <div class="code-bar"><span class="code-lang">${esc(card.lang)}</span><button class="copy" type="button" data-copy="${id}" aria-label="${esc(label)}">${icon("copy", { size: 16 })}<span data-copy-label>${esc(copy.makers.copy)}</span></button></div>
          <pre tabindex="0"><code id="${id}">${highlight(card.code, card.lang)}</code></pre>
        </div>`;
}

function makerCard(card: MakerCard, key: string, copy: SiteCopy, extra = ""): string {
  return `<article class="mk mk-${key}" data-reveal>
        ${extra}
        <h3 class="mk-title">${esc(card.title)}</h3>
        <p class="mk-note">${esc(card.note)}</p>
        ${codeBlock(card, `code-${key}`, copy)}
      </article>`;
}

export function makers(copy: SiteCopy): string {
  const m = copy.makers;
  const preview = `<div class="mk-preview" aria-hidden="true">${webScene(560, 220, { tags: true, colors: [4, 2, 3], names: 8, cursorScale: 0.95 })}</div>`;
  return `<section class="makers" aria-labelledby="makers-title">
  <div class="wrap">
    <h2 id="makers-title" class="h2 display" data-reveal>${esc(m.title)}</h2>
    <div class="makers-grid" data-copy-scope data-copied="${esc(m.copied)}" data-copy-failed="${esc(m.copyFailed)}">
      ${makerCard(m.element, "element", copy, preview)}
      ${makerCard(m.extension, "extension", copy)}
      ${makerCard(m.cli, "cli", copy)}
    </div>
  </div>
</section>`;
}

export function install(copy: SiteCopy, links: Links): string {
  const ins = copy.install;
  const rows = ins.rows
    .map((row, index) => {
      const actions = row.actions
        .map((action, i) => {
          const href = links.action(action.target);
          const rel = isExternal(href) ? ' rel="noopener"' : "";
          // Every row stays quiet; CSS lifts the lead action of the visitor's own row to primary.
          const kind = i === 0 ? "btn-secondary btn-lead" : "btn-secondary";
          return `<a class="btn btn-sm ${kind}" href="${href}"${rel}>${esc(action.label)}${i === 0 && action.target === "releases" ? icon("download-simple", { size: 16 }) : ""}</a>`;
        })
        .join("");
      const code = row.code
        ? `<div class="inst-code"><code id="inst-code-${index}">${highlight(row.code, "shell")}</code><button class="copy" type="button" data-copy="inst-code-${index}" aria-label="${esc(`${copy.makers.copy} ${row.code}`)}">${icon("copy", { size: 16 })}<span data-copy-label>${esc(copy.makers.copy)}</span></button></div>`
        : "";
      return `<li class="inst" data-channel="${row.channel}">
        <div class="inst-text">
          <h3 class="inst-name">${esc(row.name)}<span class="inst-current">${esc(ins.current)}</span></h3>
          <p class="inst-note">${esc(row.note)}</p>
        </div>
        <div class="inst-actions">${actions}${code}</div>
      </li>`;
    })
    .join("\n      ");
  return `<section class="install" id="install" aria-labelledby="install-title">
  <div class="wrap">
    <h2 id="install-title" class="h2 display" data-reveal>${esc(ins.title)}</h2>
    <ul class="install-list" data-copy-scope data-copied="${esc(copy.makers.copied)}" data-copy-failed="${esc(copy.makers.copyFailed)}">
      ${rows}
    </ul>
  </div>
</section>`;
}

export function footer(copy: SiteCopy, links: Links, mark: MarkRenderer = logoMark): string {
  const f = copy.footer;
  return `<footer class="foot" id="contact">
  <div class="wrap">
    <p class="foot-ask display" data-reveal>${esc(f.contactTitle)}</p>
    <a class="foot-mail" href="mailto:${CONTACT_EMAIL}" data-reveal>${icon("envelope-simple", { size: 24 })}<span>${esc(CONTACT_EMAIL)}</span></a>
    <div class="foot-meta">
      <a class="foot-brand" href="${links.home}" aria-label="${esc(copy.nav.home)}">${mark(22)}<span class="wordmark">SwarmLoom</span></a>
      <p class="foot-credit">${esc(f.credit)}</p>
      <ul class="foot-links">
        <li><a href="${links.license}" rel="noopener license">${esc(f.license)}</a></li>
        <li><a href="${links.repo}" rel="noopener">${esc(f.github)}</a></li>
        <li><a href="${links.otherHome}" hreflang="${copy.locale === "zh" ? "en" : "zh-CN"}" lang="${copy.locale === "zh" ? "en" : "zh-CN"}">${esc(copy.nav.otherLocale)}</a></li>
      </ul>
    </div>
  </div>
</footer>`;
}
