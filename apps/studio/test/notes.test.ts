import { expect, it } from "vitest";
import { createStudioI18n } from "../src/i18n";
import { en } from "../src/i18n/messages/en";
import { localizeNote } from "../src/notes";

it("words a font note with a crafted long font name without stalling", () => {
  // A DOCX font name is kept as written; a long run of spaces made the old pair pattern quadratic
  // (about 10 s for this name, minutes for longer ones) on Studio's main thread.
  const name = `A${" ".repeat(100_000)}x`;
  const note = `Fonts not installed on this device are shown with look-alikes (or the closest installed font): ${name} → a serif font.`;
  const start = performance.now();
  const text = localizeNote(note, createStudioI18n("en", en, null));
  expect(performance.now() - start).toBeLessThan(1000);
  expect(text).toBe(`Fonts missing on this device are shown with similar ones: ${name} → serif.`);
});
