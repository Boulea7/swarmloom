import { type FkpRun, runAt, runAtOrAfter } from "./fkp";
import type { Lists } from "./lists";
import { fcOfCp, type PieceTable, pieceGrpprl } from "./pieces";
import { applyCharSprm, applyParaSprm, type CharProps, type ParaProps, SPRM_C_ISTD } from "./props";
import { parseGrpprl, type Sprm } from "./sprm";
import type { Style, StyleSheet } from "./styles";

const EMPTY: Uint8Array = new Uint8Array(0);

/** A CP range with one CHPX (and optional piece modifier). */
export interface CharSegment {
  start: number;
  end: number;
  grpprl: Uint8Array;
  prm: Uint8Array | null;
}

/**
 * Resolves paragraph and character formatting for CPs: CP -> FC through the piece table,
 * FC -> PAPX/CHPX run, then style inheritance and direct sprms. Results are cached per grpprl.
 */
export class Formatter {
  private readonly sprmCache = new WeakMap<Uint8Array, Sprm[]>();
  private readonly charCache = new Map<Style, WeakMap<Uint8Array, CharProps>>();

  constructor(
    private readonly pieces: PieceTable,
    private readonly papx: readonly FkpRun[],
    private readonly chpx: readonly FkpRun[],
    readonly styles: StyleSheet,
    private readonly lists: Lists | null,
  ) {}

  private sprms(grpprl: Uint8Array): Sprm[] {
    let parsed = this.sprmCache.get(grpprl);
    if (!parsed) {
      parsed = parseGrpprl(grpprl);
      this.sprmCache.set(grpprl, parsed);
    }
    return parsed;
  }

  /** Paragraph style and properties of the paragraph whose mark is at `markCp`. */
  paragraph(markCp: number): { style: Style; props: ParaProps } {
    const loc = fcOfCp(this.pieces, markCp);
    const run = loc ? runAt(this.papx, loc.fc) : null;
    const style = this.styles.get(run?.istd ?? 0);
    const props: ParaProps = { ...style.para };
    const direct = run ? this.sprms(run.grpprl) : [];
    const prm = loc ? pieceGrpprl(this.pieces, loc.piece) : null;
    const modifiers = prm ? this.sprms(prm) : [];
    if (this.lists) {
      // The list level's indents sit between the style and direct formatting, so find the list first.
      const probe: ParaProps = { ...props };
      for (const s of direct) applyParaSprm(probe, s);
      for (const s of modifiers) applyParaSprm(probe, s);
      const level = probe.list > 0 ? this.lists.level(probe.list, probe.listLevel) : null;
      if (level) for (const s of this.sprms(level.papx)) applyParaSprm(props, s);
    }
    for (const s of direct) applyParaSprm(props, s);
    for (const s of modifiers) applyParaSprm(props, s);
    return { style, props };
  }

  /** Character properties for a segment inside a paragraph of `style`. */
  chars(segment: CharSegment, style: Style): CharProps {
    if (!segment.prm) {
      let perStyle = this.charCache.get(style);
      if (!perStyle) {
        perStyle = new WeakMap();
        this.charCache.set(style, perStyle);
      }
      let props = perStyle.get(segment.grpprl);
      if (!props) {
        props = this.resolveChars(this.sprms(segment.grpprl), style);
        perStyle.set(segment.grpprl, props);
      }
      return props;
    }
    return this.resolveChars([...this.sprms(segment.grpprl), ...this.sprms(segment.prm)], style);
  }

  private resolveChars(direct: Sprm[], style: Style): CharProps {
    const props: CharProps = { ...style.char };
    const charStyle = direct.find((s) => s.op === SPRM_C_ISTD);
    if (charStyle) {
      const cs = this.styles.get(charStyle.arg[0] | (charStyle.arg[1] << 8));
      if (cs.kind === "character") {
        for (const g of cs.charChain) for (const s of this.sprms(g)) applyCharSprm(props, s, style.char);
      }
    }
    const reference = { ...props };
    for (const s of direct) applyCharSprm(props, s, reference);
    return props;
  }

  /** Splits [start, end) at piece and CHPX boundaries. */
  segments(start: number, end: number): CharSegment[] {
    const out: CharSegment[] = [];
    let cp = start;
    while (cp < end) {
      const loc = fcOfCp(this.pieces, cp);
      if (!loc) {
        out.push({ start: cp, end, grpprl: EMPTY, prm: null });
        break;
      }
      const { piece, fc, width } = loc;
      const pieceEnd = Math.min(end, piece.cpEnd);
      const cpOfFc = (f: number) => piece.cpStart + Math.ceil((f - piece.fc) / width);
      const index = runAtOrAfter(this.chpx, fc);
      const run = this.chpx[index];
      let segEnd: number;
      let grpprl = EMPTY;
      if (run && run.fcStart <= fc) {
        grpprl = run.grpprl;
        segEnd = Math.min(pieceEnd, cpOfFc(run.fcEnd));
      } else {
        segEnd = run ? Math.min(pieceEnd, cpOfFc(run.fcStart)) : pieceEnd;
      }
      segEnd = Math.max(segEnd, cp + 1);
      out.push({ start: cp, end: segEnd, grpprl, prm: pieceGrpprl(this.pieces, piece) });
      cp = segEnd;
    }
    return out;
  }

  /** Character properties of a single CP (e.g. a paragraph mark). */
  charAt(cp: number, style: Style): CharProps {
    const [segment] = this.segments(cp, cp + 1);
    return segment ? this.chars(segment, style) : { ...style.char };
  }
}
