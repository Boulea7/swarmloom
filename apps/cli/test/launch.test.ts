// @vitest-environment node
/**
 * launchBrowser keeps Chromium's sandbox on and drops it, with a warning, only when the sandbox
 * itself cannot start. A shell stand-in for the browser logs how it was started.
 */
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { launchBrowser } from "../src/browser/launch";
import { findBrowser } from "../src/discovery/browser";
import { systemHost } from "../src/discovery/host";
import { MissingDependencyError } from "../src/errors";
import { findOptional } from "./real-deps";

const chrome = (await findOptional("SWARMLOOM_CHROME", () => findBrowser(systemHost())))?.path;

describe.skipIf(process.platform === "win32")("launchBrowser", () => {
  let dir = "";
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  /** A browser that logs whether it got --no-sandbox, then runs `sandboxed` or `unsandboxed`. */
  function standIn(sandboxed: string, unsandboxed: string): { exe: string; launches: () => string[] } {
    dir = mkdtempSync(path.join(tmpdir(), "swarmloom-launch-"));
    const log = path.join(dir, "launches.log");
    const exe = path.join(dir, "chrome");
    writeFileSync(
      exe,
      `#!/bin/sh
case " $* " in
  *" --no-sandbox "*) echo unsandboxed >> '${log}'; ${unsandboxed} ;;
  *) echo sandboxed >> '${log}'; ${sandboxed} ;;
esac
`,
    );
    chmodSync(exe, 0o755);
    return { exe, launches: () => readFileSync(log, "utf8").trim().split("\n") };
  }

  const noSandbox = "echo '[FATAL:zygote_host_impl_linux.cc(132)] No usable sandbox!' >&2; exit 1";

  it.skipIf(!chrome)(
    "starts sandboxed, and falls back with a warning when the sandbox cannot start",
    async () => {
      const { exe, launches } = standIn(noSandbox, `exec '${chrome}' "$@"`);
      const warnings: string[] = [];
      const browser = await launchBrowser(exe, (warning) => warnings.push(warning));
      await browser.close();
      expect(launches()).toEqual(["sandboxed", "unsandboxed"]);
      expect(warnings).toEqual([expect.stringContaining("only open pages you trust")]);
    },
    90_000,
  );

  it("does not drop the sandbox for other start failures", async () => {
    const { exe, launches } = standIn("echo 'error while loading shared libraries' >&2; exit 127", "exit 0");
    const warnings: string[] = [];
    await expect(launchBrowser(exe, (warning) => warnings.push(warning))).rejects.toThrow(MissingDependencyError);
    expect(launches()).toEqual(["sandboxed"]);
    expect(warnings).toEqual([]);
  }, 90_000);
});
