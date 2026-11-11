// @ts-check
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { parse } from "yaml";
import { checkPackage, REPOSITORY_URL } from "../check-packages.mjs";
import { assertTagMatchesManifest, parseReleaseTag, productTagFromPublished } from "../product-tag.mjs";
import { ghLabelArgs, parseLabels } from "../sync-labels.mjs";

/** @param {string} path repository-relative */
const read = (path) => readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");

test("parseReleaseTag accepts v<semver> only", () => {
  assert.deepEqual(parseReleaseTag("v0.1.0"), { tag: "v0.1.0", version: "0.1.0", prerelease: false });
  assert.equal(parseReleaseTag("v1.0.0-beta.1").prerelease, true);
  assert.equal(parseReleaseTag("v1.0.0+build.5").prerelease, false);
  for (const tag of ["0.1.0", "v1.0", "v01.0.0", "v1.0.0-", "@swarmloom/core@0.1.0", "v1.0.0\n"]) {
    assert.throws(() => parseReleaseTag(tag), /Release tag must look like/, JSON.stringify(tag));
  }
});

test("productTagFromPublished follows @swarmloom/core", () => {
  const published = JSON.stringify([
    { name: "@swarmloom/adapter-pdf", version: "0.3.0" },
    { name: "@swarmloom/core", version: "0.2.0" },
  ]);
  assert.equal(productTagFromPublished(published)?.tag, "v0.2.0");
  assert.equal(productTagFromPublished('[{"name":"@swarmloom/adapter-pdf","version":"0.3.0"}]'), null);
  assert.equal(productTagFromPublished(""), null);
  assert.throws(() => productTagFromPublished("{"), /not valid JSON/);
  assert.throws(() => productTagFromPublished('[{"name":1}]'), /Unexpected/);
  assert.throws(() => assertTagMatchesManifest(parseReleaseTag("v0.2.0"), { version: "0.1.0" }), /does not match/);
});

test("labels.json is valid and covers every label the release notes and issue forms use", () => {
  const labels = parseLabels(JSON.parse(read("scripts/release/labels.json")));
  const names = new Set(labels.map((label) => label.name));
  const config = parse(read(".github/release.yml"));
  const used = [
    ...config.changelog.exclude.labels,
    ...config.changelog.categories.flatMap((/** @type {{ labels: string[] }} */ c) => c.labels),
  ].filter((name) => name !== "*");
  for (const form of readdirSync(new URL("../../../.github/ISSUE_TEMPLATE/", import.meta.url))) {
    if (form.endsWith(".yml") && form !== "config.yml")
      used.push(...(parse(read(`.github/ISSUE_TEMPLATE/${form}`)).labels ?? []));
  }
  assert.deepEqual(
    used.filter((name) => !names.has(name)),
    [],
  );
  assert.deepEqual(ghLabelArgs(labels[0], "o/r").slice(0, 3), ["label", "create", labels[0].name]);
  assert.throws(() => parseLabels([{ name: "x", color: "#fff", description: "" }]), /color/);
  assert.throws(() => parseLabels([...labels, { ...labels[0], name: labels[0].name.toUpperCase() }]), /duplicate/);
});

test("the fixed Changesets group names real workspace packages", () => {
  const config = JSON.parse(read(".changeset/config.json"));
  const manifests = ["packages/core", "packages/element", "packages/export", "apps/cli"].map(
    (dir) => JSON.parse(read(`${dir}/package.json`)).name,
  );
  assert.deepEqual(config.fixed, [manifests]);
  assert.equal(config.baseBranch, "main");
  assert.equal(config.access, "public");
  assert.deepEqual(config.privatePackages, { version: true, tag: false });
});

test("checkPackage resolves npm access the way Changesets does", () => {
  const pkg = (/** @type {Record<string, unknown>} */ publishConfig) => ({
    dir: "packages/core",
    manifest: {
      name: "@swarmloom/core",
      version: "0.0.0",
      license: "MIT",
      repository: { url: REPOSITORY_URL, directory: "packages/core" },
      files: ["dist"],
      exports: "./dist/index.js",
      ...publishConfig,
    },
  });
  /** @type {[Record<string, unknown>, string | undefined, boolean][]} manifest extra, config access, passes */
  const cases = [
    [{}, "public", true],
    [{ publishConfig: { access: "public" } }, undefined, true],
    [{}, undefined, false],
    [{ publishConfig: { access: "restricted" } }, "public", false],
  ];
  for (const [extra, defaultAccess, passes] of cases) {
    const { errors } = checkPackage(pkg(extra), { defaultAccess });
    assert.equal(errors.length === 0, passes, `${JSON.stringify(extra)} with ${defaultAccess}: ${errors.join("; ")}`);
  }
});

test("CI typechecks the release scripts through the root typecheck", () => {
  // checkJs only runs from scripts/release/tsconfig.json, so the CI-run root script must include it.
  assert.match(JSON.parse(read("package.json")).scripts.typecheck, /tsc -p scripts\/release(?: |$)/);
  const steps = parse(read(".github/workflows/ci.yml")).jobs.check.steps;
  assert.ok(steps.some((/** @type {{ run?: string }} */ step) => step.run === "pnpm typecheck"));
});
