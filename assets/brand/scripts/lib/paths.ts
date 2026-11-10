import { resolve } from "node:path";

/** Absolute path of assets/brand (the directory every generated asset is written to). */
export const BRAND_DIR = resolve(import.meta.dirname, "../..");

/** Absolute path of the committed display font used by the raster renders. */
export const DISPLAY_FONT = resolve(BRAND_DIR, "fonts/BricolageGrotesque-Bold.latin.woff2");

/** Absolute path of the committed medium-weight display font. */
export const DISPLAY_FONT_MEDIUM = resolve(BRAND_DIR, "fonts/BricolageGrotesque-Medium.latin.woff2");
