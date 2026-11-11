/** 1 px = 15 twips (1440 twips per inch, 96 px per inch). */
export function twipsToPx(twips: number): number {
  return twips / 15;
}

/** Rounds to 2 decimals for compact, stable CSS. */
export function px(value: number): string {
  return `${Math.round(value * 100) / 100}px`;
}

/** Half-points to a CSS pt length. */
export function halfPoints(value: number): string {
  return `${value / 2}pt`;
}
