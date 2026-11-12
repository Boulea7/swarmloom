import { extensionOf } from "../formats-meta";
import { DEFAULT_SETTINGS, OPENING_MS, type StudioSettings } from "../settings";

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
  /** Frames per second. Default 30 (the CLI default). */
  fps?: number;
  /** Longest video in seconds (`--max-duration`). Default 120 (the CLI default). */
  maxDuration?: number;
  /** Overrides `settings.sound` (the export dialog's sound switch). */
  sound?: boolean;
  /** Colour scheme in effect; with theme "auto" a dark scheme is written as `--theme dark`. */
  scheme?: "light" | "dark";
  /** Player language (role labels); written unless it is English. */
  locale?: string;
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
 * Unquoted, these characters mean the same in POSIX shells, PowerShell and cmd.exe. `%` is never
 * allowed: cmd.exe expands `%NAME%` for any variable that is set, even inside double quotes and even
 * when the text looks like percent-escapes (`%DATE%20` holds `%DATE%`), and no escape for it reads the
 * same in the other shells. A link keeps its escaped letters as letters ({@link unescapeLetters});
 * a link with other percent-escapes is replaced by a saved file.
 */
const BARE = /^[\p{L}\p{M}\p{N}_./:@+=-]+$/u;

/**
 * Inside double quotes these characters stay literal in all three shells. The set has to hold even
 * after PowerShell drops the quotes and hands the bare text to `npx.cmd`, which cmd.exe parses again,
 * so cmd.exe operators (`&`, `|`, `<`, `>`, `^`) are never allowed. `"`, `$`, `` ` ``, `\` and `!` keep
 * a meaning inside double quotes in at least one shell.
 */
const QUOTABLE = /^[\p{L}\p{M}\p{N}_./:@+=,;'#?*~()[\]{} -]+$/u;

/**
 * Writes one argument so that POSIX shells, PowerShell and cmd.exe all pass it to the CLI unchanged.
 * Returns null when no spelling works in all of them (shell operators, quotes, `$`, `%`), or when the CLI
 * would read the argument as an option. The caller must then avoid the argument altogether.
 */
export function shellArg(arg: string): string | null {
  if (arg.startsWith("-")) return null;
  // A leading `@` splats a variable in PowerShell.
  if (BARE.test(arg) && !arg.startsWith("@")) return arg;
  return QUOTABLE.test(arg) ? `"${arg}"` : null;
}

/**
 * Names Windows opens as a device even with an extension: "NUL.mp4" and "nul.final.mp4" are the null
 * device, not files. The superscript digits are reserved too.
 */
const WINDOWS_DEVICE = /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?=\.|$)/i;

/** "report.final.pdf" -> "report.final"; "NUL.md" -> "NUL_" so the output is a file on Windows too. */
export function stem(name: string): string {
  const ext = extensionOf(name);
  const base = (ext ? name.slice(0, -(ext.length + 1)) : name).replace(/[^\p{L}\p{M}\p{N}._-]+/gu, "-");
  return (base.replace(/^-+|-+$/g, "") || "swarmloom").replace(WINDOWS_DEVICE, "$&_");
}

/** A file name made of {@link BARE} characters, keeping the extension: "R&D notes.md" -> "R-D-notes.md". */
function safeFileName(name: string): string {
  const ext = extensionOf(name).replace(/[^\p{L}\p{M}\p{N}]+/gu, "");
  return ext ? `${stem(name)}.${ext}` : stem(name);
}

/**
 * One percent-escaped non-ASCII character: a UTF-8 lead byte and its continuation bytes. Upper case
 * only, as the URL parser writes them, so the parsed link is the same text.
 */
const ESCAPED_CHAR = /%[C-F][\dA-F](?:%[89AB][\dA-F])+/g;

