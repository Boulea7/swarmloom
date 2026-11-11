import { extensionOf } from "../formats-meta";
import { DEFAULT_SETTINGS, type StudioSettings } from "../settings";

export type VideoFormat = "mp4" | "webm" | "gif" | "webp";
export const VIDEO_FORMATS: readonly VideoFormat[] = ["mp4", "webm", "gif", "webp"];

export interface FramePreset {
  id: string;
  width: number;
  height: number;
}

/** Common output sizes: landscape HD, full HD, square and vertical. */
export const FRAME_PRESETS: readonly FramePreset[] = [
  { id: "720p", width: 1280, height: 720 },
  { id: "1080p", width: 1920, height: 1080 },
  { id: "square", width: 1080, height: 1080 },
  { id: "vertical", width: 1080, height: 1920 },
];

export interface CliCommandOptions {
  /** File path or URL to render. */
  target: string;
  /** Base name for the output file (extension is replaced). */
  name: string;
  settings: StudioSettings;
  format: VideoFormat;
  width: number;
  height: number;
}

const SAFE = /^[A-Za-z0-9_./:@%+=,-]+$/;

/** Quotes one argument for POSIX shells (and PowerShell, which also treats '...' literally). */
export function shellQuote(arg: string): string {
  if (arg !== "" && SAFE.test(arg)) return arg;
  return `'${arg.replace(/'/g, `'\\''`)}'`;
}

/** "report.final.pdf" -> "report.final" */
function stem(name: string): string {
  const ext = extensionOf(name);
  const base = (ext ? name.slice(0, -(ext.length + 1)) : name).replace(/[^\p{L}\p{N}._-]+/gu, "-");
  return base.replace(/^-+|-+$/g, "") || "swarmloom";
}

/**
 * Builds the `npx swarmloom render` command that reproduces the current preview frame by frame.
 * Only flags that differ from the CLI defaults are listed, except `--seed`, which is always
 * written so the command stays reproducible even if defaults change.
 */
export function buildCliCommand(o: CliCommandOptions): string {
  const s = o.settings;
  const d = DEFAULT_SETTINGS;
  const args: string[] = [
    "npx",
    "swarmloom",
    "render",
    shellQuote(o.target),
    "-o",
    shellQuote(`${stem(o.name)}.${o.format}`),
  ];
  if (o.format !== "mp4") args.push("--format", o.format);
  if (o.width !== 1280) args.push("--width", String(o.width));
  if (o.height !== 720) args.push("--height", String(o.height));
  args.push("--seed", String(s.seed));
  if (s.speed !== d.speed) args.push("--speed", String(s.speed));
  if (s.agents !== d.agents) args.push("--agents", String(s.agents));
  if (s.theme !== d.theme) args.push("--theme", s.theme);
  if (s.labels !== d.labels) args.push("--labels", s.labels);
  if (s.finale !== d.finale) args.push("--finale", s.finale);
  if (!s.sound) args.push("--no-sound");
  return args.join(" ");
}
