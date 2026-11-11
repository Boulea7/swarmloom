/**
 * Inputs of the build-time renderer. The renderer is pure: everything that depends on the file
 * system (which media files exist, which brand assets were copied) arrives through this context.
 */

import type { FormatId, Locale } from "../content/types";

/** Media files expected under `public/media/` (see scripts/fetch-media.mjs). */
export interface MediaManifest {
  /** Promo films present, per locale (`promo-<locale>.mp4`). */
  promo: Record<Locale, boolean>;
  /** `promo-poster.avif`. */
  promoPoster: boolean;
  /** Caption tracks present (`promo-<locale>.vtt`). */
  captions: Record<Locale, boolean>;
  /** Per format: which clip encodings and poster exist under `clips/`. */
  clips: Partial<Record<FormatId, { mp4: boolean; webm: boolean; poster: boolean }>>;
}

/** Brand assets copied into the build (owned by the brand zone in assets/brand/). */
export interface BrandManifest {
  /** `og-<locale>.png`, 1200x630. */
  og: Record<Locale, boolean>;
  /** `favicon.svg`. */
  favicon: boolean;
  /** `icon-192.png`, used as the apple-touch-icon. */
  appleTouchIcon: boolean;
  /** `logo.svg` and `logo-dark.svg` (light and dark backgrounds), used for the nav and footer mark. */
  logo: boolean;
}

/** Everything the renderer needs besides the copy. */
export interface RenderContext {
  /** Public base path, "/" in dev, "/swarmloom/" on Pages. Always ends with "/". */
  base: string;
  /** Absolute production URL of the base, used for canonical, hreflang, OG and the sitemap. */
  siteUrl: string;
  media: MediaManifest;
  brand: BrandManifest;
  /** Font files to preload (site-relative paths). */
  fonts: string[];
  /** Inline bootstrap script (minified), executed before first paint. */
  earlyScript: string;
  /** Module entry path for Vite to bundle. */
  entry: string;
  /** Stylesheet path for Vite to bundle (render-blocking, in the head). */
  stylesheet: string;
}

/** An empty manifest: no media at all (local dev before fetch-media ran). */
export function emptyMedia(): MediaManifest {
  return {
    promo: { zh: false, en: false },
    promoPoster: false,
    captions: { zh: false, en: false },
    clips: {},
  };
}

/** An empty brand manifest: nothing copied, the renderer falls back to its own inline art. */
export function emptyBrand(): BrandManifest {
  return { og: { zh: false, en: false }, favicon: false, appleTouchIcon: false, logo: false };
}
