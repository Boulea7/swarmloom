/** Film and format strip: the two sections that show video when the media release is present. */

import { FORMAT_IDS, STUDIO_EXAMPLE } from "../../content/formats";
import type { FormatId, Locale, SiteCopy } from "../../content/types";
import { formatScene, webScene } from "../art/scenes";
import type { MediaManifest } from "../context";
import { esc } from "../html";
import { icon } from "../icons";
import type { Links } from "../links";

/** Film source for a locale: its own cut first, then the other language's cut. */
export function filmSource(media: MediaManifest, locale: Locale): Locale | null {
  if (media.promo[locale]) return locale;
  const other: Locale = locale === "zh" ? "en" : "zh";
  return media.promo[other] ? other : null;
}

function filmVideo(copy: SiteCopy, media: MediaManifest, base: string, source: Locale): string {
  const poster = media.promoPoster ? ` poster="${base}media/promo-poster.avif"` : "";
  const order: Locale[] = copy.locale === "zh" ? ["zh", "en"] : ["en", "zh"];
  const tracks = order
    .filter((lang) => media.captions[lang])
    .map(
      (lang, i) =>
        `<track kind="captions" src="${base}media/promo-${lang}.vtt" srclang="${lang}" label="${esc(copy.film.captions[lang])}"${i === 0 ? " default" : ""}>`,
    )
    .join("");
  return (
    `<video class="film-video" preload="none" playsinline${poster} aria-label="${esc(copy.film.frameLabel)}" data-film-video>` +
    `<source src="${base}media/promo-${source}.mp4" type="video/mp4">${tracks}</video>`
  );
}

export function film(copy: SiteCopy, media: MediaManifest, base: string): string {
  const f = copy.film;
  const source = filmSource(media, copy.locale);
  const cover =
    source && media.promoPoster
      ? ""
      : `<div class="film-cover" data-film-cover>${webScene(1280, 720, { tags: true, cursorScale: 1.6, colors: [0, 1, 2], names: 4, className: "scene-film" })}</div>`;
  const control = source
    ? `<button class="film-play" type="button" aria-label="${esc(f.playAria)}" data-film-play><span class="film-play-disc">${icon("play", { weight: "fill", size: 22 })}</span><span class="film-play-text">${esc(f.play)}</span></button>` +
      `<p class="film-note" role="status" data-film-status hidden>${esc(f.error)}</p>`
    : `<p class="film-note">${esc(f.soon)}</p>`;
  const video = source ? filmVideo(copy, media, base, source) : "";
  return `<section class="film" id="film" aria-labelledby="film-title">
  <div class="wrap">
    <h2 id="film-title" class="h2 display" data-reveal>${esc(f.title)}</h2>
    <div class="film-frame${source ? " has-film" : ""}" data-film data-reveal>${video}${cover}${control}</div>
    ${source ? `<p class="film-credits">${esc(f.credits)}</p>` : ""}
  </div>
</section>`;
}

function clipMedia(id: FormatId, media: MediaManifest, base: string): string {
  const clip = media.clips[id];
  const scene = formatScene(id);
  if (!clip || !(clip.mp4 || clip.webm)) return scene;
  const sources =
    (clip.webm ? `<source src="${base}media/clips/${id}.webm" type="video/webm">` : "") +
    (clip.mp4 ? `<source src="${base}media/clips/${id}.mp4" type="video/mp4">` : "");
  const poster = clip.poster ? ` poster="${base}media/clips/${id}.avif"` : "";
  const video = `<video class="fmt-video${clip.poster ? " has-poster" : ""}" muted loop playsinline preload="none"${poster} aria-hidden="true" tabindex="-1" data-lazy-video>${sources}</video>`;
  // With a poster the clip stands alone; without one the animated scene shows until it plays.
  return clip.poster ? video : scene + video;
}

export function formats(copy: SiteCopy, links: Links, media: MediaManifest, base: string): string {
  const fm = copy.formats;
  const cards = FORMAT_IDS.map((id) => {
    const item = fm.items[id];
    // The link is named by its visible text plus hidden punctuation and the action, never by an
    // aria-label, so speech-input users can say what they see (WCAG 2.5.3).
    const [comma, stop] = copy.locale === "zh" ? ["，", "。"] : [", ", ". "];
    return `<li class="fmt">
        <a class="fmt-link" href="${links.example(STUDIO_EXAMPLE[id])}">
          <span class="fmt-media">${clipMedia(id, media, base)}</span>
          <span class="fmt-text"><span class="fmt-name">${esc(item.name)}</span><span class="sr-only">${comma}</span><span class="fmt-cap">${esc(item.caption)}</span><span class="sr-only">${stop}${esc(fm.open)}</span></span>
        </a>
      </li>`;
  }).join("\n      ");
  return `<section class="formats" id="formats" aria-labelledby="formats-title">
  <div class="wrap formats-head">
    <div class="formats-intro" data-reveal>
      <h2 id="formats-title" class="h2 display">${esc(fm.title)}</h2>
      <p class="lead">${esc(fm.sub)}</p>
    </div>
    <div class="strip-ctrl">
      <button class="round" type="button" aria-label="${esc(fm.prev)}" data-strip-prev disabled>${icon("caret-left", { size: 18 })}</button>
      <button class="round" type="button" aria-label="${esc(fm.next)}" data-strip-next>${icon("caret-right", { size: 18 })}</button>
    </div>
  </div>
  <div class="strip" role="region" aria-label="${esc(fm.regionLabel)}" data-strip>
    <ul class="strip-track">
      ${cards}
    </ul>
  </div>
</section>`;
}
