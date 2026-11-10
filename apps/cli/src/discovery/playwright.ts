import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { envValue, type HostEnv, pathFor } from "./host";

/** Browser builds Playwright downloads into its cache that SwarmLoom can drive. */
export type PlaywrightBuild = "chromium-headless-shell" | "chromium";

/** What the installed playwright-core knows about its browser downloads. */
export interface PlaywrightInfo {
  /** playwright-core's package directory (PLAYWRIGHT_BROWSERS_PATH=0 keeps browsers inside it). */
  packageDir?: string;
  /** playwright-core version, e.g. "1.65.0". */
  version?: string;
  /** Revision playwright-core pins per build, e.g. { "chromium-headless-shell": "1254" }. */
  revisions: Partial<Record<PlaywrightBuild, string>>;
}

/**
 * Executable locations inside one `<build>-<revision>` cache directory, per OS. Current layouts come
 * first; `chrome-linux`, `chrome-mac` and `chrome-win` are what older Playwright releases unpacked.
 */
const LAYOUTS: Record<PlaywrightBuild, Partial<Record<NodeJS.Platform, string[][]>>> = {
  "chromium-headless-shell": {
    linux: [
      ["chrome-headless-shell-linux64", "chrome-headless-shell"],
      ["chrome-headless-shell-linux-arm64", "chrome-headless-shell"],
      ["chrome-linux", "headless_shell"],
    ],
    darwin: [
      ["chrome-headless-shell-mac-arm64", "chrome-headless-shell"],
      ["chrome-headless-shell-mac-x64", "chrome-headless-shell"],
      ["chrome-mac", "headless_shell"],
    ],
    win32: [
      ["chrome-headless-shell-win64", "chrome-headless-shell.exe"],
      ["chrome-win", "headless_shell.exe"],
    ],
  },
  chromium: {
    linux: [
      ["chrome-linux64", "chrome"],
      ["chrome-linux-arm64", "chrome"],
      ["chrome-linux", "chrome"],
    ],
    darwin: [
      ["chrome-mac-arm64", "Google Chrome for Testing.app", "Contents", "MacOS", "Google Chrome for Testing"],
      ["chrome-mac-x64", "Google Chrome for Testing.app", "Contents", "MacOS", "Google Chrome for Testing"],
      ["chrome-mac", "Chromium.app", "Contents", "MacOS", "Chromium"],
    ],
    win32: [
      ["chrome-win64", "chrome.exe"],
      ["chrome-win", "chrome.exe"],
    ],
  },
};

/** Revision of a browser inside Playwright's cache, from its `<build>-<revision>` directory name. */
export function cachedRevision(file: string): string | undefined {
  return /[\\/]chromium(?:_headless_shell)?-(\d+)[\\/]/.exec(file)?.[1];
}

/** Marker Playwright writes once a download is completely unpacked. */
const COMPLETE_MARKER = "INSTALLATION_COMPLETE";

/**
 * Reads the browser revisions the installed playwright-core pins. Never throws: an unreadable install
 * only means "no preference", and the newest cached revision is used instead.
 */
export function installedPlaywright(): PlaywrightInfo {
  try {
    const manifest = createRequire(import.meta.url).resolve("playwright-core/package.json");
    const packageDir = path.dirname(manifest);
    const { version } = JSON.parse(readFileSync(manifest, "utf8")) as { version?: unknown };
    const json = JSON.parse(readFileSync(path.join(packageDir, "browsers.json"), "utf8")) as {
      browsers?: Array<{ name?: unknown; revision?: unknown }>;
    };
    const revisions: PlaywrightInfo["revisions"] = {};
    for (const { name, revision } of json.browsers ?? []) {
      if ((name === "chromium" || name === "chromium-headless-shell") && typeof revision === "string") {
        revisions[name] = revision;
      }
    }
    return { packageDir, revisions, ...(typeof version === "string" ? { version } : {}) };
  } catch {
    return { revisions: {} };
  }
}

/**
 * Directory Playwright downloads browsers into, resolved the way Playwright does:
 * PLAYWRIGHT_BROWSERS_PATH ("0" = inside the playwright-core package), else the per-user cache
 * (XDG_CACHE_HOME or ~/.cache on Linux, ~/Library/Caches on macOS, LOCALAPPDATA on Windows) + ms-playwright.
 */
export function playwrightCacheDir(host: HostEnv, info: PlaywrightInfo): string | undefined {
  const p = pathFor(host);
  const override = envValue(host, "PLAYWRIGHT_BROWSERS_PATH");
  if (override === "0") return info.packageDir ? p.join(info.packageDir, ".local-browsers") : undefined;
  if (override) return override;
  const base =
    host.platform === "darwin"
      ? p.join(host.homedir, "Library", "Caches")
      : host.platform === "win32"
        ? (envValue(host, "LOCALAPPDATA") ?? p.join(host.homedir, "AppData", "Local"))
        : (envValue(host, "XDG_CACHE_HOME") ?? p.join(host.homedir, ".cache"));
  return p.join(base, "ms-playwright");
}

/**
 * Finds a completely installed Playwright build in the cache. The revision pinned by the installed
 * playwright-core wins; otherwise the newest one is used (`npx playwright install` may fetch another
 * revision than playwright-core pins, and any recent build speaks the CDP methods the CLI uses).
 *
 * @returns Executable path, or undefined.
 */
export function findPlaywrightBuild(host: HostEnv, build: PlaywrightBuild, info: PlaywrightInfo): string | undefined {
  const root = playwrightCacheDir(host, info);
  const layouts = LAYOUTS[build][host.platform];
  if (!root || !layouts) return undefined;
  const p = pathFor(host);
  const prefix = `${build.replace(/-/g, "_")}-`;
  const pinned = info.revisions[build];
  const revisions = host
    .listDir(root)
    .filter((name) => name.startsWith(prefix) && /^\d+$/.test(name.slice(prefix.length)))
    .map((name) => name.slice(prefix.length))
    .sort((a, b) => Number(b === pinned) - Number(a === pinned) || Number(b) - Number(a));
  for (const revision of revisions) {
    const dir = p.join(root, prefix + revision);
    if (!host.listDir(dir).includes(COMPLETE_MARKER)) continue;
    for (const layout of layouts) {
      const file = p.join(dir, ...layout);
      if (host.isExecutable(file)) return file;
    }
  }
  return undefined;
}
