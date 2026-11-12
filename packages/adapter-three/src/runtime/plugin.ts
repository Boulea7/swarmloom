import type { CustomLayer, LayerRenderer, Plugin, Point } from "@swarmloom/core";
import { TASK } from "../plan/layers";
import { CHANNEL, type Channel } from "../plan/state";
import type { Reprojector } from "./camera";
import type { ModelScene } from "./scene";
import { createTasks } from "./tasks";

/** Name under which blueprints reference the plugin (Blueprint.plugins). */
export const PLUGIN_NAME = "three";

function dataNumber(layer: CustomLayer, key: string): number {
  const data = layer.data as Record<string, unknown> | undefined;
  const value = data?.[key];
  return typeof value === "number" && Number.isInteger(value) ? value : -1;
}

function channelRenderer(scene: ModelScene, channel: Channel): LayerRenderer<CustomLayer> {
  return {
    mount(layer) {
      scene.state.reset(channel, dataNumber(layer, "patch"));
    },
    reveal(layer, p) {
      scene.reveal(channel, dataNumber(layer, "patch"), p);
    },
    finish(layer) {
      scene.state.finish(channel, dataNumber(layer, "patch"));
    },
  };
}

function materialRenderer(scene: ModelScene): LayerRenderer<CustomLayer> {
  return {
    mount(layer) {
      scene.state.setMaterial(dataNumber(layer, "group"), 0);
    },
    reveal(layer, p) {
      scene.state.setMaterial(dataNumber(layer, "group"), p);
    },
    finish(layer) {
      scene.state.setMaterial(dataNumber(layer, "group"), 1);
    },
  };
}

function lightRenderer(scene: ModelScene): LayerRenderer<CustomLayer> {
  return {
    mount() {
      scene.state.setLight(0);
      scene.resetFinale();
    },
    reveal(_layer, p) {
      scene.state.setLight(p);
      if (p <= 0) scene.resetFinale();
    },
    finish() {
      scene.state.setLight(1);
      scene.startFinale();
    },
  };
}

/**
 * The plugin of one loaded model: WebGL backdrop (setup), engine-timed rendering (frame),
 * build-to-live camera reprojection (project), renderers and tasks for the five layer kinds.
 * One stage at a time: a second setup replaces the first mount.
 */
export function createThreePlugin(scene: ModelScene, reproject: Reprojector, isDisposed: () => boolean): Plugin {
  const map = (p: Point): Point => scene.reprojectWith(reproject, p);
  return {
    name: PLUGIN_NAME,
    tasks: createTasks(scene, map),
    renderers: {
      [TASK.points]: channelRenderer(scene, CHANNEL.points),
      [TASK.edges]: channelRenderer(scene, CHANNEL.edges),
      [TASK.patch]: channelRenderer(scene, CHANNEL.faces),
      [TASK.material]: materialRenderer(scene),
      [TASK.light]: lightRenderer(scene),
    },
    setup(stage, host) {
      if (isDisposed()) throw new Error("This 3D model was disposed; load it again to play it.");
      return scene.mount(host, stage.reducedMotion === true);
    },
    frame(now) {
      scene.frame(now);
    },
    project: map,
  };
}
