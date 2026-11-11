#!/usr/bin/env node
// Writes session.cast: a scripted, fully synthetic asciinema v2 recording (no real shell runs).
// It exercises what the terminal adapter supports: typed input with 'i' events and echo,
// 16/256/truecolor SGR, bold/underline, a carriage-return progress bar, backspace corrections,
// erase-line and a resize-free fixed window. Deterministic: same output on every run.
//
//   node examples/terminal/make-session.mjs

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ESC = "\u001b";
const sgr = (...codes) => `${ESC}[${codes.join(";")}m`;
const reset = sgr(0);

// Small LCG so the typing rhythm varies but is reproducible.
let seed = 20240611;
const rand = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
};

const events = [];
let t = 0.35;
const out = (data, gap = 0) => {
  t += gap;
  events.push([Number(t.toFixed(3)), "o", data]);
};
const prompt = () =>
  out(
    `${sgr(1, 38, 5, 105)}weaver${reset}${sgr(2)}@${reset}${sgr(38, 5, 80)}loom${reset} ${sgr(1, 34)}~/swarmloom${reset} ${sgr(38, 2, 255, 79, 123)}>${reset} `,
    0.05,
  );

/** Types `text` key by key: an 'i' event then its echo a few ms later. */
const type = (text, { pause = 0.5 } = {}) => {
  t += pause;
  for (const ch of text) {
    t += 0.055 + rand() * 0.09;
    events.push([Number(t.toFixed(3)), "i", ch]);
    events.push([Number((t + 0.004).toFixed(3)), "o", ch]);
  }
};
const typo = (wrong, fix) => {
  type(wrong, { pause: 0.2 });
  t += 0.25;
  for (let i = 0; i < wrong.length; i++) {
    t += 0.07;
    events.push([Number(t.toFixed(3)), "i", "\u007f"]);
    events.push([Number((t + 0.004).toFixed(3)), "o", "\b \b"]);
  }
  type(fix, { pause: 0.15 });
};
const enter = () => {
  t += 0.3;
  events.push([Number(t.toFixed(3)), "i", "\r"]);
  events.push([Number((t + 0.004).toFixed(3)), "o", "\r\n"]);
};

prompt();
type("pnpm test --filter ");
typo("adaptr", "adapter-terminal");
enter();
out(
  `\r\n ${sgr(1, 7, 36)} RUN ${reset} ${sgr(36)}v3.2.4${reset} ${sgr(2)}packages/adapter-terminal${reset}\r\n\r\n`,
  0.6,
);
const suites = [
  ["ansi/sgr.test.ts", 41, 18],
  ["ansi/parser.test.ts", 23, 9],
  ["screen.test.ts", 37, 25],
  ["cast.test.ts", 19, 12],
  ["timeline.test.ts", 11, 6],
];
for (const [file, n, ms] of suites) {
  out(
    ` ${sgr(32)}✓${reset} test/${file} ${sgr(2)}(${n} tests)${reset} ${sgr(33)}${ms}ms${reset}\r\n`,
    0.18 + rand() * 0.25,
  );
}
out(`\r\n ${sgr(2)}Test Files${reset}  ${sgr(1, 32)}5 passed${reset} ${sgr(90)}(5)${reset}\r\n`, 0.3);
out(`      ${sgr(2)}Tests${reset}  ${sgr(1, 32)}131 passed${reset} ${sgr(90)}(131)${reset}\r\n\r\n`, 0.05);

prompt();
type("node scripts/weave.mjs --palette");
enter();
const palette = [
  ["indigo", [91, 91, 247]],
  ["accent", [255, 79, 123]],
  ["coral", [255, 107, 91]],
  ["amber", [245, 165, 36]],
  ["teal", [20, 184, 166]],
];
for (const [name, [r, g, b]] of palette) {
  out(
    `  ${sgr(48, 2, r, g, b)}      ${reset} ${sgr(1)}${name.padEnd(7)}${reset}${sgr(38, 2, r, g, b)}#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}${reset}\r\n`,
    0.12,
  );
}
let ramp = "  ";
for (let i = 232; i <= 255; i += 1) ramp += `${sgr(48, 5, i)} `;
out(`${ramp}${reset}\r\n`, 0.2);
out(`  ${sgr(4)}weaving threads${reset}\r\n`, 0.3);
for (let p = 0; p <= 20; p++) {
  const bar = `${sgr(38, 5, 99)}${"█".repeat(p)}${sgr(38, 5, 238)}${"░".repeat(20 - p)}${reset}`;
  out(`\r  ${bar} ${String(p * 5).padStart(3)}%${ESC}[K`, p === 0 ? 0.2 : 0.07 + rand() * 0.08);
}
out(`\r\n  ${sgr(1, 32)}done${reset} in 1.9s\r\n\r\n`, 0.25);
prompt();
t += 1.2;

const header = {
  version: 2,
  width: 74,
  height: 30,
  timestamp: 1718064000,
  idle_time_limit: 2,
  title: "weaver@loom: pnpm test",
  env: { SHELL: "/bin/zsh", TERM: "xterm-256color" },
};
const lines = [JSON.stringify(header), ...events.map((e) => JSON.stringify(e))];
const here = dirname(fileURLToPath(import.meta.url));
writeFileSync(join(here, "session.cast"), `${lines.join("\n")}\n`);
console.log(`session.cast: ${events.length} events, ${t.toFixed(1)} s`);
