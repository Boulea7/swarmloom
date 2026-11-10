import { defaultClientConditions, defineConfig } from "vite";

// GitHub Pages serves Studio under /swarmloom/studio/; local dev and previews use "/".
const base = process.env.SWARMLOOM_STUDIO_BASE || "/";

export default defineConfig({
  base,
  resolve: {
    // Resolve workspace packages from source so Studio never needs prebuilt dist/ folders.
    conditions: ["@swarmloom/source", ...defaultClientConditions],
  },
  build: {
    target: "es2022",
  },
});
