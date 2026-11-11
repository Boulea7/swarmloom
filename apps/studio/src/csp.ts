/**
 * Policy added while "web images and fonts" is off (decisions-v1 C03): images and fonts may only
 * come from Studio itself or from the opened file (blob:, data:). It narrows the page policy in
 * index.html; every other directive stays as that one sets it.
 */
export const OFFLINE_ASSETS_CSP = "img-src 'self' blob: data:; font-src 'self' blob: data:";

const MARK = "data-swarmloom-offline";

/**
 * Adds {@link OFFLINE_ASSETS_CSP} to the page, once. Browsers enforce a CSP meta from the moment it
 * is inserted and never lift it again, so turning remote assets back on takes a page reload.
 */
export function blockRemoteAssets(doc: Document): void {
  if (doc.head.querySelector(`meta[${MARK}]`)) return;
  const meta = doc.createElement("meta");
  meta.httpEquiv = "Content-Security-Policy";
  meta.content = OFFLINE_ASSETS_CSP;
  meta.setAttribute(MARK, "");
  doc.head.append(meta);
}
