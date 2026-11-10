import type { DeviceId, FormatId } from "./types";

/** Display order of the format strip. */
export const FORMAT_IDS: readonly FormatId[] = [
  "web",
  "html",
  "svg",
  "markdown",
  "word",
  "pdf",
  "slides",
  "sheets",
  "code",
  "image",
  "model",
];

/**
 * Studio example id opened by each format card (`studio/?example=<id>`).
 * Studio maps these ids to the samples in `examples/`.
 */
export const STUDIO_EXAMPLE: Record<FormatId, string> = {
  web: "web",
  html: "html",
  svg: "svg",
  markdown: "markdown",
  word: "docx",
  pdf: "pdf",
  slides: "pptx",
  sheets: "xlsx",
  code: "code",
  image: "image",
  model: "glb",
};

/** Device line-up order, left to right. */
/** Lineup order: the laptop sits in the middle, the smallest devices at the ends. */
export const DEVICE_IDS: readonly DeviceId[] = ["phone", "tablet", "laptop", "foldable", "watch"];
