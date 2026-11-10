import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { MissingDependencyError } from "../errors";
import { envValue, type FoundProgram, type HostEnv, which } from "./host";

/** Oldest ffmpeg major version the encoder arguments are written for. */
export const MIN_FFMPEG_MAJOR = 4;

export interface FfmpegVersion {
  /** Version token as printed, e.g. "6.1.1-static" or "N-112345-gabcdef". */
  raw: string;
  /** Release major/minor; null for git or dated snapshot builds, which are assumed recent. */
  major: number | null;
  minor: number | null;
}

export interface FoundFfmpeg extends FoundProgram {
  version: FfmpegVersion;
}

/**
 * Parses the first line of `ffmpeg -version`.
 * Handles release builds ("4.4.2-0ubuntu0.22.04.1", "n8.1.3-34-g..."), git builds ("N-112345-g...")
 * and dated snapshots ("2024-03-04-git-...").
 *
 * @returns null when the text is not ffmpeg version output.
 */
export function parseFfmpegVersion(output: string): FfmpegVersion | null {
  const raw = /ffmpeg version (\S+)/.exec(output)?.[1];
  if (!raw) return null;
  if (/^N-|^\d{4}-\d{2}-\d{2}|^git-/i.test(raw)) return { raw, major: null, minor: null };
  const release = /^n?(\d+)\.(\d+)/.exec(raw);
  if (!release) return { raw, major: null, minor: null };
  return { raw, major: Number(release[1]), minor: Number(release[2]) };
}

/** True when the version is new enough for the arguments SwarmLoom passes. */
export function isSupportedFfmpeg(version: FfmpegVersion): boolean {
  return version.major === null || version.major >= MIN_FFMPEG_MAJOR;
}

/** Short display form, e.g. "6.1" or "N-112345-gabc (snapshot)". */
export function formatFfmpegVersion(version: FfmpegVersion): string {
  return version.major === null ? `${version.raw} (snapshot)` : `${version.major}.${version.minor}`;
}

export interface FfmpegDiscoveryDeps {
  host: HostEnv;
  /** Runs `<path> -version`; resolves with its stdout, or null when the program cannot run. */
  readVersion(path: string): Promise<string | null>;
  /** Path exported by an `ffmpeg-static` package the user installed themselves (never a dependency). */
  ffmpegStatic(): string | undefined;
}

/**
 * Finds an ffmpeg >= 4.
 *
 * Order: --ffmpeg, SWARMLOOM_FFMPEG, `ffmpeg` on PATH, then an `ffmpeg-static` package if the user
 * installed one next to swarmloom. SwarmLoom neither bundles nor recommends ffmpeg binaries (the
 * static builds are GPL); it uses whatever the machine has.
 * Explicit paths must work; a too-old ffmpeg on PATH is skipped and mentioned in the error.
 *
 * @throws MissingDependencyError with install hints.
 */
export async function findFfmpeg(deps: FfmpegDiscoveryDeps, opts: { flag?: string } = {}): Promise<FoundFfmpeg> {
  const { host } = deps;
  const explicit: Array<[string | undefined, string]> = [
    [opts.flag, "--ffmpeg"],
    [envValue(host, "SWARMLOOM_FFMPEG"), "SWARMLOOM_FFMPEG"],
  ];
  for (const [value, source] of explicit) {
    if (!value) continue;
    if (!host.isExecutable(value)) {
      throw new MissingDependencyError(`ffmpeg not found at ${value} (from ${source})`, ffmpegInstallHint(host));
    }
    const found = await check(deps, value, source);
    if ("version" in found) return found;
    throw new MissingDependencyError(`${found.problem} (from ${source})`, ffmpegInstallHint(host));
  }

  const problems: string[] = [];
  const candidates: Array<[string | undefined, string]> = [
    [which(host, ["ffmpeg"]), "PATH"],
    [safeStaticPath(deps), "ffmpeg-static"],
  ];
  for (const [file, source] of candidates) {
    if (!file || !host.isExecutable(file)) continue;
    const found = await check(deps, file, source);
    if ("version" in found) return found;
    problems.push(`${found.problem} (from ${source})`);
  }
  const reason = problems.length ? `: ${problems.join("; ")}` : "";
  throw new MissingDependencyError(`No usable ffmpeg ${MIN_FFMPEG_MAJOR}+ found${reason}`, ffmpegInstallHint(host));
}

