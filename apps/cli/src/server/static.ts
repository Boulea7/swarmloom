import { createReadStream, type Stats } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".wasm": "application/wasm",
  ".pdf": "application/pdf",
  ".glb": "model/gltf-binary",
  ".gltf": "model/gltf+json",
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
};

/** Content-Type for a file name; unknown types are served as binary. */
export function contentType(file: string): string {
  return MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream";
}

export interface StaticServerOptions {
  /** Directory to serve under `base`. Nothing outside it is ever readable. Omit to serve only `files` and `mounts`. */
  root?: string;
  /** Interface to bind. Default 127.0.0.1 (loopback only). */
  host?: string;
  /** Port; 0 picks a free one. */
  port?: number;
  /** URL path prefix the files are mounted at, e.g. "/swarmloom/studio/". Default "/". "/" redirects to it. */
  base?: string;
  /** File (relative to root) served for unknown extension-less paths, for single-page apps. */
  fallback?: string;
  /**
   * Extra files outside `root`, keyed by their exact URL path (e.g. "/input/deck.pptx"): a file path
   * to stream or the bytes themselves. Nothing else from their directories is exposed.
   */
  files?: ReadonlyMap<string, string | Uint8Array>;
  /** Extra directories, each published under its own URL prefix and limited to the files it accepts. */
  mounts?: readonly StaticMount[];
  /** Extra headers on every file response, e.g. a Content-Security-Policy for served pages. */
  headers?: Readonly<Record<string, string>>;
}

/** A directory outside `root` published read-only under `prefix` (no listings, no index files). */
export interface StaticMount {
  /** URL path prefix starting and ending with "/", e.g. "/input/x7Q/". */
  prefix: string;
  dir: string;
  /** Absolute file path filter; files it rejects answer 404. */
  accept(file: string): boolean;
}

export interface StaticServer {
  /** Origin plus base, ending with "/", e.g. "http://127.0.0.1:41234/". */
  readonly url: string;
  readonly port: number;
  close(): Promise<void>;
}

/**
 * Maps a request path to a file under `root`.
 * @returns The absolute file path, or null when the path is malformed or escapes `root`.
 */
export function resolveRequestPath(root: string, base: string, urlPath: string): string | null {
  if (!urlPath.startsWith(base)) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath.slice(base.length));
  } catch {
    return null;
  }
  if (decoded.includes("\0")) return null;
  const absoluteRoot = path.resolve(root);
  const file = path.resolve(absoluteRoot, `.${path.posix.sep}${decoded}`);
  const inside = file === absoluteRoot || file.startsWith(absoluteRoot + path.sep);
  return inside ? file : null;
}

function normalizeBase(base = "/"): string {
  let value = base.startsWith("/") ? base : `/${base}`;
  if (!value.endsWith("/")) value += "/";
  return value;
}

async function fileStats(file: string): Promise<Stats | null> {
  try {
    return await stat(file);
  } catch {
    return null;
  }
}

const HEADERS = { "Cache-Control": "no-cache", "X-Content-Type-Options": "nosniff" } as const;

type Headers = Readonly<Record<string, string>>;

async function sendExtra(
  req: IncomingMessage,
  res: ServerResponse,
  urlPath: string,
  body: string | Uint8Array,
  headers: Headers,
) {
  const size = typeof body === "string" ? (await fileStats(body))?.size : body.byteLength;
  if (size === undefined) {
    res.writeHead(404).end("Not found");
    return;
  }
  res.writeHead(200, { ...headers, "Content-Type": contentType(urlPath), "Content-Length": size });
  if (req.method === "HEAD") res.end();
  else if (typeof body === "string") streamFile(body, res);
  else res.end(body);
}

/** True when a URL path has a segment starting with "." (dotfiles, ".."), which mounts never serve. */
function hasDotSegment(relative: string): boolean {
  return relative.split(/[\\/]/).some((segment) => segment.startsWith("."));
}

async function sendMounted(
  req: IncomingMessage,
  res: ServerResponse,
  mount: StaticMount,
  urlPath: string,
  headers: Headers,
) {
  const file = resolveRequestPath(mount.dir, mount.prefix, urlPath);
  const relative = file ? path.relative(path.resolve(mount.dir), file) : "";
  const stats = file && !hasDotSegment(relative) && mount.accept(file) ? await fileStats(file) : null;
  if (!file || !stats?.isFile()) {
    res.writeHead(404).end("Not found");
    return;
  }
  res.writeHead(200, { ...headers, "Content-Type": contentType(file), "Content-Length": stats.size });
  if (req.method === "HEAD") res.end();
  else streamFile(file, res);
}

function streamFile(file: string, res: ServerResponse): void {
  const stream = createReadStream(file);
  stream.on("error", () => res.destroy());
  stream.pipe(res);
}

/**
 * Starts a read-only static file server (GET/HEAD only, no directory listings, no caching).
 *
 * @throws Error from `listen` (for example EADDRINUSE) so callers can report it.
 */
export async function startStaticServer(opts: StaticServerOptions): Promise<StaticServer> {
  const root = opts.root === undefined ? undefined : path.resolve(opts.root);
  const base = normalizeBase(opts.base);
  const host = opts.host ?? "127.0.0.1";
  const headers: Headers = { ...HEADERS, ...opts.headers };

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, { Allow: "GET, HEAD" }).end();
      return;
    }
    const urlPath = new URL(req.url ?? "/", "http://localhost").pathname;
    const extra = opts.files?.get(urlPath);
    if (extra !== undefined) {
      await sendExtra(req, res, urlPath, extra, headers);
      return;
    }
    const mount = opts.mounts?.find((m) => urlPath.startsWith(m.prefix));
    if (mount) {
      await sendMounted(req, res, mount, urlPath, headers);
      return;
    }
    if (base !== "/" && (urlPath === "/" || urlPath === base.slice(0, -1))) {
      res.writeHead(302, { Location: base }).end();
      return;
    }
    let file = root ? resolveRequestPath(root, base, urlPath) : null;
    if (!root || !file) {
      res.writeHead(404).end("Not found");
      return;
    }
    let stats = await fileStats(file);
    if (stats?.isDirectory()) {
      file = path.join(file, "index.html");
      stats = await fileStats(file);
    }
    if (!stats?.isFile() && opts.fallback && path.extname(urlPath) === "") {
      file = path.join(root, opts.fallback);
      stats = await fileStats(file);
    }
    if (!stats?.isFile()) {
      res.writeHead(404).end("Not found");
      return;
    }
    res.writeHead(200, { ...headers, "Content-Type": contentType(file), "Content-Length": stats.size });
    if (req.method === "HEAD") res.end();
    else streamFile(file, res);
  }

  const server = createServer((req, res) => {
    handle(req, res).catch(() => {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port ?? 0, host, () => {
      server.off("error", reject);
      resolve();
    });
  });
  const { port } = server.address() as AddressInfo;
  const shownHost = host.includes(":") ? `[${host}]` : host;
  return {
    url: `http://${shownHost}:${port}${base}`,
    port,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}
