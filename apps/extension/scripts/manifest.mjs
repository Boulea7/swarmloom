// Per-target manifest generation and validation. Pure functions so tests can import them.
import { GECKO_ID, MIN_CHROME, MIN_FIREFOX, MIN_FIREFOX_ANDROID, MIN_SAFARI, TARGET_IDS, TARGETS } from "./targets.mjs";

/** @typedef {import("./targets.mjs").TargetId} TargetId */

export { GECKO_ID };

export const HOMEPAGE = "https://github.com/Boulea7/swarmloom";
/** Toolbar toggle shortcut (contracts/decisions-v1.md C08). */
export const SHORTCUT = "Alt+Shift+W";

/** Icon sizes copied (or generated) into `icons/icon-<size>.png`. */
export const ICON_SIZES = Object.freeze([16, 32, 48, 128]);

/** Every file a manifest may point at must come from this build; the validator checks it. */
export const ENTRY_FILES = Object.freeze({
  background: "background.js",
  options: "options.html",
});

/** The only API permissions any target may request. */
const ALLOWED_PERMISSIONS = new Set(["activeTab", "scripting", "storage", "contextMenus"]);

/** Firefox requires an explicit statement even when nothing is collected. */
const NO_DATA_COLLECTION = Object.freeze({ required: ["none"] });

/**
 * Extension page CSP for every target. The bundled Studio decodes Draco meshes and PDFs with
 * WebAssembly; the MV3 default (`script-src 'self'`) blocks WebAssembly compilation.
 */
const EXTENSION_PAGES_CSP = "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';";

/** Script sources an extension page may allow: bundled files and WebAssembly, nothing remote. */
const SAFE_SCRIPT_SOURCES = new Set(["'self'", "'wasm-unsafe-eval'", "'none'"]);

/**
 * Problems with a content security policy string: any script, object or default source other than
 * the extension itself (remote hosts, `'unsafe-eval'`, `'unsafe-inline'`, wildcards) is rejected.
 * @param {string} csp
 * @returns {string[]}
 */
export function cspProblems(csp) {
  /** @type {string[]} */
  const problems = [];
  for (const directive of csp.split(";")) {
    const [name, ...sources] = directive.trim().split(/\s+/);
    if (!name || !["script-src", "object-src", "default-src", "worker-src"].includes(name)) continue;
    for (const source of sources) {
      if (!SAFE_SCRIPT_SOURCES.has(source)) problems.push(`CSP ${name} must not allow ${source}`);
    }
  }
  return problems;
}

/** @param {readonly number[]} sizes */
function iconMap(sizes) {
  return Object.fromEntries(sizes.map((s) => [String(s), `icons/icon-${s}.png`]));
}

/**
 * @typedef {object} ManifestOptions
 * @property {string[]} [hostPermissions] Extra host permissions; only the e2e build passes them so the
 *   test can inject without a user gesture. Release builds never have host permissions.
 * @property {2 | 3} [manifestVersion] Internal override for Firefox only: the MV3 event-page variant
 *   is kept generatable for the day Mozilla recommends MV3 on Android, but it is never published.
 */

/**
 * Manifest version of `target`, honouring the internal Firefox override.
 * @param {TargetId} target
 * @param {2 | 3 | undefined} override
 * @returns {2 | 3}
 */
function manifestVersionOf(target, override) {
  const spec = TARGETS[target];
  if (override === undefined || override === spec.manifestVersion) return spec.manifestVersion;
  if (spec.engine !== "gecko") throw new Error(`${target} has no manifest_version ${override} variant`);
  return override;
}

/**
 * Builds the manifest for one target.
 * @param {TargetId} target
 * @param {string} version Extension version (from package.json).
 * @param {ManifestOptions} [options]
 * @returns {Record<string, unknown>}
 */
