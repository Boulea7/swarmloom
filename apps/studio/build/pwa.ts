import { createHash } from "node:crypto";
import { existsSync, readFileSync, renameSync } from "node:fs";
import { resolve } from "node:path";
import { build, type Plugin } from "vite";
import { FORMAT_META, type FormatMeta } from "../src/formats-meta";
import { markSvg } from "../src/ui/mark";
import { markPng } from "./icons";

/** Build target: the hosted PWA or the page bundled inside the browser extension. */
export type StudioTarget = "web" | "extension";

export interface PwaOptions {
  target: StudioTarget;
  /** Absolute path of the service worker source (src/sw/sw.ts). */
  swEntry: string;
}

/** File name of the Studio page in extension builds (integration-notes 4). */
export const EXTENSION_PAGE = "studio.html";

const ICONS = [
  { src: "icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any", size: 192, maskable: false },
  { src: "icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any", size: 512, maskable: false },
  {
    src: "icons/maskable-512.png",
    sizes: "512x512",
    type: "image/png",
    purpose: "maskable",
    size: 512,
    maskable: true,
  },
] as const;
const APPLE_ICON = { src: "icons/apple-touch-icon.png", size: 180 } as const;
const FAVICON = "favicon.svg";
const MANIFEST = "manifest.webmanifest";

/**
 * `accept` map for `file_handlers`: every MIME type of `formats`, with its extensions. The manifest
 * belongs to Studio's own build, which bundles the default `@swarmloom/formats` registry, so it
 * lists optional formats that registry provides (Lottie) as well; test/pwa.test.ts fails when it
 * lists a format the registry lacks or misses an extension Studio opens.
 */
export function fileHandlerAccept(formats: readonly FormatMeta[] = FORMAT_META): Record<string, string[]> {
  const accept: Record<string, string[]> = {};
  for (const meta of formats) {
    for (const [mime, extensions] of Object.entries(meta.handlers)) {
      accept[mime] = [...new Set([...(accept[mime] ?? []), ...extensions])];
    }
  }
  return accept;
}

/** The web app manifest: installable, a share target for files and text, and an OS file handler. */
export function webManifest(): Record<string, unknown> {
  const accept = fileHandlerAccept();
  return {
    id: "./",
    name: "SwarmLoom Studio",
    short_name: "SwarmLoom",
    description: "Open any file or web page and watch a swarm of cursors build it, then export the video.",
    lang: "zh-CN",
    dir: "ltr",
    start_url: "./",
    scope: "./",
    display: "standalone",
    background_color: "#fafafc",
    theme_color: "#fafafc",
    categories: ["productivity", "graphics", "education"],
    icons: ICONS.map(({ src, sizes, type, purpose }) => ({ src, sizes, type, purpose })),
    share_target: {
      action: "share-target",
      method: "POST",
      enctype: "multipart/form-data",
      params: {
        title: "title",
        text: "text",
        url: "url",
        files: [{ name: "file", accept: [...Object.keys(accept), ...new Set(Object.values(accept).flat())] }],
      },
    },
    file_handlers: [{ action: "./?launch=1", accept, launch_type: "single-client" }],
    launch_handler: { client_mode: ["navigate-existing", "auto"] },
  };
}

interface ChunkLike {
  type: "chunk" | "asset";
  fileName: string;
  isEntry?: boolean;
  isDynamicEntry?: boolean;
  code?: string;
  moduleIds?: readonly string[];
  imports?: readonly string[];
  viteMetadata?: { importedCss?: Set<string>; importedAssets?: Set<string> };
}

/**
 * The app shell to precache: the page, entry chunks and everything they import statically, their
 * CSS, icons and the manifest. Lazy chunks (adapters) go to the asset cache (see warmFiles).
 */
export function shellFiles(bundle: Record<string, ChunkLike>): string[] {
  const shell = new Set<string>(["./", FAVICON, MANIFEST, ...ICONS.map((i) => i.src)]);
  const visit = (name: string) => {
    const item = bundle[name];
    if (item?.type !== "chunk" || shell.has(name)) return;
    shell.add(name);
    for (const css of item.viteMetadata?.importedCss ?? []) shell.add(css);
    for (const asset of item.viteMetadata?.importedAssets ?? []) shell.add(asset);
    for (const dep of item.imports ?? []) visit(dep);
  };
  for (const item of Object.values(bundle)) if (item.type === "chunk" && item.isEntry) visit(item.fileName);
  return [...shell].sort();
}

/** Largest lazy chunk warmed at install; bigger ones (pdf.js workers) are cached on first use. */
export const WARM_MAX_BYTES = 512 * 1024;

/** A chunk small enough to warm and not part of a legacy build (old browsers only). */
function warmable(item: ChunkLike): boolean {
  return (item.code?.length ?? 0) <= WARM_MAX_BYTES && !(item.moduleIds ?? []).some((id) => id.includes("/legacy/"));
}

/**
 * Lazy chunks the worker fetches ahead at install so every format opens offline: each adapter or
 * locale entry together with everything it imports statically and their CSS, since the dynamic
 * import fails offline if any of them is missing. An entry is warmed whole or not at all: when a
 * chunk it needs is legacy or over WARM_MAX_BYTES, the entry is left to the runtime cache too.
 */
