import type { AnimationConfigWithData, AnimationItem } from "lottie-web";

/** The part of lottie-web the adapter uses. */
export interface LottieRuntime {
  loadAnimation(params: AnimationConfigWithData<"svg">): AnimationItem;
}

let runtime: Promise<LottieRuntime> | null = null;

/**
 * Assembles lottie-web's light SVG player from its source modules, on first use.
 *
 * This is what `lottie-web/build/player/lottie_light` contains (SVG renderer and shape modifiers,
 * no expressions, no `eval`) minus its `main` module, whose import side effects SwarmLoom must
 * not have on a host page: a 100 ms poll that loads every `.lottie` / `.bodymovin` element of the
 * document (including remote `data-animation-path` files) and a `window.bodymovin` global.
 * Nothing here starts a clock: animations are only ever moved with `goToAndStop`.
 */
export function loadRuntime(): Promise<LottieRuntime> {
  runtime ??= (async () => {
    const [manager, renderers, svg, modifiers, trim, pucker, repeater, round, zigzag, offset] = await Promise.all([
      import("lottie-web/player/js/animation/AnimationManager"),
      import("lottie-web/player/js/renderers/renderersManager"),
      import("lottie-web/player/js/renderers/SVGRenderer"),
      import("lottie-web/player/js/utils/shapes/ShapeModifiers"),
      import("lottie-web/player/js/utils/shapes/TrimModifier"),
      import("lottie-web/player/js/utils/shapes/PuckerAndBloatModifier"),
      import("lottie-web/player/js/utils/shapes/RepeaterModifier"),
      import("lottie-web/player/js/utils/shapes/RoundCornersModifier"),
      import("lottie-web/player/js/utils/shapes/ZigZagModifier"),
      import("lottie-web/player/js/utils/shapes/OffsetPathModifier"),
    ]);
    renderers.registerRenderer("svg", svg.default);
    const register = modifiers.ShapeModifiers.registerModifier;
    register("tm", trim.default);
    register("pb", pucker.default);
    register("rp", repeater.default);
    register("rd", round.default);
    register("zz", zigzag.default);
    register("op", offset.default);
    return { loadAnimation: (params) => manager.default.loadAnimation(params) };
  })().catch((err: unknown) => {
    runtime = null;
    throw err;
  });
  return runtime;
}
