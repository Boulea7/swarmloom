import { type CustomLayer, definePlugin, type LayerRenderer, type Plugin, type TaskFn } from "@swarmloom/core";
import { sanitizeSvgTree } from "./sanitize";
import { createSmilPlayback, SMIL_TASK, type SmilPlaybackOptions } from "./smil";
import { SVG_NS } from "./units";

/** Plugin name listed in `Blueprint.plugins`. */
export const SVG_PLUGIN = "svg";
/** Custom layer task that carries the stage-space paint servers, clips, masks, filters and markers. */
export const DEFS_TASK = "svg:defs";

/** `CustomLayer.data` of the `svg:defs` layer. */
export interface SvgDefsData {
  /** Serialised children of a `<defs>` element (SVG namespace). */
  markup: string;
}

/** Upper bound on the markup accepted by the renderer (characters). */
const MAX_MARKUP = 8 * 1024 * 1024;

function markupOf(layer: CustomLayer): string {
  const data = layer.data as Partial<SvgDefsData> | undefined;
  return typeof data?.markup === "string" && data.markup.length <= MAX_MARKUP ? data.markup : "";
}

/**
 * Builds the hidden `<svg><defs>` for a layer. The markup is parsed and sanitised again because a
 * blueprint may come from storage or another origin; only the sanitised SVG subtree is imported.
 */
function buildDefs(layer: CustomLayer, doc: Document): SVGSVGElement {
  const svg = doc.createElementNS(SVG_NS, "svg") as SVGSVGElement;
  svg.setAttribute("width", "0");
  svg.setAttribute("height", "0");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  // Not display:none: some engines stop resolving paint servers inside undisplayed subtrees.
  svg.style.cssText = "position:absolute;left:0;top:0;width:0;height:0;overflow:hidden;pointer-events:none";
  const markup = markupOf(layer);
  if (!markup) return svg;
  const parsed = new DOMParser().parseFromString(
    `<svg xmlns="${SVG_NS}" xmlns:xlink="http://www.w3.org/1999/xlink"><defs>${markup}</defs></svg>`,
    "image/svg+xml",
  );
  const root = parsed.documentElement;
  if (root.localName !== "svg" || root.namespaceURI !== SVG_NS || parsed.getElementsByTagName("parsererror").length) {
    return svg;
  }
  sanitizeSvgTree(root);
  const defs = root.firstElementChild;
  if (defs?.localName === "defs") svg.appendChild(doc.importNode(defs, true));
  return svg;
}

/**
 * Renderer of the `svg:defs` layer: an invisible definitions container inside the stage. One per
 * plugin instance (player), so a second player of the same blueprint never removes the first one's.
 */
function createDefsRenderer(): LayerRenderer<CustomLayer> {
  const mounted = new WeakMap<CustomLayer, SVGSVGElement>();
  return {
    mount(layer, container) {
      mounted.get(layer)?.remove();
      const svg = buildDefs(layer, container.ownerDocument);
      mounted.set(layer, svg);
      container.appendChild(svg);
      return svg;
    },
    reveal() {
      // Definitions are never visible themselves.
    },
    unmount(layer) {
      mounted.get(layer)?.remove();
      mounted.delete(layer);
    },
  };
}

/** The defs layer needs no cursor work; it completes as soon as the engine runs it. */
// biome-ignore lint/correctness/useYield: a task with no steps; a generator keeps finish() lazy until the engine runs it.
const defsTask: TaskFn<CustomLayer> = function* (_agent, layer, stage) {
  stage.finish(layer.id);
};

/**
 * Creates an `svg` plugin instance: the `svg:defs` renderer, so `url(#...)` references of path
 * layers resolve inside the stage's shadow root, and the `svg:smil` replay of the drawing's own
 * animation after the weave (decision C04). State is per instance and every player gets its own
 * (`perPlayer`), so players of one loaded drawing never share definitions or replay state.
 */
export function createSvgPlugin(options: SmilPlaybackOptions = {}): Plugin {
  const smil = createSmilPlayback(options);
  return definePlugin({
    name: SVG_PLUGIN,
    tasks: { [DEFS_TASK]: defsTask, [SMIL_TASK]: smil.task },
    renderers: { [DEFS_TASK]: createDefsRenderer(), [SMIL_TASK]: smil.renderer },
    frame: (now) => smil.frame(now),
    perPlayer: () => createSvgPlugin(options),
  });
}

/** Shared plugin instance returned for drawings without animation. */
export const svgPlugin: Plugin = createSvgPlugin();