async function check(
  deps: FfmpegDiscoveryDeps,
  file: string,
  source: string,
): Promise<FoundFfmpeg | { problem: string }> {
  const output = await deps.readVersion(file);
  const version = output ? parseFfmpegVersion(output) : null;
  if (!version) return { problem: `${file} did not run as ffmpeg` };
  if (!isSupportedFfmpeg(version)) {
    return { problem: `ffmpeg ${version.raw} at ${file} is too old (need ${MIN_FFMPEG_MAJOR}.0 or newer)` };
  }
  return { path: file, source, version };
}

function safeStaticPath(deps: FfmpegDiscoveryDeps): string | undefined {
  try {
    return deps.ffmpegStatic();
  } catch {
    return undefined;
  }
}

/** Platform-specific instructions for installing ffmpeg. */
export function ffmpegInstallHint(host: HostEnv): string {
  const install =
    host.platform === "darwin"
      ? "brew install ffmpeg"
      : host.platform === "win32"
        ? "winget install Gyan.FFmpeg"
        : "sudo apt install ffmpeg (or your distribution's package)";
  return [
    `Install ffmpeg ${MIN_FFMPEG_MAJOR} or newer: ${install}`,
    "or set SWARMLOOM_FFMPEG (or pass --ffmpeg) to an ffmpeg executable.",
  ].join("\n");
}

/** Production implementation of {@link FfmpegDiscoveryDeps}. */
export function systemFfmpegDeps(host: HostEnv): FfmpegDiscoveryDeps {
  return {
    host,
    readVersion: (file) => runCapture(file, ["-version"]).catch(() => null),
    ffmpegStatic() {
      // Never a dependency: only found when the user installed it where swarmloom resolves modules.
      const value: unknown = createRequire(import.meta.url)("ffmpeg-static");
      return typeof value === "string" ? value : undefined;
    },
  };
}

/* ------------------------------------------------------------------ */
/* Capabilities                                                        */
/* ------------------------------------------------------------------ */

/** Encoders and filters compiled into an ffmpeg build. */
export interface FfmpegCaps {
  encoders: ReadonlySet<string>;
  filters: ReadonlySet<string>;
}

/** Parses `ffmpeg -encoders` output into encoder names. */
export function parseEncoders(output: string): Set<string> {
  const names = new Set<string>();
  const start = output.indexOf("------");
  for (const line of output.slice(start < 0 ? 0 : start + 6).split(/\r?\n/)) {
    const [flags, name] = line.trim().split(/\s+/);
    if (flags && name && /^[VAS][A-Z.]{5}$/.test(flags)) names.add(name);
  }
  return names;
}

/** Parses `ffmpeg -filters` output into filter names. */
export function parseFilters(output: string): Set<string> {
  const names = new Set<string>();
  for (const line of output.split(/\r?\n/)) {
    const [, name, io] = line.trim().split(/\s+/);
    if (name && io?.includes("->")) names.add(name);
  }
  return names;
}

/**
 * Lists the encoders and filters of an ffmpeg binary.
 * @throws MissingDependencyError when ffmpeg cannot be run.
 */
export async function probeFfmpeg(file: string): Promise<FfmpegCaps> {
  try {
    const [encoders, filters] = await Promise.all([
      runCapture(file, ["-hide_banner", "-encoders"]),
      runCapture(file, ["-hide_banner", "-filters"]),
    ]);
    return { encoders: parseEncoders(encoders), filters: parseFilters(filters) };
  } catch (error) {
    throw new MissingDependencyError(`Could not run ffmpeg at ${file}`, undefined, { cause: error });
  }
}

function runCapture(file: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout: 15_000, windowsHide: true, maxBuffer: 8 << 20 }, (error, stdout) => {
      if (error) reject(error);
      else resolve(stdout);
    });
  });
}
