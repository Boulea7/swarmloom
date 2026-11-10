import { describe, expect, it } from "vitest";
import { findBrowser } from "../src/discovery/browser";
import { type FfmpegDiscoveryDeps, findFfmpeg, parseFfmpegVersion } from "../src/discovery/ffmpeg";
import type { HostEnv } from "../src/discovery/host";
import { MissingDependencyError } from "../src/errors";

/** A fake machine: only the listed files exist and are executable. */
function fakeHost(platform: NodeJS.Platform, files: string[], env: Record<string, string> = {}): HostEnv {
  const set = new Set(files);
  const homedir = platform === "win32" ? "C:\\Users\\me" : platform === "darwin" ? "/Users/me" : "/home/me";
  return { platform, env, homedir, isExecutable: (file) => set.has(file) };
}

describe("browser discovery", () => {
  const MAC_CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  const WIN_EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
  const WIN_ENV = { ProgramFiles: "C:\\Program Files", "ProgramFiles(x86)": "C:\\Program Files (x86)" };

  it.each([
    [
      "flag beats env",
      fakeHost("linux", ["/a/chrome", "/b/chrome"], { SWARMLOOM_CHROME: "/b/chrome" }),
      "/a/chrome",
      "--chrome",
    ],
    [
      "env beats PATH",
      fakeHost("linux", ["/b/chrome", "/usr/bin/chromium"], { SWARMLOOM_CHROME: "/b/chrome", PATH: "/usr/bin" }),
      "/b/chrome",
      "SWARMLOOM_CHROME",
    ],
    [
      "linux PATH",
      fakeHost("linux", ["/usr/local/bin/chromium"], { PATH: "/usr/local/bin:/usr/bin" }),
      "/usr/local/bin/chromium",
      "PATH",
    ],
    [
      "linux default",
      fakeHost("linux", ["/opt/google/chrome/chrome"]),
      "/opt/google/chrome/chrome",
      "default location",
    ],
    ["macOS app", fakeHost("darwin", [MAC_CHROME]), MAC_CHROME, "default location"],
    ["Windows env case", fakeHost("win32", [WIN_EDGE], WIN_ENV), WIN_EDGE, "default location"],
    ["Playwright last", fakeHost("linux", ["/pw/chrome"]), "/pw/chrome", "Playwright"],
  ])("%s", (_name, host, path, source) => {
    const flag = source === "--chrome" ? "/a/chrome" : undefined;
    expect(findBrowser(host, { flag, playwrightPath: () => "/pw/chrome" })).toEqual({ path, source });
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

  it("fails with an install hint when nothing is installed", () => {
    const error = (() => {
      try {
        findBrowser(fakeHost("darwin", []), { playwrightPath: () => undefined });
      } catch (e) {
        return e;
      }
    })();
    expect(error).toBeInstanceOf(MissingDependencyError);
    expect((error as MissingDependencyError).exitCode).toBe(2);
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
