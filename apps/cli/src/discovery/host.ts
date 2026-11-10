import { accessSync, constants, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

/** The parts of the host machine program discovery depends on; injected so tests can fake any OS. */
export interface HostEnv {
  platform: NodeJS.Platform;
  env: Readonly<Record<string, string | undefined>>;
  homedir: string;
  /** True when `file` is an existing regular file the current user may execute. */
  isExecutable(file: string): boolean;
}

/** A program found on this machine and where the path came from (for messages and `doctor`). */
export interface FoundProgram {
  path: string;
  /** Human-readable origin: "--chrome", "SWARMLOOM_CHROME", "PATH", "default location", ... */
  source: string;
}

/** HostEnv of the running process. */
export function systemHost(env: Readonly<Record<string, string | undefined>> = process.env): HostEnv {
  const platform = process.platform;
  return {
    platform,
    env,
    homedir: homedir(),
    isExecutable(file) {
      try {
        if (!statSync(file).isFile()) return false;
        if (platform !== "win32") accessSync(file, constants.X_OK);
        return true;
      } catch {
        return false;
      }
    },
  };
}

/** Path helpers matching the host platform (lets Linux tests reason about Windows paths). */
export function pathFor(host: HostEnv): path.PlatformPath {
  return host.platform === "win32" ? path.win32 : path.posix;
}

/** Reads an environment variable; case-insensitive on Windows like the real process environment. */
export function envValue(host: HostEnv, name: string): string | undefined {
  const direct = host.env[name];
  if (direct !== undefined || host.platform !== "win32") return direct || undefined;
  const upper = name.toUpperCase();
  for (const [key, value] of Object.entries(host.env)) {
    if (key.toUpperCase() === upper) return value || undefined;
  }
  return undefined;
}

/**
 * Finds the first of `names` on PATH (adding PATHEXT extensions on Windows).
 * @returns Absolute path of the executable, or undefined.
 */
export function which(host: HostEnv, names: readonly string[]): string | undefined {
  const p = pathFor(host);
  const dirs = (envValue(host, "PATH") ?? "").split(p.delimiter).filter(Boolean);
  const exts =
    host.platform === "win32"
      ? (envValue(host, "PATHEXT") ?? ".exe;.cmd;.bat;.com")
          .split(";")
          .filter(Boolean)
          .map((ext) => ext.toLowerCase())
      : [""];
  for (const name of names) {
    for (const dir of dirs) {
      for (const ext of exts) {
        const hasExt = ext !== "" && name.toLowerCase().endsWith(ext.toLowerCase());
        const candidate = p.join(dir, hasExt ? name : name + ext);
        if (host.isExecutable(candidate)) return candidate;
      }
    }
  }
  return undefined;
}
