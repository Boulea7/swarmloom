/**
 * @swarmloom/adapter-three: 3D models (GLB, glTF, OBJ, STL, PLY) rebuilt vertex by vertex,
 * edge by edge and patch by patch on the plugin's own WebGL stage.
 *
 * Load it through `@swarmloom/formats` so three.js is only fetched when a model is opened.
 */

export { createThreeAdapter, threeAdapter } from "./adapter";
export { detectFormat, sniffFormat } from "./detect";
export { ThreeAdapterError, type ThreeErrorCode } from "./errors";
export type { ThreeAdapterOptions, ThreeFormat, UpAxis } from "./options";
export { TASK as THREE_TASKS } from "./plan/layers";
export { PLUGIN_NAME as THREE_PLUGIN_NAME } from "./runtime/plugin";

import { threeAdapter } from "./adapter";

export default threeAdapter;
