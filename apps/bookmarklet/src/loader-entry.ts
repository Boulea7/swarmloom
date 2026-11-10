/**
 * Entry of the bookmarklet build: scripts/loader.mjs minifies this file into the `javascript:` URL.
 * The `__SWARMLOOM_*__` identifiers are substituted with literals at build time.
 */
import { runLoader } from "./loader";

declare const __SWARMLOOM_BUNDLE_URL__: string;
declare const __SWARMLOOM_STUDIO_URL__: string;
declare const __SWARMLOOM_OPTIONS__: string;
declare const __SWARMLOOM_TIMEOUT__: number;

runLoader(window, document, {
  bundleUrl: __SWARMLOOM_BUNDLE_URL__,
  studioUrl: __SWARMLOOM_STUDIO_URL__,
  options: __SWARMLOOM_OPTIONS__,
  timeout: __SWARMLOOM_TIMEOUT__,
});
