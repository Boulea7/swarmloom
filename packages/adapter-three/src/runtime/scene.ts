import type { Point, Size } from "@swarmloom/core";
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DataTexture,
  DirectionalLight,
  DoubleSide,
  FloatType,
  HemisphereLight,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  type Material,
  Mesh,
  MeshDepthMaterial,
  NearestFilter,
  NeutralToneMapping,
  PCFShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  PMREMGenerator,
  Points,
  RGBAFormat,
  Scene,
  ShaderMaterial,
  ShadowMaterial,
  type Texture,
  Vector2,
  Vector3,
  WebGLRenderer,
} from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { CHANNEL, type Channel, type RevealHint, RevealState, STATE_ROWS } from "../plan/state";
import type { BuildPlan } from "../plan/types";
import type { StageTheme } from "../theme";
import { type CameraPose, orbitPosition } from "./camera";
import {
  EDGES_FRAGMENT,
  EDGES_VERTEX,
  injectDepthReveal,
  injectFaceReveal,
  POINTS_FRAGMENT,
  POINTS_VERTEX,
  type PopUniforms,
  type SharedUniforms,
} from "./shaders";

/** Element pop-in durations, engine ms. */
const POP_MS = { points: 220, edges: 320, faces: 420 } as const;
/** Duration of the finale orbit, engine ms. */
const ORBIT_MS = 7000;
/** Device pixel ratio cap for the WebGL canvas. */
const MAX_DPR = 2;

const GRID_VERTEX = /* glsl */ `
varying vec2 vSlXZ;
void main() {
  vSlXZ = position.xy;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const GRID_FRAGMENT = /* glsl */ `