/**
 * "https://x/%E4%B8%AD.md" -> "https://x/中.md": escaped non-ASCII letters and digits of a link are
 * written as themselves, so the link needs no `%`. The CLI's URL parser escapes them again and fetches
 * the same URL. Other escapes (`%20`, `%2F`) are kept.
 */
function unescapeLetters(url: string): string {
  return url.replace(ESCAPED_CHAR, (escaped) => {
    try {
      const char = decodeURIComponent(escaped);
      return /^[\p{L}\p{M}\p{N}]$/u.test(char) ? char : escaped;
    } catch {
      // Not UTF-8.
      return escaped;
    }
  });
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
  // A file name is literal: "%C3%A4.md" is that file, not "ä.md".
  let target = shellArg(o.targetIsFile ? o.target : unescapeLetters(o.target));
  let saveAs = o.targetIsFile && target !== null ? o.target : undefined;
  if (target === null) {
    saveAs = safeFileName(o.targetIsFile ? o.target : o.name);
    target = saveAs;
  }
  const args: string[] = ["npx", "swarmloom", "render", target, "-o", `${stem(o.name)}.${o.format}`];
  if (o.format !== "mp4") args.push("--format", o.format);
  if (o.width !== 1280) args.push("--width", String(o.width));
  if (o.height !== 720) args.push("--height", String(o.height));
  if (o.fps !== undefined && o.fps !== 30) args.push("--fps", String(o.fps));
  if (o.maxDuration !== undefined && o.maxDuration !== 120) args.push("--max-duration", String(o.maxDuration));
  args.push("--seed", String(s.seed));
  if (s.speed !== d.speed) args.push("--speed", String(s.speed));
  if (s.agents !== d.agents) args.push("--agents", String(s.agents));
  const theme = s.theme === "auto" && o.scheme === "dark" ? "dark" : s.theme;
  if (theme !== d.theme) args.push("--theme", theme);
  if (s.labels !== d.labels) args.push("--labels", s.labels);
  if (s.finale !== d.finale) args.push("--finale", s.finale);
  if (s.intro !== d.intro) args.push("--intro", s.intro);
  if (s.follow === "none") args.push("--follow", "none");
  if (s.opening) args.push("--opening", String(OPENING_MS / 1000));
  if (s.liveTop) args.push("--live-top");
  const locale = o.locale && !/^en(?:-|$)/i.test(o.locale) ? shellArg(o.locale) : null;
  if (locale) args.push("--locale", locale);
  if (!(o.sound ?? s.sound)) args.push("--no-sound");
  else if (s.beatHits) args.push("--beat-sync", "all");
  if (!s.remoteAssets) args.push("--no-remote");
  return saveAs === undefined ? { text: args.join(" ") } : { text: args.join(" "), saveAs };
}

/**
 * Where a command's target comes from: a link, a file on the user's disk (picked, dropped or
 * launched), or text that only this page holds (pasted, dropped as text or shared in a link).
 */
export type CliTargetKind = "url" | "file" | "text";

/** The step before running a command, as a Studio message key and its variables. */
export interface CliHint {
  key: "export.cli.download" | "export.cli.folder" | "export.cli.rename" | "export.cli.save";
  vars: Record<string, string>;
}

/**
 * Says what to do before running a command whose target is the file `saveAs`. The browser knows a
 * local file's name but not its folder, so the command reads the file from the working directory:
 * the user runs it beside the file itself, beside a copy under a name a shell can hold, beside the
 * saved text, or beside the downloaded link.
 */
export function cliHint(kind: CliTargetKind, target: string, saveAs: string | undefined): CliHint | null {
  if (saveAs === undefined) return null;
  if (kind === "url") return { key: "export.cli.download", vars: { name: saveAs } };
  if (kind === "text") return { key: "export.cli.save", vars: { name: saveAs } };
  return saveAs === target
    ? { key: "export.cli.folder", vars: { name: saveAs } }
    : { key: "export.cli.rename", vars: { name: saveAs, file: target } };
}
