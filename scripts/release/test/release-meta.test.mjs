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

test("CI runs the real CLI render tests, with ffmpeg required, on every OS it checks", () => {
  // The check job may skip them (SWARMLOOM_TEST_DEPS=optional) only because another job runs them on that OS.
  /** @type {Record<string, { "runs-on": string, strategy?: { matrix: { os: string[] } }, env?: Record<string, string>, steps: { run?: string, env?: Record<string, string> }[] }>} */
  const jobs = parse(read(".github/workflows/ci.yml")).jobs;
  const covered = Object.values(jobs).flatMap((job) => {
    const optional = (/** @type {Record<string, string> | undefined} */ env) => env?.SWARMLOOM_TEST_DEPS === "optional";
    const files = ["render.test.ts", "snapshot.test.ts", "launch.test.ts"].map((file) => `apps/cli/test/${file}`);
    const runs = job.steps.some((step) => files.every((file) => step.run?.includes(file)) && !optional(step.env));
    return runs && !optional(job.env) ? (job.strategy?.matrix.os ?? [job["runs-on"]]) : [];
  });
  for (const os of jobs.check.strategy?.matrix.os ?? []) assert.ok(covered.includes(os), os);
});

test("CI runs the WebKit tests unconditionally, so a failed WebKit install fails CI", () => {
  // Safari's engine has no other regression entry: an apt or download failure must not become a skipped suite.
  /** @type {Record<string, { if?: string, "continue-on-error"?: unknown, steps: { run?: string, if?: string, "continue-on-error"?: unknown }[] }>} */
  const jobs = parse(read(".github/workflows/ci.yml")).jobs;
  const job = Object.values(jobs).find((candidate) => candidate.steps.some((step) => step.run === "pnpm test:webkit"));
  assert.ok(job, "no CI job runs pnpm test:webkit");
  const webkitSteps = job.steps.filter((step) => /\bwebkit\b/.test(step.run ?? ""));
  assert.ok(webkitSteps.some((step) => /playwright install(?:-deps| --with-deps)\b.*\bwebkit\b/.test(step.run ?? "")));
  for (const unit of [job, ...webkitSteps]) {
    assert.equal(unit.if, undefined, `conditional: ${JSON.stringify(unit)}`);
    assert.equal(unit["continue-on-error"], undefined, `continue-on-error: ${JSON.stringify(unit)}`);
  }
  for (const step of webkitSteps) assert.doesNotMatch(step.run ?? "", /\|\||&&\s*exit 0/, "install falls back");
});
