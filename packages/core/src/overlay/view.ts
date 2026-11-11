/**
 * Mapping from stage (world) coordinates to canvas CSS pixels for the current frame.
 * One mutable instance is shared by the stage and its painters and refreshed once per frame,
 * so painting code converts coordinates with plain arithmetic and no allocations:
 *
 *   canvasX = originX + stageX * scale
 *   canvasY = originY + stageY * scale
 */
export interface ViewTransform {
  /** Canvas size in CSS px (equals the visible stage viewport). */
  width: number;
  height: number;
  /** Device pixel ratio the canvas backing store uses. */
  dpr: number;
  /** CSS px per stage px (inline mode scales wide content down to fit). */
  scale: number;
  originX: number;
  originY: number;
  /** Scroll offset of the visible viewport inside the world, stage px. */
  scrollX: number;
  scrollY: number;
}

export function createViewTransform(): ViewTransform {
  return { width: 0, height: 0, dpr: 1, scale: 1, originX: 0, originY: 0, scrollX: 0, scrollY: 0 };
}
