import { MissingDependencyError } from "../errors";
import { envValue, type FoundProgram, type HostEnv, pathFor, which } from "./host";

/** Chromium-family commands looked up on PATH (Linux and other Unix systems). */
const UNIX_COMMANDS = [
  "google-chrome-stable",
  "google-chrome",
  "chromium",
  "chromium-browser",
  "microsoft-edge-stable",
  "microsoft-edge",
  "brave-browser",
];

const LINUX_PATHS = [
  "/usr/bin/google-chrome-stable",
  "/usr/bin/google-chrome",
  "/opt/google/chrome/chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/snap/bin/chromium",
  "/opt/microsoft/msedge/msedge",
  "/opt/brave.com/brave/brave",
];

const MAC_APPS = ["Google Chrome", "Google Chrome Canary", "Chromium", "Microsoft Edge", "Brave Browser"];

const WINDOWS_SUFFIXES = [
  "Google\\Chrome\\Application\\chrome.exe",
  "Google\\Chrome SxS\\Application\\chrome.exe",
  "Chromium\\Application\\chrome.exe",
  "Microsoft\\Edge\\Application\\msedge.exe",
  "BraveSoftware\\Brave-Browser\\Application\\brave.exe",
];

/**
 * Well-known install locations of Chrome, Chromium, Edge and Brave for the host OS, most preferred first.
 */
export function systemBrowserPaths(host: HostEnv): string[] {
  const p = pathFor(host);
  if (host.platform === "darwin") {
    const roots = ["/Applications", p.join(host.homedir, "Applications")];
    return MAC_APPS.flatMap((app) => roots.map((root) => p.join(root, `${app}.app`, "Contents", "MacOS", app)));
  }
  if (host.platform === "win32") {
    const roots = ["PROGRAMFILES", "PROGRAMFILES(X86)", "LOCALAPPDATA"]
      .map((name) => envValue(host, name))
      .filter((root): root is string => Boolean(root));
    return WINDOWS_SUFFIXES.flatMap((suffix) => roots.map((root) => p.join(root, suffix)));
  }
  return LINUX_PATHS;
}

/** macOS users often pass the .app bundle; resolve it to the executable inside. */
function resolveAppBundle(host: HostEnv, file: string): string {
  if (host.platform !== "darwin" || !/\.app\/?$/i.test(file)) return file;
  const p = pathFor(host);
  const bundle = file.replace(/\/$/, "");
  return p.join(bundle, "Contents", "MacOS", p.basename(bundle, ".app"));
}

export interface FindBrowserOptions {
  /** Value of --chrome. */
  flag?: string;
  /** Path of Playwright's own Chromium build when playwright-core knows one (may not be installed). */
  playwrightPath?: () => string | undefined;
}

/**
 * Finds a Chromium-family browser to drive.
 *
 * Order: --chrome, SWARMLOOM_CHROME, CHROME_PATH, Chromium-family commands on PATH (Unix),
 * default install locations per OS, then Playwright's downloaded Chromium.
 * An explicit path (flag or env) that does not exist is an error, never silently skipped.
 *
 * @throws MissingDependencyError with install hints when nothing usable is found.
 */
export function findBrowser(host: HostEnv, opts: FindBrowserOptions = {}): FoundProgram {
  const explicit: Array<[string | undefined, string]> = [
    [opts.flag, "--chrome"],
    [envValue(host, "SWARMLOOM_CHROME"), "SWARMLOOM_CHROME"],
    [envValue(host, "CHROME_PATH"), "CHROME_PATH"],
  ];
  for (const [value, source] of explicit) {
    if (!value) continue;
    const file = resolveAppBundle(host, value);
    if (host.isExecutable(file)) return { path: file, source };
    throw new MissingDependencyError(
      `Browser not found at ${value} (from ${source})`,
      "Point it at a Chrome, Chromium, Edge or Brave executable.",
    );
  }
  if (host.platform !== "win32" && host.platform !== "darwin") {
    const onPath = which(host, UNIX_COMMANDS);
    if (onPath) return { path: onPath, source: "PATH" };
  }
  const installed = systemBrowserPaths(host).find((file) => host.isExecutable(file));
  if (installed) return { path: installed, source: "default location" };
  const bundled = opts.playwrightPath?.();
  if (bundled && host.isExecutable(bundled)) return { path: bundled, source: "Playwright" };
  throw new MissingDependencyError("No Chrome, Chromium, Edge or Brave browser found", browserInstallHint(host));
}

/** Platform-specific instructions for getting a usable browser. */
export function browserInstallHint(host: HostEnv): string {
  const install =
    host.platform === "darwin"
      ? "Install Google Chrome (https://www.google.com/chrome/) or run: brew install --cask chromium"
      : host.platform === "win32"
        ? "Install Google Chrome (https://www.google.com/chrome/); Microsoft Edge also works"
        : "Install Chromium or Google Chrome with your package manager (for example: sudo apt install chromium)";
  return [
    install,
    "or set SWARMLOOM_CHROME (or pass --chrome) to a Chromium-based browser executable,",
    "or download Playwright's build: npx playwright install chromium",
  ].join("\n");
}
