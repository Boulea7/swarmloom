import type { AdapterContext, LoadedSource, Player, PlayerOptions, SourceInput } from "@swarmloom/core";
import type { Recording, RecordOptions } from "@swarmloom/export";
import type { ExampleManifest } from "./examples/manifest";
import type { HandoffPage } from "./handoff";
import type { CoreI18n } from "./i18n";

/** Build target: the hosted PWA or the page bundled inside the browser extension. */
export type StudioTarget = "web" | "extension";

/**
 * Input the extension hands over through `chrome.storage.session` (or local) under `?key=<key>`.
 * Exactly one of `url`, `text` or `base64` carries the content.
 */
export interface StoredInput {
  name: string;
  type?: string;
  url?: string;
  text?: string;
  /** Standard base64 of the file bytes. */
  base64?: string;
}

/** One item received through the PWA share target and parked by the service worker. */
export type InboxItem =
  | { kind: "file"; file: File }
  | { kind: "text"; text: string; title?: string }
  | { kind: "url"; url: string; title?: string };

/** What document adapters may fetch while laying out (decisions-v1 C03). */
export type NetworkPolicy = "https" | "none";

/**
 * Adapter context plus Studio's network policy. Core's `AdapterContext` does not carry `network`
 * (cross-zone seam): adapters that understand the member (html, markdown) read it, the rest
 * ignore it. "https" allows https images and fonts without a referrer; "none" loads nothing remote.
 */
export interface StudioLoadContext extends AdapterContext {
  network: NetworkPolicy;
}

/**
 * Player methods newer engines may offer beyond the contract. Studio feature-detects them:
 * `seek` drives the scrubber (decisions-v1 S05).
 */
export interface PlayerExtras {
  /** Jump to engine time `t` (ms from the start of the build). */
  seek?(t: number): void;
}

/**
 * Everything Studio needs from the outside world. `main.ts` wires the real packages; tests pass
 * fakes, so the UI can be exercised while core, formats or export are still stubs.
 */
export interface StudioServices {
  target: StudioTarget;
  manifest: ExampleManifest;
  /** Absolute URL prefix of the copied example files, ending in "/". */
  examplesBase: string;
  /** Hosted gallery to link to when the build carries no examples (extension). */
  onlineGallery?: string;
  /**
   * `formats.load`: detects the format and runs the adapter. Studio always sets `ctx.network`
   * (decisions-v1 C03) so document adapters know whether https images and fonts may load.
   */
  load(input: SourceInput, ctx: StudioLoadContext): Promise<LoadedSource>;
  /**
   * Adapter ids of the `@swarmloom/formats` registry. Optional formats (`FormatMeta.optional`, such
   * as Lottie) are offered only when listed here.
   */
  formats?: readonly string[];
  createPlayer(options: PlayerOptions): Player & PlayerExtras;
  /** `@swarmloom/export` recordElement; absent hides in-browser recording. */
  recordElement?: (target: Element, opts?: RecordOptions) => Promise<Recording>;
  /** True when {@link recordElement} can work in this browser. */
  canRecord?: () => boolean;
  /** Core toolbar and format strings for a locale, when core provides them. */
  coreI18n?: (locale: string) => CoreI18n | null;
  fetch: typeof fetch;
  storage?: Storage;
  /** Extension handoff (`?key=`); resolves null when nothing is stored under the key. */
  readStored?: (key: string) => Promise<StoredInput | null>;
  /** Share-target handoff (`?inbox=`), served from the service worker cache. */
  readInbox?: (id: string) => Promise<InboxItem[]>;
  /** Registers a consumer for files opened through the OS (`file_handlers`). */
  onLaunch?: (consumer: (files: File[]) => void) => void;
  /** Bookmarklet handoff (`?from=bookmarklet`): the page copy posted by `window.opener`. */
  receiveHandoff?: (signal?: AbortSignal) => Promise<HandoffPage>;
}
