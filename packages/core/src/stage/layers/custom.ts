import type { CustomLayer, LayerRenderer } from "../../types";
import { clamp01, contentDiv, type LayerView, type MountEnv, Shell, Transient } from "./common";

/** Renderer failures are reported once per layer id per stage, then the layer degrades to a fade. */
function report(layer: CustomLayer, phase: string, error: unknown): void {
  console.warn(`SwarmLoom stage: renderer "${layer.task}" failed in ${phase} for layer "${layer.id}"`, error);
}

/**
 * Custom layer drawn by a plugin renderer (keyed by CustomLayer.task). The renderer receives a
 * container that fills the layer box; it may return its own element (exposed through el()) or
 * nothing when it draws elsewhere (a WebGL backdrop). Without a renderer, or after it throws,
 * the layer is an empty box that fades.
 */
export function mountCustom(env: MountEnv, layer: CustomLayer, z: number): LayerView {
  const shell = new Shell(env, layer, z);
  const container = contentDiv(env.doc);
  shell.shell.append(container);
  const transient = new Transient();
  let renderer: LayerRenderer | undefined = typeof layer.task === "string" ? env.renderer(layer.task) : undefined;
  let el: HTMLElement | SVGElement | null = null;
  let failed = false;

  const fail = (phase: string, error: unknown): void => {
    if (!failed) report(layer, phase, error);
    failed = true;
    renderer = undefined;
  };

  if (renderer) {
    try {
      const out = renderer.mount(layer, container, env.api);
      if (out && out !== container && !container.contains(out)) container.append(out);
      el = out ?? null;
    } catch (error) {
      fail("mount", error);
    }
  }

  // DOM-less renderers (WebGL scenes) are cheap to keep and may reset plugin state when re-mounted.
  const pinned = !!renderer && !el && container.childNodes.length === 0;

  return {
    outer: shell.outer,
    el: el ?? container,
    pinned,
    reveal(p) {
      const v = clamp01(p);
      if (renderer) {
        shell.setVisible(v > 0);
        shell.alpha(1);
        try {
          renderer.reveal(layer, v);
          return;
        } catch (error) {
          fail("reveal", error);
        }
      }
      shell.setVisible(v > 0);
      shell.alpha(v);
    },
    finish() {
      transient.clear(el ?? container);
      if (renderer?.finish) {
        shell.setVisible(true);
        shell.alpha(1);
        try {
          renderer.finish(layer);
          return;
        } catch (error) {
          fail("finish", error);
        }
      }
      this.reveal(1);
    },
    transient(css) {
      transient.apply(el ?? container, css);
    },
    destroy() {
      if (!renderer?.unmount) return;
      try {
        renderer.unmount(layer);
      } catch (error) {
        fail("unmount", error);
      }
    },
  };
}
