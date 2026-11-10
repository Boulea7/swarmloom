import type { BoxLayer, CustomLayer, ImageLayer, MediaLayer, PathLayer, TextLayer } from "../../types";
import type { Slot } from "../registry";
import { mountBox } from "./box";
import type { LayerView, MountEnv } from "./common";
import { mountCustom } from "./custom";
import { mountImage } from "./image";
import { mountMedia } from "./media";
import { mountPath } from "./path";
import { mountText } from "./text";

export type { GraphemeSegmenter, LayerView, MountEnv } from "./common";
export { countTypingUnits } from "./typing";

/** Creates the view of a DOM-rendered layer (not yet attached), or null for kinds without DOM. */
export function createView(env: MountEnv, slot: Slot): LayerView | null {
  const layer = slot.layer;
  switch (layer.kind) {
    case "box":
      return mountBox(env, layer as BoxLayer, slot.z);
    case "text":
      return mountText(env, layer as TextLayer, slot.z);
    case "path":
      return mountPath(env, layer as PathLayer, slot.z);
    case "image":
      return mountImage(env, layer as ImageLayer, slot.z);
    case "media":
      return mountMedia(env, layer as MediaLayer, slot.z);
    case "custom":
      return mountCustom(env, layer as CustomLayer, slot.z);
    default:
      return null;
  }
}
