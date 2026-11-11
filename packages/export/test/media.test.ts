import { expect, it } from "vitest";
import { type ColorScheme, pinnedQuery } from "../src/browser/media";

const NEVER = "(width < 0px)";
const ALWAYS = "(width >= 0px)";

it.each<[string, string, ColorScheme?]>([
  ["(prefers-reduced-motion: reduce)", NEVER],
  ["(prefers-reduced-motion)", NEVER],
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
])("pins %s", (query, pinned, scheme = "light") => {
  expect(pinnedQuery(query, scheme)).toBe(pinned);
});
