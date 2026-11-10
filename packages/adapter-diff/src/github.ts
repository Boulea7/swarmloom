/**
 * GitHub pull request diffs, for the CLI only. Browsers cannot fetch github.com diffs (no CORS),
 * and the adapter never handles credentials: URLs carrying tokens or user info are refused, no
 * Authorization header is sent, and nothing is stored.
 */

const PULL =
  /^https:\/\/github\.com\/([A-Za-z0-9-]{1,39})\/([A-Za-z0-9._-]{1,100})\/pull\/(\d{1,9})(?:\/(?:files|commits))?(?:\.(?:diff|patch))?\/?$/;
const SECRET_PARAMS = /(?:^|&)(?:token|access_token|private_token|auth|key|sig|signature)=/i;

/** Owner, repository and number of a GitHub pull request URL. */
export interface PullRef {
  owner: string;
  repo: string;
  number: number;
}

/**
 * Recognises `https://github.com/<owner>/<repo>/pull/<n>` (optionally `/files`, `/commits`,
 * `.diff` or `.patch`). Returns null for anything else.
 *
 * @throws TypeError when the URL carries credentials (user info or token-like query parameters).
 */
export function parsePullUrl(url: string): PullRef | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.hostname !== "github.com" && u.hostname !== "www.github.com") return null;
  if (u.username || u.password)
    throw new TypeError("GitHub URLs with credentials are refused; tokens are never used or stored");
  if (SECRET_PARAMS.test(u.search.slice(1)))
    throw new TypeError("GitHub URLs with token parameters are refused; tokens are never used or stored");
  const m = PULL.exec(`https://github.com${u.pathname}`);
  if (!m) return null;
  return { owner: m[1] as string, repo: m[2] as string, number: Number(m[3]) };
}

/** The public `.diff` URL of a pull request URL, or null when `url` is not one. */
export function pullDiffUrl(url: string): string | null {
  const ref = parsePullUrl(url);
  return ref ? `https://github.com/${ref.owner}/${ref.repo}/pull/${ref.number}.diff` : null;
}

export interface FetchPullOptions {
  /** Fetch implementation (Node 18+ global fetch by default). */
  fetch?: typeof fetch;
  /** Reject larger diffs. Default 16 MiB. */
  maxBytes?: number;
  signal?: AbortSignal;
}

/**
 * Downloads the public diff of a pull request for the CLI. Anonymous request: no cookies, no
 * Authorization header. Private repositories are not supported.
 *
 * @returns The diff text and a file name (`<repo>-pr<n>.diff`).
 */
export async function fetchPullDiff(
  url: string,
  options: FetchPullOptions = {},
): Promise<{ text: string; name: string }> {
  const ref = parsePullUrl(url);
  if (!ref) throw new TypeError(`Not a GitHub pull request URL: ${url}`);
  const doFetch = options.fetch ?? globalThis.fetch;
  if (typeof doFetch !== "function") throw new TypeError("fetch is not available");
  const maxBytes = options.maxBytes ?? 16 * 1024 * 1024;
  const res = await doFetch(`https://github.com/${ref.owner}/${ref.repo}/pull/${ref.number}.diff`, {
    credentials: "omit",
    redirect: "follow",
    headers: { accept: "text/plain" },
    ...(options.signal ? { signal: options.signal } : {}),
  });
  if (!res.ok) throw new Error(`GitHub answered ${res.status} for pull request ${ref.owner}/${ref.repo}#${ref.number}`);
  const declared = Number(res.headers.get("content-length") ?? "0");
  if (declared > maxBytes) throw new RangeError(`The pull request diff is too large (${declared} bytes)`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.byteLength > maxBytes)
    throw new RangeError(`The pull request diff is too large (${bytes.byteLength} bytes)`);
  return { text: new TextDecoder("utf-8").decode(bytes), name: `${ref.repo}-pr${ref.number}.diff` };
}
