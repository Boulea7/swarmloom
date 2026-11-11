// @ts-check
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { isOnRegistry, versionPackages } from "../version-packages.mjs";

/**
 * @param {number} status
 * @param {unknown} [body]
 * @returns {import("../version-packages.mjs").Fetch}
 */
const answer = (status, body) => async () => ({ status, json: async () => body });

test("the registry decides whether the first release is still pending, and errors stop it", async () => {
  assert.equal(await isOnRegistry("@swarmloom/core", answer(404)), false);
  assert.equal(await isOnRegistry("@swarmloom/core", answer(200, { versions: { "0.1.0": {} } })), true);
  await assert.rejects(isOnRegistry("@swarmloom/core", answer(503)), /HTTP 503/);
  await assert.rejects(isOnRegistry("@swarmloom/core", answer(200, { error: "x" })), /no versions/);
  await assert.rejects(isOnRegistry("../core", answer(404)), /Invalid package name/);
  /** @type {string[]} */
  const urls = [];
  await isOnRegistry("@swarmloom/core", async (url) => {
    urls.push(url);
    return { status: 404, json: async () => ({}) };
  });
  assert.deepEqual(urls, ["https://registry.npmjs.org/@swarmloom%2fcore"]);
});

test("pending changesets fold into the first release instead of bumping past it", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "changesets-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const name of ["README.md", "config.json", "cli-capture-cues.md", "initial-release.md"]) {
    writeFileSync(join(dir, name), '---\n"swarmloom": minor\n---\n\nx\n');
  }
  let versioned = 0;
  const runVersion = () => {
    versioned++;
    return 0;
  };

  const dry = versionPackages({ changesetDir: dir, published: false, runVersion, dryRun: true });
  assert.deepEqual(dry.removed, ["cli-capture-cues.md", "initial-release.md"]);
  assert.equal(readdirSync(dir).length, 4);

  // Before the first release: nothing is versioned, the changesets go, README and config stay.
  const first = versionPackages({ changesetDir: dir, published: false, runVersion });
  assert.deepEqual([first.mode, first.status, versioned], ["first-release", 0, 0]);
  assert.deepEqual(readdirSync(dir).sort(), ["README.md", "config.json"]);

  // After it: plain `changeset version`, whose exit status is passed on.
  writeFileSync(join(dir, "next.md"), '---\n"swarmloom": patch\n---\n\ny\n');
  const runFailing = () => {
    versioned++;
    return 3;
  };
  const later = versionPackages({ changesetDir: dir, published: true, runVersion: runFailing });
  assert.deepEqual([later.mode, later.status, versioned], ["version", 3, 1]);
  assert.ok(readdirSync(dir).includes("next.md"));
});
