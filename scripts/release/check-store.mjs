#!/usr/bin/env node
// @ts-check
/**
 * Validates the store submission material in store/ before a manual upload:
 * - listing text in store/listing/<locale>.yaml against each store's field limits;
 * - the listing name and short description against the extension's _locales messages;
 * - a permission justification for every permission the shipped manifest declares;
 * - image files in store/images/ against the sizes in store/stores.yaml (missing images are warnings
 *   unless --require-images is passed, because the media work fills them in later).
 *
 * Usage: node scripts/release/check-store.mjs [--extension <unpacked build>] [--require-images]
 *                                             [--summary <markdown file to append to>]
 *   --extension       folder with manifest.json and _locales/ (default apps/extension/dist/chrome); to check a
 *                     release zip, unzip it first
 *   --require-images  fail when an image listed in store/stores.yaml is missing
 *   --summary         append a Markdown report (the store job passes $GITHUB_STEP_SUMMARY)
 */
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { parse as parseYaml } from "yaml";
import { runIfMain } from "./lib/cli.mjs";
import { isRecord, readJson } from "./lib/json.mjs";

/**
 * Field limits taken from the official store documentation (2026-11-10). Lengths are in characters
 * (Unicode code points) unless the name says bytes.
 */
export const LIMITS = {
  /** App Store name: 2-30 characters (AMO allows 50, so the App Store limit is the binding one). */
  name: { min: 2, max: 30 },
  /** Chrome Web Store summary, taken from the manifest description. */
  short: { max: 132 },
  /** AMO summary; URLs are not allowed. */
  summary: { max: 250 },
  /** App Store subtitle. */
  subtitle: { max: 30 },
  /** App Store promotional text. */
  promotionalText: { max: 170 },
  /** App Store keywords: 100 bytes in total, each keyword longer than two characters. */
  keywords: { maxBytes: 100, minEach: 3 },
  /** Edge needs at least 250 characters (max 10,000); the App Store allows at most 4,000. */
  description: { min: 250, max: 4000 },
  /** Edge search terms: at most 7 terms of up to 30 characters, 21 words in total. */
  searchTerms: { maxTerms: 7, maxEach: 30, maxWords: 21 },
};

/** Unpacked Chrome build checked when --extension is not given. */
const DEFAULT_EXTENSION_BUILD = "apps/extension/dist/chrome";

/** Listing fields every locale must provide as non-empty strings. */
const TEXT_FIELDS = ["name", "short", "summary", "subtitle", "promotional_text", "keywords", "description"];

/** @typedef {{ errors: string[]; warnings: string[] }} Report */
/** @typedef {{ format: "png" | "jpeg"; width: number; height: number; alpha: boolean }} ImageInfo */

/** @param {string} text */
const length = (text) => [...text].length;

/**
 * Checks one listing file against the store limits.
 * @param {unknown} listing parsed store/listing/<locale>.yaml
 * @param {string} locale expected locale code
 * @returns {Report}
 */
export function checkListing(listing, locale) {
  /** @type {Report} */
  const report = { errors: [], warnings: [] };
  const error = (/** @type {string} */ message) => report.errors.push(`${locale}: ${message}`);
  if (!isRecord(listing)) {
    error("listing must be a mapping");
    return report;
  }
  if (listing.locale !== locale) error(`locale field is ${JSON.stringify(listing.locale)}, expected "${locale}"`);
  for (const field of TEXT_FIELDS) {
    const value = listing[field];
    if (typeof value !== "string" || value.trim() === "") error(`${field} must be a non-empty string`);
  }
  if (report.errors.length > 0) return report;
  const text = /** @type {Record<string, string>} */ (listing);

  const maxChecks = /** @type {const} */ ([
    ["name", LIMITS.name.max],
    ["short", LIMITS.short.max],
    ["summary", LIMITS.summary.max],
    ["subtitle", LIMITS.subtitle.max],
    ["promotional_text", LIMITS.promotionalText.max],
    ["description", LIMITS.description.max],
  ]);
  for (const [field, max] of maxChecks) {
    if (length(text[field]) > max) error(`${field} has ${length(text[field])} characters, limit ${max}`);
  }
  if (length(text.name) < LIMITS.name.min) error(`name needs at least ${LIMITS.name.min} characters`);
  if (length(text.description) < LIMITS.description.min) {
    error(`description has ${length(text.description)} characters; Edge requires at least ${LIMITS.description.min}`);
  }
  if (/https?:\/\/|www\./i.test(text.summary)) error("summary must not contain URLs (AMO rejects them)");

  const keywordBytes = Buffer.byteLength(text.keywords, "utf8");
  if (keywordBytes > LIMITS.keywords.maxBytes) {
    error(`keywords take ${keywordBytes} bytes, limit ${LIMITS.keywords.maxBytes}`);
  }
  for (const keyword of text.keywords.split(",").map((item) => item.trim())) {
    if (length(keyword) < LIMITS.keywords.minEach) {
      error(`keyword ${JSON.stringify(keyword)} must be longer than two characters`);
    }
  }

  const terms = listing.search_terms;
  if (!Array.isArray(terms) || !terms.every((term) => typeof term === "string" && term.trim() !== "")) {
    error("search_terms must be a list of non-empty strings");
  } else {
    if (terms.length > LIMITS.searchTerms.maxTerms) error(`search_terms has ${terms.length} terms, limit 7`);
    const words = terms.reduce((count, term) => count + term.trim().split(/\s+/).length, 0);
    if (words > LIMITS.searchTerms.maxWords) error(`search_terms has ${words} words, limit 21`);
    for (const term of terms) {
      if (length(term) > LIMITS.searchTerms.maxEach) error(`search term ${JSON.stringify(term)} is over 30 characters`);
    }
  }

  const privacy = isRecord(listing.privacy) ? listing.privacy : undefined;
  for (const field of ["single_purpose", "remote_code", "data_usage"]) {
    if (typeof privacy?.[field] !== "string" || privacy[field].trim() === "") error(`privacy.${field} is missing`);
  }
  if (!isRecord(privacy?.permissions)) error("privacy.permissions must map each permission to a justification");
  if (typeof listing.reviewer_notes !== "string" || listing.reviewer_notes.trim() === "") {
    error("reviewer_notes is missing");
  }
  return report;
}

