/**
 * Video behaviour: format clips load lazily and loop muted while visible; the promo film loads
 * only when the visitor presses play. Missing or failing media leaves the SVG scenes in place.
 */

import { onReducedMotionChange, prefersReducedMotion, saveData } from "./env";

function markPlaying(video: HTMLVideoElement): void {
  video.addEventListener("playing", () => video.closest(".fmt-media")?.classList.add("has-clip"), { once: true });
  video.addEventListener("error", () => video.closest(".fmt-media")?.classList.remove("has-clip"), true);
}

/** Muted looping clips in the format strip. */
export function initClips(): void {
  const videos = [...document.querySelectorAll<HTMLVideoElement>("video[data-lazy-video]")];
  if (videos.length === 0 || typeof IntersectionObserver !== "function") return;
  if (saveData()) return;
  const visible = new Set<HTMLVideoElement>();
  const sync = (video: HTMLVideoElement): void => {
    if (visible.has(video) && !prefersReducedMotion() && !document.hidden) {
      if (video.preload !== "auto") video.preload = "auto";
      video.play().catch(() => {
        // Autoplay can be refused (power saving, data saver); the poster or scene stays.
      });
    } else if (!video.paused) {
      video.pause();
    }
  };
  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const video = entry.target as HTMLVideoElement;
        if (entry.isIntersecting) visible.add(video);
        else visible.delete(video);
        sync(video);
      }
    },
    { rootMargin: "0px 240px", threshold: 0.25 },
  );
  for (const video of videos) {
    video.muted = true;
    markPlaying(video);
    io.observe(video);
  }
  document.addEventListener("visibilitychange", () => videos.forEach(sync));
  onReducedMotionChange(() => videos.forEach(sync));
}

/** Promo film: click to play with sound and native controls. */
export function initFilm(): void {
  const frame = document.querySelector<HTMLElement>("[data-film]");
  const video = frame?.querySelector<HTMLVideoElement>("[data-film-video]");
  const button = frame?.querySelector<HTMLButtonElement>("[data-film-play]");
  const status = frame?.querySelector<HTMLElement>("[data-film-status]");
  if (!frame || !video || !button) return;
  const fail = (): void => {
    frame.classList.remove("is-playing");
    frame.classList.add("is-error");
    video.controls = false;
    if (status) status.hidden = false;
    button.hidden = true;
  };
  video.addEventListener("error", fail, true);
  button.addEventListener("click", () => {
    frame.classList.add("is-playing");
    video.controls = true;
    video.preload = "auto";
    button.hidden = true;
    video.play().then(
      () => video.focus({ preventScroll: true }),
      (error: unknown) => {
        // NotAllowedError means the browser wants another gesture; the native controls handle that.
        if (error instanceof DOMException && error.name === "NotAllowedError") return;
        fail();
      },
    );
  });
}
