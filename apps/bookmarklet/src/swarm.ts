/**
 * The hosted bookmarklet bundle (`swarm.js`): snapshot-dom + core, no format adapters.
 *
 * The loader injects it as a module script; module scripts run once per page, so later clicks
 * reach it through the handle it registers (see bundle/boot.ts).
 */
import { createPlayer } from "@swarmloom/core";
import { snapshot } from "@swarmloom/snapshot-dom";
import { bootBookmarklet } from "./bundle/boot";

/** Replaced at build time; while unbundled (tests, dev) the Studio is assumed next to `bm/`. */
declare const __SWARMLOOM_STUDIO_URL__: string | undefined;

const studioUrl = new URL(
  typeof __SWARMLOOM_STUDIO_URL__ === "string" ? __SWARMLOOM_STUDIO_URL__ : "../studio/?from=bookmarklet",
  import.meta.url,
);

bootBookmarklet({ win: window, doc: document, snapshot, createPlayer, studioUrl });
