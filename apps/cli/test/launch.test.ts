// @vitest-environment node
/**
 * launchBrowser keeps Chromium's sandbox on and drops it, with a warning, only when the sandbox
 * itself cannot start and the command does not require it. The cases that keep the sandbox stub
 * Playwright's launch, so they run on every OS; the fallback cases put a shell stand-in that logs
 * how it was started in front of a real browser, so they need /bin/sh and skip on Windows.
 */
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { chromeArgs, launchBrowser } from "../src/browser/launch";
import { snapshotCommand } from "../src/commands/snapshot";
import { findBrowser } from "../src/discovery/browser";
import { systemHost } from "../src/discovery/host";
import { MissingDependencyError } from "../src/errors";
import { findOptional, skipReason } from "./real-deps";

const chrome = (await findOptional("SWARMLOOM_CHROME", () => findBrowser(systemHost())))?.path;
// Under CI a missing browser fails the file instead of skipping the fallback tests (see skipReason).
const missing = skipReason(chrome ? undefined : "no Chrome/Chromium found (set SWARMLOOM_CHROME)");
const skipped = missing ? ` (skipped: ${missing})` : "";
const SNAPSHOT_DOUBLE = path.join(import.meta.dirname, "fixtures/snapshot.js");

const NO_USABLE_SANDBOX = "[FATAL:zygote_host_impl_linux.cc(132)] No usable sandbox!";

describe("launchBrowser", () => {
  afterEach(() => vi.restoreAllMocks());

  it.each([
    {
      why: "other start failures",
      stderr: "error while loading shared libraries: libnss3.so",
      requireSandbox: false,
      error: /Could not start the browser/,
    },
    { why: "--require-sandbox", stderr: NO_USABLE_SANDBOX, requireSandbox: true, error: /sandbox does not start/ },
  ])("does not drop the sandbox for $why", async ({ stderr, requireSandbox, error }) => {
    const { chromium } = await import("playwright-core");
    const launch = vi
      .spyOn(chromium, "launch")
      .mockRejectedValue(new Error(`browserType.launch: Browser closed.\n[pid=1][err] ${stderr}`));
    const warnings: string[] = [];
    const onUnsandboxed = (warning: string) => warnings.push(warning);
    const launched = launchBrowser("chrome", { webPages: true, requireSandbox, onUnsandboxed });
    await expect(launched).rejects.toThrow(MissingDependencyError);
    await expect(launched).rejects.toThrow(error);
    expect(launch.mock.calls.map(([options]) => options?.chromiumSandbox)).toEqual([true]);
    expect(warnings).toEqual([]);
  });
});

describe.skipIf(process.platform === "win32")("launchBrowser behind a shell stand-in", () => {
  let dir = "";
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  /**
   * A browser that logs whether it got --no-sandbox, and its arguments, then runs `sandboxed` or
   * `unsandboxed`. `launches()` returns one argument list per start, led by how it started.
   */
  function standIn(sandboxed: string, unsandboxed: string): { exe: string; launches: () => string[][] } {
    dir = mkdtempSync(path.join(tmpdir(), "swarmloom-launch-"));
    const log = path.join(dir, "launches.log");
    const exe = path.join(dir, "chrome");
    writeFileSync(
      exe,
      `#!/bin/sh
case " $* " in
  *" --no-sandbox "*) echo "unsandboxed $*" >> '${log}'; ${unsandboxed} ;;
  *) echo "sandboxed $*" >> '${log}'; ${sandboxed} ;;
esac
`,
    );
    chmodSync(exe, 0o755);
    return {
      exe,
      launches: () =>
        readFileSync(log, "utf8")
          .trim()
          .split("\n")
          .map((line) => line.split(" ")),
    };
  }

  const noSandbox = `echo '${NO_USABLE_SANDBOX}' >&2; exit 1`;

  it.skipIf(missing).each([
    { webPages: true, webgl: false },
    { webPages: false, webgl: true },
  ])(
    `starts sandboxed, and falls back with a warning when the sandbox cannot start (web pages: $webPages)${skipped}`,
    async ({ webPages, webgl }) => {
      const { exe, launches } = standIn(noSandbox, `exec '${chrome}' "$@"`);
      const warnings: string[] = [];
      const onUnsandboxed = (warning: string) => warnings.push(warning);
      const browser = await launchBrowser(exe, { webPages, requireSandbox: false, onUnsandboxed });
      try {
        const page = await browser.newPage();
        // Web pages must not reach SwiftShader in a GPU process without a sandbox; the render page's 3D models do.
        expect(await page.evaluate(() => document.createElement("canvas").getContext("webgl") !== null)).toBe(webgl);
      } finally {
        await browser.close();
      }
      const [first, second = []] = launches();
      expect([first?.[0], second[0]]).toEqual(["sandboxed", "unsandboxed"]);
      expect(second.includes("--enable-unsafe-swiftshader")).toBe(webgl);
      expect(warnings).toEqual([expect.stringContaining("only open pages you trust")]);
    },
    90_000,
  );

  it.skipIf(missing)(
    `shows the warning under --quiet${skipped}`,
    async () => {
      const { exe } = standIn(noSandbox, `exec '${chrome}' "$@"`);
      writeFileSync(path.join(dir, "page.html"), "<!doctype html><title>t</title><p>text</p>");
      const err: string[] = [];
      const argv = [path.join(dir, "page.html"), "-o", "-", "--chrome", exe, "--quiet"];
      const code = await snapshotCommand.run(argv, {
        io: { out: () => {}, err: (line) => err.push(line) },
        cwd: dir,
        env: {},
        assets: { snapshotBundle: SNAPSHOT_DOUBLE },
      });
      expect(code).toBe(0);
      expect(err).toEqual([expect.stringContaining("runs without one")]);
    },
    90_000,
  );
});

it.each([
  ["linux", false],
  ["win32", false],
  ["darwin", true],
] as const)("on %s, leaves the GPU out: %s", (platform, noGpu) => {
  expect(chromeArgs(platform).includes("--disable-gpu")).toBe(noGpu);
});
