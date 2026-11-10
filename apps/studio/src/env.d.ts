/// <reference types="vite/client" />

declare module "virtual:studio-examples" {
  /**
   * Examples manifest generated at build time from the repository's examples folder (empty in
   * extension builds). Typed as unknown on purpose: `sanitizeManifest` validates it.
   */
  const manifest: unknown;
  export default manifest;
}

/** Build target, set by vite.config.ts (`STUDIO_TARGET=extension` or `--mode extension`). */
declare const __STUDIO_TARGET__: "web" | "extension";
