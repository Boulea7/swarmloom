import { describe, expect, it } from "vitest";
import { Screen } from "../src/screen";
import { restCell, rowEnds, watchCell } from "../src/spots";

// 8 x 20 px cells: a cursor needs 8 free columns right of the text and reaches two rows down (and
// one row up for a watcher's status bubble).
const g = { cols: 40, rows: 8, cellW: 8, cellH: 20 };

function ends(text: string): number[] {
  const screen = new Screen(g.cols, g.rows);
  screen.write(text);
  return rowEnds(screen);
}

describe("terminal cursor spots", () => {
  const session = ends("$ swarmloom render landing.html \\\r\n> --seed 7\r\nrendering 40%");

  it("watches output right of the text its bubble and tag reach, above the cursor row when there is room", () => {
    expect(session.slice(0, 3)).toEqual([33, 10, 13]);
    expect(watchCell(session, g, 6)).toEqual({ x: 14, y: 3.5 });
    expect(watchCell(session, g, 2)).toEqual({ x: 14, y: 2.5 });
  });

  it("rests idle cursors clear of the text, above the text cursor's row when there is room", () => {
    expect(restCell(session, g, 6, () => 0)).toEqual({ x: 14, y: 1.5 });
    expect(restCell(session, g, 2, () => 0)).toEqual({ x: 1, y: 3.5 });
  });

  it("finds no spot on a screen full of text", () => {
    const full = ends(`${"x".repeat(39)}\r\n`.repeat(8));
    expect(watchCell(full, g, 0)).toBeNull();
    expect(restCell(full, g, 7, () => 0)).toBeNull();
  });
});
