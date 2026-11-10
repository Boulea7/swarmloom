import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MissingDependencyError } from "./errors";

/**
 * Files the CLI ships next to its code (copied into dist/ by scripts/build.mjs):
 *  - dist/render/      the headless render page of @swarmloom/export (index.html + render.js + adapter chunks)
 *  - dist/studio/      the Studio PWA build of apps/studio
 *  - dist/snapshot.js  IIFE that exposes @swarmloom/snapshot-dom as window.__swarmloomSnapshot
 * Each can be overridden by an environment variable, which is how development builds and tests point
 * the CLI at other copies.
 */
export interface AssetPaths {
  renderDir?: string;
  studioDir?: string;
  snapshotBundle?: string;
}

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));

/**
 * Candidate locations relative to the running module. The bundle runs from apps/cli/dist/, the sources
 * (tests) from apps/cli/src/; both are three levels below the repository root, so workspace fallbacks
 * (packages/export/dist/render, apps/studio/dist) resolve the same way from either.
 */
function candidates(moduleDir: string, bundled: string, workspace: string): string[] {
  return [
    path.join(moduleDir, bundled),
    path.join(moduleDir, "..", "dist", bundled),
    path.join(moduleDir, "..", "..", "..", workspace),
  ];
}

/**
 * Finds the bundled assets, honouring SWARMLOOM_RENDER_DIR, SWARMLOOM_STUDIO_DIR and
 * SWARMLOOM_SNAPSHOT_BUNDLE overrides. Missing assets are left undefined; commands that need
 * one call the matching `require*` helper.
 */
export function locateAssets(
  env: Readonly<Record<string, string | undefined>>,
  moduleDir: string = MODULE_DIR,
): AssetPaths {
  const firstDir = (list: string[]) => list.find((dir) => existsSync(path.join(dir, "index.html")));
  const pick = (override: string | undefined, list: string[], test: (list: string[]) => string | undefined) =>
    override ? path.resolve(override) : test(list);
  return {
    renderDir: pick(env.SWARMLOOM_RENDER_DIR, candidates(moduleDir, "render", "packages/export/dist/render"), firstDir),
    studioDir: pick(env.SWARMLOOM_STUDIO_DIR, candidates(moduleDir, "studio", "apps/studio/dist"), firstDir),
    snapshotBundle: pick(
      env.SWARMLOOM_SNAPSHOT_BUNDLE,
      [path.join(moduleDir, "snapshot.js"), path.join(moduleDir, "..", "dist", "snapshot.js")],
      (list) => list.find((file) => existsSync(file)),
    ),
  };
}

const SOURCE_HINT = "Reinstall swarmloom. In a source checkout run: pnpm build";

/** @throws MissingDependencyError when the render page is not available. */
export function requireRenderDir(assets: AssetPaths): string {
  const dir = assets.renderDir;
  if (dir && existsSync(path.join(dir, "index.html"))) return dir;
  throw new MissingDependencyError(
    dir ? `Render page not found in ${dir}` : "The render page (@swarmloom/export) is not bundled with this build",
    `${SOURCE_HINT} (or set SWARMLOOM_RENDER_DIR to packages/export/dist/render).`,
  );
}

/** @throws MissingDependencyError when the Studio build is not available. */
export function requireStudioDir(assets: AssetPaths): string {
  const dir = assets.studioDir;
  if (dir && existsSync(path.join(dir, "index.html"))) return dir;
  throw new MissingDependencyError(
    dir ? `Studio build not found in ${dir}` : "Studio is not bundled with this build",
    `${SOURCE_HINT} (or set SWARMLOOM_STUDIO_DIR to apps/studio/dist).`,
  );
}

/** @throws MissingDependencyError when the snapshot script is not available. */
export function requireSnapshotBundle(assets: AssetPaths): string {
  const file = assets.snapshotBundle;
  if (file && existsSync(file)) return file;
  throw new MissingDependencyError(
    file ? `Snapshot script not found at ${file}` : "The page snapshot script is not bundled with this build",
    `${SOURCE_HINT} (or set SWARMLOOM_SNAPSHOT_BUNDLE).`,
  );
}
