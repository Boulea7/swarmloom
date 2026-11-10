/*
 * Types of the lottie-web source modules the adapter assembles its player from (the package ships
 * them untyped). Only the members used here are declared.
 */

declare module "lottie-web/player/js/animation/AnimationManager" {
  import type { AnimationConfigWithData, AnimationItem } from "lottie-web";
  const animationManager: { loadAnimation(params: AnimationConfigWithData<"svg">): AnimationItem };
  export default animationManager;
}

declare module "lottie-web/player/js/renderers/renderersManager" {
  export function registerRenderer(key: string, renderer: unknown): void;
}

declare module "lottie-web/player/js/renderers/SVGRenderer" {
  const SVGRenderer: unknown;
  export default SVGRenderer;
}

declare module "lottie-web/player/js/utils/shapes/ShapeModifiers" {
  export const ShapeModifiers: { registerModifier(key: string, modifier: unknown): void };
}

declare module "lottie-web/player/js/utils/shapes/TrimModifier" {
  const modifier: unknown;
  export default modifier;
}
declare module "lottie-web/player/js/utils/shapes/PuckerAndBloatModifier" {
  const modifier: unknown;
  export default modifier;
}
declare module "lottie-web/player/js/utils/shapes/RepeaterModifier" {
  const modifier: unknown;
  export default modifier;
}
declare module "lottie-web/player/js/utils/shapes/RoundCornersModifier" {
  const modifier: unknown;
  export default modifier;
}
declare module "lottie-web/player/js/utils/shapes/ZigZagModifier" {
  const modifier: unknown;
  export default modifier;
}
declare module "lottie-web/player/js/utils/shapes/OffsetPathModifier" {
  const modifier: unknown;
  export default modifier;
}
