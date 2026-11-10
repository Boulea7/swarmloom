import { describe, expect, it } from "vitest";
import { findBrowser } from "../src/discovery/browser";
import { type FfmpegDiscoveryDeps, findFfmpeg, parseFfmpegVersion } from "../src/discovery/ffmpeg";
import type { HostEnv } from "../src/discovery/host";
import { cachedRevision } from "../src/discovery/playwright";
import { MissingDependencyError } from "../src/errors";

/** A fake machine: only the listed files exist (and are executable); directories are implied by them. */
function fakeHost(platform: NodeJS.Platform, files: string[], env: Record<string, string> = {}): HostEnv {
  const set = new Set(files);
  const homedir = platform === "win32" ? "C:\\Users\\me" : platform === "darwin" ? "/Users/me" : "/home/me";
  const sep = platform === "win32" ? "\\" : "/";
  const listDir = (dir: string) => {
    const prefix = dir.endsWith(sep) ? dir : dir + sep;
    const names = files.filter((f) => f.startsWith(prefix)).map((f) => f.slice(prefix.length).split(sep)[0] ?? "");
    return [...new Set(names)];
  };
  return { platform, env, homedir, isExecutable: (file) => set.has(file), listDir };
}

/** Files of a complete Playwright download of `build` at `revision` in the Linux cache. */
function cached(build: string, revision: string, layout: string, complete = true): string[] {
  const dir = `/home/me/.cache/ms-playwright/${build}-${revision}`;
  return [`${dir}/${layout}`, ...(complete ? [`${dir}/INSTALLATION_COMPLETE`] : [])];
}

describe("browser discovery", () => {
  const SHELL = "chrome-headless-shell-linux64/chrome-headless-shell";
  const MAC_CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  const WIN_EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
  const WIN_ENV = { ProgramFiles: "C:\\Program Files", "ProgramFiles(x86)": "C:\\Program Files (x86)" };
  const WIN_SHELL =
    "C:\\Users\\me\\AppData\\Local\\ms-playwright\\chromium_headless_shell-1254\\chrome-headless-shell-win64\\chrome-headless-shell.exe";
  const pinned = { revisions: { "chromium-headless-shell": "1254" } };

  it.each([
    [
      "flag beats env",
      fakeHost("linux", ["/a/chrome", "/b/chrome"], { SWARMLOOM_CHROME: "/b/chrome" }),
      "/a/chrome",
      "--chrome",
    ],
    [
      "env beats the headless shell",
      fakeHost("linux", ["/b/chrome", ...cached("chromium_headless_shell", "1254", SHELL)], {
        SWARMLOOM_CHROME: "/b/chrome",
      }),
      "/b/chrome",
      "SWARMLOOM_CHROME",
    ],
    [
      "pinned headless shell beats a newer one and installed Chrome",
      fakeHost(
        "linux",
        [
          "/usr/bin/chromium",
          ...cached("chromium_headless_shell", "1254", SHELL),
          ...cached("chromium_headless_shell", "1300", SHELL),
        ],
        { PATH: "/usr/bin" },
      ),
      `/home/me/.cache/ms-playwright/chromium_headless_shell-1254/${SHELL}`,
      "Playwright headless shell",
    ],
    [
      "an unfinished download is skipped",
      fakeHost("linux", ["/usr/bin/chromium", ...cached("chromium_headless_shell", "1254", SHELL, false)], {
        PATH: "/usr/bin",
      }),
      "/usr/bin/chromium",
      "PATH",
    ],
    [
      "snap Chromium only after other installs",
      fakeHost("linux", ["/snap/bin/chromium", "/opt/google/chrome/chrome"], { PATH: "/snap/bin" }),
      "/opt/google/chrome/chrome",
      "default location",
    ],
    ["macOS app", fakeHost("darwin", [MAC_CHROME]), MAC_CHROME, "default location"],
    ["Windows env case", fakeHost("win32", [WIN_EDGE], WIN_ENV), WIN_EDGE, "default location"],
    [
      "Windows headless shell",
      fakeHost(
        "win32",
        [WIN_EDGE, WIN_SHELL, WIN_SHELL.replace(/chrome-headless-shell-win64.*$/, "INSTALLATION_COMPLETE")],
        WIN_ENV,
      ),
      WIN_SHELL,
      "Playwright headless shell",
    ],
    [
      "Playwright Chromium last",
      fakeHost("linux", cached("chromium", "1254", "chrome-linux64/chrome")),
      "/home/me/.cache/ms-playwright/chromium-1254/chrome-linux64/chrome",
      "Playwright Chromium",
    ],
  ])("%s", (_name, host, path, source) => {
    const flag = source === "--chrome" ? "/a/chrome" : undefined;
    expect(findBrowser(host, { flag, playwright: pinned })).toEqual({ path, source });
  });

  it("reads the cache revision of a found build (doctor compares it with the pinned one)", () => {
    expect(cachedRevision(`/home/me/.cache/ms-playwright/chromium_headless_shell-1248/${SHELL}`)).toBe("1248");
    expect(cachedRevision(WIN_SHELL)).toBe("1254");
    expect(cachedRevision("/usr/bin/chromium")).toBeUndefined();
  });

  it("resolves a macOS .app bundle passed explicitly", () => {
    const host = fakeHost("darwin", ["/Applications/Chromium.app/Contents/MacOS/Chromium"]);
    expect(findBrowser(host, { flag: "/Applications/Chromium.app" }).path).toBe(
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
    );
  });

  it("never skips a broken explicit path", () => {
    const host = fakeHost("linux", ["/usr/bin/chromium"], { SWARMLOOM_CHROME: "/nope", PATH: "/usr/bin" });
    expect(() => findBrowser(host)).toThrow("Browser not found at /nope (from SWARMLOOM_CHROME)");
  });

  it("fails with the headless shell install command when nothing is installed", () => {
    const error = (() => {
      try {
        findBrowser(fakeHost("darwin", []), { playwright: { version: "1.65.0", revisions: {} } });
      } catch (e) {
        return e;
      }
    })();
    expect(error).toBeInstanceOf(MissingDependencyError);
    expect((error as MissingDependencyError).exitCode).toBe(2);
    expect((error as MissingDependencyError).hint).toContain("npx playwright@1.65.0 install chromium-headless-shell");
    expect((error as MissingDependencyError).hint).toContain("brew install --cask chromium");
  });
});

