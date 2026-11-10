/**
 * Per-run bookkeeping for one choreography: tracked overlays, pointer state, cursor shape and
 * transient styles, all undone in one place when the task ends, fails or is aborted.
 */

import type {
  AgentApi,
  CSSMap,
  CursorShape,
  Layer,
  OverlayHandle,
  OverlayKind,
  Rect,
  SoundName,
  StageApi,
  TaskFn,
  TaskGen,
} from "../types";

/** Body of a built-in task; {@link defineTask} wraps it with cleanup and the final `finish`. */
export type TaskBody<L extends Layer = Layer> = (scope: TaskScope, layer: L) => TaskGen;

/** Used only when the stage reports an unusable viewport (hidden host, zero size). */
const FALLBACK_VIEW: Rect = { x: 0, y: 0, w: 1280, h: 800 };

/**
 * Transient inline styles of one layer. Every call sends the complete current map, so the
 * result is the same whether the stage merges or replaces successive `setStyle` calls.
 */
export class TransientStyle {
  #current: CSSMap = {};
  #active = false;

  constructor(
    private readonly stage: StageApi,
    private readonly id: string,
  ) {}

  get active(): boolean {
    return this.#active;
  }

  /** Merges `css` into the transient map and applies it. */
  set(css: CSSMap): void {
    this.#current = { ...this.#current, ...css };
    this.#active = true;
    this.stage.setStyle(this.id, { ...this.#current });
  }

  /**
   * Removes `keys` from the transient map. Clears, then re-applies the rest, so stages that merge
   * successive `setStyle` calls drop the keys too.
   */
  unset(keys: readonly string[]): void {
    if (!this.#active) return;
    const rest: CSSMap = { ...this.#current };
    for (const key of keys) delete rest[key];
    this.clear();
    if (Object.keys(rest).length > 0) this.set(rest);
  }

  /** Drops every transient style on the stage. */
  clear(): void {
    if (!this.#active) return;
    this.#current = {};
    this.#active = false;
    this.stage.setStyle(this.id, null);
  }

  /** Forgets local state without touching the stage (after `finish`, which clears styles itself). */
  forget(): void {
    this.#current = {};
    this.#active = false;
  }
}

export class TaskScope {
  readonly style: TransientStyle;
  readonly #live = new Set<OverlayHandle>();
  #pressed = false;
  #cursorChanged = false;
  #saying = false;
  #finished = false;

  constructor(
    readonly agent: AgentApi,
    readonly stage: StageApi,
    readonly layerId: string,
  ) {
    this.style = new TransientStyle(stage, layerId);
  }

  get finished(): boolean {
    return this.#finished;
  }

  get pressed(): boolean {
    return this.#pressed;
  }

  /** Creates an overlay that is removed automatically when the task ends. */
  overlay(kind: OverlayKind, props: Record<string, unknown>): OverlayHandle {
    const handle = this.stage.overlay(kind, props);
    this.#live.add(handle);
    return handle;
  }

  /** Removes a tracked overlay now. Null and already removed handles are ignored. */
  drop(handle: OverlayHandle | null | undefined): void {
    if (!handle || !this.#live.delete(handle)) return;
    handle.remove();
  }

  /** Mouse button down, with its sound (`null` for a silent press, e.g. pen clicks that play "pen"). */
  press(sound: SoundName | null = "press"): void {
    this.agent.press();
    this.#pressed = true;
    if (sound) this.agent.sound(sound);
  }

  /** Mouse button up, with its sound. No-op when the button is not held. */
  release(sound: SoundName | null = "release"): void {
    if (!this.#pressed) return;
    this.agent.release();
    this.#pressed = false;
    if (sound) this.agent.sound(sound);
  }

  cursor(shape: CursorShape): void {
    this.agent.setCursor(shape);
    this.#cursorChanged = true;
  }

  /** Status bubble next to the cursor; cleared automatically when the task ends. */
  say(text: string): void {
    this.agent.say(text);
    this.#saying = text !== "";
  }

  sound(name: SoundName, opts?: { pitch?: number; vel?: number }): void {
    this.agent.sound(name, opts);
  }

  /** Current viewport in stage coordinates, never degenerate. */
  viewport(): Rect {
    const v = this.stage.viewport();
    if (v && Number.isFinite(v.x) && Number.isFinite(v.y) && v.w > 0 && v.h > 0) return v;
    const size = this.stage.blueprint.viewport;
    return size && size.w > 0 && size.h > 0 ? { x: 0, y: 0, w: size.w, h: size.h } : FALLBACK_VIEW;
  }

  /** Marks the layer complete. The stage clears transient styles as part of `finish`. */
  finish(): void {
    if (this.#finished) return;
    this.stage.finish(this.layerId);
    this.style.forget();
    this.#finished = true;
  }

  /** Number of overlays still alive (tests and diagnostics). */
  get liveOverlays(): number {
    return this.#live.size;
  }

  /**
   * Undoes every transient effect: overlays, held button, bubble, cursor shape and (if the layer never
   * finished) transient styles. Each step runs even when an earlier one throws; the first error
   * is returned so the caller can decide whether to surface it.
   */
  dispose(): unknown {
    let first: unknown;
    const attempt = (fn: () => void): void => {
      try {
        fn();
      } catch (error) {
        first ??= error;
      }
    };
    for (const handle of this.#live) attempt(() => handle.remove());
    this.#live.clear();
    if (this.#pressed) {
      this.#pressed = false;
      attempt(() => this.agent.release());
    }
    if (this.#saying) {
      this.#saying = false;
      attempt(() => this.agent.say(""));
    }
    if (this.#cursorChanged) {
      this.#cursorChanged = false;
      attempt(() => this.agent.setCursor("arrow"));
    }
    if (!this.#finished) attempt(() => this.style.clear());
    return first;
  }
}

/**
 * Turns a task body into a {@link TaskFn}. The body runs inside a {@link TaskScope} and the scope
 * is disposed on every exit path:
 *  - completion: the layer is finished, then cleaned up;
 *  - error: the layer is still finished (its final state is the honest fallback; a half-typed
 *    text must not stay on screen), then the original error is rethrown for the engine to report;
 *  - abort (`return()` on replay/destroy): cleaned up without finishing, the stage is being reset.
 * A cleanup error is rethrown only when nothing else failed, so it never masks the original one.
 */
export function defineTask<L extends Layer>(body: TaskBody<L>): TaskFn<L> {
  return function* run(agent: AgentApi, layer: L, stage: StageApi): TaskGen {
    const scope = new TaskScope(agent, stage, layer.id);
    let completed = false;
    try {
      yield* body(scope, layer);
      completed = true;
    } catch (error) {
      try {
        scope.finish();
      } catch {
        // The stage cannot finish the layer either; the original error says more.
      }
      throw error;
    } finally {
      // Failed or aborted. Cleanup errors are dropped here: after a failure the original error
      // wins, after an abort the stage is reset or destroyed right away.
      if (!completed) scope.dispose();
    }
    let finishError: unknown;
    try {
      scope.finish();
    } catch (error) {
      finishError = error;
    }
    const cleanupError = scope.dispose();
    if (finishError !== undefined) throw finishError;
    if (cleanupError !== undefined) throw cleanupError;
  };
}
