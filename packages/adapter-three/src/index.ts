import type { Adapter, AdapterContext, LoadedSource, SourceInput } from "@swarmloom/core";

/**
 * glTF/GLB/OBJ/STL/PLY -> vertices, edges, patches and materials on the plugin's own WebGL stage.
 *
 * Stub: `load()` rejects until the implementation lands.
 */
export const threeAdapter: Adapter = {
  id: "three",
  label: "3D model",
  extensions: ["glb", "gltf", "obj", "stl", "ply"],
  mime: ["model/gltf-binary", "model/gltf+json", "model/obj", "model/stl", "model/x-ply"],
  async load(input: SourceInput, ctx: AdapterContext): Promise<LoadedSource> {
    void input;
    void ctx;
    throw new Error("not implemented yet");
  },
};

export default threeAdapter;
