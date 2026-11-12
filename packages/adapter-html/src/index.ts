/**
 * @swarmloom/adapter-html: HTML documents and fragments -> Blueprint.
 *
 * Full documents are sanitized and laid out in a hidden sandboxed frame without scripts, then
 * snapshotted; fragments are sanitized and laid out by snapshot-dom's snapshotHtml. By default
 * only https: images and fonts are fetched (no referrer). Arbitrary cross-origin URLs only work
 * where the browser lets the page read them (CORS); otherwise the error points to the browser
 * extension or the CLI.
 */

export type { HtmlAdapterOptions, HtmlLoadContext, LiveFrame, LoadedHtml } from "./adapter";
export { createHtmlAdapter, htmlAdapter } from "./adapter";
export { decodeHtml, isFullDocument, sniffMetaCharset } from "./detect";
export type { FrameDocument, FrameOptions, FrozenAnimations } from "./frame";
export { freezeAnimations, renderInFrame } from "./frame";
export type { NetworkPolicy } from "./policy";
export { allowedResource, applyNetworkPolicy, localOrigin, rewriteCssUrls } from "./policy";
export type { PreparedDocument, PrepareOptions } from "./prepare";
export { contentSecurityPolicy, prepareDocument } from "./prepare";
export { sanitizeDocument, sanitizeFragment } from "./sanitize";
export type { KeyframeTimeline, TimelineData } from "./timeline";
export { MAX_TIMELINE_MS, MAX_TIMELINES, TIMELINE_PLUGIN } from "./timeline";
