/**
 * Opacity fade driven by engine time: every value comes from the `now` passed to step(), never
 * from wall-clock CSS transitions, so exports render the same frames as live playback
 * (behaviour spec invariant I2). The fade starts at the first step() after start().
 */
export class Fade {
  #from = 0;
  #to = 0;
  #dur = 0;
  #startAt = Number.NaN;
  #value: number;
  #active = false;
  #resolve: (() => void) | null = null;
  #promise: Promise<void> | null = null;

  constructor(initial: number) {
    this.#value = initial;
  }

  get value(): number {
    return this.#value;
  }

  get active(): boolean {
    return this.#active;
  }

  /** Starts fading from the current value to `to` over `dur` engine ms; resolves when it ends. */
  start(to: number, dur: number): Promise<void> {
    this.#settle();
    this.#from = this.#value;
    this.#to = to;
    this.#dur = Number.isFinite(dur) && dur > 0 ? dur : 0;
    this.#startAt = Number.NaN;
    if (this.#from === to || this.#dur === 0) {
      this.#value = to;
      return Promise.resolve();
    }
    this.#active = true;
    this.#promise = new Promise<void>((resolve) => {
      this.#resolve = resolve;
    });
    return this.#promise;
  }

  /** Advances to engine time `now`; returns the current value. */
  step(now: number): number {
    if (!this.#active) return this.#value;
    if (!Number.isFinite(this.#startAt)) this.#startAt = now;
    const t = (now - this.#startAt) / this.#dur;
    if (!(t < 1)) {
      this.#value = this.#to;
      this.#settle();
      return this.#value;
    }
    const k = t <= 0 ? 0 : t * t * (3 - 2 * t);
    this.#value = this.#from + (this.#to - this.#from) * k;
    return this.#value;
  }

  /** Jumps to `value` and resolves a running fade (reset, destroy, superseded fades). */
  set(value: number): void {
    this.#value = value;
    this.#settle();
  }

  #settle(): void {
    this.#active = false;
    const resolve = this.#resolve;
    this.#resolve = null;
    this.#promise = null;
    resolve?.();
  }
}