/**
 * Names the stores ask a justification for: each entry of `permissions` and `optional_permissions`,
 * plus one entry each for `host_permissions` and `optional_host_permissions` when present.
 * @param {unknown} manifest
 * @returns {string[]}
 */
export function declaredPermissions(manifest) {
  if (!isRecord(manifest)) throw new Error("manifest.json is not a JSON object");
  /** @type {string[]} */
  const names = [];
  for (const key of ["permissions", "optional_permissions"]) {
    const list = manifest[key];
    if (Array.isArray(list)) names.push(...list.filter((item) => typeof item === "string"));
  }
  for (const key of ["host_permissions", "optional_host_permissions"]) {
    if (Array.isArray(manifest[key]) && manifest[key].length > 0) names.push(key);
  }
  return names;
}

/**
 * Compares a listing with the built extension: name and short description must match the _locales
 * messages that the stores display, and every declared permission needs a justification.
 * @param {Record<string, unknown>} listing
 * @param {string} locale
 * @param {{ manifest: unknown; messages: unknown }} extension manifest.json and _locales/<locale>/messages.json
 * @returns {Report}
 */
export function checkAgainstExtension(listing, locale, { manifest, messages }) {
  /** @type {Report} */
  const report = { errors: [], warnings: [] };
  if (!isRecord(manifest)) {
    report.errors.push("manifest.json is not a JSON object");
    return report;
  }
  for (const [field, manifestKey] of /** @type {const} */ ([
    ["name", "name"],
    ["short", "description"],
  ])) {
    const shipped = resolveMessage(manifest[manifestKey], messages);
    if (shipped === undefined) {
      report.errors.push(`${locale}: manifest ${manifestKey} has no message for this locale`);
    } else if (shipped !== listing[field]) {
      report.errors.push(
        `${locale}: listing ${field} ${JSON.stringify(listing[field])} differs from the shipped manifest ${manifestKey} ${JSON.stringify(shipped)}`,
      );
    }
  }
  const privacy = isRecord(listing.privacy) ? listing.privacy : {};
  const justified = isRecord(privacy.permissions) ? privacy.permissions : {};
  const declared = declaredPermissions(manifest);
  for (const permission of declared) {
    const text = justified[permission];
    if (typeof text !== "string" || text.trim() === "") {
      report.errors.push(`${locale}: no justification for permission ${permission}`);
    }
  }
  for (const permission of Object.keys(justified)) {
    if (!declared.includes(permission)) {
      report.warnings.push(
        `${locale}: justification for ${permission}, which the shipped manifest does not declare; leave it out of the dashboard`,
      );
    }
  }
  return report;
}

/**
 * Resolves a `__MSG_name__` placeholder (message names are case-insensitive) or returns a literal string.
 * @param {unknown} value
 * @param {unknown} messages parsed messages.json
 * @returns {string | undefined}
 */
