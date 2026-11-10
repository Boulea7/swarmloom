import type { Color, DataTexture, Material, Vector2 } from "three";

/** Uniforms shared by every build material (one object, so updates reach all programs). */
export interface SharedUniforms {
  uSlState: { value: DataTexture };
  /** Engine time in ms. */
  uSlTime: { value: number };
  uSlClay: { value: Color };
  uSlInk: { value: Color };
  /** 1 while the build wireframe shows, fading to 0 as materials arrive. */
  uSlWire: { value: number };
  /** Drawing-buffer size in device px (edge width maths). */
  uSlResolution: { value: Vector2 };
  uSlPixelRatio: { value: number };
}

/** Pop-in durations per channel, engine ms. Zero under reduced motion. */
export interface PopUniforms {
  points: { value: number };
  edges: { value: number };
  faces: { value: number };
}

/**
 * GLSL shared by all reveal shaders. `slReveal` returns (shown, age): shown is 1 once the
 * patch progress reached the element's order; age runs 0..1 over the pop-in after its birth,
 * which is extrapolated from the time and rate of the latest reveal step (see RevealState).
 */
const REVEAL_GLSL = /* glsl */ `
uniform highp sampler2D uSlState;
uniform float uSlTime;
float slGet(int patchId, int row, vec4 m) {
  return dot(texelFetch(uSlState, ivec2(patchId, row), 0), m);
}
vec2 slReveal(int patchId, vec4 m, float order, float popMs) {
  float p = slGet(patchId, 0, m);
  if (order > p + 1e-6) return vec2(0.0);
  float rate = slGet(patchId, 2, m);
  if (rate <= 0.0 || popMs <= 0.0 || order <= slGet(patchId, 3, m)) return vec2(1.0);
  float birth = slGet(patchId, 1, m) - (p - order) / rate;
  return vec2(1.0, clamp((uSlTime - birth) / popMs, 0.0, 1.0));
}
vec3 slTint(int patchId, vec4 m) {
  return vec3(slGet(patchId, 4, m), slGet(patchId, 5, m), slGet(patchId, 6, m));
}
float slEaseOut(float t) {
  float u = 1.0 - t;
  return 1.0 - u * u * u;
}
`;

const FACE_ATTRIBUTES = /* glsl */ `
attribute float aSlPatch;
attribute float aSlOrder;
attribute vec3 aSlCentroid;
uniform float uSlPop;
`;

/** Collapses unrevealed triangles to their centroid and grows new ones out of it. */
const FACE_GROW = /* glsl */ `
  int slPatch = int(aSlPatch + 0.5);
  vec2 slR = slReveal(slPatch, vec4(0.0, 0.0, 1.0, 0.0), aSlOrder, uSlPop);
  float slE = slEaseOut(slR.y);
  transformed = mix(aSlCentroid, transformed, slR.x * mix(0.55, 1.0, slE));
`;

function insertAfter(source: string, chunk: string, code: string): string {
  const marker = `#include <${chunk}>`;
  return source.includes(marker) ? source.replace(marker, `${marker}\n${code}`) : source;
}

/**
 * Patches a built-in material so its triangles reveal per patch, start as neutral clay and
 * blend to the real material with `mix`. Works for the Standard/Physical/Basic/Lambert/Phong
 * family: optional chunks (emissive, roughness) are only touched when present.
 */
export function injectFaceReveal(
  material: Material,
  shared: SharedUniforms,
  pop: PopUniforms,
  mix: { value: number },
): void {
  const previous = material.onBeforeCompile.bind(material);
  material.onBeforeCompile = (shader, renderer) => {
    previous(shader, renderer);
    Object.assign(shader.uniforms, shared, { uSlPop: pop.faces, uSlMix: mix });
    let vertex = insertAfter(
      shader.vertexShader,
      "common",
      `${FACE_ATTRIBUTES}${REVEAL_GLSL}varying float vSlFlash;\nvarying vec3 vSlTint;`,
    );
    vertex = insertAfter(
      vertex,
      "begin_vertex",
      `${FACE_GROW}  vSlFlash = slR.x * (1.0 - slE);\n  vSlTint = slTint(slPatch, vec4(0.0, 0.0, 1.0, 0.0));`,
    );
    let fragment = insertAfter(
      shader.fragmentShader,
      "common",
      "uniform float uSlMix;\nuniform vec3 uSlClay;\nvarying float vSlFlash;\nvarying vec3 vSlTint;",
    );
    fragment = insertAfter(
      fragment,
      "color_fragment",
      "diffuseColor.rgb = mix(uSlClay, diffuseColor.rgb, uSlMix);\ndiffuseColor.rgb = mix(diffuseColor.rgb, vSlTint, vSlFlash * 0.6);",
    );
    fragment = insertAfter(
      fragment,
      "emissivemap_fragment",
      "totalEmissiveRadiance = totalEmissiveRadiance * uSlMix + vSlTint * vSlFlash * 0.35;",
    );
    fragment = insertAfter(
      fragment,
      "metalnessmap_fragment",
      "metalnessFactor *= uSlMix;\nroughnessFactor = mix(0.8, roughnessFactor, uSlMix);",
    );
    shader.vertexShader = vertex;
    shader.fragmentShader = fragment;
  };
  material.customProgramCacheKey = () => "swarmloom-face-reveal-1";
  material.needsUpdate = true;
}

