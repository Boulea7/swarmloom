/**
 * Constants shared by the service worker and the page: cache names and the share-target inbox.
 * Pure data, no DOM or worker globals, so both bundles (and tests) can import it.
 */

/** Cache holding share-target items until the page picks them up. */
export const INBOX_CACHE = "swarmloom-inbox-v1";
/** Path (relative to the scope) the manifest's `share_target.action` posts to. */
export const SHARE_TARGET_PATH = "share-target";
/** Key prefix of inbox entries, relative to the scope. */
export const INBOX_PREFIX = "__inbox/";
/** Unclaimed inbox items are dropped after a day. */
export const INBOX_MAX_AGE_MS = 24 * 60 * 60 * 1000;
/** Largest shared file the worker keeps (matches Studio's input limit). */
export const INBOX_MAX_BYTES = 50 * 1024 * 1024;

/** Response headers carrying an inbox item's metadata. */
export const INBOX_HEADER = {
  kind: "x-swarmloom-kind",
  name: "x-swarmloom-name",
  title: "x-swarmloom-title",
  time: "x-swarmloom-time",
} as const;

/** Message a page posts to a waiting worker to activate it (the user accepted the update). */
export const MSG_SKIP_WAITING = "swarmloom:skip-waiting";

/** Absolute cache key of the `index`-th item of inbox `id`. */
export function inboxKey(scope: string, id: string, index: number): string {
  return new URL(`${INBOX_PREFIX}${encodeURIComponent(id)}/${index}`, scope).href;
}
