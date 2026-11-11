import { restorable, routeToUrl } from "../route";
import { DEFAULT_SETTINGS, type StudioSettings } from "../settings";
import { encodeShare, MAX_SHARE_LENGTH, SHARE_SETTING_KEYS, sanitizeShareName } from "../share";
import type { OpenedSource } from "../source";

/** Why a source cannot be shared as a link. */
export type ShareRefusal = "binary" | "tooLarge" | "unsupported";

export type ShareLink = { ok: true; url: string } | { ok: false; reason: ShareRefusal };

/** Settings worth carrying in a link: the ones that change the performance, when not default. */
export function shareableSettings(s: StudioSettings): Partial<StudioSettings> {
  const out: Partial<StudioSettings> = {};
  for (const key of SHARE_SETTING_KEYS) {
    if (s[key] !== DEFAULT_SETTINGS[key]) (out as Record<string, unknown>)[key] = s[key];
  }
  return out;
}

/**
 * Builds a link that reopens `opened` elsewhere: examples and remote URLs by reference, small text
 * inputs compressed into the hash, anything else refused with a reason the UI can explain.
 */
export async function buildShareLink(
  opened: OpenedSource,
  settings: StudioSettings,
  appUrl: string,
): Promise<ShareLink> {
  const overrides = shareableSettings(settings);
  if (restorable(opened.ref) && opened.ref.kind !== "shared") {
    return { ok: true, url: routeToUrl({ source: opened.ref, autoplay: true, overrides }, appUrl) };
  }
  const name = sanitizeShareName(opened.name);
  if (opened.text === undefined || !name) return { ok: false, reason: "binary" };
  let payload: string;
  try {
    payload = await encodeShare({ name, text: opened.text, settings: overrides });
  } catch {
    return { ok: false, reason: "unsupported" };
  }
  if (payload.length > MAX_SHARE_LENGTH) return { ok: false, reason: "tooLarge" };
  return { ok: true, url: routeToUrl({ source: { kind: "shared", payload }, autoplay: true }, appUrl) };
}
