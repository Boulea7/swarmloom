#!/usr/bin/env node
// @ts-check
/**
 * Dependency licence gate. Every package installed in the workspace (dependencies and devDependencies of every
 * workspace project, as reported by `pnpm -r licenses list --json`) must carry an SPDX licence expression that
 * the allowlist in scripts/release/license-policy.json accepts. MPL-2.0 and OFL-1.1 are accepted only for the
 * packages listed as exceptions there. Unknown or custom licences fail.
 *
 * Usage: node scripts/release/check-licenses.mjs [--policy scripts/release/license-policy.json]
 */
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { runIfMain } from "./lib/cli.mjs";
import { isRecord, readJson } from "./lib/json.mjs";

/** @typedef {{ package: string; license: string; reason: string }} LicenseException */
/** @typedef {{ allowed: string[]; exceptions: LicenseException[] }} LicensePolicy */
/** @typedef {{ name: string; version: string; license: string }} InstalledPackage */

/**
 * Validates the parsed policy file.
 * @param {unknown} data
 * @returns {LicensePolicy}
 */
export function parsePolicy(data) {
  if (!isRecord(data)) throw new Error("license policy must be a JSON object");
  const { allowed, exceptions } = data;
  if (!Array.isArray(allowed) || allowed.length === 0 || !allowed.every((id) => typeof id === "string" && id)) {
    throw new Error("license policy: allowed must be a non-empty list of SPDX identifiers");
  }
  if (!Array.isArray(exceptions)) throw new Error("license policy: exceptions must be a list");
  for (const [index, item] of exceptions.entries()) {
    const ok =
      isRecord(item) &&
      typeof item.package === "string" &&
      item.package !== "" &&
      typeof item.license === "string" &&
      item.license !== "" &&
      typeof item.reason === "string" &&
      item.reason.trim() !== "";
    if (!ok) throw new Error(`license policy: exceptions[${index}] needs package, license and reason`);
  }
  return { allowed, exceptions: /** @type {LicenseException[]} */ (exceptions) };
}

/**
 * Decides whether an SPDX licence expression is acceptable under a set of licence identifiers:
 * `A OR B` needs one acceptable side, `A AND B` needs both, and `A WITH exception` is never accepted
 * automatically. A trailing `+` ("or later") is ignored. Malformed expressions are rejected.
 * @param {string} expression
 * @param {ReadonlySet<string>} allowed
 * @returns {boolean}
 */
export function isExpressionAllowed(expression, allowed) {
  const tokens = expression.replace(/[()]/g, " $& ").trim().split(/\s+/).filter(Boolean);
  let position = 0;
  const peekOperator = () => tokens[position]?.toUpperCase();

  /** @returns {boolean} */
  const parseOr = () => {
    let result = parseAnd();
    while (peekOperator() === "OR") {
      position += 1;
      const right = parseAnd();
      result = result || right;
    }
    return result;
  };
  /** @returns {boolean} */
  const parseAnd = () => {
    let result = parseTerm();
    while (peekOperator() === "AND") {
      position += 1;
      const right = parseTerm();
      result = result && right;
    }
    return result;
  };
  /** @returns {boolean} */
  const parseTerm = () => {
    const token = tokens[position];
    if (token === undefined) throw new SyntaxError("unexpected end");
    position += 1;
    let result;
    if (token === "(") {
      result = parseOr();
      if (tokens[position] !== ")") throw new SyntaxError("missing )");
      position += 1;
    } else if (token === ")" || ["AND", "OR", "WITH"].includes(token.toUpperCase())) {
      throw new SyntaxError(`unexpected ${token}`);
    } else {
      result = allowed.has(token.replace(/\+$/, ""));
    }
    if (peekOperator() === "WITH") {
      position += 2; // skip the exception identifier: never accepted without review
      if (position > tokens.length) throw new SyntaxError("WITH needs an exception identifier");
      result = false;
    }
    return result;
  };

  try {
    const result = parseOr();
    return position === tokens.length && result;
  } catch {
    return false;
  }
}

/**
 * Matches a package name against an exception pattern (exact name, or a prefix followed by `*`).
 * @param {string} pattern
 * @param {string} name
 */
export function matchesPackage(pattern, name) {
  return pattern.endsWith("*") ? name.startsWith(pattern.slice(0, -1)) : pattern === name;
}

/**
 * Checks installed packages against the policy.
 * @param {readonly InstalledPackage[]} packages
 * @param {LicensePolicy} policy
 * @returns {{ problems: string[]; usedExceptions: string[]; unusedExceptions: string[] }}
 */
export function checkLicenses(packages, policy) {
  const allowed = new Set(policy.allowed);
  /** @type {string[]} */
  const problems = [];
  const used = new Set();
  for (const pkg of packages) {
    if (isExpressionAllowed(pkg.license, allowed)) continue;
    const exception = policy.exceptions.find(
      (item) =>
        matchesPackage(item.package, pkg.name) && isExpressionAllowed(pkg.license, new Set([...allowed, item.license])),
    );
    if (exception) {
      used.add(exception.package);
      continue;
    }
    problems.push(`${pkg.name}@${pkg.version}: ${pkg.license || "no licence"}`);
  }
  const usedExceptions = [...used].sort();
  const unusedExceptions = policy.exceptions.map((item) => item.package).filter((name) => !used.has(name));
  return { problems, usedExceptions, unusedExceptions };
}

/**
 * Flattens the output of `pnpm licenses list --json` ({ [license]: [{ name, versions, license }] }).
 * @param {unknown} report
 * @returns {InstalledPackage[]}
 */
export function packagesFromPnpmReport(report) {
  if (!isRecord(report)) throw new Error("pnpm licenses output is not a JSON object");
  /** @type {InstalledPackage[]} */
  const packages = [];
  for (const [groupLicense, entries] of Object.entries(report)) {
    if (!Array.isArray(entries)) throw new Error(`pnpm licenses output: ${groupLicense} is not a list`);
    for (const entry of entries) {
      if (!isRecord(entry) || typeof entry.name !== "string" || !Array.isArray(entry.versions)) {
        throw new Error(`pnpm licenses output: unexpected entry under ${groupLicense}`);
      }
      const license = typeof entry.license === "string" ? entry.license : groupLicense;
      for (const version of entry.versions) packages.push({ name: entry.name, version: String(version), license });
    }
  }
  return packages;
}

function main() {
  const { values } = parseArgs({
    options: {
      policy: { type: "string", default: fileURLToPath(new URL("license-policy.json", import.meta.url)) },
    },
  });
  const policy = parsePolicy(readJson(values.policy));
  const output = execFileSync("pnpm", ["-r", "licenses", "list", "--json"], {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    stdio: ["ignore", "pipe", "inherit"],
    shell: process.platform === "win32",
  });
  /** @type {unknown} */
  let report;
  try {
    report = JSON.parse(output);
  } catch {
    throw new Error("pnpm licenses list did not print JSON");
  }
  const packages = packagesFromPnpmReport(report);
  const { problems, usedExceptions, unusedExceptions } = checkLicenses(packages, policy);
  for (const name of unusedExceptions) console.warn(`warning: exception for ${name} matched no installed package`);
  for (const problem of problems) console.error(`error: ${problem} is not on the licence allowlist`);
  console.log(
    `licenses: ${packages.length} packages checked, exceptions used: ${usedExceptions.join(", ") || "none"}; ` +
      `${problems.length} problem(s)`,
  );
  return problems.length > 0 ? 1 : 0;
}

runIfMain(import.meta.url, "check-licenses", main);
