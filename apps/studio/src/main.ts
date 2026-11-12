import "./styles/studio.css";
import rawManifest from "virtual:studio-examples";
import * as core from "@swarmloom/core";
import { isExportFrame } from "@swarmloom/export";
import { formats, load } from "@swarmloom/formats";
import { mountStudio } from "./app";
import { blockRemoteAssets } from "./csp";
import { MAX_INPUT_BYTES } from "./errors";
import { sanitizeManifest } from "./examples/manifest";
import { receiveHandoff } from "./handoff";
import type { CoreI18n } from "./i18n";
import { launchHandler, readInbox, registerServiceWorker } from "./pwa";
import type { StudioServices } from "./services";
import { readStored } from "./stored";

/** Hosted Studio, linked from builds without examples (the extension). */
const HOSTED_STUDIO = "https://boulea7.github.io/swarmloom/studio/";

/**
 * Core's translator, when the core package exports it (`createI18n`, core-ui seam). Read through
 * the namespace so Studio keeps working, with its own English format names, until it does.
 */
function coreI18n(locale: string): CoreI18n | null {
  // Reflect keeps the bundler from flagging the (not yet exported) binding at build time.
  const create: unknown = Reflect.get(core, "createI18n");
  return typeof create === "function" ? (create as (locale?: string) => CoreI18n)(locale) : null;
}

function localStore(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

/** Builds the services and mounts Studio into #app. */
function boot(): void {
  const target = __STUDIO_TARGET__;

  const services: StudioServices = {
    target,
    manifest: sanitizeManifest(rawManifest),
    examplesBase: new URL(`${import.meta.env.BASE_URL}examples/`, window.location.href).href,
    onlineGallery: target === "extension" ? HOSTED_STUDIO : undefined,
    load: (input, ctx) => load(input, ctx, { maxBytes: MAX_INPUT_BYTES }),
    formats: formats.map((entry) => entry.id),
    createPlayer: (options) => core.createPlayer(options),
    loadExporter: () => import("@swarmloom/export/browser"),
    coreI18n,
    fetch: window.fetch.bind(window),
    storage: localStore(),
    readStored: target === "extension" ? (key) => readStored(key) : undefined,
    readInbox: (id) => readInbox(id, new URL(import.meta.env.BASE_URL, window.location.href).href),
    onLaunch: launchHandler(window),
    receiveHandoff: (signal) => receiveHandoff(window, signal),
    blockRemoteAssets: () => blockRemoteAssets(document),
  };

  const root = document.getElementById("app");
  if (!root) throw new Error("#app element is missing from index.html");

  mountStudio(root, services).then(
    (app) => {
      if (target === "web" && import.meta.env.PROD) registerServiceWorker(window, app.toast, () => app.context.i18n);
    },
    (error: unknown) => {
      console.error("[studio] failed to start", error);
      const message = document.createElement("p");
      message.className = "boot-error";
      message.textContent = "SwarmLoom Studio could not start. Reload the page to try again.";
      root.replaceChildren(message);
    },
  );
}

// The hidden export frame loads the render page module, which shares this entry's chunk in a
// production build: there the entry must only provide modules, never start Studio.
if (!isExportFrame()) boot();