export function resolveMessage(value, messages) {
  if (typeof value !== "string") return undefined;
  const match = /^__MSG_(\w+)__$/.exec(value);
  if (!match) return value;
  if (!isRecord(messages)) return undefined;
  const key = Object.keys(messages).find((name) => name.toLowerCase() === match[1].toLowerCase());
  const entry = key === undefined ? undefined : messages[key];
  return isRecord(entry) && typeof entry.message === "string" ? entry.message : undefined;
}

/**
 * Reads the size and alpha channel of a PNG or baseline/progressive JPEG from its header.
 * @param {Uint8Array} bytes
 * @returns {ImageInfo}
 */
export function readImageInfo(bytes) {
  const data = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (data.length >= 33 && data.subarray(0, 8).equals(png) && data.toString("latin1", 12, 16) === "IHDR") {
    const colorType = data[25];
    // Color types 4 and 6 carry an alpha channel; a tRNS chunk adds transparency to the others.
    let alpha = colorType === 4 || colorType === 6;
    for (let offset = 8; !alpha && offset + 8 <= data.length; ) {
      const chunkLength = data.readUInt32BE(offset);
      const type = data.toString("latin1", offset + 4, offset + 8);
      if (type === "tRNS") alpha = true;
      if (type === "IDAT" || type === "IEND") break;
      offset += 12 + chunkLength;
    }
    return { format: "png", width: data.readUInt32BE(16), height: data.readUInt32BE(20), alpha };
  }
  if (data.length >= 4 && data[0] === 0xff && data[1] === 0xd8) {
    for (let offset = 2; offset + 9 <= data.length; ) {
      if (data[offset] !== 0xff) break;
      const marker = data[offset + 1];
      if (marker === 0xff) {
        offset += 1; // fill byte
        continue;
      }
      const segmentLength = data.readUInt16BE(offset + 2);
      const isStartOfFrame = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
      if (isStartOfFrame) {
        return {
          format: "jpeg",
          height: data.readUInt16BE(offset + 5),
          width: data.readUInt16BE(offset + 7),
          alpha: false,
        };
      }
      offset += 2 + segmentLength;
    }
  }
  throw new Error("not a PNG or JPEG file, or its header is truncated");
}

/**
 * Expands the image plan from stores.yaml into the files the media work has to deliver and checks the
 * ones that exist.
 * @param {unknown} images `images` section of stores.yaml
 * @param {readonly string[]} locales
 * @param {(relativePathWithoutExtension: string) => { path: string; bytes: Uint8Array } | undefined} findImage
 * @returns {Report & { missing: string[] }}
 */
export function checkImages(images, locales, findImage) {
  /** @type {Report & { missing: string[] }} */
  const report = { errors: [], warnings: [], missing: [] };
  if (!isRecord(images)) {
    report.errors.push("stores.yaml: images must be a mapping");
    return report;
  }
  for (const [kind, spec] of Object.entries(images)) {
    const valid =
      isRecord(spec) &&
      typeof spec.path === "string" &&
      Array.isArray(spec.sizes) &&
      spec.sizes.every((size) => Array.isArray(size) && size.length === 2 && size.every(Number.isInteger)) &&
      Array.isArray(spec.count) &&
      spec.count.length === 2 &&
      spec.count.every(Number.isInteger);
    if (!valid) {
      report.errors.push(`stores.yaml: images.${kind} needs path, sizes [[w, h], ...] and count [min, max]`);
      continue;
    }
    const [min, max] = /** @type {[number, number]} */ (spec.count);
    const sizes = /** @type {[number, number][]} */ (spec.sizes);
    const template = /** @type {string} */ (spec.path);
    const perLocale = template.includes("{locale}");
    for (const locale of perLocale ? locales : [""]) {
      for (let n = 1; n <= max; n += 1) {
        const name = template.replace("{locale}", locale).replace("{n}", String(n));
        const found = findImage(name);
        if (!found) {
          if (n <= min) report.missing.push(`${name}.png (${sizes.map(([w, h]) => `${w}x${h}`).join(" or ")})`);
          if (!template.includes("{n}")) break;
          continue;
        }
        let info;
        try {
          info = readImageInfo(found.bytes);
        } catch (error) {
          report.errors.push(`${found.path}: ${/** @type {Error} */ (error).message}`);
          continue;
        }
        if (!sizes.some(([width, height]) => width === info.width && height === info.height)) {
          report.errors.push(
            `${found.path}: ${info.width}x${info.height}, expected ${sizes.map(([w, h]) => `${w}x${h}`).join(" or ")}`,
          );
        }
        if (spec.alpha === false && info.alpha) report.errors.push(`${found.path}: must not have an alpha channel`);
        if (!template.includes("{n}")) break;
      }
    }
  }
  return report;
}

