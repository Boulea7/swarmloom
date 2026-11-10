// Per-browser manifest generation. Pure functions so tests can import them.

/** @typedef {"chrome" | "edge" | "firefox" | "safari"} Browser */

/** @type {readonly Browser[]} */
export const BROWSERS = ["chrome", "edge", "firefox", "safari"];

export const GECKO_ID = "swarmloom@boulea7.github.io";

/**
 * Manifest fields shared by every browser.
 * @param {string} version Extension version (from package.json).
 */
export function baseManifest(version) {
  return {
    manifest_version: 3,
    name: "__MSG_extName__",
    description: "__MSG_extDescription__",
    version,
    default_locale: "en",
    action: { default_title: "__MSG_extName__" },
    permissions: ["activeTab", "scripting", "contextMenus", "storage"],
    commands: {
      _execute_action: { suggested_key: { default: "Alt+Shift+S" } },
    },
  };
}

/** @type {Record<Browser, Record<string, unknown>>} */
const OVERRIDES = {
  chrome: {
    background: { service_worker: "background.js" },
    minimum_chrome_version: "116",
  },
  edge: {
    background: { service_worker: "background.js" },
    minimum_chrome_version: "116",
  },
  firefox: {
    // Firefox MV3 runs background scripts as an event page, not a service worker.
    background: { scripts: ["background.js"] },
    browser_specific_settings: {
      gecko: {
        id: GECKO_ID,
        strict_min_version: "140.0",
        // Required for new AMO submissions; SwarmLoom collects nothing.
        data_collection_permissions: { required: ["none"] },
      },
      gecko_android: { strict_min_version: "142.0" },
    },
  },
  safari: {
    background: { service_worker: "background.js" },
  },
};

/**
 * Builds the manifest for one browser.
 * @param {Browser} browser
 * @param {string} version
 * @returns {Record<string, unknown>}
 */
export function manifestFor(browser, version) {
  const override = OVERRIDES[browser];
  if (!override) throw new Error(`Unknown browser "${browser}". Expected one of: ${BROWSERS.join(", ")}`);
  return { ...baseManifest(version), ...override };
}

/**
 * Parses a `--browser` value: "all" or a comma-separated list.
 * @param {string} value
 * @returns {Browser[]}
 */
export function parseBrowsers(value) {
  if (value === "all") return [...BROWSERS];
  const list = value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const unknown = list.filter((b) => !BROWSERS.includes(/** @type {Browser} */ (b)));
  if (!list.length || unknown.length) {
    throw new Error(`Unknown browser "${unknown.join(",") || value}". Expected all or: ${BROWSERS.join(", ")}`);
  }
  return /** @type {Browser[]} */ (list);
}
