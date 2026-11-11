import type { AdapterContext, Blueprint, SourceInput } from "@swarmloom/core";
import { AssetStore } from "./shared/assets";
import { luminance } from "./shared/color";
import { OfficeFormatError } from "./shared/errors";
import { FontLog } from "./shared/fonts";
import { SLIDES_ICON } from "./shared/icons";
import { displayName, isCfb, readBytes } from "./shared/input";
import type { OfficeAdapter, OfficeLoadedSource } from "./shared/loaded";
import { isOpenDocument, isZip, ZipArchive } from "./shared/zip";
import { emitSlides, slideLayout } from "./slides/emit";
import type { Presentation } from "./slides/model";
import { slideNotes } from "./slides/notes";
import { readPresentation } from "./slides/reader";

export { OfficeFormatError } from "./shared/errors";
export type { OfficeAdapter, OfficeLoadedSource } from "./shared/loaded";

/** Options of {@link createSlidesAdapter}. */
export interface SlidesAdapterOptions {
  /** Slides read from the start of the deck; the rest is reported in `Blueprint.truncated`. Default 40. */
  maxSlides?: number;
}

const DEFAULT_MAX_LAYERS = 6000;

/** "dark" when most slides have a dark background (light text), else "light". */
function deckScheme(pres: Presentation): "light" | "dark" {
  let dark = 0;
  for (const slide of pres.slides) {
    const bg = slide.background;
    const color = bg.kind === "solid" ? bg.color : bg.kind === "gradient" ? bg.first : undefined;
    if (color && luminance(color) < 0.25) dark++;
  }
  return dark * 2 > pres.slides.length ? "dark" : "light";
}

function checkContainer(bytes: Uint8Array): ZipArchive {
  if (isCfb(bytes)) {
    throw new OfficeFormatError(
      "PowerPoint 97-2003 (.ppt) files are not supported yet. Save the deck as .pptx or PDF and open it again.",
    );
  }
  if (!isZip(bytes)) throw new OfficeFormatError("This file is not a PowerPoint (.pptx) presentation");
  const zip = ZipArchive.open(bytes);
  if (isOpenDocument(zip, "presentation")) {
    throw new OfficeFormatError("OpenDocument presentations (.odp) are not supported yet. Export as .pptx or PDF.");
  }
  return zip;
}

/**
 * Creates the presentation adapter (id `slides`).
 *
 * Each slide becomes a page box (role "slide") with its background, master/layout decorations,
 * shapes (preset and custom geometry, solid/gradient fills, outlines, shadows), text (runs,
 * bullets, alignment, theme fonts and colours, placeholder inheritance), pictures (blob URLs,
 * cropping), tables and labelled placeholders for charts, SmartArt and media. Slides are
 * stacked vertically at the context width. Nothing in the file is executed or fetched.
 * Placeholders, unreadable slides and font substitutions are listed in
 * {@link OfficeLoadedSource.notes}.
 */
export function createSlidesAdapter(options: SlidesAdapterOptions = {}): OfficeAdapter {
  const maxSlides = Math.max(1, Math.floor(options.maxSlides ?? 40));
  return {
    id: "slides",
    label: "Presentation",
    // OpenDocument presentations belong to @swarmloom/adapter-odf.
    extensions: ["pptx", "ppt"],
    mime: [
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "application/vnd.ms-powerpoint",
    ],
    async load(input: SourceInput, ctx: AdapterContext): Promise<OfficeLoadedSource> {
      const bytes = await readBytes(input, ctx.signal);
      const zip = checkContainer(bytes);
      const assets = new AssetStore();
      const fonts = new FontLog();
      try {
        const pres = await readPresentation(zip, assets, { maxSlides, signal: ctx.signal, fonts });
        const layout = slideLayout(pres, ctx.width);
        const emitted = emitSlides(pres, layout, Math.max(1, ctx.maxLayers ?? DEFAULT_MAX_LAYERS));
        const name = displayName(input, "presentation.pptx");
        const total = pres.slides.length + pres.droppedSlides;
        const shown = pres.slides.length - emitted.droppedSlides;
        const blueprint: Blueprint = {
          version: 1,
          source: { type: "slides", name, title: pres.title ?? name, url: input.url },
          size: { w: layout.width, h: emitted.height },
          background: ctx.theme === "dark" ? "#16171d" : "#eceef3",
          scheme: deckScheme(pres),
          icon: SLIDES_ICON,
          layers: emitted.layers,
        };
        if (shown < total) {
          blueprint.truncated = { reason: `Showing the first ${shown} of ${total} slides`, dropped: total - shown };
        } else if (emitted.droppedLayers > 0) {
          blueprint.truncated = {
            reason: "The slide has more elements than the layer limit",
            dropped: emitted.droppedLayers,
          };
        }
        const notes = slideNotes(pres, fonts);
        return { blueprint, ...(notes.length > 0 ? { notes } : {}), dispose: () => assets.dispose() };
      } catch (error) {
        assets.dispose();
        throw error;
      }
    },
  };
}

/** Presentation adapter with default options. */
export const slidesAdapter: OfficeAdapter = createSlidesAdapter();
