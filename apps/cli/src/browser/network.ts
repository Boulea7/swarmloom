import type { BrowserContext, Route } from "playwright-core";

/**
 * Network rules of the render page (decision C03): everything on the CLI's own loopback server, plus
 * https: images and fonts fetched without a Referer. Nothing else leaves the machine: no scripts,
 * style sheets, XHR/fetch or plain-http assets from elsewhere.
 */
export interface NetworkPolicy {
  /** Origin of the loopback server that serves the render page and the input, e.g. "http://127.0.0.1:41234". */
  localOrigin: string;
  /** Allow https: images and fonts. False with --offline. */
  remoteAssets: boolean;
}

/** What happens to one request: pass through, pass through without a Referer, or abort. */
export type NetworkVerdict = "allow" | "anonymous" | "block";

/** Playwright resource types an https: URL may load. */
const REMOTE_TYPES: ReadonlySet<string> = new Set(["image", "font"]);

/** Decides one request under `policy`. Unparsable URLs are blocked. */
export function networkVerdict(url: string, resourceType: string, policy: NetworkPolicy): NetworkVerdict {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "block";
  }
  if (parsed.protocol === "data:" || parsed.protocol === "blob:") return "allow";
  if (parsed.origin === policy.localOrigin) return "allow";
  if (policy.remoteAssets && parsed.protocol === "https:" && REMOTE_TYPES.has(resourceType)) return "anonymous";
  return "block";
}

/**
 * Enforces `policy` on every request of `context`.
 * @param onBlocked Called for each aborted request (for warnings and --verbose logging).
 */
export async function applyNetworkPolicy(
  context: BrowserContext,
  policy: NetworkPolicy,
  onBlocked?: (url: string, resourceType: string) => void,
): Promise<void> {
  await context.route("**/*", (route: Route) => {
    const request = route.request();
    const verdict = networkVerdict(request.url(), request.resourceType(), policy);
    // A request can outlive its page (closed while the route is pending); that is not an error here.
    const ignore = () => {};
    if (verdict === "allow") return route.continue().catch(ignore);
    if (verdict === "anonymous") {
      const { referer: _referer, ...headers } = request.headers();
      return route.continue({ headers }).catch(ignore);
    }
    onBlocked?.(request.url(), request.resourceType());
    return route.abort("blockedbyclient").catch(ignore);
  });
}