export function manifestFor(target, version, options = {}) {
  const spec = TARGETS[target];
  if (!spec) throw new Error(`Unknown target "${target}". Expected one of: ${TARGET_IDS.join(", ")}`);
  const manifestVersion = manifestVersionOf(target, options.manifestVersion);
  const mv3 = manifestVersion === 3;
  const hosts = options.hostPermissions ?? [];

  const permissions = ["activeTab", "scripting", "storage"];
  if (spec.contextMenus) permissions.push("contextMenus");

  /** @type {Record<string, unknown>} */
  const manifest = {
    manifest_version: manifestVersion,
    name: "__MSG_extName__",
    short_name: "SwarmLoom",
    description: "__MSG_extDescription__",
    version,
    default_locale: "en",
    homepage_url: HOMEPAGE,
    icons: iconMap(ICON_SIZES),
    [mv3 ? "action" : "browser_action"]: {
      default_title: "__MSG_actionTitle__",
      default_icon: iconMap([16, 32]),
    },
    background:
      spec.background === "service_worker"
        ? { service_worker: ENTRY_FILES.background }
        : { scripts: [ENTRY_FILES.background], persistent: false },
    permissions: mv3 ? permissions : [...permissions, ...hosts],
    options_ui: { page: ENTRY_FILES.options, open_in_tab: true },
  };

  if (mv3 && hosts.length) manifest.host_permissions = hosts;
  if (spec.optionalHosts) manifest[mv3 ? "optional_host_permissions" : "optional_permissions"] = ["<all_urls>"];
  if (spec.commands) {
    manifest.commands = {
      [mv3 ? "_execute_action" : "_execute_browser_action"]: {
        suggested_key: { default: SHORTCUT },
        description: "__MSG_commandToggle__",
      },
    };
  }
  // MV3 takes an object keyed by context; MV2 a plain string.
  manifest.content_security_policy = mv3 ? { extension_pages: EXTENSION_PAGES_CSP } : EXTENSION_PAGES_CSP;

  switch (spec.engine) {
    case "chromium":
      manifest.minimum_chrome_version = MIN_CHROME;
      break;
    case "gecko":
      // `gecko_android` declares Android compatibility on the same AMO listing.
      manifest.browser_specific_settings = {
        gecko: { id: GECKO_ID, strict_min_version: MIN_FIREFOX, data_collection_permissions: NO_DATA_COLLECTION },
        gecko_android: { strict_min_version: MIN_FIREFOX_ANDROID },
      };
      break;
    case "webkit":
      manifest.browser_specific_settings = { safari: { strict_min_version: MIN_SAFARI } };
      break;
  }
  return manifest;
}

/** @param {unknown} v */
const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);

/** Chrome/AMO version rule: 1 to 4 dot-separated integers, 0..65535, no leading zeros. */
const VERSION_RE = /^(0|[1-9]\d{0,4})(\.(0|[1-9]\d{0,4})){0,3}$/;

/**
 * Schema-style checks of a generated manifest. Returns human readable problems (empty when valid).
 * @param {Record<string, unknown>} m
 * @param {TargetId} target
 * @param {{ allowHostPermissions?: boolean; manifestVersion?: 2 | 3 }} [opts]
 * @returns {string[]}
 */
