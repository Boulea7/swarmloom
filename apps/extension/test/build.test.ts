import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { auditPackage } from "../scripts/audit.mjs";
import { placeholderIcon } from "../scripts/icons.mjs";
import { cspProblems, GECKO_ID, manifestFor, messageKeys, validateManifest } from "../scripts/manifest.mjs";
import { parseTargets, TARGET_IDS } from "../scripts/targets.mjs";
import { directoryEntries, sourceDateEpoch, unzipEntries, zipEntries } from "../scripts/zip.mjs";
import { BUILD_CAPABILITIES } from "../src/shared/capabilities";
import { catalogFor, LOCALES } from "../src/shared/i18n";

// biome-ignore lint/suspicious/noExplicitAny: generated manifests are plain JSON probed by the assertions.
type Json = Record<string, any>;

describe("manifests", () => {
  it("generates a valid manifest for every target", () => {
    for (const target of TARGET_IDS) {
      const m = manifestFor(target, "1.2.3") as Json;
      expect(validateManifest(m, target), target).toEqual([]);
      expect(m.action?.default_popup ?? m.browser_action?.default_popup).toBeUndefined();
      expect(m.host_permissions).toBeUndefined();
      expect(m.permissions.includes("contextMenus"), target).toBe(BUILD_CAPABILITIES[target].contextMenus);
    }
  });

  it("uses the right background and settings per browser", () => {
    const chrome = manifestFor("chrome", "1.0.0") as Json;
    expect(chrome.background).toEqual({ service_worker: "background.js" });
    expect(chrome.commands._execute_action.suggested_key.default).toBe("Alt+Shift+W");

    // One Firefox XPI for desktop and Android: MV2 event page with gecko and gecko_android.
    const firefox = manifestFor("firefox", "1.0.0") as Json;
    expect(firefox).toMatchObject({
      manifest_version: 2,
      background: { scripts: ["background.js"], persistent: false },
    });
    expect(firefox.browser_action).toBeDefined();
    expect(firefox.action).toBeUndefined();
    expect(firefox.commands._execute_browser_action.suggested_key.default).toBe("Alt+Shift+W");
    expect(firefox.optional_permissions).toEqual(["<all_urls>"]);
    expect(firefox.browser_specific_settings).toEqual({
      gecko: { id: GECKO_ID, strict_min_version: "140.0", data_collection_permissions: { required: ["none"] } },
      gecko_android: { strict_min_version: "142.0" },
    });

    // The MV3 variant stays generatable for later, but only as an internal option.
    const firefoxMv3 = manifestFor("firefox", "1.0.0", { manifestVersion: 3 }) as Json;
    expect(validateManifest(firefoxMv3, "firefox", { manifestVersion: 3 })).toEqual([]);
    expect(firefoxMv3).toMatchObject({ manifest_version: 3, background: { persistent: false } });
    expect(() => manifestFor("chrome", "1.0.0", { manifestVersion: 2 })).toThrow();

    const safari = manifestFor("safari", "1.0.0") as Json;
    expect(safari.background).toEqual({ service_worker: "background.js" });
    expect(safari.permissions).toEqual(["activeTab", "scripting", "storage", "contextMenus"]);
  });

  it("rejects broken manifests and unknown targets", () => {
    const bad: Json = {
      ...(manifestFor("chrome", "1.0.0") as Json),
      host_permissions: ["<all_urls>"],
      version: "01.2",
    };
    bad.action = { default_popup: "popup.html" };
    const problems = validateManifest(bad, "chrome").join("\n");
    expect(problems).toMatch(/host_permissions/);
    expect(problems).toMatch(/popup/);
    expect(problems).toMatch(/version/);
    expect(validateManifest(manifestFor("firefox", "1.0.0"), "chrome")).not.toEqual([]);
    const remote = {
      ...(manifestFor("firefox", "1.0.0") as Json),
      content_security_policy: "script-src 'self' https://cdn.example; object-src 'self'",
    };
    expect(validateManifest(remote, "firefox").join("\n")).toMatch(/cdn\.example/);
    expect(cspProblems("script-src 'self' 'unsafe-eval'")).toHaveLength(1);
    expect(parseTargets("all")).toEqual([...TARGET_IDS]);
    expect(() => parseTargets("chrome,netscape")).toThrow("netscape");
  });
});