describe("ffmpeg discovery", () => {
  it.each([
    ["ffmpeg version 4.4.2-0ubuntu0.22.04.1 Copyright", 4, 4],
    ["ffmpeg version n8.1.3-34-ga35157abb9-20261105 Copyright", 8, 1],
    ["ffmpeg version 6.1.1-static https://johnvansickle.com", 6, 1],
    ["ffmpeg version N-112345-gabcdef0123 Copyright", null, null],
    ["ffmpeg version 2.4.3 Copyright (c) 2000-2014", 2, 4],
  ])("parses %s", (line, major, minor) => {
    expect(parseFfmpegVersion(line)).toMatchObject({ major, minor });
  });

  it("rejects output that is not ffmpeg", () => {
    expect(parseFfmpegVersion("usage: something")).toBeNull();
  });

  function deps(host: HostEnv, versions: Record<string, string>, ffmpegStatic?: string): FfmpegDiscoveryDeps {
    return {
      host,
      readVersion: async (file) => versions[file] ?? null,
      ffmpegStatic: () => ffmpegStatic,
    };
  }

  it("skips a too-old ffmpeg on PATH and falls back to ffmpeg-static", async () => {
    const host = fakeHost("linux", ["/usr/bin/ffmpeg", "/pkg/ffmpeg"], { PATH: "/usr/bin" });
    const versions = { "/usr/bin/ffmpeg": "ffmpeg version 2.4.3", "/pkg/ffmpeg": "ffmpeg version 6.0" };
    await expect(findFfmpeg(deps(host, versions, "/pkg/ffmpeg"))).resolves.toMatchObject({
      path: "/pkg/ffmpeg",
      source: "ffmpeg-static",
    });
  });

  it("finds ffmpeg.exe on a Windows PATH", async () => {
    const host = fakeHost("win32", ["C:\\tools\\ffmpeg.exe"], { Path: "C:\\Windows;C:\\tools" });
    const found = await findFfmpeg(deps(host, { "C:\\tools\\ffmpeg.exe": "ffmpeg version 7.0" }));
    expect(found).toMatchObject({ path: "C:\\tools\\ffmpeg.exe", source: "PATH" });
  });

  it.each([
    [
      "an explicit too-old ffmpeg",
      { SWARMLOOM_FFMPEG: "/old/ffmpeg" },
      "is too old (need 4.0 or newer) (from SWARMLOOM_FFMPEG)",
    ],
    ["a missing explicit path", { SWARMLOOM_FFMPEG: "/nope" }, "ffmpeg not found at /nope"],
    ["only an old ffmpeg on PATH", { PATH: "/old" }, "No usable ffmpeg 4+ found: ffmpeg 2.4.3"],
  ])("rejects %s", async (_name, env, message) => {
    const host = fakeHost("linux", ["/old/ffmpeg"], env);
    await expect(findFfmpeg(deps(host, { "/old/ffmpeg": "ffmpeg version 2.4.3" }))).rejects.toThrow(message);
  });
});
