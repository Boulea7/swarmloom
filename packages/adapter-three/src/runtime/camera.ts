import type { Point, Size } from "@swarmloom/core";
import { PerspectiveCamera, Vector3, Vector4 } from "three";
import type { Projector } from "../plan/types";

/** Build-camera framing constants: a three-quarter view from slightly above. */
const FOV = 30;
const AZIMUTH = (32 * Math.PI) / 180;
const ELEVATION = (18 * Math.PI) / 180;
/** Fraction of the stage the model's projected extent may fill. */
const FILL = 0.78;

/** Camera position for an orbit angle around the Y axis at a given distance and elevation. */
export function orbitPosition(azimuth: number, elevation: number, distance: number, out = new Vector3()): Vector3 {
  const flat = Math.cos(elevation) * distance;
  return out.set(Math.sin(azimuth) * flat, Math.sin(elevation) * distance, Math.cos(azimuth) * flat);
}

/** Pose of the locked build camera. */
export interface CameraPose {
  azimuth: number;
  elevation: number;
  distance: number;
}

function placeCamera(camera: PerspectiveCamera, pose: CameraPose): void {
  orbitPosition(pose.azimuth, pose.elevation, pose.distance, camera.position);
  camera.near = Math.max(0.01, pose.distance - 4);
  camera.far = pose.distance + 8;
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
}

/**
 * Frames a normalized model (bounding radius 1 at the origin): starts from the bounding-sphere
 * distance, then tightens it so the projected extent of `samples` fills about 78% of the stage.
 */
export function fitCamera(size: Size, samples: Float32Array): { camera: PerspectiveCamera; pose: CameraPose } {
  const aspect = size.w / size.h;
  const camera = new PerspectiveCamera(FOV, aspect, 0.01, 100);
  const vHalf = ((FOV / 2) * Math.PI) / 180;
  const hHalf = Math.atan(Math.tan(vHalf) * aspect);
  const pose: CameraPose = {
    azimuth: AZIMUTH,
    elevation: ELEVATION,
    distance: 1.08 / Math.sin(Math.min(vHalf, hHalf)),
  };
  placeCamera(camera, pose);
  const clip = new Vector4();
  const n = samples.length / 3;
  const stride = Math.max(1, Math.floor(n / 4000));
  for (let pass = 0; pass < 2 && n > 0; pass++) {
    let extent = 0;
    for (let i = 0; i < n; i += stride) {
      clip.set(samples[i * 3] as number, samples[i * 3 + 1] as number, samples[i * 3 + 2] as number, 1);
      clip.applyMatrix4(camera.matrixWorldInverse).applyMatrix4(camera.projectionMatrix);
      if (clip.w <= 1e-6) continue;
      extent = Math.max(extent, Math.abs(clip.x / clip.w), Math.abs(clip.y / clip.w));
    }
    if (!(extent > 1e-4)) break;
    // Perspective scale is ~1/distance around the target; never come closer than the sphere allows.
    pose.distance = Math.max(1.6, pose.distance * (extent / FILL));
    placeCamera(camera, pose);
  }
  return { camera, pose };
}

/** Projector from model space to stage px through `camera` for a stage of `size`. */
export function stageProjector(camera: PerspectiveCamera, size: Size): Projector {
  const clip = new Vector4();
  return (x, y, z, out) => {
    clip.set(x, y, z, 1).applyMatrix4(camera.matrixWorldInverse).applyMatrix4(camera.projectionMatrix);
    if (!(clip.w > 1e-6)) return false;
    out.x = ((clip.x / clip.w + 1) / 2) * size.w;
    out.y = ((1 - clip.y / clip.w) / 2) * size.h;
    return Number.isFinite(out.x) && Number.isFinite(out.y);
  };
}

/** Function mapping a stage point under the build camera to the live camera's stage point. */
export type Reprojector = (p: Point, live: PerspectiveCamera) => Point;

/**
 * Builds a {@link Reprojector}. A coarse screen grid stores the nearest model depth seen by the
 * build camera (from `samples`, normalized positions); a stage point is lifted to that depth
 * along its view ray (the model-centre depth where the grid is empty) and projected with the
 * live camera. Exact for anchors on the visible surface, approximate elsewhere.
 */
export function createReprojector(build: PerspectiveCamera, size: Size, samples: Float32Array): Reprojector {
  const cols = 48;
  const rows = Math.max(8, Math.min(96, Math.round((cols * size.h) / size.w)));
  const depth = new Float32Array(cols * rows).fill(Number.POSITIVE_INFINITY);
  const forward = build.getWorldDirection(new Vector3());
  const v = new Vector3();
  const clip = new Vector4();
  const n = samples.length / 3;
  const stride = Math.max(1, Math.floor(n / 60_000));
  for (let i = 0; i < n; i += stride) {
    v.set(samples[i * 3] as number, samples[i * 3 + 1] as number, samples[i * 3 + 2] as number);
    clip.set(v.x, v.y, v.z, 1).applyMatrix4(build.matrixWorldInverse).applyMatrix4(build.projectionMatrix);
    if (!(clip.w > 1e-6)) continue;
    const cx = Math.floor(((clip.x / clip.w + 1) / 2) * cols);
    const cy = Math.floor(((1 - clip.y / clip.w) / 2) * rows);
    if (cx < 0 || cy < 0 || cx >= cols || cy >= rows) continue;
    const d = v.sub(build.position).dot(forward);
    if (d < (depth[cy * cols + cx] as number)) depth[cy * cols + cx] = d;
  }
  const centreDepth = new Vector3().sub(build.position).dot(forward);
  const ray = new Vector3();
  const hit = new Vector3();
  return (p, live) => {
    const cx = Math.min(cols - 1, Math.max(0, Math.floor((p.x / size.w) * cols)));
    const cy = Math.min(rows - 1, Math.max(0, Math.floor((p.y / size.h) * rows)));
    const cell = depth[cy * cols + cx] as number;
    const d = Number.isFinite(cell) ? cell : centreDepth;
    ray
      .set((p.x / size.w) * 2 - 1, 1 - (p.y / size.h) * 2, 0.5)
      .unproject(build)
      .sub(build.position);
    const along = ray.dot(forward);
    if (!(along > 1e-9)) return p;
    hit.copy(build.position).addScaledVector(ray, d / along);
    clip.set(hit.x, hit.y, hit.z, 1).applyMatrix4(live.matrixWorldInverse).applyMatrix4(live.projectionMatrix);
    if (!(clip.w > 1e-6)) return p;
    const x = ((clip.x / clip.w + 1) / 2) * size.w;
    const y = ((1 - clip.y / clip.w) / 2) * size.h;
    return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : p;
  };
}
