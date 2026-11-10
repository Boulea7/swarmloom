/**
 * Long-input budget (contracts/decisions-v1.md S10): a build should finish in about 60-90 s at 1x.
 * At roughly 260 layers per 45 s (S09) that is about 400 layers, and typing more than ~12 000
 * characters would dominate the time on its own. Adapters count blocks, cells, frames and text
 * objects as "units" and stop emitting content once either allowance is spent.
 */
export interface BudgetLimits {
  /** Most content units (paragraphs, cells, frames, images, text objects). */
  units: number;
  /** Most characters of text. */
  chars: number;
}

export const DEFAULT_BUDGET: Readonly<BudgetLimits> = { units: 420, chars: 12_000 };

/** Running account of a {@link BudgetLimits}. */
export class ContentBudget {
  private units = 0;
  private chars = 0;
  /** Units refused after the budget ran out. */
  dropped = 0;

  constructor(readonly limits: BudgetLimits = DEFAULT_BUDGET) {}

  /** True once either allowance is spent. */
  get exhausted(): boolean {
    return this.units >= this.limits.units || this.chars >= this.limits.chars;
  }

  /**
   * Books one content unit with `chars` characters. The unit that crosses a limit is still
   * accepted (content is never cut mid-paragraph); later ones are refused and counted in `dropped`.
   */
  take(chars = 0, units = 1): boolean {
    if (this.exhausted) {
      this.dropped += units;
      return false;
    }
    this.units += units;
    this.chars += chars;
    return true;
  }

  /** Counts units skipped without trying them (for example whole chapters or pages left out). */
  skip(units: number): void {
    this.dropped += Math.max(0, units);
  }
}
