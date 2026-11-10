import { defineConfig } from "vitest/config";

// The brand zone is not a workspace package, so the root projects (packages/*, apps/*) do not see its
// tests. Run them with: pnpm exec vitest run --config assets/brand/vitest.config.ts --project unit
export default defineConfig({
  test: {
    name: "unit",
    root: import.meta.dirname,
    include: ["test/**/*.test.ts"],
    environment: "node",
  },
});