export function warmFiles(bundle: Record<string, ChunkLike>, shell: readonly string[]): string[] {
  const skip = new Set(shell);
  /** The entry with its static imports and CSS outside the shell, or null if one is not warmable. */
  const closure = (entry: string): Set<string> | null => {
    const files = new Set<string>();
    const pending = [entry];
    for (let name = pending.pop(); name !== undefined; name = pending.pop()) {
      const item = bundle[name];
      if (item?.type !== "chunk" || skip.has(name) || files.has(name)) continue;
      if (!warmable(item)) return null;
      files.add(name);
      for (const css of item.viteMetadata?.importedCss ?? []) if (!skip.has(css)) files.add(css);
      pending.push(...(item.imports ?? []));
    }
    return files;
  };
  const warm = new Set<string>();
  for (const item of Object.values(bundle)) {
    if (item.type !== "chunk" || item.isDynamicEntry !== true) continue;
    for (const name of closure(item.fileName) ?? []) warm.add(name);
  }
  return [...warm].sort();
}

/**
 * Release id the worker's cache names carry: a hash of every file it caches, by path and bytes
 * (`./` is the page, index.html). The page, manifest and icons keep their names between releases,
 * so a change to only one of them must still change the worker script, or browsers keep serving
 * the old shell. Throws when a listed file is missing from `outDir`.
 */
export function releaseVersion(outDir: string, files: readonly string[]): string {
  const hash = createHash("sha256");
  for (const file of [...new Set(files)].sort()) {
    hash.update(`${file}\0`);
    hash.update(readFileSync(resolve(outDir, file === "./" ? "index.html" : file)));
    hash.update("\0");
  }
  return hash.digest("hex").slice(0, 12);
}

/**
 * Studio's PWA plumbing: favicon and icons rasterized from the mark, the web manifest, the service
 * worker (bundled separately as a classic `sw.js` with the precache list injected), and the
 * extension variant (relative base, `studio.html`, no worker, no manifest).
 */
export function pwaPlugin(options: PwaOptions): Plugin {
  const web = options.target === "web";
  let base = "/";
  let outDir = "dist";
  let root = process.cwd();
  let precache: string[] = [];
  let warmList: string[] = [];
  let assets: string[] = [];

  return {
    name: "swarmloom-studio-pwa",
    enforce: "post",
    configResolved(config) {
      base = config.base;
      root = config.root;
      outDir = resolve(config.root, config.build.outDir);
    },
    configureServer(server) {
      const prefix = base.replace(/\/?$/, "/");
      server.middlewares.use((req, res, next) => {
        const url = req.url?.split("?")[0] ?? "";
        if (url === `${prefix}${FAVICON}`) {
          res.setHeader("Content-Type", "image/svg+xml");
          res.end(markSvg());
          return;
        }
        next();
      });
    },
    transformIndexHtml() {
      const tags: { tag: string; attrs: Record<string, string>; injectTo: "head" }[] = [
        { tag: "link", attrs: { rel: "icon", type: "image/svg+xml", href: `${base}${FAVICON}` }, injectTo: "head" },
      ];
      if (web) {
        tags.push(
          { tag: "link", attrs: { rel: "manifest", href: `${base}${MANIFEST}` }, injectTo: "head" },
          { tag: "link", attrs: { rel: "apple-touch-icon", href: `${base}${APPLE_ICON.src}` }, injectTo: "head" },
        );
      }
      return tags;
    },
    generateBundle(_output, bundle) {
      this.emitFile({ type: "asset", fileName: FAVICON, source: markSvg() });
      if (!web) return;
      for (const icon of ICONS)
        this.emitFile({ type: "asset", fileName: icon.src, source: markPng(icon.size, { maskable: icon.maskable }) });
      this.emitFile({ type: "asset", fileName: APPLE_ICON.src, source: markPng(APPLE_ICON.size, { maskable: true }) });
      this.emitFile({ type: "asset", fileName: MANIFEST, source: `${JSON.stringify(webManifest(), null, 2)}\n` });
      const items = bundle as unknown as Record<string, ChunkLike>;
      precache = shellFiles(items);
      warmList = warmFiles(items, precache);
      assets = Object.keys(items)
        .filter((name) => name.startsWith("assets/"))
        .sort();
    },
    async closeBundle() {
      if (!web) {
        const page = resolve(outDir, "index.html");
        if (existsSync(page)) renameSync(page, resolve(outDir, EXTENSION_PAGE));
        return;
      }
      const version = releaseVersion(outDir, [...precache, ...warmList, ...assets]);
      await build({
        configFile: false,
        root,
        logLevel: "warn",
        publicDir: false,
        define: {
          __PRECACHE__: JSON.stringify(precache),
          __WARM__: JSON.stringify(warmList),
          __ASSETS__: JSON.stringify(assets),
          __VERSION__: JSON.stringify(version),
        },
        build: {
          outDir,
          emptyOutDir: false,
          copyPublicDir: false,
          target: "es2022",
          minify: true,
          lib: { entry: options.swEntry, formats: ["iife"], name: "SwarmLoomStudioWorker", fileName: () => "sw.js" },
        },
      });
    },
  };
}