/**
 * @param {string} path
 * @returns {unknown}
 */
function readYaml(path) {
  try {
    return parseYaml(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`Cannot read ${path}: ${/** @type {Error} */ (error).message}`);
  }
}

function main() {
  const { values } = parseArgs({
    options: {
      extension: { type: "string" },
      "require-images": { type: "boolean", default: false },
      summary: { type: "string" },
    },
  });
  const storeDir = resolve("store");
  const config = readYaml(join(storeDir, "stores.yaml"));
  if (!isRecord(config) || !Array.isArray(config.locales)) throw new Error("store/stores.yaml: locales is missing");
  const locales = config.locales.filter((locale) => typeof locale === "string");
  /** @type {Report & { missing: string[] }} */
  const total = { errors: [], warnings: [], missing: [] };
  const add = (/** @type {Partial<Report & { missing: string[] }>} */ part) => {
    total.errors.push(...(part.errors ?? []));
    total.warnings.push(...(part.warnings ?? []));
    total.missing.push(...(part.missing ?? []));
  };

  if (isRecord(config.urls)) {
    for (const [key, url] of Object.entries(config.urls)) {
      if (typeof url !== "string" || !url.startsWith("https://"))
        total.errors.push(`stores.yaml: urls.${key} must be https`);
    }
  } else {
    total.errors.push("stores.yaml: urls is missing");
  }

  const extensionDir = resolve(values.extension ?? DEFAULT_EXTENSION_BUILD);
  const manifestPath = join(extensionDir, "manifest.json");
  const explicitExtension = values.extension !== undefined;
  const manifest = existsSync(manifestPath) ? readJson(manifestPath) : undefined;
  if (manifest === undefined) {
    // An explicit build that is missing is a mistake; the default one may simply not be built yet.
    if (explicitExtension) throw new Error(`${manifestPath} not found`);
    total.warnings.push(`${manifestPath} not found: build the extension to check names and permissions`);
  }
  for (const locale of locales) {
    const listing = readYaml(join(storeDir, "listing", `${locale}.yaml`));
    const listingReport = checkListing(listing, locale);
    add(listingReport);
    if (manifest !== undefined && listingReport.errors.length === 0) {
      const messagesPath = join(extensionDir, "_locales", locale.replace("-", "_"), "messages.json");
      const messages = existsSync(messagesPath) ? readJson(messagesPath) : undefined;
      add(checkAgainstExtension(/** @type {Record<string, unknown>} */ (listing), locale, { manifest, messages }));
    }
  }

  const imagesDir = join(storeDir, "images");
  add(
    checkImages(config.images, locales, (name) => {
      for (const extension of [".png", ".jpg", ".jpeg"]) {
        const path = join(imagesDir, `${name}${extension}`);
        if (existsSync(path)) return { path: `store/images/${name}${extension}`, bytes: readFileSync(path) };
      }
      return undefined;
    }),
  );
  if (values["require-images"]) total.errors.push(...total.missing.map((file) => `missing image store/images/${file}`));

  for (const message of total.warnings) console.warn(`warning: ${message}`);
  if (!values["require-images"] && total.missing.length > 0) {
    console.warn(`warning: ${total.missing.length} required image(s) not provided yet (see store/images/README.md)`);
  }
  for (const message of total.errors) console.error(`error: ${message}`);
  console.log(
    `store listing: ${locales.join(", ")}; ${total.errors.length} error(s), ${total.missing.length} image(s) missing`,
  );
  if (values.summary) appendFileSync(values.summary, summaryMarkdown(config, total));
  return total.errors.length > 0 ? 1 : 0;
}

/**
 * Short Markdown report for the GitHub Actions job summary.
 * @param {Record<string, unknown>} config
 * @param {Report & { missing: string[] }} report
 */
function summaryMarkdown(config, report) {
  const stores = isRecord(config.stores) ? config.stores : {};
  const rows = Object.values(stores)
    .filter(isRecord)
    .map(
      (store) =>
        `| ${String(store.title)} | \`${String(store.package)}\` | ${String(store.category)} | ${String(store.dashboard)} |`,
    );
  const list = (/** @type {string[]} */ items) =>
    items.length ? items.map((item) => `- ${item}`).join("\n") : "- none";
  return [
    "## Store submission",
    "",
    "Upload by hand, following store/CHECKLIST.md. Nothing was submitted to any store.",
    "",
    "| Store | Package | Category | Dashboard |",
    "| --- | --- | --- | --- |",
    ...rows,
    "",
    "### Missing images",
    list(report.missing),
    "",
    "### Warnings",
    list(report.warnings),
    "",
  ].join("\n");
}

runIfMain(import.meta.url, "check-store", main);
