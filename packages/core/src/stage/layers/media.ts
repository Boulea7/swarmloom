import type { MediaLayer } from "../../types";
import { applyLayerStyle, isSafeUrl } from "../sanitize";
import { contentDiv, type LayerView, type MountEnv, Shell, Transient } from "./common";

/**
 * Video, iframe, canvas or embed that cannot be rebuilt: a snapshot image when provided, else a
 * neutral placeholder with a play glyph and the label. Reveal is a fade.
 */
export function mountMedia(env: MountEnv, layer: MediaLayer, z: number): LayerView {
  const doc = env.doc;
  const shell = new Shell(env, layer, z);
  const content = contentDiv(doc);
  content.style.overflow = "hidden";
  applyLayerStyle(content, layer.style);
  const label = typeof layer.label === "string" ? layer.label.slice(0, 200) : "";
  let img: HTMLImageElement | null = null;
  if (typeof layer.src === "string" && layer.src && isSafeUrl(layer.src)) {
    img = doc.createElement("img");
    img.decoding = "async";
    img.draggable = false;
    img.alt = label;
    const s = img.style;
    s.display = "block";
    s.width = "100%";
    s.height = "100%";
    s.maxWidth = "none";
    s.objectFit = "cover";
    img.src = layer.src;
    content.append(img);
  } else {
    const ph = doc.createElement("div");
    ph.className = "sl-m";
    const s = ph.style;
    s.position = "absolute";
    s.inset = "0";
    s.background = env.tokens.ghost;
    s.color = env.tokens.ghostInk;
    s.border = `1px solid ${env.tokens.ghostLine}`;
    s.borderRadius = "inherit";
    ph.setAttribute("role", "img");
    ph.setAttribute("aria-label", label || "media");
    ph.append(doc.createElement("i"));
    if (label && layer.box.w >= 72 && layer.box.h >= 28) {
      const span = doc.createElement("span");
      span.textContent = label;
      ph.append(span);
    }
    content.append(ph);
  }
  shell.shell.append(content);
  const transient = new Transient();

  return {
    outer: shell.outer,
    el: content,
    reveal(p) {
      if (!(p > 0)) {
        shell.setVisible(false);
        return;
      }
      shell.setVisible(true);
      shell.alpha(p);
    },
    finish() {
      transient.clear(content);
      this.reveal(1);
    },
    transient(css) {
      transient.apply(content, css);
    },
    decode() {
      return img
        ? img.decode().then(
            () => undefined,
            () => undefined,
          )
        : Promise.resolve();
    },
    destroy() {
      img = null;
    },
  };
}
