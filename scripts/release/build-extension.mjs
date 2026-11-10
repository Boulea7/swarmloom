#!/usr/bin/env node
// @ts-check
/**
 * Builds the browser extension together with the Studio it bundles.
 *
 * 1. Builds the Studio in extension mode (STUDIO_TARGET=extension: relative base, no service worker) and the
 *    workspace packages the extension depends on.
 * 2. Builds the extension for every target; its build copies the Studio from SWARMLOOM_STUDIO_DIR into each
 *    package as studio.html + assets.
 *
 * Usage: node scripts/release/build-extension.mjs [--without-studio]
 *   --without-studio  build only the extension (local checks; release packages must include the Studio)
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { runIfMain } from "./lib/cli.mjs";

/** Where the Studio writes its extension-mode build (read by apps/extension/scripts/build.mjs). */
export const STUDIO_EXTENSION_DIR = "apps/studio/dist-extension";

/**
 * Returns the Studio entry file inside an extension-mode build, or undefined when the build is missing.
 * @param {string} dir
 * @param {(path: string) => boolean} [exists]
 * @returns {string | undefined}
 */
export function findStudioEntry(dir, exists = existsSync) {
  return ["studio.html", "index.html"].find((name) => exists(join(dir, name)));
}

/**
 * Runs pnpm with fixed arguments. Windows needs a shell to start pnpm.cmd; no argument comes from user input.
 * @param {string[]} args
 * @param {NodeJS.ProcessEnv} env
 */
function pnpm(args, env) {
  console.log(`$ pnpm ${args.join(" ")}`);
  execFileSync("pnpm", args, { stdio: "inherit", env, shell: process.platform === "win32" });
}

function main() {
  const { values } = parseArgs({ options: { "without-studio": { type: "boolean", default: false } } });
  const env = { ...process.env };
  if (values["without-studio"]) {
    pnpm(["--filter", "@swarmloom/extension...", "build"], env);
    return;
  }
  const studioDir = resolve(STUDIO_EXTENSION_DIR);
  // The Studio and the extension's dependencies first; the extension does not depend on the Studio, so a single
  // pnpm run could build them in either order.
  pnpm(["--filter", "@swarmloom/studio...", "--filter", "@swarmloom/extension^...", "build"], {
    ...env,
    STUDIO_TARGET: "extension",
  });
  if (!findStudioEntry(studioDir)) {
    throw new Error(
      `${STUDIO_EXTENSION_DIR}/studio.html (or index.html) not found after building the Studio with ` +
        "STUDIO_TARGET=extension. The Studio build must write its extension mode there; " +
        "use --without-studio only for local checks.",
    );
  }
  pnpm(["--filter", "@swarmloom/extension", "build"], { ...env, SWARMLOOM_STUDIO_DIR: studioDir });
}

runIfMain(import.meta.url, "build-extension", main);
