import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BUDGETS,
  checkBudgets,
  frameStats,
  parseBenchArgs,
  replaceSection,
  SECTION_END,
  SECTION_START,
} from "../lib.mjs";

/** Results that meet every budget: the midpoint between zero and each limit, or twice each floor. */
function passing() {
  const results = {};
  for (const b of BUDGETS) {
    const parts = b.key.split(".");
    let o = results;
    for (const p of parts.slice(0, -1)) o = o[p] ??= {};
    o[parts.at(-1)] = b.max !== undefined ? b.max / 2 : b.min * 2;
  }
  return results;
}

test("budgets fail on a regression or a metric that is no longer measured", () => {
  const cases = [
    ["all within budget", () => {}, []],
    ["finish() mounts every layer", (r) => (r.large.nodes.finish = 4400), ["large.nodes.finish"]],
    ["snapshot runs as one long task", (r) => (r.large.snapshotLongestTaskMs = 300), ["large.snapshotLongestTaskMs"]],
    ["fps below the floor", (r) => (r.demo.build.fps = 30), ["demo.build.fps"]],
    ["heap leak metric missing", (r) => delete r.demo.heapMB.leak, ["demo.heapMB.leak"]],
  ];
  for (const [name, mutate, failing] of cases) {
    const r = passing();
    mutate(r);
    const failed = checkBudgets(r)
      .filter((c) => !c.ok)
      .map((c) => c.key);
    assert.deepEqual(failed, failing, name);
  }
});

test("frame stats cover only the window and count frames over 33 ms", () => {
  // 60 Hz frames with one 50 ms gap; the first and last frames fall outside the window.
  const ts = [0, 100, 116.7, 133.3, 183.3, 200, 216.7, 900];
  const frames = { ts, cost: ts.map((_, i) => i + 1) };
  const longTasks = [
    { start: 120, duration: 60 },
    { start: 500, duration: 80 },
  ];
  const s = frameStats(frames, longTasks, 100, 220);
  assert.equal(s.frames, 6);
  assert.equal(s.slow, 1);
  assert.equal(s.cbMax, 7);
  assert.equal(s.longTasks, 1);
  assert.ok(Math.abs(s.fps - 5000 / 116.7) < 1e-6);
});

test("docs sections are replaced between the markers and missing markers throw", () => {
  const page = `# Perf\n\n${SECTION_START}\nold\n${SECTION_END}\n\ntail\n`;
  assert.equal(replaceSection(page, "new"), `# Perf\n\n${SECTION_START}\nnew\n${SECTION_END}\n\ntail\n`);
  assert.throws(() => replaceSection("# Perf\n", "new"), /markers/);
});

test("--json takes a file, or means stdout without one; unknown options throw", () => {
  const cases = [
    // Regression: `--report-only --json` used to stop with ERR_PARSE_ARGS_INVALID_OPTION_VALUE.
    [["--report-only", "--json"], { json: "-", reportOnly: true, write: false }],
    [["--json", "--write"], { json: "-", reportOnly: false, write: true }],
    [["--json", "-"], { json: "-", reportOnly: false, write: false }],
    [["--json", "bench.json", "--report-only"], { json: "bench.json", reportOnly: true, write: false }],
    [[], { json: undefined, reportOnly: false, write: false }],
  ];
  for (const [argv, want] of cases) {
    const got = parseBenchArgs(argv);
    assert.deepEqual({ json: got.json, reportOnly: got.reportOnly, write: got.write }, want, argv.join(" "));
  }
  assert.throws(() => parseBenchArgs(["--jsn"]), /Unknown option/);
  assert.throws(() => parseBenchArgs(["extra"]), /positional/);
});
