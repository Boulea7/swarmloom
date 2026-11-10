/**
 * Colours of the 3D stage. Original SwarmLoom palette (contracts/brand.md); no colour here is
 * taken from another product.
 */

/** Brand cursor palette, reused for materials of formats without materials (STL, PLY, OBJ). */
export const BRAND_PALETTE: readonly string[] = [
  "#5B5BF7",
  "#FF6B5B",
  "#14B8A6",
  "#F5A524",
  "#D946EF",
  "#3BA7F5",
  "#84CC16",
  "#9B5CF6",
  "#F43F5E",
  "#0EA5E9",
  "#22C55E",
  "#FB923C",
];

export interface StageTheme {
  scheme: "light" | "dark";
  /** CSS background of the blank stage (Blueprint.background). */
  background: string;
  /** Unlit "clay" surface shown before materials fade in. */
  clay: string;
  /** Colour points and edges settle to after their pop-in flash. */
  ink: string;
  /** Floor grid line colour (fades out with the light sweep). */
  grid: string;
  /** Hemisphere light colours (sky, ground). */
  sky: string;
  ground: string;
  /** Final opacity of the soft ground shadow. */
  shadow: number;
}

const LIGHT: StageTheme = {
  scheme: "light",
  background: "radial-gradient(120% 90% at 50% 38%, #FFFFFF 0%, #F4F4F9 52%, #E6E6EF 100%)",
  clay: "#D9DAE4",
  ink: "#2A2A3C",
  grid: "#8E8FA6",
  sky: "#FFFFFF",
  ground: "#C9CAD6",
  shadow: 0.24,
};

const DARK: StageTheme = {
  scheme: "dark",
  background: "radial-gradient(120% 90% at 50% 38%, #22222F 0%, #15151F 52%, #0B0B12 100%)",
  clay: "#62637A",
  ink: "#E9E9F4",
  grid: "#5C5D74",
  sky: "#E6E7FF",
  ground: "#1A1A24",
  shadow: 0.5,
};

/** Stage colours for a content scheme. */
export function stageTheme(scheme: "light" | "dark"): StageTheme {
  return scheme === "dark" ? DARK : LIGHT;
}

/** File-type icon for the intro orbit: an original isometric cube mark. */
export const MODEL_ICON =
  "data:image/svg+xml," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">' +
      '<path d="M32 6 56 19v26L32 58 8 45V19z" fill="#5B5BF7"/>' +
      '<path d="M32 6 56 19 32 32 8 19z" fill="#8A8AFA"/>' +
      '<path d="M32 32v26L8 45V19z" fill="#4545D8"/>' +
      '<path d="M32 32 56 19M32 32 8 19M32 32v26" stroke="#FAFAFC" stroke-width="2" stroke-linejoin="round" fill="none"/>' +
      '<circle cx="32" cy="6" r="3.5" fill="#FF6B5B"/><circle cx="56" cy="45" r="3.5" fill="#14B8A6"/>' +
      '<circle cx="8" cy="45" r="3.5" fill="#F5A524"/></svg>',
  );
