#!/usr/bin/env node
/**
 * Generates examples/image/scene.webp: an original, procedurally drawn landscape (seeded, so the
 * output is reproducible on the same Chromium build). Rendering happens in a headless Chromium
 * canvas and is encoded with the browser's WebP encoder.
 *
 * Usage: SWARMLOOM_CHROME=/path/to/chrome node examples/image/generate-scene.mjs
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const WIDTH = 960;
const HEIGHT = 640;
const QUALITY = 0.86;
const out = join(dirname(fileURLToPath(import.meta.url)), "scene.webp");

/** Runs inside the page: draws the scene and returns a WebP data URL. */
function draw({ width, height, quality }) {
  let seed = 20261110;
  const rand = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const g = canvas.getContext("2d");
  const horizon = height * 0.62;

  // Sky.
  const sky = g.createLinearGradient(0, 0, 0, horizon);
  sky.addColorStop(0, "#2b3a7a");
  sky.addColorStop(0.45, "#8f5fb0");
  sky.addColorStop(0.8, "#f08a6c");
  sky.addColorStop(1, "#ffd28a");
  g.fillStyle = sky;
  g.fillRect(0, 0, width, horizon);

  // Stars in the upper sky.
  for (let i = 0; i < 70; i++) {
    const x = rand() * width;
    const y = rand() * horizon * 0.35;
    g.fillStyle = `rgba(255,255,240,${0.3 + rand() * 0.6})`;
    g.fillRect(x, y, 1.6, 1.6);
  }

  // Sun with a glow.
  const sx = width * 0.68;
  const sy = horizon * 0.4;
  const glow = g.createRadialGradient(sx, sy, 10, sx, sy, 220);
  glow.addColorStop(0, "rgba(255,236,170,0.9)");
  glow.addColorStop(1, "rgba(255,180,120,0)");
  g.fillStyle = glow;
  g.fillRect(0, 0, width, horizon);
  g.fillStyle = "#fff1c4";
  g.beginPath();
  g.arc(sx, sy, 46, 0, Math.PI * 2);
  g.fill();

  // Clouds: clusters of soft ellipses.
  const cloud = (cx, cy, s, colour) => {
    g.fillStyle = colour;
    for (let i = 0; i < 7; i++) {
      g.beginPath();
      g.ellipse(cx + (i - 3) * 22 * s, cy + Math.sin(i * 1.7) * 6 * s, 34 * s, 16 * s, 0, 0, Math.PI * 2);
      g.fill();
    }
  };
  cloud(width * 0.2, 120, 1.1, "rgba(255,214,220,0.75)");
  cloud(width * 0.47, 80, 0.8, "rgba(255,226,230,0.6)");
  cloud(width * 0.86, 170, 0.9, "rgba(255,200,190,0.65)");

  // Mountain ranges, far to near.
  const ridge = (base, amp, rough, colour) => {
    g.fillStyle = colour;
    g.beginPath();
    g.moveTo(0, horizon);
    let y = base;
    for (let x = 0; x <= width; x += 8) {
      y += (rand() - 0.5) * rough;
      y = Math.min(horizon - 4, Math.max(base - amp, y));
      g.lineTo(x, y + Math.sin(x / 90) * amp * 0.35);
    }
    g.lineTo(width, horizon);
    g.closePath();
    g.fill();
  };
  ridge(horizon - 150, 80, 22, "#6d4f8f");
  ridge(horizon - 95, 60, 18, "#4d3a78");
  ridge(horizon - 45, 35, 12, "#2f2a5c");

  // Lake with the sun's reflection.
  const lake = g.createLinearGradient(0, horizon, 0, height);
  lake.addColorStop(0, "#f0a07a");
  lake.addColorStop(0.3, "#7a5a9a");
  lake.addColorStop(1, "#1f2350");
  g.fillStyle = lake;
  g.fillRect(0, horizon, width, height - horizon);
  for (let i = 0; i < 26; i++) {
    const y = horizon + 6 + i * 7;
    const w = 120 - i * 3.5 + rand() * 30;
    g.fillStyle = `rgba(255,232,170,${0.65 - i * 0.022})`;
    g.fillRect(sx - w / 2 + (rand() - 0.5) * 12, y, w, 2.5);
  }

  // Near shore with grass.
  g.fillStyle = "#1c3b2f";
  g.beginPath();
  g.moveTo(0, height);
  g.lineTo(0, height - 120);
  g.bezierCurveTo(width * 0.18, height - 150, width * 0.32, height - 90, width * 0.46, height - 70);
  g.bezierCurveTo(width * 0.55, height - 58, width * 0.6, height - 30, width * 0.66, height);
  g.closePath();
  g.fill();

  // Pine trees on the shore.
  const pine = (x, base, h) => {
    g.fillStyle = "#3b2a1e";
    g.fillRect(x - 3, base - h * 0.18, 6, h * 0.18);
    for (let k = 0; k < 3; k++) {
      const top = base - h + k * h * 0.22;
      const half = h * (0.18 + k * 0.08);
      g.fillStyle = k % 2 ? "#2e6a4a" : "#245a3e";
      g.beginPath();
      g.moveTo(x, top);
      g.lineTo(x + half, top + h * 0.42);
      g.lineTo(x - half, top + h * 0.42);
      g.closePath();
      g.fill();
    }
  };
  pine(70, height - 112, 150);
  pine(140, height - 120, 120);
  pine(205, height - 105, 135);

  // A small cabin with a lit window.
  const hx = 300;
  const hy = height - 96;
  g.fillStyle = "#a8503c";
  g.fillRect(hx, hy - 52, 88, 52);
  g.fillStyle = "#5c2d2a";
  g.beginPath();
  g.moveTo(hx - 10, hy - 50);
  g.lineTo(hx + 44, hy - 88);
  g.lineTo(hx + 98, hy - 50);
  g.closePath();
  g.fill();
  g.fillStyle = "#ffd36b";
  g.fillRect(hx + 14, hy - 38, 20, 18);
  g.fillStyle = "#3a221c";
  g.fillRect(hx + 54, hy - 34, 18, 34);

  // A boat on the lake.
  g.fillStyle = "#e9e2d4";
  g.beginPath();
  g.moveTo(width * 0.5, horizon + 70);
  g.lineTo(width * 0.5 + 70, horizon + 70);
  g.lineTo(width * 0.5 + 58, horizon + 84);
  g.lineTo(width * 0.5 + 10, horizon + 84);
  g.closePath();
  g.fill();
  g.strokeStyle = "#e9e2d4";
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(width * 0.5 + 34, horizon + 70);
  g.lineTo(width * 0.5 + 34, horizon + 20);
  g.stroke();
  g.fillStyle = "#f2b14c";
  g.beginPath();
  g.moveTo(width * 0.5 + 36, horizon + 22);
  g.lineTo(width * 0.5 + 64, horizon + 64);
  g.lineTo(width * 0.5 + 36, horizon + 64);
  g.closePath();
  g.fill();

  // Birds.
  g.strokeStyle = "#2a2140";
  g.lineWidth = 2;
  for (let i = 0; i < 6; i++) {
    const bx = width * 0.3 + i * 38 + rand() * 20;
    const by = 190 + rand() * 60;
    g.beginPath();
    g.moveTo(bx - 9, by);
    g.quadraticCurveTo(bx - 4, by - 6, bx, by);
    g.quadraticCurveTo(bx + 4, by - 6, bx + 9, by);
    g.stroke();
  }

  return canvas.toDataURL("image/webp", quality);
}

const browser = await chromium.launch({ executablePath: process.env.SWARMLOOM_CHROME || undefined });
try {
  const page = await browser.newPage();
  const url = await page.evaluate(draw, { width: WIDTH, height: HEIGHT, quality: QUALITY });
  const prefix = "data:image/webp;base64,";
  if (!url.startsWith(prefix)) throw new Error("This Chromium build cannot encode WebP");
  const bytes = Buffer.from(url.slice(prefix.length), "base64");
  writeFileSync(out, bytes);
  console.log(`wrote ${out} (${bytes.length} bytes, ${WIDTH}x${HEIGHT})`);
} finally {
  await browser.close();
}
