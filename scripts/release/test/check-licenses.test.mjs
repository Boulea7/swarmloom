// @ts-check
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { checkLicenses, isExpressionAllowed, packagesFromPnpmReport, parsePolicy } from "../check-licenses.mjs";

const allowed = new Set(["MIT", "ISC", "Apache-2.0", "BSD-3-Clause"]);

test("isExpressionAllowed evaluates SPDX expressions", () => {
  /** @type {[string, boolean][]} */
  const cases = [
    ["MIT", true],
    ["GPL-3.0-only", false],
    ["(MIT OR GPL-3.0-only)", true],
    ["GPL-2.0-only OR LGPL-3.0-only", false],
    ["MIT AND ISC", true],
    ["MIT AND GPL-3.0-only", false],
    ["(MIT OR GPL-2.0-only) AND (Apache-2.0 OR LGPL-2.1-only)", true],
    ["MIT OR ISC AND GPL-3.0-only", true], // AND binds tighter than OR
    ["Apache-2.0+", true],
    ["Apache-2.0 WITH LLVM-exception", false],
    ["mit", false], // identifiers are case-sensitive in this gate
    ["", false],
    ["MIT OR", false],
    ["(MIT", false],
    ["MIT ISC", false],
    ["MIT WITH", false],
    ["SEE LICENSE IN LICENSE.txt", false],
  ];
  for (const [expression, expected] of cases) {
    assert.equal(isExpressionAllowed(expression, allowed), expected, expression);
  }
});

test("checkLicenses applies exceptions only to the listed packages", () => {
  const policy = parsePolicy({
    allowed: ["MIT"],
    exceptions: [{ package: "lightningcss-*", license: "MPL-2.0", reason: "build tool" }],
  });
  const result = checkLicenses(
    [
      { name: "lodash", version: "4.17.21", license: "MIT" },
      { name: "lightningcss-linux-x64-gnu", version: "1.30.0", license: "MPL-2.0" },
      { name: "other-mpl", version: "1.0.0", license: "MPL-2.0" },
      { name: "no-licence", version: "0.0.1", license: "" },
    ],
    policy,
  );
  assert.deepEqual(result.problems, ["other-mpl@1.0.0: MPL-2.0", "no-licence@0.0.1: no licence"]);
  assert.deepEqual(result.usedExceptions, ["lightningcss-*"]);
  assert.deepEqual(result.unusedExceptions, []);
});

test("parsePolicy requires a reason for every exception, and the shipped policy is valid", () => {
  assert.throws(
    () => parsePolicy({ allowed: ["MIT"], exceptions: [{ package: "x", license: "MPL-2.0", reason: " " }] }),
    /exceptions\[0\]/,
  );
  assert.throws(() => parsePolicy({ allowed: [], exceptions: [] }), /allowed/);
  const shipped = parsePolicy(JSON.parse(readFileSync(new URL("../license-policy.json", import.meta.url), "utf8")));
  assert.ok(!shipped.allowed.some((id) => /GPL|MPL|OFL|SSPL|BUSL/.test(id)), "copyleft is never allowed globally");
  // decisions L04: per-package exceptions exist only for MPL-2.0 and OFL-1.1; other licences need a replacement.
  assert.deepEqual(
    shipped.exceptions.filter((item) => !["MPL-2.0", "OFL-1.1"].includes(item.license)),
    [],
    "only MPL-2.0 and OFL-1.1 take per-package exceptions",
  );
});

test("packagesFromPnpmReport flattens every version", () => {
  const report = {
    MIT: [{ name: "a", versions: ["1.0.0", "2.0.0"], license: "MIT" }],
    "(MIT OR Apache-2.0)": [{ name: "b", versions: ["0.1.0"] }],
  };
  assert.deepEqual(packagesFromPnpmReport(report), [
    { name: "a", version: "1.0.0", license: "MIT" },
    { name: "a", version: "2.0.0", license: "MIT" },
    { name: "b", version: "0.1.0", license: "(MIT OR Apache-2.0)" },
  ]);
  assert.throws(() => packagesFromPnpmReport({ MIT: [{ name: "a" }] }), /unexpected entry/);
});
