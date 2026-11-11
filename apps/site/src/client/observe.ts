/**
 * Visibility plumbing: starts the SVG build scenes when they scroll into view (and pauses them
 * offscreen), drives the reveal fallback where scroll-driven animations are unsupported, and
 * marks the nav once the page has scrolled.
 */

const supportsViewTimeline = typeof CSS !== "undefined" && CSS.supports("animation-timeline: view()");
const supportsScrollTimeline = typeof CSS !== "undefined" && CSS.supports("animation-timeline: scroll()");

/** Scenes play once visible and pause while offscreen so idle tabs cost nothing. */
export function observeScenes(root: ParentNode = document): void {
  const scenes = [...root.querySelectorAll<Element>("[data-scene]")].filter(
    (scene) => !scene.parentElement?.closest("[data-scene]"),
  );
  if (scenes.length === 0) return;
  if (typeof IntersectionObserver !== "function") {
    for (const scene of scenes) scene.classList.add("in-view");
    return;
  }
  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const el = entry.target;
        if (entry.isIntersecting) {
          el.classList.add("in-view");
          el.classList.remove("paused");
        } else if (el.classList.contains("in-view")) {
          el.classList.add("paused");
        }
      }
    },
    { rootMargin: "80px 0px" },
  );
  for (const scene of scenes) io.observe(scene);
}

/** Reveal on scroll for browsers without `animation-timeline: view()`. */
export function observeReveals(): void {
  if (supportsViewTimeline) return;
  const items = document.querySelectorAll<Element>("[data-reveal]");
  if (items.length === 0) return;
  if (typeof IntersectionObserver !== "function") return;
  document.documentElement.classList.add("reveal-io");
  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add("is-in");
        io.unobserve(entry.target);
      }
    },
    { rootMargin: "0px 0px -8% 0px" },
  );
  for (const item of items) io.observe(item);
}

/** Nav hairline after the first scroll, for browsers without scroll timelines. */
export function observeNav(): void {
  if (supportsScrollTimeline) return;
  const navEl = document.querySelector<HTMLElement>("[data-nav]");
  if (!navEl || typeof IntersectionObserver !== "function") return;
  const sentinel = document.createElement("div");
  sentinel.className = "nav-sentinel";
  sentinel.setAttribute("aria-hidden", "true");
  document.body.prepend(sentinel);
  new IntersectionObserver(([entry]) => {
    navEl.classList.toggle("scrolled", entry ? !entry.isIntersecting : false);
  }).observe(sentinel);
}
