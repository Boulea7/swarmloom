import type { BoxLayer, CSSMap } from "../../types";
import { applyLayerStyle } from "../sanitize";
import { contentDiv, type LayerView, type MountEnv, Shell, smooth, Transient } from "./common";
import { holdCssImages } from "./still-css";

/** Reveal progress where the ghost placeholder starts turning into the real fill. */
const FILL_FROM = 0.35;

function radiusOf(style: CSSMap | undefined): string {
  const r = style?.["border-radius"];
  return typeof r === "string" && r.length < 128 ? r : "";
}

/**
 * Styled rectangle. Reveal: hidden at 0, a dashed "ghost" placeholder early on, cross-fading into
 * the real fill until it is fully styled at 1. The fade runs on a wrapper so transient styles a
 * choreography puts on the content element (opacity, radius, shadow) never fight the reveal. An
 * animated background or mask image shows a still copy (see still-css.ts).
 */
export function mountBox(env: MountEnv, layer: BoxLayer, z: number): LayerView {
  const shell = new Shell(env, layer, z);
  const fill = contentDiv(env.doc);
  const content = contentDiv(env.doc);
  applyLayerStyle(content, layer.style);
  const held = holdCssImages(content, env.doc);
  fill.append(content);
  shell.shell.append(fill);
  const transient = new Transient();
  let ghost: HTMLElement | null = null;
  let lastFill = -1;

  const ensureGhost = (): HTMLElement => {
    if (ghost) return ghost;
    const g = env.doc.createElement("div");
    g.className = "sl-g";
    const s = g.style;
    s.background = env.tokens.ghost;
    s.border = `1px dashed ${env.tokens.ghostLine}`;
    const r = radiusOf(layer.style);
    if (r) s.setProperty("border-radius", r);
    shell.shell.prepend(g);
    ghost = g;
    return g;
  };

  const dropGhost = (): void => {
    ghost?.remove();
    ghost = null;
  };

  const setFill = (t: number): void => {
    const q = Math.round(t * 1000) / 1000;
    if (q === lastFill) return;
    lastFill = q;
    fill.style.opacity = q >= 1 ? "" : String(q);
  };

  const view: LayerView = {
    outer: shell.outer,
    el: content,
    reveal(p) {
      if (!(p > 0)) {
        shell.setVisible(false);
        return;
      }
      shell.setVisible(true);
      shell.alpha(1);
      if (p >= 1) {
        dropGhost();
        setFill(1);
        return;
      }
      const t = smooth(FILL_FROM, 1, p);
      ensureGhost().style.opacity = String(Math.round((1 - t) * 1000) / 1000);
      setFill(t);
    },
    finish() {
      transient.clear(content);
      this.reveal(1);
    },
    transient(css) {
      transient.apply(content, css);
    },
    destroy() {
      ghost = null;
    },
  };
  if (held) view.decode = () => held;
  return view;
}
