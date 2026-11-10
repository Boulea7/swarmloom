#!/usr/bin/env node
// @ts-check
/**
 * Creates or updates the repository labels listed in scripts/release/labels.json using the GitHub CLI.
 * Release notes (.github/release.yml) and the issue forms rely on these names, so keep them in sync.
 * Existing labels with other names are left alone.
 *
 * Usage: node scripts/release/sync-labels.mjs [--repo Boulea7/swarmloom] [--dry-run]
 * Requires `gh` authenticated with write access to the repository (not needed for --dry-run).
 */
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { runIfMain } from "./lib/cli.mjs";
import { isRecord, readJson } from "./lib/json.mjs";

export const DEFAULT_REPO = "Boulea7/swarmloom";
// GitHub's limits for label names and descriptions.
const MAX_NAME_LENGTH = 50;
const MAX_DESCRIPTION_LENGTH = 100;

/** @typedef {{ name: string; color: string; description: string }} Label */

/**
 * Validates the parsed contents of labels.json.
 * @param {unknown} data
 * @returns {Label[]}
 */
export function parseLabels(data) {
  if (!Array.isArray(data) || data.length === 0) throw new Error("labels.json must be a non-empty array");
  const seen = new Set();
  return data.map((item, index) => {
    const where = `labels.json[${index}]`;
    if (!isRecord(item)) throw new Error(`${where} must be an object`);
    const { name, color, description } = item;
    if (typeof name !== "string" || name.trim() !== name || name.length === 0 || [...name].length > MAX_NAME_LENGTH) {
      throw new Error(`${where}: name must be 1-${MAX_NAME_LENGTH} characters without surrounding spaces`);
    }
    if (typeof color !== "string" || !/^[0-9a-f]{6}$/.test(color)) {
      throw new Error(`${where} (${name}): color must be 6 lowercase hex digits without "#"`);
    }
    if (typeof description !== "string" || [...description].length > MAX_DESCRIPTION_LENGTH) {
      throw new Error(
        `${where} (${name}): description must be a string of at most ${MAX_DESCRIPTION_LENGTH} characters`,
      );
    }
    // GitHub label names are case-insensitive.
    const key = name.toLowerCase();
    if (seen.has(key)) throw new Error(`${where}: duplicate label "${name}"`);
    seen.add(key);
    return { name, color, description };
  });
}

/**
 * Builds the `gh` argument list that creates a label or updates it in place.
 * @param {Label} label
 * @param {string} repo owner/name
 * @returns {string[]}
 */
export function ghLabelArgs(label, repo) {
  return [
    "label",
    "create",
    label.name,
    "--repo",
    repo,
    "--color",
    label.color,
    "--description",
    label.description,
    "--force",
  ];
}

function main() {
  const { values } = parseArgs({
    options: {
      repo: { type: "string", default: DEFAULT_REPO },
      file: { type: "string", default: fileURLToPath(new URL("labels.json", import.meta.url)) },
      "dry-run": { type: "boolean", default: false },
    },
  });
  const repo = values.repo;
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo))
    throw new Error(`--repo must look like owner/name, got ${JSON.stringify(repo)}`);
  const labels = parseLabels(readJson(values.file));
  for (const label of labels) {
    const args = ghLabelArgs(label, repo);
    if (values["dry-run"]) {
      console.log(["gh", ...args].map((arg) => (/^[\w@%+=:,./-]+$/.test(arg) ? arg : JSON.stringify(arg))).join(" "));
      continue;
    }
    // execFileSync passes arguments without a shell, so label text cannot inject commands.
    execFileSync("gh", args, { stdio: ["ignore", "inherit", "inherit"] });
  }
  console.log(`${values["dry-run"] ? "would sync" : "synced"} ${labels.length} labels on ${repo}`);
}

runIfMain(import.meta.url, "sync-labels", main);