uniform vec3 uSlColor;
uniform float uSlOpacity;
uniform float uSlCell;
uniform float uSlRadius;
varying vec2 vSlXZ;
void main() {
  vec2 g = abs(fract(vSlXZ / uSlCell - 0.5) - 0.5) / fwidth(vSlXZ / uSlCell);
  float line = 1.0 - min(min(g.x, g.y), 1.0);
  float fade = 1.0 - smoothstep(uSlRadius * 0.45, uSlRadius, length(vSlXZ));
  float a = line * fade * uSlOpacity;
  if (a <= 0.003) discard;
  gl_FragColor = vec4(uSlColor, a);
  #include <colorspace_fragment>
}
`;

/** Model data a {@link ModelScene} renders; owned by the loaded source, never mutated. */
export interface SceneModel {
  plan: BuildPlan;
  /** Material per soup material index. */
  materials: readonly Material[];
  /** Material group per material index. */
  groupOf: readonly number[];
  /** Lowest normalized Y (floor height). */
  floor: number;
  /** Accessible label of the model. */
  label: string;
}

export interface SceneConfig {
  size: Size;
  pose: CameraPose;
  theme: StageTheme;
  orbitDegrees: number;
}

/** GPU objects of one mount; everything here is disposed on unmount. */
interface Mounted {
  renderer: WebGLRenderer;
  scene: Scene;
  camera: PerspectiveCamera;
  controls: OrbitControls;
  stateTexture: DataTexture;
  shared: SharedUniforms;
  pop: PopUniforms;
  faceMixes: Array<{ value: number }>;
  sweepLight: DirectionalLight;
  gridOpacity: { value: number };
  pointsMix: { value: number };
  disposables: Array<{ dispose(): void }>;
  cleanupDom: () => void;
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

function easeInOut(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

/**
 * The WebGL backdrop of a 3D build: owns the reveal state (always) and the GPU scene (while
 * mounted). Rendering happens only in {@link frame} (engine time) and, after the build, on
 * user orbit input; nothing is drawn when nothing changed.
 */
export class ModelScene {
  readonly state: RevealState;
  readonly #model: SceneModel;
  readonly #config: SceneConfig;
  readonly #hints = new Map<number, RevealHint>();
  readonly #started: Uint8Array;
  #mounted: Mounted | null = null;
  #reducedMotion = false;
  #redraw = true;
  #finaleAt: number | null = null;
  #userOrbit = false;
  #cameraMoved = false;
  #interactiveFrame = 0;
  #failure: string | null = null;

  constructor(model: SceneModel, config: SceneConfig) {
    this.#model = model;
    this.#config = config;
    this.state = new RevealState(model.plan.patches.length, model.plan.materials.length);
    this.#started = new Uint8Array(Math.max(1, model.plan.patches.length));
  }

  /** Why the scene cannot render (e.g. WebGL unavailable), or null. */
  get failure(): string | null {
    return this.#failure;
  }

  get mounted(): boolean {
    return this.#mounted !== null;
  }

  /** True once the live camera left the build pose (finale orbit or user orbit). */
  get cameraMoved(): boolean {
    return this.#cameraMoved;
  }

  /** The live camera, while mounted. */
  get camera(): PerspectiveCamera | null {
    return this.#mounted?.camera ?? null;
  }

  get reducedMotion(): boolean {
    return this.#reducedMotion;
  }

  /* ---------------------------------------------------------------- */
  /* Build state API used by tasks and renderers                       */
  /* ---------------------------------------------------------------- */

  /** Hint for the next reveal of a channel of a patch (consumed by that reveal). */
  hint(channel: Channel, patch: number, hint: RevealHint): void {
    this.#hints.set(patch * 3 + channel, hint);
  }

  reveal(channel: Channel, patch: number, p: number): void {
    const key = patch * 3 + channel;
    const hint = this.#hints.get(key);
    this.#hints.delete(key);
    const pop = this.#reducedMotion
      ? 0
      : POP_MS[channel === CHANNEL.points ? "points" : channel === CHANNEL.edges ? "edges" : "faces"];
    this.state.reveal(channel, patch, p, hint, pop);
  }

  markStarted(patch: number): void {
    if (patch >= 0 && patch < this.#started.length) this.#started[patch] = 1;
  }

  /** Builder colour newly revealed elements flash in (any CSS colour). */
  tint(channel: Channel, patch: number, css: string): void {
    const c = new Color();
    c.setStyle(css);
    this.state.tint(channel, patch, c.r, c.g, c.b);
  }

  /** Last build channel of a patch (faces for meshes, points for clouds). */
  #lastChannel(patch: number): Channel {
    const plan = this.#model.plan.patches[patch];
    if (!plan || plan.triangles > 0) return CHANNEL.faces;
    return plan.edges > 0 && plan.strokes.length > 0 ? CHANNEL.edges : CHANNEL.points;
  }

  /** True while any of `patches` was started but its last phase is not complete. */
  pending(patches: readonly number[]): boolean {
    for (const patch of patches) {
      if (this.#started[patch] === 1 && this.state.progress(this.#lastChannel(patch), patch) < 1) return true;
    }
    return false;
  }

  /** True while any material group is part-way through its fade. */
  materialsPending(): boolean {
    for (const m of this.state.materials) if (m > 0 && m < 1) return true;
    return false;
  }

  /** The light sweep finished: start the finale orbit and enable orbit controls. */
  startFinale(): void {
    if (this.#finaleAt !== null) return;
    this.#finaleAt = this.#config.orbitDegrees > 0 && !this.#reducedMotion ? this.state.now : -1;
    this.#enableControls();
  }

  /** Back to the build pose and a blank model (replay). */
  resetFinale(): void {
    this.#finaleAt = null;
    this.#userOrbit = false;
    const m = this.#mounted;
    if (!m) return;
    m.controls.enabled = false;
    m.renderer.domElement.style.pointerEvents = "none";
    m.renderer.domElement.tabIndex = -1;
    this.#applyPose(m.camera, this.#config.pose.azimuth);
    this.#cameraMoved = false;
    this.#redraw = true;
  }

  /* ---------------------------------------------------------------- */
  /* Mounting                                                          */
  /* ---------------------------------------------------------------- */

  /**
   * Creates the WebGL canvas inside `host` and all GPU resources. Returns the cleanup.
   * When WebGL is unavailable an accessible notice is shown instead and the build still runs.
   *
   * @param reducedMotion The player's resolved reduced-motion setting (`StageApi.reducedMotion`):
   *   no pop-in and no finale orbit. Taken from the player, not from `prefers-reduced-motion`, so an
   *   explicit setting and exports (which never inherit the host preference) decide.
   */
  mount(host: HTMLElement, reducedMotion = false): () => void {
    this.unmount();
    const doc = host.ownerDocument;
    this.#reducedMotion = reducedMotion;
    const { size } = this.#config;
    let renderer: WebGLRenderer;
    try {
      renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
    } catch (error) {
      this.#failure = error instanceof Error ? error.message : String(error);
      return this.#mountNotice(host);
    }
    this.#failure = null;
    renderer.setPixelRatio(Math.min(doc.defaultView?.devicePixelRatio ?? 1, MAX_DPR));
    renderer.setSize(size.w, size.h, true);
    renderer.setClearColor(0x000000, 0);
    renderer.toneMapping = NeutralToneMapping;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = PCFShadowMap;
    // The key light and model are static: the shadow only changes while faces reveal.
    renderer.shadowMap.autoUpdate = false;
    renderer.shadowMap.needsUpdate = true;

    const canvas = renderer.domElement;
    canvas.setAttribute("role", "img");
    canvas.setAttribute("aria-label", this.#model.label);
    Object.assign(canvas.style, { position: "absolute", left: "0", top: "0", pointerEvents: "none", outline: "none" });
    const restoreHost = this.#positionHost(host);
    host.prepend(canvas);
    const onLost = (event: Event) => event.preventDefault();
    const onRestored = () => {
      renderer.shadowMap.needsUpdate = true;
      this.state.dirty = true;
      this.#redraw = true;
    };
    canvas.addEventListener("webglcontextlost", onLost);
    canvas.addEventListener("webglcontextrestored", onRestored);

    const built = this.#buildScene(renderer);
    this.#mounted = {
      ...built,
      cleanupDom: () => {
        canvas.removeEventListener("webglcontextlost", onLost);
        canvas.removeEventListener("webglcontextrestored", onRestored);
        canvas.remove();
        restoreHost();
      },
    };
    this.state.dirty = true;
    this.#redraw = true;
    // Compile programs and upload textures now, so the first reveals do not hitch.
    renderer.compile(built.scene, built.camera);
    this.#render();
    return () => this.unmount();
  }

  /** Disposes the GPU scene and removes the canvas. Safe to call twice. */
  unmount(): void {
    const m = this.#mounted;
    if (!m) return;
    this.#mounted = null;
    if (this.#interactiveFrame)
      m.renderer.domElement.ownerDocument.defaultView?.cancelAnimationFrame(this.#interactiveFrame);
    this.#interactiveFrame = 0;
    m.controls.dispose();
    for (const d of m.disposables) d.dispose();
    m.scene.traverse((object) => {
      const shadow = (object as DirectionalLight).shadow;
      if (shadow?.map) shadow.dispose();
    });
    m.renderer.dispose();
    m.renderer.forceContextLoss();
    m.cleanupDom();
  }

  #mountNotice(host: HTMLElement): () => void {
    const note = host.ownerDocument.createElement("div");
    note.setAttribute("role", "status");
    note.textContent = "This 3D model needs WebGL 2, which is not available here.";
    Object.assign(note.style, {
      position: "absolute",
      left: "50%",
      top: "50%",
      transform: "translate(-50%, -50%)",
      font: "500 14px/1.4 system-ui, sans-serif",
      color: this.#config.theme.ink,
      opacity: "0.7",
      pointerEvents: "none",
    });
    const restoreHost = this.#positionHost(host);
    host.prepend(note);
    return () => {
      note.remove();
      restoreHost();
    };
  }

  /** Absolute children need a positioned host; restore the inline value on cleanup. */
  #positionHost(host: HTMLElement): () => void {
    const view = host.ownerDocument.defaultView;
    if (view?.getComputedStyle(host).position !== "static") return () => {};
    const previous = host.style.position;
    host.style.position = "relative";
    return () => {
      host.style.position = previous;
    };
  }

  #buildScene(renderer: WebGLRenderer): Omit<Mounted, "cleanupDom"> {
    const { plan, materials, floor } = this.#model;
    const { size, theme } = this.#config;
    const disposables: Array<{ dispose(): void }> = [];
    const scene = new Scene();

    const camera = new PerspectiveCamera(30, size.w / size.h, 0.01, 100);
    this.#applyPose(camera, this.#config.pose.azimuth);

    // Shared reveal state texture.
    const stateTexture = new DataTexture(this.state.texels, this.state.patches, STATE_ROWS, RGBAFormat, FloatType);
    stateTexture.minFilter = NearestFilter;
    stateTexture.magFilter = NearestFilter;
    stateTexture.generateMipmaps = false;
    stateTexture.needsUpdate = true;
    disposables.push(stateTexture);
    const drawing = renderer.getDrawingBufferSize(new Vector2());
    const shared: SharedUniforms = {
      uSlState: { value: stateTexture },
      uSlTime: { value: 0 },
      uSlClay: { value: new Color(theme.clay) },
      uSlInk: { value: new Color(theme.ink) },
      uSlWire: { value: 1 },
      uSlResolution: { value: drawing },
      uSlPixelRatio: { value: renderer.getPixelRatio() },
    };
    const reduced = this.#reducedMotion;
    const pop: PopUniforms = {
      points: { value: reduced ? 0 : POP_MS.points },
      edges: { value: reduced ? 0 : POP_MS.edges },
      faces: { value: reduced ? 0 : POP_MS.faces },
    };

    // Lights: neutral studio rig (sky/ground fill, shadowed key, soft fill, room reflections).
    scene.add(new HemisphereLight(new Color(theme.sky), new Color(theme.ground), 1.1));
    const key = new DirectionalLight(0xffffff, 2.1);
    key.position.set(-1.6, 3.2, 2.2);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.radius = 5;
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.02;
    Object.assign(key.shadow.camera, { left: -1.6, right: 1.6, top: 1.6, bottom: -1.6, near: 0.5, far: 8 });
    key.shadow.camera.updateProjectionMatrix();
    scene.add(key);
    const fill = new DirectionalLight(0xffffff, 0.55);
    fill.position.set(2.4, 1.2, -1.4);
    scene.add(fill);
    const sweepLight = new DirectionalLight(0xffffff, 0);
    scene.add(sweepLight);
    const pmrem = new PMREMGenerator(renderer);
    const room = new RoomEnvironment();
    const env: Texture = pmrem.fromScene(room, 0.04).texture;
    room.dispose();
    pmrem.dispose();
    disposables.push(env);
    scene.environment = env;
    scene.environmentIntensity = 0.35;

    // Floor: soft shadow catcher and a fading guide grid.
    const floorY = floor - 0.002;
    const groundGeometry = new PlaneGeometry(6, 6);
    const shadowMaterial = new ShadowMaterial({ opacity: theme.shadow });
    const ground = new Mesh(groundGeometry, shadowMaterial);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = floorY;
    ground.receiveShadow = true;
    scene.add(ground);
    const gridOpacity = { value: 0.55 };
    const gridMaterial = new ShaderMaterial({
      vertexShader: GRID_VERTEX,
      fragmentShader: GRID_FRAGMENT,
      uniforms: {
        uSlColor: { value: new Color(theme.grid) },
        uSlOpacity: gridOpacity,
        uSlCell: { value: 0.25 },
        uSlRadius: { value: 2.6 },
      },
      transparent: true,
      depthWrite: false,
    });
    const grid = new Mesh(groundGeometry, gridMaterial);
    grid.rotation.x = -Math.PI / 2;
    grid.position.y = floorY + 0.001;
    grid.renderOrder = -1;
    scene.add(grid);
    disposables.push(groundGeometry, shadowMaterial, gridMaterial);

    // Faces: one mesh per material soup, cloned materials patched for reveal.
    const faceMixes: Array<{ value: number }> = [];
    const mixes = materials.map(() => ({ value: 0 }));
    for (const buffers of plan.faces) {
      const geometry = new BufferGeometry();
      geometry.setAttribute("position", new BufferAttribute(buffers.soup.positions, 3));
      geometry.setAttribute("normal", new BufferAttribute(buffers.soup.normals, 3));
      if (buffers.soup.uvs) geometry.setAttribute("uv", new BufferAttribute(buffers.soup.uvs, 2));
      if (buffers.soup.colors) geometry.setAttribute("color", new BufferAttribute(buffers.soup.colors, 3));
      geometry.setAttribute("aSlPatch", new BufferAttribute(buffers.patch, 1));
      geometry.setAttribute("aSlOrder", new BufferAttribute(buffers.order, 1));
      geometry.setAttribute("aSlCentroid", new BufferAttribute(buffers.centroid, 3));
      geometry.computeBoundingSphere();
      const source = materials[buffers.soup.material];
      if (!source) continue;
      const material = source.clone();
      const mix = mixes[buffers.soup.material] as { value: number };
      injectFaceReveal(material, shared, pop, mix);
      const depth = new MeshDepthMaterial();
      injectDepthReveal(depth, shared, pop);
      const mesh = new Mesh(geometry, material);
      mesh.castShadow = true;
      mesh.customDepthMaterial = depth;
      mesh.frustumCulled = false; // vertices move in the shader
      scene.add(mesh);
      disposables.push(geometry, material, depth);
    }
    mixes.forEach((m) => {
      faceMixes.push(m);
    });

    // Build points (welded vertices, or the whole content for point clouds).
    const cloud = plan.kind === "cloud";
    const pointsMix = { value: 0 };
    if (plan.points.count > 0) {
      const geometry = new BufferGeometry();
      geometry.setAttribute("position", new BufferAttribute(plan.points.positions, 3));
      geometry.setAttribute("aSlPatch", new BufferAttribute(plan.points.patch, 1));
      geometry.setAttribute("aSlOrder", new BufferAttribute(plan.points.order, 1));
      const colors = plan.points.colors ?? new Float32Array(plan.points.count * 3).fill(1);
      geometry.setAttribute("aSlColor", new BufferAttribute(colors, 3));
      const dense = plan.points.count > 20_000;
      const material = new ShaderMaterial({
        vertexShader: POINTS_VERTEX,
        fragmentShader: POINTS_FRAGMENT,
        uniforms: {
          ...shared,
          uSlPop: pop.points,
          uSlSize: { value: cloud ? (dense ? 2.2 : 3.2) : 3.6 },
          uSlDrop: { value: 0.06 },
          uSlMix: pointsMix,
          uSlCloud: { value: cloud ? 1 : 0 },
        },
        transparent: true,
        depthWrite: cloud,
      });
      const points = new Points(geometry, material);
      points.frustumCulled = false;
      points.renderOrder = 2;
      scene.add(points);
      disposables.push(geometry, material);
    }

    // Build edges as instanced screen-space quads.
    if (plan.edges.count > 0) {
      const geometry = new InstancedBufferGeometry();
      geometry.setAttribute(
        "position",
        new BufferAttribute(new Float32Array([0, -1, 0, 1, -1, 0, 1, 1, 0, 0, 1, 0]), 3),
      );
      geometry.setIndex([0, 1, 2, 0, 2, 3]);
      geometry.setAttribute("iSlStart", new InstancedBufferAttribute(plan.edges.start, 3));
      geometry.setAttribute("iSlEnd", new InstancedBufferAttribute(plan.edges.end, 3));
      geometry.setAttribute("aSlPatch", new InstancedBufferAttribute(plan.edges.patch, 1));
      geometry.setAttribute("aSlOrder", new InstancedBufferAttribute(plan.edges.order, 1));
      geometry.instanceCount = plan.edges.count;
      const material = new ShaderMaterial({
        vertexShader: EDGES_VERTEX,
        fragmentShader: EDGES_FRAGMENT,
        uniforms: { ...shared, uSlPop: pop.edges, uSlWidth: { value: 1.6 } },
        transparent: true,
        depthWrite: false,
        side: DoubleSide,
      });
      const edges = new Mesh(geometry, material);
      edges.frustumCulled = false;
      edges.renderOrder = 1;
      scene.add(edges);
      disposables.push(geometry, material);
    }

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enabled = false;
    controls.enableDamping = false;
    controls.minDistance = 1.3;
    controls.maxDistance = this.#config.pose.distance * 3;
    controls.target.set(0, 0, 0);
    controls.addEventListener("start", () => {
      this.#userOrbit = true;
    });
    controls.addEventListener("change", () => {
      this.#cameraMoved = true;
      this.#scheduleInteractiveRender();
    });

    return {
      renderer,
      scene,
      camera,
      controls,
      stateTexture,
      shared,
      pop,
      faceMixes,
      sweepLight,
      gridOpacity,
      pointsMix,
      disposables,
    };
  }

  #applyPose(camera: PerspectiveCamera, azimuth: number): void {
    const { pose } = this.#config;
    orbitPosition(azimuth, pose.elevation, pose.distance, camera.position);
    camera.near = Math.max(0.01, pose.distance - 4);
    camera.far = pose.distance + 8;
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
  }

  #enableControls(): void {
    const m = this.#mounted;
    if (!m) return;
    const canvas = m.renderer.domElement;
    m.camera.near = 0.01;
    m.camera.updateProjectionMatrix();
    m.controls.enabled = true;
    m.controls.update();
    canvas.style.pointerEvents = "auto";
    canvas.style.touchAction = "none";
    canvas.style.cursor = "grab";
    canvas.tabIndex = 0;
    canvas.setAttribute("aria-label", `${this.#model.label}. Drag to rotate, scroll or pinch to zoom.`);
    m.controls.listenToKeyEvents(canvas);
  }

  /** Renders on the next animation frame after user orbit input (the engine clock may be stopped). */
  #scheduleInteractiveRender(): void {
    const m = this.#mounted;
    const view = m?.renderer.domElement.ownerDocument.defaultView;
    if (!m || !view || this.#interactiveFrame) return;
    this.#interactiveFrame = view.requestAnimationFrame(() => {
      this.#interactiveFrame = 0;
      this.#render();
    });
  }

  /* ---------------------------------------------------------------- */
  /* Per-frame update                                                  */
  /* ---------------------------------------------------------------- */

  /** Advances to engine time `now` and renders when anything changed or is animating. */
  frame(now: number): void {
    const state = this.state;
    state.now = now;
    const m = this.#mounted;
    if (!m) return;
    let changed = this.#redraw || state.dirty;
    if (state.dirty || now < state.animatingUntil) m.renderer.shadowMap.needsUpdate = true;
    if (state.dirty) {
      m.stateTexture.needsUpdate = true;
      const mean = state.materialMean();
      const light = state.light;
      m.shared.uSlWire.value = (1 - 0.65 * mean) * (1 - light);
      m.faceMixes.forEach((mix, i) => {
        mix.value = state.materials[this.#model.groupOf[i] ?? 0] ?? 0;
      });
      m.pointsMix.value = state.materials[0] ?? 0;
      m.gridOpacity.value = 0.55 * (1 - light);
      m.scene.environmentIntensity = 0.35 + 0.65 * light;
      const swing = this.#config.pose.azimuth + (-100 + 200 * light) * (Math.PI / 180);
      orbitPosition(swing, 0.45, 4, m.sweepLight.position);
      m.sweepLight.intensity = 2.6 * Math.sin(Math.PI * light);
      state.dirty = false;
    }
    if (this.#finaleAt !== null && this.#finaleAt >= 0 && !this.#userOrbit) {
      const t = clamp01((now - this.#finaleAt) / ORBIT_MS);
      // Swing toward (and past) the front so the model's face stays in view during the orbit.
      const azimuth = this.#config.pose.azimuth - easeInOut(t) * this.#config.orbitDegrees * (Math.PI / 180);
      this.#applyPose(m.camera, azimuth);
      m.camera.near = 0.01;
      m.camera.updateProjectionMatrix();
      m.controls.update();
      this.#cameraMoved = true;
      changed = true;
      if (t >= 1) this.#finaleAt = -1;
    }
    if (now < state.animatingUntil) changed = true;
    if (!changed) return;
    m.shared.uSlTime.value = now;
    this.#redraw = false;
    this.#render();
  }

  #render(): void {
    const m = this.#mounted;
    if (!m || m.renderer.getContext().isContextLost()) return;
    m.renderer.render(m.scene, m.camera);
  }

  /** Stage point under the build camera -> current screen point (identity until the camera moves). */
  reprojectWith(fn: (p: Point, live: PerspectiveCamera) => Point, p: Point): Point {
    const camera = this.#mounted?.camera;
    if (!camera || !this.#cameraMoved) return p;
    return fn(p, camera);
  }

  /** World position helper for tests: model point -> current stage px. */
  projectModelPoint(x: number, y: number, z: number): Point | null {
    const camera = this.#mounted?.camera;
    if (!camera) return null;
    const v = new Vector3(x, y, z).project(camera);
    if (!Number.isFinite(v.x) || !Number.isFinite(v.y) || v.z > 1) return null;
    return { x: ((v.x + 1) / 2) * this.#config.size.w, y: ((1 - v.y) / 2) * this.#config.size.h };
  }
}
