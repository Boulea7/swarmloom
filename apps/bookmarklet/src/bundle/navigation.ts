/**
 * Calls `onLeave` when the user leaves the page or a single-page app swaps it for another route,
 * so a rebuild made from the old DOM never outlives it:
 *
 *  - `pagehide`: the document unloads or enters the back/forward cache. Tearing down here also
 *    means a page restored from that cache shows the real page, not a stale overlay.
 *  - Navigation API `navigate`, where supported: link clicks, history traversal,
 *    `pushState`/`replaceState` and form submissions;
 *  - otherwise `popstate`, i.e. history traversal only.
 *
 * A route change means another origin or path. Fragment and query-only changes keep the rebuild:
 * scroll-spy pages rewrite the hash and many pages mirror UI state into the query while the
 * content stays. Downloads are ignored too.
 *
 * @param win Window of the page.
 * @param onLeave Called for every such event; must be idempotent.
 * @returns A function that removes the listeners.
 */
export function watchNavigation(win: Window, onLeave: () => void): () => void {
  const { location } = win;
  // `navigation` is typed as always present, but older Safari and Firefox releases lack it.
  const navigation: Navigation | undefined = "navigation" in win ? win.navigation : undefined;
  let path = location.pathname;

  const onNavigate = (event: NavigateEvent) => {
    if (event.downloadRequest !== null) return;
    const to = new URL(event.destination.url);
    if (to.origin !== location.origin || to.pathname !== location.pathname) onLeave();
  };
  // popstate fires after the URL changed; pushState calls in between are invisible here.
  const onPopState = () => {
    if (location.pathname !== path) onLeave();
    path = location.pathname;
  };

  win.addEventListener("pagehide", onLeave);
  if (navigation) navigation.addEventListener("navigate", onNavigate);
  else win.addEventListener("popstate", onPopState);
  return () => {
    win.removeEventListener("pagehide", onLeave);
    navigation?.removeEventListener("navigate", onNavigate);
    win.removeEventListener("popstate", onPopState);
  };
}
