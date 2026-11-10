// @ts-check
/** Command-line plumbing shared by the release scripts. */
import { appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Runs `main` when the calling module is the process entry point (not when a test imports it).
 * Errors are printed as one readable line and exit with status 1; `main` may return a status code.
 * @param {string} moduleUrl the caller's import.meta.url
 * @param {string} name script name used as the message prefix
 * @param {() => number | undefined | void | Promise<number | undefined | void>} main
 */
export function runIfMain(moduleUrl, name, main) {
  const entry = process.argv[1];
  if (!entry || resolve(entry) !== fileURLToPath(moduleUrl)) return;
  Promise.resolve()
    .then(main)
    .then(
      (code) => {
        if (typeof code === "number") process.exitCode = code;
      },
      (error) => {
        console.error(`${name}: ${error instanceof Error ? error.message : String(error)}`);
        process.exitCode = 1;
      },
    );
}

/**
 * Writes `key=value` step outputs to $GITHUB_OUTPUT in GitHub Actions, or to stdout elsewhere.
 * @param {Record<string, string>} outputs
 */
export function writeOutputs(outputs) {
  const text = Object.entries(outputs)
    .map(([key, value]) => {
      if (/[\r\n]/.test(value)) throw new Error(`Output ${key} must be a single line`);
      return `${key}=${value}\n`;
    })
    .join("");
  const target = process.env.GITHUB_OUTPUT;
  if (target) appendFileSync(target, text);
  else process.stdout.write(text);
}
