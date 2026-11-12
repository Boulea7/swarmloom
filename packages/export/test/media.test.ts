import { expect, it } from "vitest";
import { type ColorScheme, pinnedQuery } from "../src/browser/media";

/** A 640 x 360 export, which the CLI renders with a screen of that size. */
const SIZE = { width: 640, height: 360 };

const NEVER = "(width < 0px)";
const ALWAYS = "(width >= 0px)";

it.each<[string, string, ColorScheme?]>([
  ["(prefers-reduced-motion: reduce)", NEVER],
  ["(prefers-reduced-motion)", NEVER],
  ["(forced-colors: active), (prefers-contrast: more)", `${NEVER}, ${NEVER}`],
  ["(forced-colors: none) and (prefers-contrast: no-preference)", `${ALWAYS} and ${ALWAYS}`],
  ["not all and (prefers-reduced-motion: no-preference)", `not all and ${ALWAYS}`],
  ["only screen and (min-resolution: 2dppx), print", `only screen and ${NEVER}, print`],
  ["(-webkit-min-device-pixel-ratio: 1.5)", NEVER],
  ["(max-resolution: 96dpi)", ALWAYS],
  ["(resolution)", ALWAYS],
  ["(1dppx <= resolution < 2x)", ALWAYS],
  ["(-webkit-device-pixel-ratio > 1)", NEVER],
  ["(min-width: 600px) and (prefers-color-scheme: dark)", `(min-width: 600px) and ${NEVER}`],
  ["(prefers-color-scheme: dark)", ALWAYS, "dark"],
  ["(prefers-color-scheme)", "(prefers-color-scheme)"],
  ["(color-gamut: p3), (color-gamut: srgb) and (dynamic-range: high)", `${NEVER}, ${ALWAYS} and ${NEVER}`],
  [
    "(pointer: coarse), (any-hover: none), (hover) and (any-pointer: fine)",
    `${NEVER}, ${NEVER}, ${ALWAYS} and ${ALWAYS}`,
  ],
  ["(display-mode: standalone), (display-mode: browser), (dynamic-range)", `${NEVER}, ${ALWAYS}, (dynamic-range)`],
  [
    "(max-device-width: 480px), (device-aspect-ratio: 16 / 9) and (min-device-height: 22.5em)",
    `${NEVER}, ${ALWAYS} and ${ALWAYS}`,
  ],
  ["(color: 8) and (monochrome), (prefers-reduced-transparency: reduce)", `${ALWAYS} and ${NEVER}, ${NEVER}`],
])("pins %s", (query, pinned, scheme = "light") => {
  expect(pinnedQuery(query, { scheme, ...SIZE })).toBe(pinned);
});
