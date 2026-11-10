// Build targets and their build-time capabilities. Pure data plus tiny helpers; the manifest
// generator, the build script and the tests import it. Runtime code never reads this file: it
// derives the same decisions from the generated manifest plus feature detection.

/**
 * @typedef {"chrome" | "edge" | "firefox" | "safari"} TargetId
 *
 * @typedef {object} TargetSpec
 * @property {2 | 3} manifestVersion
 * @property {"service_worker" | "event_page"} background Chromium/Safari service worker or a
 *   non-persistent Firefox event page (`background.scripts` + `persistent: false`).
 * @property {boolean} contextMenus Declare the context menu permission (runtime still detects the API).
 * @property {boolean} commands Declare the Alt+Shift+W command.
 * @property {boolean} optionalHosts Declare `<all_urls>` as an optional host permission, requested
 *   per origin when Studio must fetch a linked file.
 * @property {boolean} fileAccess The browser can grant `file://` access to extensions.
 * @property {"chromium" | "gecko" | "webkit"} engine
 * @property {string[]} esbuild esbuild syntax targets.
 * @property {string} store Human readable store name for docs and logs.
 */

/** Firefox add-on id: one package and one AMO listing for desktop and Android. */
export const GECKO_ID = "swarmloom@boulea7.github.io";

/** Minimum Chromium version: `scripting.executeScript` with promises and `optional_host_permissions`. */
export const MIN_CHROME = "116";
/** Firefox desktop 140 and Android 142 support the built-in data collection consent keys. */
export const MIN_FIREFOX = "140.0";
export const MIN_FIREFOX_ANDROID = "142.0";
/** Oldest Safari we test against (see research/platforms.md section 3.1). */
export const MIN_SAFARI = "26.0";

const CHROMIUM_SYNTAX = ["chrome116", "edge116"];

/** @type {Readonly<Record<TargetId, Readonly<TargetSpec>>>} */
export const TARGETS = Object.freeze({
  chrome: {
    manifestVersion: 3,
    background: "service_worker",
    contextMenus: true,
    commands: true,
    optionalHosts: true,
    fileAccess: true,
    engine: "chromium",
    esbuild: CHROMIUM_SYNTAX,
    store: "Chrome Web Store (also Brave, Opera, Vivaldi)",
  },
  edge: {
    manifestVersion: 3,
    background: "service_worker",
    contextMenus: true,
    commands: true,
    optionalHosts: true,
    fileAccess: true,
    engine: "chromium",
    esbuild: CHROMIUM_SYNTAX,
    store: "Microsoft Edge Add-ons",
  },
  firefox: {
    // One XPI for desktop and Android (AMO only offers the latest version of a listing). MV2 event
    // page because Mozilla still recommends MV2 on Android; menus and commands are declared for
    // desktop and simply absent at run time on Android. The generator keeps an MV3 variant as an
    // internal option (`manifestVersion: 3`), never published.
    manifestVersion: 2,
    background: "event_page",
    contextMenus: true,
    commands: true,
    optionalHosts: true,
    fileAccess: true,
    engine: "gecko",
    esbuild: ["firefox140"],
    store: "addons.mozilla.org (desktop and Android)",
  },
  safari: {
    // One resource folder serves macOS, iOS, iPadOS and visionOS; iOS lacks menus (detected at runtime).
    manifestVersion: 3,
    background: "service_worker",
    contextMenus: true,
    commands: true,
    optionalHosts: false,
    fileAccess: false,
    engine: "webkit",
    esbuild: ["safari18"],
    store: "App Store (via safari-web-extension-packager)",
  },
});

/**
 * Workspace packages the extension never bundles: format adapters. The extension plays live pages
 * (snapshot-dom + core); documents open in Studio. build.mjs replaces these imports with a module
 * that fails when loaded, and amo-source.mjs leaves their sources out unless Studio is bundled.
 */
export const STUBBED_PACKAGES = /^@swarmloom\/adapter-/;

/** @type {readonly TargetId[]} */
export const TARGET_IDS = Object.freeze(/** @type {TargetId[]} */ (Object.keys(TARGETS)));

/**
 * Parses a `--target` value: "all" or a comma-separated list of target ids.
 * @param {string} value
 * @returns {TargetId[]}
 * @throws {Error} on an empty list or an unknown id.
 */
export function parseTargets(value) {
  if (value.trim() === "all") return [...TARGET_IDS];
  const list = value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const unknown = list.filter((t) => !TARGET_IDS.includes(/** @type {TargetId} */ (t)));
  if (!list.length || unknown.length) {
    throw new Error(`Unknown target "${unknown.join(",") || value}". Expected all or: ${TARGET_IDS.join(", ")}`);
  }
  return [...new Set(/** @type {TargetId[]} */ (list))];
}
