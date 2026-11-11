// Pure helpers of scripts/bench.mjs: command line, frame statistics, budgets, report tables and the
// synthetic page. Nothing here touches a browser, so the rules can be unit tested (scripts/bench/test).
import { parseArgs } from "node:util";

/** `--json` value that sends the raw results to stdout. */
export const JSON_STDOUT = "-";

/**
 * Parses the bench command line. `--json` takes a file name; given without one (last argument, or
 * followed by another option), or as `--json -`, it means stdout.
 * @param {string[]} argv arguments after the script name
 * @returns {{ write: boolean, json?: string, reportOnly: boolean, chrome?: string }}
 * @throws TypeError on unknown options or positional arguments
 */
export function parseBenchArgs(argv) {
  const args = [...argv];
  const i = args.indexOf("--json");
  const next = args[i + 1];
  if (i >= 0 && (next === undefined || (next.startsWith("-") && next !== JSON_STDOUT))) {
    args[i] = `--json=${JSON_STDOUT}`;
  }
  const { values } = parseArgs({
    args,
    options: {
      write: { type: "boolean", default: false },
      json: { type: "string" },
      "report-only": { type: "boolean", default: false },
      chrome: { type: "string" },
    },
  });
  return { write: values.write, json: values.json, reportOnly: values["report-only"], chrome: values.chrome };
}

/** Frames slower than two 60 Hz periods count as dropped. */
export const SLOW_FRAME_MS = 33.4;

/**
 * Regression budgets. Loose on purpose: the machine running the bench is often shared, so they
 * catch structural regressions (a long task in the snapshot, finish() mounting every layer,
 * replays leaking, per-frame cost doubling) rather than a few percent of noise. `max` is an upper
 * bound and `min` a lower one. Behaviour spec §19 sets the targets these guard.
 */
export const BUDGETS = [
  { key: "demo.snapshotMs", max: 250, label: "demo: snapshot, ms" },
  { key: "demo.build.fps", min: 50, label: "demo: build fps" },
  { key: "demo.build.cbP95", max: 6, label: "demo: rAF callback p95, ms" },
  { key: "demo.build.slowShare", max: 0.05, label: "demo: share of frames over 33 ms" },
  { key: "demo.build.longTaskMs", max: 250, label: "demo: long tasks while building, ms" },
  { key: "demo.heapMB.built", max: 16, label: "demo: heap after build, MB" },
  { key: "demo.heapMB.leak", max: 2, label: "demo: heap growth over 3 replays, MB" },
  { key: "demo.seekMs", max: 500, label: "demo: seek(10 s) from the start, ms" },
  { key: "large.snapshotMs", max: 3000, label: "4k layers: snapshot, ms" },
  { key: "large.snapshotLongestTaskMs", max: 120, label: "4k layers: longest task while snapshotting, ms" },
  { key: "large.build.fps", min: 50, label: "4k layers: build fps" },
  { key: "large.build.cbP95", max: 6, label: "4k layers: rAF callback p95, ms" },
  { key: "large.build.slowShare", max: 0.05, label: "4k layers: share of frames over 33 ms" },
  { key: "large.nodes.peak", max: 2500, label: "4k layers: mounted stage nodes, peak while building" },
  { key: "large.nodes.finish", max: 2500, label: "4k layers: mounted stage nodes, peak during finish()" },
  { key: "large.finishMs", max: 3000, label: "4k layers: finish() to build end, ms" },
  { key: "large.heapMB.built", max: 48, label: "4k layers: heap after finish(), MB" },
  { key: "large.tourSeek.ms", max: 2000, label: "4k layers: tour-mode seek(60 s) from the start, ms" },
  { key: "large.tourSeek.nodes", max: 2500, label: "4k layers: mounted stage nodes after the tour-mode seek" },
  { key: "flock.cbP95", max: 3, label: "128-agent flock: rAF callback p95, ms" },
];

/**
 * One-off observation of the reference product on its own demo page (research notes, shared
 * loaded machine, screenshots every 250 ms). Printed for orientation only: page, machine and
 * method differ, so it is never a pass/fail input.
 */
export const REFERENCE = { fps: 45.7, longTasks: 5, longTaskMs: 1977, heapPeakMB: 7.37 };

/** Value at the given 0..1 quantile of an ascending array (nearest rank). */
export function quantile(sorted, q) {
  if (!sorted.length) return Number.NaN;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
  return sorted[i];
}

/**
 * Summarises the frames whose rAF timestamp lies in [from, to].
 * @param {{ ts: number[], cost: number[] }} frames rAF timestamps and the summed callback time of each frame.
 * @param {{ start: number, duration: number }[]} longTasks PerformanceObserver "longtask" entries.
 */
