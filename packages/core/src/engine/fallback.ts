import type { AgentApi, Layer, StageApi, TaskGen } from "../types";
import { FALLBACK_FADE_MS } from "./constants";
import { clamp } from "./easing";

/** Inset that keeps the cursor inside the viewport when the layer is partly off screen. */
const EDGE_INSET_PX = 24;

/** AgentApi plus the optional task clock the engine's agents provide. */
type ClockedAgent = AgentApi & { now?(): number };

/**
 * Used when no plugin provides a choreography for a layer: the agent points at the layer
 * (its visible part) and the layer fades in.
 */
export function* fallbackFade(agent: ClockedAgent, layer: Layer, stage: StageApi): TaskGen {
  const vp = stage.viewport();
  const { x, y, w, h } = layer.box;
  const tx = clamp(x + w / 2, vp.x + EDGE_INSET_PX, vp.x + Math.max(EDGE_INSET_PX, vp.w - EDGE_INSET_PX));
  const ty = clamp(y + Math.min(h / 2, 40), vp.y + EDGE_INSET_PX, vp.y + Math.max(EDGE_INSET_PX, vp.h - EDGE_INSET_PX));
  if (Number.isFinite(tx) && Number.isFinite(ty)) yield* agent.moveTo(tx, ty);
  const now = typeof agent.now === "function" ? () => (agent.now as () => number).call(agent) : null;
  if (now) {
    const start = now();
    for (let p = 0; p < 1; p = (now() - start) / FALLBACK_FADE_MS) {
      stage.reveal(layer.id, p);
      yield undefined;
    }
  } else {
    const steps = 8;
    for (let i = 0; i < steps; i++) {
      stage.reveal(layer.id, i / steps);
      yield FALLBACK_FADE_MS / steps;
    }
  }
  stage.reveal(layer.id, 1);
  stage.finish(layer.id);
}
