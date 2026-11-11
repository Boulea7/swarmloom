/**
 * Gates of the CLI tests that drive a real browser and ffmpeg: finding those programs, deciding whether a
 * missing one skips or fails the tests, and whether the built render page is current.
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

type Env = Record<string, string | undefined>;

/** True on a CI runner (`CI=1` or `CI=true`). */
export function inCi(env: Env = process.env): boolean {
  return /^(1|true)$/i.test(env.CI ?? "");
}

/**
 * Finds a program a test needs. A path the run set in `envName` that does not work always throws, so a
 * misconfigured run fails; a program that is simply not installed resolves to undefined.
 */
export async function findOptional<T>(
  envName: string,
  find: () => T | Promise<T>,
  env: Env = process.env,
): Promise<T | undefined> {
  try {
    return await find();
  } catch (error) {
    if (env[envName]) throw error;
    return undefined;
  }
}

/**
 * Returns why the tests skip, or throws it where the programs are required: under CI, unless the job sets
 * SWARMLOOM_TEST_DEPS=optional because it does not provide them (CI's e2e job does and runs these tests).
 */
export function skipReason(missing: string | undefined, env: Env = process.env): string | undefined {
  if (missing && inCi(env) && env.SWARMLOOM_TEST_DEPS !== "optional") {
    throw new Error(`${missing}; CI requires it (a job without it sets SWARMLOOM_TEST_DEPS=optional)`);
  }
  return missing;
}

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
