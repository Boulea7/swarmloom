/** Timing and size of a Lottie composition. */
export interface LottieInfo {
  /** Bodymovin version that wrote the file, e.g. "5.12.0". */
  version: string;
  /** Composition name (`nm`), when present. */
  name?: string;
  /** Frames per second (`fr`). */
  fr: number;
  /** In point, frames (`ip`). */
  ip: number;
  /** Out point, frames (`op`, exclusive). */
  op: number;
  /** Composition size, px. */
  w: number;
  h: number;
  /** Number of frames in one cycle (`op - ip`). */
  frames: number;
  /** Length of one cycle, ms. */
  duration: number;
}

/** Counts gathered while validating, for notes and tests. */
export interface LottieStats {
  /** Layers, including those inside precompositions. */
  layers: number;
  /** Precomposition assets. */
  precomps: number;
  /** Image assets kept. */
  images: number;
  /** Text layers. */
  texts: number;
  /** Keyframes over all animated properties. */
  keyframes: number;
  /** Expressions removed. */
  expressions: number;
}

/** A validated and sanitised Lottie animation. */
export interface ParsedLottie {
  info: LottieInfo;
  /**
   * Sanitised animation as JSON text. This is what blueprints store and what lottie-web receives;
   * lottie-web mutates the object it is given, so every player parses its own copy.
   */
  json: string;
  /**
   * Times of keyframes in composition frames, sorted, unique and within [ip, op]. Falls back to
   * layer in/out points when nothing is keyframed.
   */
  keyTimes: number[];
  stats: LottieStats;
  /** Human-readable notes about features that were removed or approximated. */
  notes: string[];
}

/** Options of {@link parseLottie}. */
export interface ParseLottieOptions {
  /** Largest JSON text accepted, bytes. Default 50 MiB. */
  maxBytes?: number;
  /** Deepest JSON nesting accepted. Default 256. */
  maxDepth?: number;
  /** Most layers accepted (precompositions included). Default 10 000. */
  maxLottieLayers?: number;
  /** Most keyframes accepted. Default 500 000. */
  maxKeyframes?: number;
  /** Largest embedded image, bytes. Default 32 MiB. */
  maxImageBytes?: number;
  /**
   * Resolves a non-embedded image asset path (`u + p`) to a data URL, e.g. from a dotLottie
   * archive. Unresolved images that are not embedded (data:image/*) are left out with a note.
   */
  resolveImage?: (path: string) => string | undefined;
}
