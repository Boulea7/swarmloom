import { portable, routeToUrl } from "../route";
import type { StudioTarget } from "../services";
import type { StudioSettings } from "../settings";
import { encodeShare, MAX_SHARE_LENGTH, SHARE_SETTING_KEYS, sanitizeShareName } from "../share";
import type { OpenedSource } from "../source";

/** The hosted Studio: the online gallery and the page links made in the extension's Studio open. */
export const HOSTED_STUDIO = "https://boulea7.github.io/swarmloom/studio/";

/**
 * The Studio page a link for someone else or another device opens. The extension's own pages
 * (`chrome-extension://<id>/...`) open only in the browser that installed it, so links made there
 * point at the hosted Studio; the web build links to itself.
 */
export function shareBase(target: StudioTarget, appUrl: string): string {
  return target === "extension" ? HOSTED_STUDIO : appUrl;
}

/** Why a source cannot be shared as a link. */
export type ShareRefusal = "binary" | "tooLarge" | "unsupported";

export type ShareLink = { ok: true; url: string } | { ok: false; reason: ShareRefusal };

/**
 * Settings a link carries: every one that shapes the performance, defaults included. The receiving
 * Studio puts a link's settings over its own saved ones, so a key left out would play with the
 * recipient's value, not the sender's.
 */
export function shareableSettings(s: StudioSettings): Partial<StudioSettings> {
  const out: Partial<StudioSettings> = {};
  for (const key of SHARE_SETTING_KEYS) (out as Record<string, unknown>)[key] = s[key];
  return out;
}

/**
 * Builds a link on `base` (see {@link shareBase}) that reopens `opened` elsewhere: examples and web
 * URLs by reference, small text inputs (local `file:` URLs too) compressed into the hash, anything
 * else refused with a reason the UI can explain.
 */
export async function buildShareLink(opened: OpenedSource, settings: StudioSettings, base: string): Promise<ShareLink> {
  const overrides = shareableSettings(settings);
  if (portable(opened.ref) && opened.ref.kind !== "shared") {
    return { ok: true, url: routeToUrl({ source: opened.ref, autoplay: true, overrides }, base) };
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
  return { ok: true, url: routeToUrl({ source: { kind: "shared", payload }, autoplay: true }, base) };
}