export function validateManifest(m, target, opts = {}) {
  const spec = TARGETS[target];
  /** @type {string[]} */
  const problems = [];
  const expect = (/** @type {boolean} */ ok, /** @type {string} */ msg) => {
    if (!ok) problems.push(msg);
  };
  if (!spec) return [`unknown target ${target}`];
  const manifestVersion = manifestVersionOf(target, opts.manifestVersion);
  const mv3 = manifestVersion === 3;

  expect(m.manifest_version === manifestVersion, `manifest_version must be ${manifestVersion}`);
  for (const key of ["name", "description", "version", "default_locale"]) {
    expect(typeof m[key] === "string" && m[key] !== "", `${key} must be a non-empty string`);
  }
  expect(typeof m.version === "string" && VERSION_RE.test(m.version), `version "${m.version}" is not 1-4 integers`);

  const actionKey = mv3 ? "action" : "browser_action";
  const otherAction = mv3 ? "browser_action" : "action";
  expect(isObject(m[actionKey]), `${actionKey} is required`);
  expect(!(otherAction in m), `${otherAction} is not valid in MV${manifestVersion}`);
  expect(!("default_popup" in /** @type {object} */ (m[actionKey] ?? {})), "the action must not open a popup");

  const bg = m.background;
  if (spec.background === "service_worker") {
    expect(
      isObject(bg) && /** @type {any} */ (bg).service_worker === ENTRY_FILES.background,
      "background.service_worker expected",
    );
    expect(!isObject(bg) || !("scripts" in bg), "service worker targets must not declare background.scripts");
  } else {
    const scripts = isObject(bg) ? /** @type {any} */ (bg).scripts : undefined;
    expect(Array.isArray(scripts) && scripts.length === 1, "background.scripts expected");
    expect(isObject(bg) && /** @type {any} */ (bg).persistent === false, "background must be non-persistent");
    expect(!isObject(bg) || !("service_worker" in bg), "event page targets must not declare a service worker");
  }

  const permissions = Array.isArray(m.permissions) ? m.permissions : [];
  const hostLike = (/** @type {unknown} */ p) => typeof p === "string" && (p.includes("://") || p === "<all_urls>");
  for (const p of permissions) {
    expect(
      ALLOWED_PERMISSIONS.has(p) || (!mv3 && hostLike(p) && !!opts.allowHostPermissions),
      `permission ${p} is not allowed`,
    );
  }
  expect(
    permissions.includes("contextMenus") === spec.contextMenus,
    `contextMenus must be ${spec.contextMenus ? "declared" : "absent"}`,
  );
  if (!opts.allowHostPermissions) {
    expect(!("host_permissions" in m), "release builds must not declare host_permissions");
  }
  expect(!("content_scripts" in m), "content scripts are injected on demand, never declared");
  const csp = m.content_security_policy;
  if (typeof csp === "string") problems.push(...cspProblems(csp));
  else if (isObject(csp)) {
    for (const value of Object.values(/** @type {object} */ (csp))) {
      if (typeof value === "string") problems.push(...cspProblems(value));
    }
  }
  const pagesCsp = mv3 ? /** @type {any} */ (csp)?.extension_pages : csp;
  expect(
    typeof pagesCsp === "string" && /(?:^|;)\s*script-src\b[^;]*'wasm-unsafe-eval'/.test(pagesCsp),
    `${mv3 ? "content_security_policy.extension_pages" : "content_security_policy"} must allow 'wasm-unsafe-eval' (Studio decodes with WebAssembly)`,
  );
  expect(!("web_accessible_resources" in m), "no web accessible resources (avoids page fingerprinting)");
  expect("commands" in m === spec.commands, `commands must be ${spec.commands ? "declared" : "absent"}`);

  const bss = /** @type {any} */ (m.browser_specific_settings);
  if (spec.engine === "gecko") {
    expect(bss?.gecko?.id === GECKO_ID, `gecko id must be ${GECKO_ID}`);
    expect(
      Array.isArray(bss?.gecko?.data_collection_permissions?.required),
      "gecko data_collection_permissions required",
    );
    expect(isObject(bss?.gecko_android), "gecko_android is required (one package for desktop and Android)");
    expect(!("strict_max_version" in (bss?.gecko ?? {})), "no strict_max_version");
  } else if (spec.engine === "webkit") {
    expect(typeof bss?.safari?.strict_min_version === "string", "safari strict_min_version expected");
  } else {
    expect(bss === undefined, "Chromium targets must not carry browser_specific_settings");
    expect(typeof m.minimum_chrome_version === "string", "minimum_chrome_version expected");
  }
  return problems;
}

/**
 * Collects every `__MSG_key__` placeholder used in a manifest.
 * @param {unknown} value
 * @param {Set<string>} [out]
 * @returns {Set<string>}
 */
export function messageKeys(value, out = new Set()) {
  if (typeof value === "string") {
    for (const [, key] of value.matchAll(/__MSG_(\w+?)__/g)) out.add(key);
  } else if (Array.isArray(value)) {
    for (const v of value) messageKeys(v, out);
  } else if (isObject(value)) {
    for (const v of Object.values(/** @type {object} */ (value))) messageKeys(v, out);
  }
  return out;
}

/**
 * Every file path a manifest references (icons, background, options page).
 * @param {Record<string, unknown>} m
 * @returns {string[]}
 */
export function referencedFiles(m) {
  const files = new Set();
  const addIcons = (/** @type {unknown} */ icons) => {
    if (isObject(icons)) for (const f of Object.values(/** @type {object} */ (icons))) files.add(f);
  };
  addIcons(m.icons);
  addIcons(/** @type {any} */ (m.action ?? m.browser_action)?.default_icon);
  const bg = /** @type {any} */ (m.background);
  if (bg?.service_worker) files.add(bg.service_worker);
  for (const s of bg?.scripts ?? []) files.add(s);
  const options = /** @type {any} */ (m.options_ui)?.page;
  if (options) files.add(options);
  return [...files];
}
