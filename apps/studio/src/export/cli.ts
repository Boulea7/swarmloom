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
  /** File name or URL to render. */
  target: string;
  /** The target is a local file the user must have (pasted or opened content), not a URL. */
  targetIsFile: boolean;
  /** Base name for the output file (extension is replaced). */
  name: string;
  settings: StudioSettings;
  format: VideoFormat;
  width: number;
  height: number;
}

export interface CliCommand {
  /** The command line. It reads the same in POSIX shells, PowerShell and cmd.exe. */
  text: string;
  /**
   * File name the user must save the source as before running the command: the local file, or a
   * stand-in for a URL that cannot be written safely on a command line.
   */
  saveAs?: string;
}

/**
 * Unquoted, these characters mean the same in POSIX shells, PowerShell and cmd.exe. A `%` is only
 * allowed in a percent-escape such as `%20`, so cmd.exe cannot be made to expand `%PATH%` and the like.
 */
const BARE = /^(?:[\p{L}\p{M}\p{N}_./:@+=-]|%[0-9A-Fa-f]{2})+$/u;

/**
 * Inside double quotes these characters stay literal in all three shells. The set has to hold even
 * after PowerShell drops the quotes and hands the bare text to `npx.cmd`, which cmd.exe parses again,
 * so cmd.exe operators (`&`, `|`, `<`, `>`, `^`) are never allowed. `"`, `$`, `` ` ``, `\` and `!` keep
 * a meaning inside double quotes in at least one shell.
 */
const QUOTABLE = /^(?:[\p{L}\p{M}\p{N}_./:@+=,;'#?*~()[\]{} -]|%[0-9A-Fa-f]{2})+$/u;

/**
 * Writes one argument so that POSIX shells, PowerShell and cmd.exe all pass it to the CLI unchanged.
 * Returns null when no spelling works in all of them (shell operators, quotes, `$`), or when the CLI
 * would read the argument as an option. The caller must then avoid the argument altogether.
 */
export function shellArg(arg: string): string | null {
  if (arg.startsWith("-")) return null;
  // A leading `@` splats a variable in PowerShell.
  if (BARE.test(arg) && !arg.startsWith("@")) return arg;
  return QUOTABLE.test(arg) ? `"${arg}"` : null;
}

/** "report.final.pdf" -> "report.final" */
function stem(name: string): string {
  const ext = extensionOf(name);
  const base = (ext ? name.slice(0, -(ext.length + 1)) : name).replace(/[^\p{L}\p{M}\p{N}._-]+/gu, "-");
  return base.replace(/^-+|-+$/g, "") || "swarmloom";
}

/** A file name made of {@link BARE} characters, keeping the extension: "R&D notes.md" -> "R-D-notes.md". */
function safeFileName(name: string): string {
  const ext = extensionOf(name).replace(/[^\p{L}\p{M}\p{N}]+/gu, "");
  return ext ? `${stem(name)}.${ext}` : stem(name);
}

/**
 * Builds the `npx swarmloom render` command that reproduces the current preview frame by frame.
 * Only flags that differ from the CLI defaults are listed, except `--seed`, which is always
 * written so the command stays reproducible even if defaults change.
 *
 * The target comes from file names and links anyone can craft, so it is never written in a way a
 * shell could run. A target that cannot be written safely is replaced by a plain file name the user
 * saves the source as first.
 */
export function buildCliCommand(o: CliCommandOptions): CliCommand {
  const s = o.settings;
  const d = DEFAULT_SETTINGS;
  let target = shellArg(o.target);
  let saveAs = o.targetIsFile && target !== null ? o.target : undefined;
  if (target === null) {
    saveAs = safeFileName(o.targetIsFile ? o.target : o.name);
    target = saveAs;
  }
  const args: string[] = ["npx", "swarmloom", "render", target, "-o", `${stem(o.name)}.${o.format}`];
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
  return saveAs === undefined ? { text: args.join(" ") } : { text: args.join(" "), saveAs };
}