/** Patches a depth material so shadows only come from revealed triangles. */
export function injectDepthReveal(material: Material, shared: SharedUniforms, pop: PopUniforms): void {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, shared, { uSlPop: pop.faces });
    shader.vertexShader = insertAfter(
      insertAfter(shader.vertexShader, "common", `${FACE_ATTRIBUTES}${REVEAL_GLSL}`),
      "begin_vertex",
      FACE_GROW,
    );
  };
  material.customProgramCacheKey = () => "swarmloom-depth-reveal-1";
}

/** Vertex points that drop in with a pop, flash in the builder's colour and fade with the wireframe. */
export const POINTS_VERTEX = /* glsl */ `
${REVEAL_GLSL}
attribute float aSlPatch;
attribute float aSlOrder;
attribute vec3 aSlColor;
uniform float uSlPop;
uniform float uSlSize;
uniform float uSlDrop;
uniform float uSlWire;
uniform float uSlMix;
uniform float uSlCloud;
uniform float uSlPixelRatio;
uniform vec3 uSlInk;
varying vec3 vSlColor;
varying float vSlAlpha;
void main() {
  int p = int(aSlPatch + 0.5);
  vec2 r = slReveal(p, vec4(1.0, 0.0, 0.0, 0.0), aSlOrder, uSlPop);
  if (r.x < 0.5) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    vSlColor = vec3(0.0);
    vSlAlpha = 0.0;
    return;
  }
  float e = slEaseOut(r.y);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  mv.y += (1.0 - e) * uSlDrop;
  gl_Position = projectionMatrix * mv;
  gl_PointSize = uSlSize * uSlPixelRatio * mix(2.4, 1.0, e);
  vec3 base = mix(uSlInk, aSlColor, uSlCloud * uSlMix);
  vSlColor = mix(slTint(p, vec4(1.0, 0.0, 0.0, 0.0)), base, e);
  float faces = slGet(p, 0, vec4(0.0, 0.0, 1.0, 0.0));
  vSlAlpha = uSlCloud > 0.5 ? 1.0 : uSlWire * mix(0.95, 0.3, faces);
}
`;

export const POINTS_FRAGMENT = /* glsl */ `
varying vec3 vSlColor;
varying float vSlAlpha;
void main() {
  float d = length(gl_PointCoord - vec2(0.5));
  if (d > 0.5 || vSlAlpha <= 0.0) discard;
  gl_FragColor = vec4(vSlColor, vSlAlpha * smoothstep(0.5, 0.34, d));
  #include <colorspace_fragment>
}
`;

/**
 * Edges as screen-space quads (WebGL line width is fixed at 1px on most platforms): each
 * instance grows from its start to its end point while it pops in.
 */
export const EDGES_VERTEX = /* glsl */ `
${REVEAL_GLSL}
attribute vec3 iSlStart;
attribute vec3 iSlEnd;
attribute float aSlPatch;
attribute float aSlOrder;
uniform float uSlPop;
uniform float uSlWidth;
uniform float uSlWire;
uniform vec2 uSlResolution;
uniform float uSlPixelRatio;
uniform vec3 uSlInk;
varying vec3 vSlColor;
varying float vSlAlpha;
varying float vSlSide;
void main() {
  int p = int(aSlPatch + 0.5);
  vec2 r = slReveal(p, vec4(0.0, 1.0, 0.0, 0.0), aSlOrder, uSlPop);
  vSlSide = position.y;
  if (r.x < 0.5 || uSlWire <= 0.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    vSlColor = vec3(0.0);
    vSlAlpha = 0.0;
    return;
  }
  float g = slEaseOut(r.y);
  vec3 tip = mix(iSlStart, iSlEnd, g);
  vec4 c0 = projectionMatrix * modelViewMatrix * vec4(iSlStart, 1.0);
  vec4 c1 = projectionMatrix * modelViewMatrix * vec4(tip, 1.0);
  vec2 half_ = uSlResolution * 0.5;
  vec2 d = (c1.xy / c1.w - c0.xy / c0.w) * half_;
  float len = length(d);
  vec2 n = len > 1e-3 ? vec2(-d.y, d.x) / len : vec2(0.0, 1.0);
  vec4 c = position.x < 0.5 ? c0 : c1;
  c.xy += n * position.y * (uSlWidth * uSlPixelRatio * 0.5) / half_ * c.w;
  c.z -= 0.0015 * c.w;
  gl_Position = c;
  vSlColor = mix(slTint(p, vec4(0.0, 1.0, 0.0, 0.0)), uSlInk, g);
  float faces = slGet(p, 0, vec4(0.0, 0.0, 1.0, 0.0));
  vSlAlpha = uSlWire * mix(0.85, 0.28, faces);
}
`;

export const EDGES_FRAGMENT = /* glsl */ `
varying vec3 vSlColor;
varying float vSlAlpha;
varying float vSlSide;
void main() {
  float a = vSlAlpha * (1.0 - smoothstep(0.55, 1.0, abs(vSlSide)));
  if (a <= 0.0) discard;
  gl_FragColor = vec4(vSlColor, a);
  #include <colorspace_fragment>
}
`;
