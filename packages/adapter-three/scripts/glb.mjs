/**
 * GLB export for the sample generators, running three's GLTFExporter under Node.
 *
 * Node has Blob but no FileReader, which GLTFExporter's binary path uses; a minimal one is
 * installed only when missing.
 */

import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";

/** Minimal FileReader covering the two calls GLTFExporter makes. */
class NodeFileReader {
  result = null;
  onloadend = null;
  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then((buffer) => {
      this.result = buffer;
      this.onloadend?.();
    });
  }
  readAsDataURL(blob) {
    blob.arrayBuffer().then((buffer) => {
      this.result = `data:${blob.type || "application/octet-stream"};base64,${Buffer.from(buffer).toString("base64")}`;
      this.onloadend?.();
    });
  }
}
globalThis.FileReader ??= NodeFileReader;

/**
 * Exports an object tree as binary glTF.
 * @param {import("three").Object3D} root
 * @returns {Promise<Uint8Array>}
 */
export async function exportGlb(root) {
  const glb = await new GLTFExporter().parseAsync(root, { binary: true, onlyVisible: true });
  if (!(glb instanceof ArrayBuffer)) throw new Error("GLTFExporter did not return binary glTF");
  return new Uint8Array(glb);
}
