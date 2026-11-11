import { expect, it } from "vitest";
import { WATCH_QUERY, watchViewport } from "../src/layout/viewport";

it.each([
  ["a watch screen", { width: 320, height: 390 }, true],
  ["a narrow window on a phone screen", { width: 412, height: 915 }, false],
  ["a narrow window on a desktop screen", { width: 1920, height: 1080 }, false],
  ["an unknown screen", { width: 0, height: 0 }, false],
])("takes a 320 x 400 window on %s for a watch: %s", (_label, screen, watch) => {
  const win = {
    screen,
    navigator: {},
    matchMedia: (query: string) => ({
      matches: query === WATCH_QUERY,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }),
  } as unknown as Window;
  const viewport = watchViewport(win, document.createElement("div"));
  expect(viewport.state.watch).toBe(watch);
  viewport.destroy();
});
