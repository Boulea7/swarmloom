/** Adapter id (`Adapter.id`, `BlueprintSource.type`). */
export const LOTTIE_ADAPTER_ID = "lottie";
/** Plugin name listed in `Blueprint.plugins` for the player renderer and task. */
export const LOTTIE_PLUGIN = "lottie";
/** CustomLayer.task of the layer that plays the real animation after the weave. */
export const PLAYER_TASK = "lottie:player";

const MiB = 1024 * 1024;

/** Default limits for untrusted input (product-spec A.1: JSON up to 50 MB, depth 256). */
export const LIMITS = {
  /** Lottie JSON text, bytes. */
  maxBytes: 50 * MiB,
  /** .lottie archive, bytes. */
  maxArchiveBytes: 100 * MiB,
  /** Total uncompressed bytes read from one archive. */
  maxUnpackedBytes: 256 * MiB,
  /** One embedded image, bytes. */
  maxImageBytes: 32 * MiB,
  /** Archive entries (central directory records). */
  maxEntries: 10_000,
  /** Declared compression ratio above which an entry counts as a zip bomb (entries over 1 MiB). */
  maxRatio: 200,
  /** JSON nesting depth. */
  maxDepth: 256,
  /** Lottie layers, including those inside precompositions. */
  maxLottieLayers: 10_000,
  /** Keyframes over all animated properties. */
  maxKeyframes: 500_000,
  /** Blueprint layers emitted for the static weave (AdapterContext.maxLayers wins when smaller). */
  maxLayers: 1500,
  /** Longest animation, seconds. */
  maxDurationSeconds: 600,
  /** Largest composition side, px. */
  maxSide: 16_384,
  /** Highest frame rate accepted. */
  maxFrameRate: 240,
  /** Largest rendered frame (serialised SVG) handed to the SVG converter, characters. */
  maxFrameChars: 16 * MiB,
} as const;

/** Neutral colours from the brand sheet (contracts/brand.md). */
export const NEUTRALS = {
  ink: "#0B0B12",
  paper: "#FAFAFC",
  lineLight: "rgba(11,11,18,.12)",
  lineDark: "rgba(255,255,255,.14)",
} as const;
