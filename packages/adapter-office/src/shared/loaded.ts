import type { Adapter, AdapterContext, LoadedSource, SourceInput } from "@swarmloom/core";

/**
 * A {@link LoadedSource} that also carries the quality notes of this package.
 *
 * `notes` is proposed as an optional member of the core `LoadedSource` contract (decisions-v1
 * F01). Until the contract has it, the adapters return this structural extension; it stays
 * assignable to `LoadedSource`, and becomes a plain alias once the core member lands.
 */
export interface OfficeLoadedSource extends LoadedSource {
  /**
   * Plain English sentences, one per difference from the original: font substitutions, content
   * shown as placeholders, formulas shown without a saved result. Omitted when nothing differs.
   */
  notes?: string[];
}

/** An {@link Adapter} whose `load` resolves to an {@link OfficeLoadedSource}. */
export interface OfficeAdapter extends Adapter {
  load(input: SourceInput, ctx: AdapterContext): Promise<OfficeLoadedSource>;
}
