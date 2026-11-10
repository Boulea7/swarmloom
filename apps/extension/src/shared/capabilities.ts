/**
 * Feature capabilities of the running extension.
 *
 * Two layers decide every capability:
 *  1. Build time: what the target package declares and ships (BUILD_CAPABILITIES, mirrored by
 *     scripts/targets.mjs and the generated manifest).
 *  2. Run time: whether the API actually exists in this browser. The Safari package (macOS and
 *     iOS) and the Firefox package (desktop and Android) declare menus and commands, but iOS and
 *     Android do not expose them, so they are probed, never assumed.
 * Never sniff the user agent; only probe the objects we are about to call.
 */

import { type ExtensionApi, menusApi } from "./api";
import { BUILD_TARGET, type TargetId } from "./build-info";

export type CapabilityName =
  | "scripting"
  | "capturePoster"
  | "audio"
  | "contextMenus"
  | "sidePanel"
  | "fileAccess"
  | "viewportSegments";

export type CapabilitySet = Readonly<Record<CapabilityName, boolean>>;

const ALL_ON: CapabilitySet = {
  scripting: true,
  capturePoster: true,
  audio: true,
  contextMenus: true,
  // The side panel is not part of the product; kept as an explicit "off" so no target ships it by accident.
  sidePanel: false,
  fileAccess: true,
  viewportSegments: true,
};

/** What each package is built to use. Runtime detection can only turn a capability off. */
export const BUILD_CAPABILITIES: Readonly<Record<TargetId, CapabilitySet>> = {
  chrome: ALL_ON,
  edge: ALL_ON,
  firefox: ALL_ON,
  // Safari ignores file:// permissions on every platform.
  safari: { ...ALL_ON, fileAccess: false },
};

/** Capabilities observable from the background context (extension APIs). */
export type BackgroundCapabilities = Pick<
  CapabilitySet,
  "scripting" | "capturePoster" | "contextMenus" | "sidePanel" | "fileAccess"
>;

/** Capabilities observable from a page (the content script overlay or an extension page). */
export type PageCapabilities = Pick<CapabilitySet, "audio" | "viewportSegments">;

/** Detects extension API capabilities, intersected with the build-time set of `target`. */
export function detectBackgroundCapabilities(
  api: ExtensionApi | null,
  target: TargetId = BUILD_TARGET,
): BackgroundCapabilities {
  const built = BUILD_CAPABILITIES[target];
  const menus = api ? menusApi(api) : undefined;
  return {
    scripting: built.scripting && typeof api?.scripting?.executeScript === "function",
    capturePoster: built.capturePoster && typeof api?.tabs.captureVisibleTab === "function",
    contextMenus: built.contextMenus && typeof menus?.create === "function",
    sidePanel: built.sidePanel && typeof api?.sidePanel?.open === "function",
    fileAccess: built.fileAccess && api !== null,
  };
}

interface PageScope {
  AudioContext?: unknown;
  webkitAudioContext?: unknown;
  matchMedia?: (query: string) => { matches: boolean };
  viewport?: { segments?: unknown };
}

/** Detects page-level capabilities: WebAudio for the overlay sound, viewport segments for foldables. */
export function detectPageCapabilities(
  scope: PageScope = globalThis as unknown as PageScope,
  target: TargetId = BUILD_TARGET,
): PageCapabilities {
  const built = BUILD_CAPABILITIES[target];
  const audio = typeof scope.AudioContext === "function" || typeof scope.webkitAudioContext === "function";
  let segments = Array.isArray(scope.viewport?.segments);
  if (!segments && typeof scope.matchMedia === "function") {
    // Boolean form matches whenever the feature is known (one segment or more).
    segments = scope.matchMedia("(horizontal-viewport-segments)").matches;
  }
  return { audio: built.audio && audio, viewportSegments: built.viewportSegments && segments };
}

export type FileAccessState = "granted" | "denied" | "unknown" | "unsupported";

/**
 * Whether the user allowed `file://` access. Chromium answers through
 * `extension.isAllowedFileSchemeAccess`; elsewhere the answer is "unknown" and the caller tries
 * the injection and reports a failure.
 */
export async function fileAccessState(api: ExtensionApi, target: TargetId = BUILD_TARGET): Promise<FileAccessState> {
  if (!BUILD_CAPABILITIES[target].fileAccess) return "unsupported";
  const check = api.extension?.isAllowedFileSchemeAccess;
  // Firefox has no such switch: file:// injection either works or fails, and the failure is reported.
  if (typeof check !== "function" || target === "firefox") return "unknown";
  try {
    return (await check.call(api.extension)) ? "granted" : "denied";
  } catch {
    return "unknown";
  }
}