export function frameStats(frames, longTasks, from, to) {
  const ts = [];
  const cost = [];
  for (let i = 0; i < frames.ts.length; i++) {
    if (frames.ts[i] >= from && frames.ts[i] <= to) {
      ts.push(frames.ts[i]);
      cost.push(frames.cost[i]);
    }
  }
  let slow = 0;
  for (let i = 1; i < ts.length; i++) if (ts[i] - ts[i - 1] > SLOW_FRAME_MS) slow++;
  const span = ts.length > 1 ? ts[ts.length - 1] - ts[0] : 0;
  const sorted = [...cost].sort((a, b) => a - b);
  const tasks = longTasks.filter((t) => t.start + t.duration >= from && t.start <= to);
  return {
    ms: to - from,
    frames: ts.length,
    fps: span > 0 ? ((ts.length - 1) * 1000) / span : 0,
    cbMean: cost.length ? cost.reduce((a, b) => a + b, 0) / cost.length : Number.NaN,
    cbP95: quantile(sorted, 0.95),
    cbMax: sorted.length ? sorted[sorted.length - 1] : Number.NaN,
    slow,
    slowShare: ts.length > 1 ? slow / (ts.length - 1) : 0,
    longTasks: tasks.length,
    longTaskMs: tasks.reduce((a, t) => a + t.duration, 0),
  };
}

function valueAt(results, key) {
  let v = results;
  for (const part of key.split(".")) v = v?.[part];
  return v;
}

/**
 * Checks results against budgets. A missing or non-finite value fails: a metric that silently
 * stopped being measured must not pass.
 * @returns {{ key: string, label: string, value: number | undefined, limit: string, ok: boolean }[]}
 */
export function checkBudgets(results, budgets = BUDGETS) {
  return budgets.map((b) => {
    const value = valueAt(results, b.key);
    const finite = typeof value === "number" && Number.isFinite(value);
    const ok = finite && (b.max === undefined || value <= b.max) && (b.min === undefined || value >= b.min);
    const limit = b.max !== undefined ? `<= ${b.max}` : `>= ${b.min}`;
    return { key: b.key, label: b.label, value, limit, ok };
  });
}

function fmt(v, digits = 1) {
  return typeof v === "number" && Number.isFinite(v) ? v.toFixed(digits) : "n/a";
}

const COLUMNS = {
  zh: {
    head: "| 场景 | 图层 | 光标 | 快照 | 构建 fps | rAF 回调 均值 / p95 / 最大 | >33 ms 帧 | 长任务 | 舞台节点 | 堆内存 |",
    demo: "demo 页",
    large: "合成 4k 图层页（前 8 s，随后 finish()）",
    flock: "128 光标群聚结尾",
    nodes: (n) => `构建中峰值 ${n.peak}，finish() 期间峰值 ${n.finish}`,
    heap: (h) =>
      h.replays !== undefined
        ? `${fmt(h.base)} → 构建后 ${fmt(h.built)} → 3 次重播后 ${fmt(h.replays)} MB`
        : `finish 后 ${fmt(h.built)} MB`,
  },
  en: {
    head: "| Scenario | Layers | Cursors | Snapshot | Build fps | rAF callback mean / p95 / max | Frames >33 ms | Long tasks | Stage nodes | Heap |",
    demo: "demo page",
    large: "synthetic 4k-layer page (first 8 s, then finish())",
    flock: "128-cursor flock finale",
    nodes: (n) => `peak ${n.peak} building, ${n.finish} during finish()`,
    heap: (h) =>
      h.replays !== undefined
        ? `${fmt(h.base)} → ${fmt(h.built)} built → ${fmt(h.replays)} MB after 3 replays`
        : `${fmt(h.built)} MB after finish`,
  },
};

function row(c, name, s, build, extra = {}) {
  const cb = `${fmt(build.cbMean, 2)} / ${fmt(build.cbP95, 2)} / ${fmt(build.cbMax, 1)} ms`;
  const tasks = `${build.longTasks} / ${fmt(build.longTaskMs, 0)} ms`;
  const snap = s.snapshotMs !== undefined ? `${fmt(s.snapshotMs, 0)} ms` : "—";
  const nodes = extra.nodes ? c.nodes(extra.nodes) : "—";
  const heap = extra.heap ? c.heap(extra.heap) : "—";
  return `| ${name} | ${s.layers ?? "—"} | ${s.agents} | ${snap} | ${fmt(build.fps)} | ${cb} | ${build.slow} | ${tasks} | ${nodes} | ${heap} |`;
}

