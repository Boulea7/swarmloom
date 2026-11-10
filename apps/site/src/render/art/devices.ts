/**
 * Device mockups drawn in SVG (original line art, no product likeness). Each screen hosts an
 * animated build scene, so the line-up shows SwarmLoom running without any video files.
 */

import type { DeviceId } from "../../content/types";
import { esc } from "../html";
import { foldableScene, watchScene, webScene } from "./scenes";

interface DeviceArt {
  /** viewBox width and height of the whole device. */
  w: number;
  h: number;
  body: (id: string) => string;
}

function clip(id: string, x: number, y: number, w: number, h: number, r: number): string {
  return `<clipPath id="${id}"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}"/></clipPath>`;
}

function screen(x: number, y: number, w: number, h: number, r: number): string {
  return `<rect class="dv-screen" x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}"/>`;
}

const DEVICES: Record<DeviceId, DeviceArt> = {
  laptop: {
    w: 600,
    h: 372,
    body: (id) => {
      const sx = 54;
      const sy = 16;
      const sw = 492;
      const sh = 308;
      return (
        `<defs>${clip(`${id}-s`, sx, sy, sw, sh, 6)}</defs>` +
        '<rect class="dv-shell" x="40" y="2" width="520" height="336" rx="18"/>' +
        screen(sx, sy, sw, sh, 6) +
        webScene(sw, sh, {
          tags: true,
          colors: [0, 1, 2],
          names: 0,
          place: { x: sx, y: sy, w: sw, h: sh, clip: `${id}-s` },
        }) +
        '<path class="dv-base" d="M0 340 H600 V346 C600 356 590 366 576 368 C450 372 150 372 24 368 C10 366 0 356 0 346 Z"/>' +
        '<path class="dv-edge" d="M250 340 H350 C350 345 344 348 338 348 H262 C256 348 250 345 250 340 Z"/>'
      );
    },
  },
  tablet: {
    w: 252,
    h: 336,
    body: (id) => {
      const sx = 12;
      const sy = 12;
      const sw = 228;
      const sh = 312;
      return (
        `<defs>${clip(`${id}-s`, sx, sy, sw, sh, 12)}</defs>` +
        '<rect class="dv-shell" x="0" y="0" width="252" height="336" rx="24"/>' +
        screen(sx, sy, sw, sh, 12) +
        webScene(sw, sh, { colors: [3, 4, 5], names: 3, place: { x: sx, y: sy, w: sw, h: sh, clip: `${id}-s` } })
      );
    },
  },
  foldable: {
    w: 256,
    h: 230,
    body: (id) => {
      const sx = 9;
      const sy = 9;
      const sw = 238;
      const sh = 212;
      return (
        `<defs>${clip(`${id}-s`, sx, sy, sw, sh, 10)}</defs>` +
        '<rect class="dv-shell" x="0" y="0" width="256" height="230" rx="18"/>' +
        screen(sx, sy, sw, sh, 10) +
        foldableScene(sw, sh, { x: sx, y: sy, w: sw, h: sh, clip: `${id}-s` }) +
        `<line class="dv-crease" x1="128" y1="${sy}" x2="128" y2="${sy + sh}"/>`
      );
    },
  },
  phone: {
    w: 132,
    h: 272,
    body: (id) => {
      const sx = 6;
      const sy = 6;
      const sw = 120;
      const sh = 260;
      return (
        `<defs>${clip(`${id}-s`, sx, sy, sw, sh, 20)}</defs>` +
        '<rect class="dv-shell" x="0" y="0" width="132" height="272" rx="26"/>' +
        screen(sx, sy, sw, sh, 20) +
        webScene(sw, sh, {
          colors: [6, 0, 8],
          names: 6,
          place: { x: sx, y: sy + 18, w: sw, h: sh - 18, clip: `${id}-s` },
        }) +
        '<rect class="dv-island" x="48" y="13" width="36" height="10" rx="5"/>'
      );
    },
  },
  watch: {
    w: 96,
    h: 160,
    body: (id) => {
      const sx = 14;
      const sy = 36;
      const sw = 68;
      const sh = 88;
      return (
        `<defs>${clip(`${id}-s`, sx, sy, sw, sh, 20)}</defs>` +
        '<rect class="dv-band" x="26" y="0" width="44" height="40" rx="10"/>' +
        '<rect class="dv-band" x="26" y="120" width="44" height="40" rx="10"/>' +
        '<rect class="dv-edge" x="86" y="62" width="6" height="18" rx="3"/>' +
        '<rect class="dv-shell" x="8" y="30" width="80" height="100" rx="26"/>' +
        screen(sx, sy, sw, sh, 20) +
        watchScene(sw, sh, { x: sx, y: sy, w: sw, h: sh, clip: `${id}-s` })
      );
    },
  },
};

/** Size of a device drawing in design units (used for relative widths in the line-up). */
export function deviceSize(device: DeviceId): { w: number; h: number } {
  const { w, h } = DEVICES[device];
  return { w, h };
}

/**
 * Inline SVG of a device with an animated stage on its screen.
 * @param label Accessible name (the device name in the page locale).
 */
export function deviceSvg(device: DeviceId, label: string): string {
  const art = DEVICES[device];
  const id = `dv-${device}`;
  return (
    `<svg class="device-art" viewBox="0 0 ${art.w} ${art.h}" role="img" aria-label="${esc(label)}" data-scene>` +
    art.body(id) +
    "</svg>"
  );
}
