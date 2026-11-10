// @ts-check
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { findStudioEntry } from "../build-extension.mjs";
import { packExtension, parseBrowserList, shouldPackage, validateManifest } from "../pack-extension.mjs";

const gecko = { gecko: { id: "swarmloom@boulea7.github.io" }, gecko_android: {} };
const chromium = { manifest_version: 3, name: "SwarmLoom", version: "0.1.0" };
const firefox = { manifest_version: 2, name: "SwarmLoom", version: "0.1.0", browser_specific_settings: gecko };

test("validateManifest accepts store-ready manifests", () => {
  assert.equal(validateManifest("chrome", chromium), "0.1.0");
  assert.equal(validateManifest("safari", { ...chromium, version: "1.2.3.4" }), "1.2.3.4");
  assert.equal(validateManifest("firefox", firefox), "0.1.0", "one MV2 package for desktop and Android");
  assert.equal(validateManifest("firefox", { ...firefox, manifest_version: 3 }), "0.1.0");
});

test("validateManifest rejects what stores reject", () => {
  /** @type {[string, unknown, RegExp][]} */
  const cases = [
    ["chrome", { ...chromium, manifest_version: 2 }, /manifest_version must be 3/],
    ["edge", { ...chromium, version: "0.1.0-beta.1" }, /version must be/],
    ["edge", { ...chromium, version: "01.0" }, /version must be/],
    ["chrome", { ...chromium, name: " " }, /name is missing/],
    ["chrome", { ...chromium, key: "abc" }, /key must not ship/],
    ["chrome", { ...chromium, update_url: "https://example.com" }, /update_url/],
    ["firefox", { ...firefox, browser_specific_settings: { gecko: {} } }, /gecko\.id is required/],
    ["firefox", { ...firefox, browser_specific_settings: { gecko: gecko.gecko } }, /gecko_android is required/],
    ["safari", [], /not a JSON object/],
  ];
  for (const [browser, manifest, pattern] of cases) assert.throws(() => validateManifest(browser, manifest), pattern);
});

test("shouldPackage and parseBrowserList", () => {
  assert.ok(shouldPackage("assets/app.js"));
  assert.ok(!shouldPackage("assets/app.js.map"));
  assert.ok(!shouldPackage("icons/.DS_Store"));
  assert.deepEqual(parseBrowserList("all"), ["chrome", "edge", "firefox", "safari"]);
  assert.deepEqual(parseBrowserList(" firefox, chrome "), ["firefox", "chrome"]);
  assert.throws(() => parseBrowserList("firefox-android"), /Unknown browser/);
  assert.throws(() => parseBrowserList(","), /Unknown browser/);
});

test("packExtension names the archive after browser and version, without maps", () => {
  const root = mkdtempSync(join(tmpdir(), "swarmloom-pack-"));
  try {
    const source = join(root, "firefox");
    mkdirSync(join(source, "assets"), { recursive: true });
    writeFileSync(join(source, "manifest.json"), JSON.stringify(firefox));
    writeFileSync(join(source, "assets", "background.js"), "export {};\n");
    writeFileSync(join(source, "assets", "background.js.map"), "{}");
    const result = packExtension({ sourceDir: source, outDir: join(root, "out"), browser: "firefox" });
    assert.equal(result.file, join(root, "out", "swarmloom-firefox-0.1.0.zip"));
    assert.equal(result.entries, 2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("findStudioEntry prefers studio.html", () => {
  const only = (/** @type {string[]} */ files) => (/** @type {string} */ path) => files.some((f) => path.endsWith(f));
  assert.equal(findStudioEntry("d", only(["studio.html", "index.html"])), "studio.html");
  assert.equal(findStudioEntry("d", only(["index.html"])), "index.html");
  assert.equal(findStudioEntry("d", only([])), undefined);
});
