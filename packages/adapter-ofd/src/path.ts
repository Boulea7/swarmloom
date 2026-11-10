/**
 * OFD `AbbreviatedData` path syntax to SVG path data. Commands (GB/T 33190, 9.3.4): S/M move,
 * L line, Q quadratic, B cubic Bezier, A arc, C close. Coordinates are millimetres in the object's
 * own space; numbers are validated and the output only ever contains commands and numbers.
 */

const ARGS: Record<string, [string, number]> = {
  S: ["M", 2],
  M: ["M", 2],
  L: ["L", 2],
  Q: ["Q", 4],
  B: ["C", 6],
  A: ["A", 7],
  C: ["Z", 0],
};

const MAX_TOKENS = 200_000;

const num = (n: number) => String(Math.round(n * 1000) / 1000);

/** Converts AbbreviatedData to SVG path data; returns "" when nothing valid remains. */
export function abbreviatedToSvg(data: string): string {
  const tokens = data
    .trim()
    .split(/[\s,]+/)
    .slice(0, MAX_TOKENS);
  const out: string[] = [];
  let i = 0;
  let started = false;
  while (i < tokens.length) {
    const op = ARGS[tokens[i] as string];
    i++;
    if (!op) continue;
    const [svg, count] = op;
    const args = tokens.slice(i, i + count).map(Number);
    if (args.length < count || !args.every(Number.isFinite)) break;
    i += count;
    if (svg === "M") started = true;
    else if (!started) {
      // A path must start with a move; draw from the origin like OFD readers do.
      out.push("M0 0");
      started = true;
    }
    if (svg === "A") {
      const [rx, ry, rot, large, sweep, x, y] = args as [number, number, number, number, number, number, number];
      out.push(
        `A${num(Math.abs(rx))} ${num(Math.abs(ry))} ${num(rot)} ${large ? 1 : 0} ${sweep ? 1 : 0} ${num(x)} ${num(y)}`,
      );
    } else out.push(`${svg}${args.map(num).join(" ")}`);
  }
  return out.length > 0 && started ? out.join("") : "";
}