/**
 * Markdown table of a bench run in "zh" or "en", with the environment line and the budget outcome under it.
 * @param {ReturnType<typeof checkBudgets>} [checks] budget results of the run; omitted: no budget line
 */
export function renderTable(results, lang, checks) {
  const c = COLUMNS[lang];
  const { demo, large, flock, env } = results;
  const lines = [
    c.head,
    `|${"---|".repeat(10)}`,
    row(c, c.demo, demo, demo.build, { heap: demo.heapMB }),
    row(c, c.large, large, large.build, { nodes: large.nodes, heap: large.heapMB }),
    row(c, c.flock, { layers: demo.layers, agents: flock.agents }, flock),
  ];
  const tour = large.tourSeek;
  const seek =
    lang === "zh"
      ? `seek(10 s) 从头重放 ${fmt(demo.seekMs, 0)} ms；4k 图层页 tour 模式 seek(60 s) 从头重放 ${fmt(tour.ms, 0)} ms，之后舞台节点 ${fmt(tour.nodes, 0)}`
      : `seek(10 s) from the start ${fmt(demo.seekMs, 0)} ms; tour-mode seek(60 s) from the start on the 4k-layer page ${fmt(tour.ms, 0)} ms, ${fmt(tour.nodes, 0)} stage nodes after it`;
  const where =
    lang === "zh"
      ? `环境：${env.browser}，无头，${env.viewport}，DPR ${env.dpr}，关闭声音，${env.cpus} 核，1 分钟负载 ${fmt(env.load, 1)}，${env.date}。${seek}。`
      : `Environment: ${env.browser}, headless, ${env.viewport}, DPR ${env.dpr}, sound off, ${env.cpus} cores, 1-minute load ${fmt(env.load, 1)}, ${env.date}. ${seek}.`;
  if (!checks) return `${lines.join("\n")}\n\n${where}`;
  const failed = checks.filter((c) => !c.ok);
  const list = failed.map((c) => `${c.label} ${fmt(c.value, 1)} (${c.limit})`).join(lang === "zh" ? "；" : "; ");
  const met = `${checks.length - failed.length}/${checks.length}`;
  const budgets =
    lang === "zh"
      ? `预算：满足 ${met}${failed.length ? `；未满足：${list}` : ""}。`
      : `Budgets: ${met} met${failed.length ? `; failed: ${list}` : ""}.`;
  return `${lines.join("\n")}\n\n${where}\n\n${budgets}`;
}

export const SECTION_START = "<!-- bench:start -->";
export const SECTION_END = "<!-- bench:end -->";

/**
 * Replaces the text between the bench markers of a Markdown page.
 * @throws Error when the page lacks the markers, so a moved section is noticed.
 */
export function replaceSection(markdown, body) {
  const a = markdown.indexOf(SECTION_START);
  const b = markdown.indexOf(SECTION_END);
  if (a < 0 || b < a) throw new Error(`missing ${SECTION_START} … ${SECTION_END} markers`);
  return `${markdown.slice(0, a + SECTION_START.length)}\n${body}\n${markdown.slice(b)}`;
}

/** A self-contained page of `cards` cards (about 4.5 layers each) in a four-column grid. */
export function syntheticPage(cards) {
  const tones = ["#5b5bf7", "#ff4f7b", "#14b8a6", "#f5a524", "#d946ef", "#3ba7f5"];
  const items = [];
  for (let i = 0; i < cards; i++) {
    const tone = tones[i % tones.length];
    const badge = i % 2 === 0 ? `<span class="badge" style="background:${tone}">#${i}</span>` : "";
    items.push(
      `<article class="card"><h3>Card ${i}</h3><p>Warp ${i * 7} and weft ${i * 3} interlace in row ${i >> 2}.</p>${badge}<hr></article>`,
    );
  }
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>SwarmLoom bench</title><style>
body{margin:0;font:14px/1.5 system-ui,sans-serif;color:#0b0b12;background:#fafafc}
main{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;padding:16px}
.card{border:1px solid rgba(11,11,18,.12);border-radius:10px;background:#fff;padding:10px 12px}
h3{margin:0 0 4px;font-size:15px}p{margin:0 0 6px;color:#43435a}
.badge{display:inline-block;color:#fff;border-radius:999px;padding:0 8px;font-size:12px}
hr{border:0;border-top:1px solid #e4e4ee;margin:6px 0 0}
</style></head><body><main>${items.join("")}</main></body></html>`;
}
