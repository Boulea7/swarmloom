/**
 * Gates of the CLI tests that drive a real browser and ffmpeg: whether the built render page is current.
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

/**
 * Why the built render page (packages/export/dist/render) cannot be used: it is not built, or one of its build
 * inputs changed after the build. Those are every packages/<name>/src (the page bundles them from src/),
 * the page's own folder packages/export/render and its Vite config; a stale build would test old code.
 */
export function renderPageProblem(repo: string): string | undefined {
  const page = path.join(repo, "packages/export/dist/render/index.html");
  const rebuild = "run pnpm -F @swarmloom/export build";
  if (!existsSync(page)) return `render page not built yet: ${rebuild}`;
  const builtAt = statSync(page).mtimeMs;
  const inputs = [
    ...readdirSync(path.join(repo, "packages")).map((name) => `packages/${name}/src`),
    "packages/export/render",
    "packages/export/vite.render.config.ts",
  ];
  const changed = inputs.find((input) => changedAfter(path.join(repo, input), builtAt));
  return changed ? `render page is older than ${changed}: ${rebuild}` : undefined;
}

/** True when the file, or anything under the folder, was modified after `time`; false when it does not exist. */
function changedAfter(file: string, time: number): boolean {
  if (!existsSync(file)) return false;
  if (!statSync(file).isDirectory()) return statSync(file).mtimeMs > time;
  const entries = readdirSync(file, { recursive: true, encoding: "utf8" });
  return entries.some((entry) => statSync(path.join(file, entry)).mtimeMs > time);
}
