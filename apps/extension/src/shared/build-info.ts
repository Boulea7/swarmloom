/**
 * Facts fixed at build time. `scripts/build.mjs` replaces the `__SWARMLOOM_*__` identifiers through
 * esbuild `define`; the `typeof` guards keep the module usable in tests, where nothing is defined.
 */

declare const __SWARMLOOM_TARGET__: string | undefined;
declare const __SWARMLOOM_STUDIO__: string | undefined;

export type TargetId = "chrome" | "edge" | "firefox" | "safari";
export type Engine = "chromium" | "gecko" | "webkit";

const TARGETS: readonly TargetId[] = ["chrome", "edge", "firefox", "safari"];

function isTargetId(value: unknown): value is TargetId {
  return typeof value === "string" && (TARGETS as readonly string[]).includes(value);
}

/** Package this code was built for. Defaults to "chrome" in tests. */
export const BUILD_TARGET: TargetId =
  typeof __SWARMLOOM_TARGET__ === "string" && isTargetId(__SWARMLOOM_TARGET__) ? __SWARMLOOM_TARGET__ : "chrome";

/**
 * Extension-relative path of the bundled Studio entry (for example "studio/index.html"), or "" when
 * the build did not find a Studio extension build; callers then fall back to the hosted Studio.
 */
export const BUNDLED_STUDIO: string = typeof __SWARMLOOM_STUDIO__ === "string" ? __SWARMLOOM_STUDIO__ : "";

/** Rendering engine family of a target (restricted-page rules differ per engine). */
export function engineOf(target: TargetId): Engine {
  if (target === "firefox") return "gecko";
  if (target === "safari") return "webkit";
  return "chromium";
}
