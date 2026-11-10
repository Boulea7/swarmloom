#!/usr/bin/env node
// @ts-check
/**
 * Product release tags (`vX.Y.Z`, one GitHub Release per product version).
 *
 * The product version is the shared version of the fixed Changesets group (@swarmloom/core, @swarmloom/element,
 * @swarmloom/export and the CLI), read from @swarmloom/core because that package is always published to npm.
 *
 * Usage:
 *   node scripts/release/product-tag.mjs --published '<changesets published-packages JSON>'
 *   node scripts/release/product-tag.mjs --tag v0.1.0   # also checks it matches packages/core/package.json
 * Both forms write `tag`, `version` and `prerelease` as step outputs (empty tag when nothing to release).
 */
import { join } from "node:path";
import { parseArgs } from "node:util";
import { runIfMain, writeOutputs } from "./lib/cli.mjs";
import { isRecord, readJson } from "./lib/json.mjs";

export const PRODUCT_ANCHOR = "@swarmloom/core";

// Semantic Versioning 2.0.0 (https://semver.org), without the leading "v".
const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+[0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*)?$/;

/** @typedef {{ tag: string; version: string; prerelease: boolean }} ReleaseTag */

/**
 * Validates a `v<semver>` tag.
 * @param {string} tag
 * @returns {ReleaseTag}
 */
export function parseReleaseTag(tag) {
  const match = tag.startsWith("v") ? SEMVER.exec(tag.slice(1)) : null;
  if (!match) throw new Error(`Release tag must look like v1.2.3 or v1.2.3-beta.1, got ${JSON.stringify(tag)}`);
  return { tag, version: tag.slice(1), prerelease: match[4] !== undefined };
}

/**
 * Picks the product tag from the `published-packages` output of changesets/action/publish.
 * @param {string} json e.g. '[{"name":"@swarmloom/core","version":"0.1.0"}]'
 * @param {string} [anchor]
 * @returns {ReleaseTag | null} null when the anchor package was not published in this run
 */
export function productTagFromPublished(json, anchor = PRODUCT_ANCHOR) {
  /** @type {unknown} */
  let parsed;
  try {
    parsed = JSON.parse(json || "[]");
  } catch {
    throw new Error("published-packages is not valid JSON");
  }
  if (!Array.isArray(parsed)) throw new Error("published-packages must be a JSON array");
  for (const item of parsed) {
    if (!isRecord(item) || typeof item.name !== "string" || typeof item.version !== "string") {
      throw new Error(`Unexpected published-packages entry: ${JSON.stringify(item)}`);
    }
  }
  const anchorRelease = parsed.find((item) => item.name === anchor);
  return anchorRelease ? parseReleaseTag(`v${anchorRelease.version}`) : null;
}

/**
 * Fails when a tag does not match the checked-out product version, so assets are never attached to the
 * release of a different version.
 * @param {ReleaseTag} release
 * @param {unknown} anchorManifest parsed package.json of the anchor package
 */
export function assertTagMatchesManifest(release, anchorManifest) {
  const version = isRecord(anchorManifest) ? anchorManifest.version : undefined;
  if (version !== release.version) {
    throw new Error(
      `${release.tag} does not match ${PRODUCT_ANCHOR} version ${JSON.stringify(version)} at this commit`,
    );
  }
}

function main() {
  const { values } = parseArgs({ options: { published: { type: "string" }, tag: { type: "string" } } });
  if ((values.published === undefined) === (values.tag === undefined)) {
    throw new Error("pass exactly one of --published <json> or --tag <tag>");
  }
  let release;
  if (values.tag !== undefined) {
    release = parseReleaseTag(values.tag);
    assertTagMatchesManifest(release, readJson(join(process.cwd(), "packages", "core", "package.json")));
  } else {
    release = productTagFromPublished(values.published ?? "[]");
  }
  writeOutputs({
    tag: release?.tag ?? "",
    version: release?.version ?? "",
    prerelease: String(release?.prerelease ?? false),
  });
}

runIfMain(import.meta.url, "product-tag", main);
