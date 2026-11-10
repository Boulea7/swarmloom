import { MissingDependencyError } from "../errors";
import { envValue, type FoundProgram, type HostEnv, pathFor, which } from "./host";
import { findPlaywrightBuild, type PlaywrightInfo } from "./playwright";

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
  /** Revisions pinned by the installed playwright-core and its location. Default: newest cached build. */
  playwright?: PlaywrightInfo;
}

/** Snap packages run confined (private /tmp, limited file access), which breaks automation; try them last. */
export function isSnapPath(file: string): boolean {
  return file.startsWith("/snap/");
}

/** True for Chrome Headless Shell builds (the binary Playwright installs as chromium-headless-shell). */
export function isHeadlessShell(file: string): boolean {
  return /headless[_-]shell(\.exe)?$/i.test(file);
}

/** Installed Chrome, Chromium, Edge or Brave: CHROME_PATH, PATH commands (Unix), default locations. */
function systemBrowser(host: HostEnv): FoundProgram | undefined {
  const candidates: FoundProgram[] = [];
  const chromePath = envValue(host, "CHROME_PATH");
  if (chromePath) candidates.push({ path: resolveAppBundle(host, chromePath), source: "CHROME_PATH" });
  if (host.platform !== "win32" && host.platform !== "darwin") {
    for (const name of UNIX_COMMANDS) {
      const file = which(host, [name]);
      if (file) candidates.push({ path: file, source: "PATH" });
    }
  }
  for (const file of systemBrowserPaths(host)) candidates.push({ path: file, source: "default location" });
  const usable = candidates.filter((c) => host.isExecutable(c.path));
  return usable.find((c) => !isSnapPath(c.path)) ?? usable[0];
}

/**
 * Finds a Chromium-family browser to drive.
 *
 * Order: --chrome, SWARMLOOM_CHROME, Playwright's chromium-headless-shell from its browser cache
 * (pinned build, the most repeatable frames), installed Chrome/Chromium/Edge/Brave (CHROME_PATH,
 * PATH commands on Unix, default install locations per OS; snap packages last), then Playwright's
 * full Chromium build. An explicit path (flag or SWARMLOOM_CHROME) that does not exist is an error,
 * never silently skipped.
 *
 * @throws MissingDependencyError with install hints when nothing usable is found.
 */
export function findBrowser(host: HostEnv, opts: FindBrowserOptions = {}): FoundProgram {
  const explicit: Array<[string | undefined, string]> = [
    [opts.flag, "--chrome"],
    [envValue(host, "SWARMLOOM_CHROME"), "SWARMLOOM_CHROME"],
  ];
  for (const [value, source] of explicit) {
    if (!value) continue;
    const file = resolveAppBundle(host, value);
    if (host.isExecutable(file)) return { path: file, source };
    throw new MissingDependencyError(
      `Browser not found at ${value} (from ${source})`,
      "Point it at a Chrome, Chromium, Edge or Brave executable, or at Chrome Headless Shell.",
    );
  }
  const info = opts.playwright ?? { revisions: {} };
  const shell = findPlaywrightBuild(host, "chromium-headless-shell", info);
  if (shell) return { path: shell, source: "Playwright headless shell" };
  const installed = systemBrowser(host);
  if (installed) return installed;
  const chromium = findPlaywrightBuild(host, "chromium", info);
  if (chromium) return { path: chromium, source: "Playwright Chromium" };
  throw new MissingDependencyError(
    "No Chrome, Chromium, Edge or Brave browser found",
    browserInstallHint(host, info.version),
  );
}

/**
 * Command that downloads Chrome Headless Shell into Playwright's cache. With the installed
 * playwright-core version it fetches exactly the revision that version pins.
 */
export function headlessShellInstallCommand(playwrightVersion?: string): string {
  const pkg = playwrightVersion ? `playwright@${playwrightVersion}` : "playwright";
  return `npx ${pkg} install chromium-headless-shell`;
}

/** Platform-specific instructions for getting a usable browser. */
export function browserInstallHint(host: HostEnv, playwrightVersion?: string): string {
  const install =
    host.platform === "darwin"
      ? "or install Google Chrome (https://www.google.com/chrome/), or run: brew install --cask chromium"
      : host.platform === "win32"
        ? "or install Google Chrome (https://www.google.com/chrome/); Microsoft Edge also works"
        : "or install Chromium or Google Chrome with your package manager (for example: sudo apt install chromium)";
  return [
    `Recommended (repeatable frames): ${headlessShellInstallCommand(playwrightVersion)}`,
    install,
    "or set SWARMLOOM_CHROME (or pass --chrome) to a Chromium-based browser executable.",
  ].join("\n");
}
