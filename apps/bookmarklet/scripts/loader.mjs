// Builds the minified loader code (the body of the javascript: URL) with esbuild.
// Shared by scripts/build.mjs and the loader size test.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Default wait for the bundle before falling back to the Studio, ms. */
export const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * @param {{ bundleUrl: string; studioUrl: string; options: string; timeout?: number }} config
 * @returns {Promise<string>} Minified IIFE source without a trailing newline.
 */
export async function buildLoaderCode(config) {
  const result = await build({
    entryPoints: [join(root, "src/loader-entry.ts")],
    bundle: true,
    write: false,
    minify: true,
    format: "iife",
    target: "es2020",
    charset: "ascii",
    legalComments: "none",
    logLevel: "silent",
    // LoaderConfig keys only: payload keys are part of the Studio protocol and must stay readable.
    mangleProps: /^(bundleUrl|studioUrl|options|timeout)$/,
    define: {
      __SWARMLOOM_BUNDLE_URL__: JSON.stringify(config.bundleUrl),
      __SWARMLOOM_STUDIO_URL__: JSON.stringify(config.studioUrl),
      __SWARMLOOM_OPTIONS__: JSON.stringify(config.options),
      __SWARMLOOM_TIMEOUT__: String(config.timeout ?? DEFAULT_TIMEOUT_MS),
    },
  });
  // The directive esbuild copies from tsconfig changes nothing here.
  return result.outputFiles[0].text.trim().replace(/^"use strict";/, "");
}