describe("locales", () => {
  it("has every key in every language with matching placeholders and no '$'", () => {
    const en = catalogFor("en") as Record<string, string>;
    const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    const manifestKeys = messageKeys(manifestFor("chrome", "1.0.0"));
    for (const locale of LOCALES) {
      const catalog = catalogFor(locale) as Record<string, string>;
      expect(Object.keys(catalog).sort(), locale).toEqual(Object.keys(en).sort());
      for (const [key, text] of Object.entries(catalog)) {
        expect(text.trim(), `${locale}.${key}`).not.toBe("");
        expect(vars(text), `${locale}.${key}`).toEqual(vars(en[key] ?? ""));
      }
      for (const key of manifestKeys) expect(catalog[key], `${locale}.${key}`).not.toContain("$");
      expect((catalog.extName ?? "").length).toBeLessThanOrEqual(45);
      expect((catalog.extDescription ?? "").length).toBeLessThanOrEqual(132);
    }
  });
});

describe("packaging helpers", () => {
  it("zips deterministically and round-trips", () => {
    const files = [
      { name: "manifest.json", data: new TextEncoder().encode('{"a":1}') },
      { name: "icons/icon-16.png", data: placeholderIcon(16) },
    ];
    const a = zipEntries(files);
    const b = zipEntries([...files].reverse());
    expect(a).toEqual(b);
    const back = unzipEntries(a);
    expect(back.map((e) => e.name)).toEqual(["icons/icon-16.png", "manifest.json"]);
    expect(new TextDecoder().decode(back[1]?.data)).toBe('{"a":1}');
    expect(() => zipEntries([{ name: "../evil", data: new Uint8Array() }])).toThrow();

    // SOURCE_DATE_EPOCH sets every entry's MS-DOS timestamp; invalid values are rejected.
    const stamped = zipEntries(files, { mtime: sourceDateEpoch("1700000000") });
    expect(stamped.readUInt16LE(12)).toBe(((2023 - 1980) << 9) | (11 << 5) | 14);
    expect(sourceDateEpoch(undefined)).toBeUndefined();
    expect(() => sourceDateEpoch("yesterday")).toThrow(/SOURCE_DATE_EPOCH/);
  });

  it("draws placeholder icons as valid PNGs of the requested size", async () => {
    const png: Uint8Array = placeholderIcon(32);
    const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
    expect(new TextDecoder().decode(png.subarray(1, 4))).toBe("PNG");
    expect([view.getUint32(16), view.getUint32(20)]).toEqual([32, 32]);
    // One IDAT chunk at offset 33 (signature 8 + IHDR 25): length, type, zlib data.
    expect(new TextDecoder().decode(png.subarray(37, 41))).toBe("IDAT");
    const zlib = png.slice(41, 41 + view.getUint32(33));
    const raw = await new Response(
      new Blob([zlib]).stream().pipeThrough(new DecompressionStream("deflate")),
    ).arrayBuffer();
    expect(raw.byteLength).toBe(32 * (1 + 32 * 4));
  });
});

describe("package audit", () => {
  it("passes a clean package and flags remote code, the test hook and a stale zip", () => {
    const dir = mkdtempSync(join(tmpdir(), "swarmloom-audit-"));
    try {
      writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifestFor("chrome", "1.0.0")));
      writeFileSync(join(dir, "swarm.js"), "console.log(1);");
      mkdirSync(join(dir, "pages"));
      writeFileSync(join(dir, "pages", "welcome.js"), "const site = 'https://example.com/'; open(site);");
      const zip = join(dir, "..", `${dir.split(/[\\/]/).pop()}.zip`);
      writeFileSync(zip, zipEntries(directoryEntries(dir)));
      expect(auditPackage(dir, "chrome", zip)).toEqual([]);

      writeFileSync(join(dir, "page.html"), '<script src="https://cdn.example/x.js"></script>');
      writeFileSync(join(dir, "background.js"), "globalThis.__swarmloomTest = {}; eval(code);");
      const problems = auditPackage(dir, "chrome", zip).join("\n");
      expect(problems).toMatch(/page\.html: remote <script src>/);
      expect(problems).toMatch(/background\.js: eval/);
      expect(problems).toMatch(/test hook/);
      expect(problems).toMatch(/does not match/);
      rmSync(zip);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
