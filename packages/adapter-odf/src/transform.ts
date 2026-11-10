import { lengthPx } from "./kit/css";

/** 2D affine matrix [a, b, c, d, e, f] as in CSS `matrix()`. */
export type Matrix = [number, number, number, number, number, number];

export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** m1 x m2: applies m2 first, then m1. */
export function multiply(m1: Matrix, m2: Matrix): Matrix {
  const [a1, b1, c1, d1, e1, f1] = m1;
  const [a2, b2, c2, d2, e2, f2] = m2;
  return [
    a1 * a2 + c1 * b2,
    b1 * a2 + d1 * b2,
    a1 * c2 + c1 * d2,
    b1 * c2 + d1 * d2,
    a1 * e2 + c1 * f2 + e1,
    b1 * e2 + d1 * f2 + f1,
  ];
}

function num(v: string | undefined): number | undefined {
  if (v === undefined) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Parses an ODF `draw:transform` ("rotate (0.52) translate (2cm 3cm)"). The operations apply in
 * the order written; ODF rotates counter-clockwise, so on screen the angle is negated. Returns
 * undefined for anything unparsable.
 */
export function parseOdfTransform(value: string | null | undefined): Matrix | undefined {
  if (!value) return undefined;
  let m: Matrix = IDENTITY;
  const re = /([a-zA-Z]+)\s*\(([^)]*)\)/g;
  let seen = false;
  for (let hit = re.exec(value); hit; hit = re.exec(value)) {
    seen = true;
    const args = (hit[2] ?? "")
      .trim()
      .split(/[\s,]+/)
      .filter((s) => s !== "");
    let op: Matrix | undefined;
    switch (hit[1]?.toLowerCase()) {
      case "rotate": {
        const r = num(args[0]);
        if (r !== undefined) op = [Math.cos(-r), Math.sin(-r), -Math.sin(-r), Math.cos(-r), 0, 0];
        break;
      }
      case "translate": {
        const x = lengthPx(args[0]);
        const y = args[1] === undefined ? 0 : lengthPx(args[1]);
        if (x !== undefined && y !== undefined) op = [1, 0, 0, 1, x, y];
        break;
      }
      case "scale": {
        const sx = num(args[0]);
        const sy = args[1] === undefined ? sx : num(args[1]);
        if (sx !== undefined && sy !== undefined) op = [sx, 0, 0, sy, 0, 0];
        break;
      }
      case "skewx": {
        const t = num(args[0]);
        if (t !== undefined) op = [1, 0, Math.tan(-t), 1, 0, 0];
        break;
      }
      case "skewy": {
        const t = num(args[0]);
        if (t !== undefined) op = [1, Math.tan(-t), 0, 1, 0, 0];
        break;
      }
      case "matrix": {
        const [a, b, c, d] = args.slice(0, 4).map(num);
        const e = lengthPx(args[4]);
        const f = lengthPx(args[5]);
        if ([a, b, c, d, e, f].every((v) => v !== undefined)) op = [a, b, c, d, e, f] as Matrix;
        break;
      }
    }
    if (!op) return undefined;
    m = multiply(op, m);
  }
  return seen ? m : undefined;
}

/** CSS `matrix()` with rounded components. */
export function cssMatrix(m: Matrix): string {
  const r = (n: number) => Math.round(n * 10000) / 10000;
  return `matrix(${m.map(r).join(",")})`;
}
