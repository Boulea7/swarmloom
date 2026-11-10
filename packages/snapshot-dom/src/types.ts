import type { BlueprintSource } from "@swarmloom/core";

/** Options of {@link snapshot}. */
export interface SnapshotOptions {
  /**
   * "document": stage origin = document origin (live pages). "element": the root's border-box
   * top-left = (0,0). Default: "document" for Document/body/html, "element" otherwise.
   */
  origin?: "document" | "element";
  /** Copied into `Blueprint.source`. Default `{ type: "dom" }` plus the document title and http(s) URL. */
  source?: BlueprintSource;
  /** Default 6000. When exceeded, the snapshot keeps reading order and sets `Blueprint.truncated`. */
  maxLayers?: number;
  /** Default 60000 px of world height. Content below is dropped and reported in `Blueprint.truncated`. */
  maxHeight?: number;
  /** Repeated siblings -> master + duplicates. Default true. */
  detectDuplicates?: boolean;
  /** Shared left edges / baselines -> guide layers. Default true. */
  detectGuides?: boolean;
  /**
   * Screenshot of the visible viewport (data URL) used to crop WebGL canvases, playing videos and
   * cross-origin iframes. `scrollX/scrollY` are the window scroll offsets at capture time and `dpr`
   * the ratio of screenshot pixels to CSS px.
   */
  screenshot?: { src: string; scrollX: number; scrollY: number; dpr: number };
  /**
   * Quick scroll pass before capture to trigger lazy images and reveal-on-scroll content (live pages).
   * The scroll position is restored afterwards; callers should cover the page meanwhile. Default false.
   */
  prescroll?: boolean;
  /** Convert same-origin images to data URLs (needed when the blueprint is played in another document). Default false. */
  inlineImages?: boolean;
  /**
   * Show the values of text fields and text areas. Default false: every visible character is
   * masked (spaces and line breaks are kept so the text keeps its shape). Passwords, card numbers
   * and one-time codes are masked regardless. Placeholders, button labels and selected options
   * are page content and always shown.
   */
  showFormValues?: boolean;
  signal?: AbortSignal;
}

/** Options of {@link snapshotHtml}. */
export interface SnapshotHtmlOptions extends SnapshotOptions {
  /** Layout width in CSS px (the content is laid out in a hidden sandbox of this width). */
  width: number;
  /** Style sheet applied inside the sandbox (theme for markdown/docx etc.). Copied into `Blueprint.css` too. */
  css?: string;
  /** Document to create the sandbox in. Default `globalThis.document`. */
  document?: Document;
  /** Base URL for resolving relative links/images. */
  baseUrl?: string;
  /** Page background colour/gradient of the content. Default: computed from the sandbox root. */
  background?: string;
  scheme?: "light" | "dark";
  icon?: string;
}
