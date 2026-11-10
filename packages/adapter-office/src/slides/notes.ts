/**
 * User-facing quality notes for a converted deck: what is shown as a placeholder and which
 * fonts are substituted. Nothing is dropped silently.
 */

import type { FontLog } from "../shared/fonts";
import type { Presentation } from "./model";

/** Builds the notes for `OfficeLoadedSource.notes` (empty when the deck converted fully). */
export function slideNotes(pres: Presentation, fonts: FontLog): string[] {
  const notes: string[] = [];
  const placeholders = new Map<string, number>();
  const broken: number[] = [];
  for (const slide of pres.slides) {
    if (slide.error) broken.push(slide.number);
    for (const node of slide.nodes) {
      if (node.type === "media") placeholders.set(node.label, (placeholders.get(node.label) ?? 0) + 1);
    }
  }
  if (placeholders.size > 0) {
    const parts = [...placeholders].map(([label, n]) => (n > 1 ? `${label} x${n}` : label));
    notes.push(`Shown as labelled placeholders: ${parts.join(", ")}. Export the deck as PDF for an exact picture.`);
  }
  if (broken.length > 0) {
    const list = broken.join(", ");
    const plural = broken.length > 1;
    notes.push(
      `Slide${plural ? "s" : ""} ${list} could not be read and ${plural ? "are" : "is"} shown as a placeholder.`,
    );
  }
  const fontNote = fonts.note();
  if (fontNote) notes.push(fontNote);
  return notes;
}
