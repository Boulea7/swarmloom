/**
 * @swarmloom/adapter-lottie: Lottie JSON and dotLottie animations woven as a static pose, then
 * played for real from the engine clock after a keyframe-timeline choreography.
 *
 * Also home of the format-neutral `anim:timeline` plugin and `collectKeyframes()`, which HTML and
 * SVG content can reuse for their CSS and SMIL animations.
 */
export {
  createLottieAdapter,
  type LottieAdapterOptions,
  type LottieLoadedSource,
  lottieAdapter,
  lottieAdapter as default,
} from "./adapter";
export { LOTTIE_ADAPTER_ID, LOTTIE_PLUGIN, PLAYER_TASK } from "./constants";
export { type DotLottieContent, type DotLottieOptions, unpackDotLottie } from "./dotlottie";
export { LottieError, type LottieErrorCode } from "./errors";
export type { LottieInfo, LottieStats, ParsedLottie, ParseLottieOptions } from "./lottie/model";
export { parseLottie } from "./lottie/validate";
export type { LottiePlayerData } from "./player/data";
export { createLottiePlugin, type LottiePluginOptions } from "./player/plugin";
export type { PoseChoice } from "./render/pose";
export { looksLikeDotLottie, looksLikeLottieText, sniffLottie } from "./sniff";
export { type CollectedKeyframes, type CollectKeyframesOptions, collectKeyframes } from "./timeline/collect";
export { type AnimTimelineData, TIMELINE_PLUGIN, TIMELINE_TASK } from "./timeline/data";
export { createAnimTimelinePlugin } from "./timeline/plugin";
export { type AnimTarget, animTargetOf, registerAnimTarget } from "./timeline/target";
