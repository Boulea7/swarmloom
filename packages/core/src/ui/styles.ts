/**
 * Toolbar styles, scoped to the toolbar's own shadow root so page and blueprint CSS cannot reach it.
 * Colours follow the SwarmLoom brand constants (Loom Indigo #5B5BF7, ink #0B0B12, paper #FAFAFC).
 */

export const TOOLBAR_CSS = /* css */ `
:host {
  all: initial;
  position: absolute;
  inset: 0;
  pointer-events: none;
  contain: layout style;
  z-index: 2147483000;
  --sl-primary: #5b5bf7;
  --sl-primary-ink: #ffffff;
  --sl-focus: #5b5bf7;
  --sl-target: 36px;
  --sl-gap: 4px;
  --sl-pad: 6px;
  --sl-ease: cubic-bezier(0.2, 0.8, 0.2, 1);
  --sl-seek-h: 20px;
  font: 500 13px/1.2 system-ui, -apple-system, "Segoe UI", Roboto, "PingFang SC", "Hiragino Sans",
    "Noto Sans CJK SC", "Microsoft YaHei", "Malgun Gothic", sans-serif;
  -webkit-font-smoothing: antialiased;
  -webkit-tap-highlight-color: transparent;
}
:host([data-chrome="light"]) {
  --sl-bg: rgba(250, 250, 252, 0.8);
  --sl-bg-solid: #fafafc;
  --sl-ink: #0b0b12;
  --sl-ink-2: rgba(11, 11, 18, 0.62);
  --sl-line: rgba(11, 11, 18, 0.12);
  --sl-hover: rgba(11, 11, 18, 0.06);
  --sl-active: rgba(11, 11, 18, 0.1);
  --sl-track: rgba(11, 11, 18, 0.12);
  --sl-shadow: 0 10px 30px -8px rgba(11, 11, 18, 0.24), 0 2px 6px rgba(11, 11, 18, 0.08);
  --sl-accent-ink: #4545dd;
  --sl-accent-soft: rgba(91, 91, 247, 0.12);
  color-scheme: light;
}
:host([data-chrome="dark"]) {
  --sl-bg: rgba(20, 20, 30, 0.72);
  --sl-bg-solid: #16161f;
  --sl-ink: #f4f4f8;
  --sl-ink-2: rgba(244, 244, 248, 0.66);
  --sl-line: rgba(255, 255, 255, 0.14);
  --sl-hover: rgba(255, 255, 255, 0.08);
  --sl-active: rgba(255, 255, 255, 0.14);
  --sl-track: rgba(255, 255, 255, 0.16);
  --sl-shadow: 0 10px 30px -8px rgba(0, 0, 0, 0.6), 0 2px 6px rgba(0, 0, 0, 0.3);
  --sl-focus: #8f8fff;
  --sl-accent-ink: #b4b4ff;
  --sl-accent-soft: rgba(143, 143, 255, 0.16);
  color-scheme: dark;
}
:host([data-compact]) { --sl-target: 44px; --sl-gap: 2px; --sl-pad: 4px; }
@media (pointer: coarse) { :host { --sl-target: 44px; --sl-seek-h: 28px; } }

[hidden] { display: none !important; }

.dock {
  position: absolute;
  left: var(--sl-dock-left, 0px);
  width: var(--sl-dock-width, 100%);
  bottom: var(--sl-dock-bottom, 0px);
  box-sizing: border-box;
  display: flex;
  justify-content: center;
  padding: 0 max(12px, env(safe-area-inset-right, 0px)) max(14px, env(safe-area-inset-bottom, 0px))
    max(12px, env(safe-area-inset-left, 0px));
  pointer-events: none;
  transition: left 0.3s var(--sl-ease), width 0.3s var(--sl-ease), bottom 0.3s var(--sl-ease);
}

.bar {
  position: relative;
  pointer-events: auto;
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  align-items: center;
  gap: var(--sl-gap);
  max-width: 100%;
  box-sizing: border-box;
  padding: var(--sl-pad);
  border-radius: calc(var(--sl-target) / 2 + var(--sl-pad));
  background: var(--sl-bg);
  color: var(--sl-ink);
  border: 1px solid var(--sl-line);
  box-shadow: var(--sl-shadow);
  -webkit-backdrop-filter: blur(18px) saturate(1.5);
  backdrop-filter: blur(18px) saturate(1.5);
  transition: opacity 0.24s var(--sl-ease), transform 0.32s var(--sl-ease);
  touch-action: manipulation;
  user-select: none;
  -webkit-user-select: none;
}
@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
  .bar { background: var(--sl-bg-solid); }
}
@media (prefers-reduced-transparency: reduce) {
  .bar { background: var(--sl-bg-solid); backdrop-filter: none; -webkit-backdrop-filter: none; }
}
.dock[data-away] .bar { opacity: 0; transform: translateY(10px); pointer-events: none; }

.sep { width: 1px; height: calc(var(--sl-target) * 0.5); background: var(--sl-line); margin: 0 2px; }
:host([data-compact]) .sep { display: none; }

.btn {
  all: unset;
  position: relative;
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-width: var(--sl-target);
  height: var(--sl-target);
  padding: 0 calc((var(--sl-target) - 20px) / 2);
  border-radius: calc(var(--sl-target) / 2);
  color: inherit;
  cursor: pointer;
  white-space: nowrap;
  transition: background-color 0.15s ease, color 0.15s ease, box-shadow 0.15s ease;
}
.btn svg { width: 20px; height: 20px; flex: none; }
.btn:hover { background: var(--sl-hover); }
.btn:active { background: var(--sl-active); }
.btn:focus-visible, .ring:focus-visible { outline: 2px solid var(--sl-focus); outline-offset: 2px; }
.btn[aria-pressed="false"] { color: var(--sl-ink-2); }
.btn.labelled { padding: 0 14px 0 calc((var(--sl-target) - 20px) / 2); }
.btn.primary { background: var(--sl-primary); color: var(--sl-primary-ink); }
.btn.primary:hover { background: color-mix(in srgb, var(--sl-primary) 88%, #000); }
:host([data-compact]) .label { display: none; }
:host([data-compact]) .btn.labelled { padding: 0 calc((var(--sl-target) - 20px) / 2); }

.speed {
  display: inline-flex;
  border-radius: calc(var(--sl-target) / 2);
  background: var(--sl-hover);
}
.speed .btn {
  min-width: var(--sl-target);
  padding: 0 6px;
  font-variant-numeric: tabular-nums;
  color: var(--sl-ink-2);
}
.speed .btn[aria-checked="true"] {
  background: var(--sl-bg-solid);
  color: var(--sl-ink);
  box-shadow: inset 0 0 0 1px var(--sl-line), 0 1px 3px rgba(0, 0, 0, 0.14);
  font-weight: 600;
}
.cycle { font-variant-numeric: tabular-nums; font-weight: 600; }

.ring {
  position: relative;
  display: inline-grid;
  place-items: center;
  width: var(--sl-target);
  height: var(--sl-target);
  border-radius: 50%;
  outline: none;
  cursor: default;
}
.ring svg.track { position: absolute; inset: 3px; width: calc(100% - 6px); height: calc(100% - 6px); transform: rotate(-90deg); }
.ring circle { fill: none; stroke-width: 2.5; }
.ring .bg { stroke: var(--sl-track); }
.ring .fg { stroke: var(--sl-primary); stroke-linecap: round; transition: stroke-dashoffset 0.35s var(--sl-ease); }
.ring .pct { display: inline-flex; align-items: baseline; font-size: 11px; font-weight: 600; font-variant-numeric: tabular-nums; letter-spacing: -0.03em; }
.ring .unit { font-size: 7.5px; font-weight: 600; margin-left: 0.5px; }
.ring .pct[data-unit-first] { flex-direction: row-reverse; }
.ring svg[data-icon] { width: 20px; height: 20px; color: var(--sl-accent-ink); stroke-width: 2; }

/*
 * Seek bar: a row across the top of the pill. Out of the flex flow, so it never widens the pill
 * or changes how the buttons wrap; the pill makes room for it with extra top padding.
 */
.bar[data-seek] { padding-top: calc(var(--sl-pad) + var(--sl-seek-h) + 2px); }
.seek {
  -webkit-appearance: none;
  appearance: none;
  position: absolute;
  top: var(--sl-pad);
  left: calc(var(--sl-pad) + var(--sl-target) / 2 - 7px);
  right: calc(var(--sl-pad) + var(--sl-target) / 2 - 7px);
  width: auto;
  height: var(--sl-seek-h);
  margin: 0;
  padding: 0;
  box-sizing: border-box;
  background: transparent;
  color: inherit;
  cursor: pointer;
  touch-action: pan-y;
}
.seek::-webkit-slider-runnable-track {
  height: 4px;
  border-radius: 2px;
  background: linear-gradient(to right, var(--sl-primary) var(--sl-seek, 0%), var(--sl-track) var(--sl-seek, 0%));
}
.seek::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 14px;
  height: 14px;
  margin-top: -5px;
  border-radius: 50%;
  background: var(--sl-primary);
  border: 2px solid var(--sl-bg-solid);
  box-sizing: border-box;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.28);
}
.seek::-moz-range-track { height: 4px; border-radius: 2px; background: var(--sl-track); }
.seek::-moz-range-progress { height: 4px; border-radius: 2px; background: var(--sl-primary); }
.seek::-moz-range-thumb {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--sl-primary);
  border: 2px solid var(--sl-bg-solid);
  box-sizing: border-box;
}
.seek:focus-visible { outline: 2px solid var(--sl-focus); outline-offset: 2px; border-radius: 6px; }

.tip {
  position: absolute;
  bottom: calc(100% + 12px);
  left: 50%;
  transform: translate(-50%, 4px);
  padding: 6px 10px;
  border-radius: 8px;
  background: var(--sl-bg-solid);
  color: var(--sl-ink);
  border: 1px solid var(--sl-line);
  box-shadow: var(--sl-shadow);
  font-size: 12px;
  white-space: nowrap;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.15s ease, transform 0.15s ease;
}
.ring .tip { left: 0; transform: translate(0, 4px); }
.ring:focus-visible .tip, .btn:focus-visible .tip { opacity: 1; transform: translate(-50%, 0); }
.ring:focus-visible .tip { transform: none; }
@media (hover: hover) {
  .ring:hover .tip, .btn:hover .tip { opacity: 1; transform: translate(-50%, 0); transition-delay: 0.35s; }
  .ring:hover .tip { transform: none; }
}
.bar[data-seek] .tip { bottom: calc(100% + 14px + var(--sl-seek-h)); }
.dock[data-away] .tip { opacity: 0; }

.hint { font-size: 12.5px; }
.btn.locked { color: var(--sl-accent-ink); background: var(--sl-accent-soft); }
.btn.locked::before {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: inherit;
  box-shadow: 0 0 0 0 color-mix(in srgb, var(--sl-primary) 45%, transparent);
  animation: sl-pulse 1.6s ease-out infinite;
}
:host([data-compact]) .hint {
  position: absolute;
  bottom: calc(100% + 12px);
  left: 50%;
  transform: translateX(-50%);
  padding: 6px 10px;
  border-radius: 999px;
  background: var(--sl-primary);
  color: var(--sl-primary-ink);
  box-shadow: var(--sl-shadow);
}
:host([data-compact]) .bar[data-seek] .hint { bottom: calc(100% + 14px + var(--sl-seek-h)); }
@keyframes sl-pulse {
  0% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--sl-primary) 45%, transparent); }
  70%, 100% { box-shadow: 0 0 0 10px transparent; }
}

.sr {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
  border: 0;
}

@media (prefers-reduced-motion: reduce) {
  .dock, .bar, .btn, .tip, .ring .fg { transition: none !important; }
  .btn.locked::before { animation: none; box-shadow: 0 0 0 2px color-mix(in srgb, var(--sl-primary) 45%, transparent); }
  .dock[data-away] .bar { transform: none; }
}
@media (forced-colors: active) {
  .bar, .tip { border-color: CanvasText; }
  .btn.primary, .speed .btn[aria-checked="true"] { forced-color-adjust: none; background: Highlight; color: HighlightText; }
  .ring .fg { stroke: Highlight; }
  .seek { forced-color-adjust: none; --sl-primary: Highlight; --sl-track: GrayText; --sl-bg-solid: Canvas; }
}
`;
