/**
 * @swarmloom/core: engine, choreography, stage, overlay, sound, player and toolbar UI.
 *
 * The types shared by every package live in `./types` (the contract); the few others are exported
 * next to the functions that take them. The rules that tell whether a seek can start an animation,
 * which the HTML capture and the export share and which may change in any release, are exported from
 * `@swarmloom/core/internal` instead.
 */

export type { RealtimeClockOptions } from "./clock";
export { RealtimeClock, VirtualClock } from "./clock";
export { missingFonts } from "./font-probe";
export type { FontFallback, GenericFontFamily, ResolvedFontFamily } from "./fonts";
export { cleanFontFamily, FONT_FALLBACKS, formatFontFamily, resolveFontFamily } from "./fonts";
export type { Locale } from "./i18n/index";
export { CATALOGS, createI18n, LOCALES } from "./i18n/index";
export type { I18n } from "./internal";
export { createPlayer } from "./player";
export { definePlugin } from "./plugin";
export { createRng } from "./rng";
export type { RenderOfflineOptions } from "./sound/index";
export { encodeWav, quantize, renderOffline, soundTimes } from "./sound/index";
export { holdAllCssImages } from "./stage/layers/still-css";
export { holdSvgImages, stillImageSource } from "./stage/layers/still-image";
export type * from "./types";
