// Pulls the entry-file shims into every program that compiles this file from source (packages that
// resolve @swarmloom/adapter-pdf through the "@swarmloom/source" condition do not include them).
/// <reference path="./pdfjs-modules.d.ts" />

/**
 * Lazy pdf.js runtime: picks the modern or legacy build, starts one shared parser
 * worker per configuration and falls back to parsing on the main thread when no
 * worker can be started (blocked URL, CSP, bundler that did not emit the asset).
 *
 * Nothing from pdfjs-dist is imported until the first PDF is opened.
 */

import type * as PdfJsApi from "pdfjs-dist";
import type { ResolvedOptions } from "./options";

export type PdfJs = typeof PdfJsApi;
export type PdfWorker = InstanceType<PdfJs["PDFWorker"]>;

export interface PdfRuntime {
  pdfjs: PdfJs;
  worker: PdfWorker;
  build: "modern" | "legacy";
  /** True when parsing runs on the main thread. */
  mainThread: boolean;
}

/** pdf.js `VerbosityLevel.ERRORS`: keeps pdf.js warnings (missing fonts, recoverable syntax) out of the console. */
const VERBOSITY_ERRORS = 0;
const WORKER_START_TIMEOUT_MS = 15_000;

const runtimes = new Map<string, Promise<PdfRuntime>>();

/** True when the browser has the recent built-ins the modern pdf.js build calls without polyfills. */
export function supportsModernBuild(): boolean {
  const P = Promise as unknown as { withResolvers?: unknown; try?: unknown };
  const M = Math as unknown as { sumPrecise?: unknown };
  const MapProto = Map.prototype as unknown as { getOrInsertComputed?: unknown };
  const U8 = Uint8Array as unknown as { fromBase64?: unknown; prototype: { toBase64?: unknown; toHex?: unknown } };
  return [
    P.withResolvers,
    P.try,
    M.sumPrecise,
    MapProto.getOrInsertComputed,
    U8.fromBase64,
    U8.prototype.toBase64,
  ].every((f) => typeof f === "function");
}

/** True when `Promise.withResolvers` is the engine's own, so a worker started by this page has it too. */
function nativeWithResolvers(): boolean {
  const f = (Promise as unknown as { withResolvers?: unknown }).withResolvers;
  return typeof f === "function" && /\{\s*\[native code\]\s*\}\s*$/.test(Function.prototype.toString.call(f));
}

/**
 * Installs `Promise.withResolvers` (ES2024) when it is missing: the legacy pdf.js build polyfills
 * the other recent built-ins it calls, but not this one, which Chrome/Edge 116-118 and Safari before
 * 17.4 lack. Same semantics as the built-in (`this` is the promise constructor).
 */
function installWithResolvers(): void {
  if (typeof (Promise as unknown as { withResolvers?: unknown }).withResolvers === "function") return;
  Object.defineProperty(Promise, "withResolvers", {
    configurable: true,
    writable: true,
    value: function withResolvers<T>(this: PromiseConstructor | undefined) {
      let resolve!: (value: T | PromiseLike<T>) => void;
      let reject!: (reason?: unknown) => void;
      const promise = new (this ?? Promise)<T>((res, rej) => {
        resolve = res;
        reject = rej;
      });
      return { promise, resolve, reject };
    },
  });
}

function pickBuild(pref: ResolvedOptions["build"]): "modern" | "legacy" {
  if (pref !== "auto") return pref;
  return supportsModernBuild() ? "modern" : "legacy";
}

// Each import and URL below is a string literal so bundlers can see and emit it.

function importApi(build: "modern" | "legacy"): Promise<PdfJs> {
  return build === "legacy"
    ? (import("pdfjs-dist/legacy/build/pdf.mjs") as Promise<PdfJs>)
    : (import("pdfjs-dist/build/pdf.mjs") as Promise<PdfJs>);
}

/** Registers the worker module on the main thread (`globalThis.pdfjsWorker`), which pdf.js then uses in-process. */
function importWorkerModule(build: "modern" | "legacy"): Promise<unknown> {
  return build === "legacy"
    ? import("pdfjs-dist/legacy/build/pdf.worker.min.mjs")
    : import("pdfjs-dist/build/pdf.worker.min.mjs");
}

/** Bundler-resolved worker URL (Vite, webpack 5, Parcel); null where `import.meta.url` cannot locate it. */
function defaultWorkerUrl(build: "modern" | "legacy"): string | null {
  try {
    return build === "legacy"
      ? new URL("pdfjs-dist/legacy/build/pdf.worker.min.mjs", import.meta.url).href
      : new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).href;
  } catch {
    return null;
  }
}

/**
 * Starts a module worker and resolves once pdf.js inside it reports ready.
 * Rejects on load errors (404, CSP, syntax) or after a timeout, terminating the worker.
 */
function spawnWorker(src: string): Promise<Worker> {
  return new Promise<Worker>((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(src, { type: "module", name: "swarmloom-pdf" });
    } catch (error) {
      reject(error);
      return;
    }
    const fail = (reason: unknown) => {
      cleanup();
      worker.terminate();
      reject(reason instanceof Error ? reason : new Error(`PDF worker failed to start from ${src}`));
    };
    const onMessage = (e: MessageEvent) => {
      const msg = e.data as { action?: unknown } | null;
      if (msg?.action !== "ready") return;
      cleanup();
      resolve(worker);
    };
    const onError = (e: Event) => {
      e.preventDefault();
      fail((e as ErrorEvent).error);
    };
    const timer = setTimeout(() => fail(new Error("PDF worker start timed out")), WORKER_START_TIMEOUT_MS);
    const cleanup = () => {
      clearTimeout(timer);
      worker.removeEventListener("message", onMessage);
      worker.removeEventListener("error", onError);
    };
    worker.addEventListener("message", onMessage);
    worker.addEventListener("error", onError);
  });
}

async function startRuntime(o: ResolvedOptions): Promise<PdfRuntime> {
  const build = pickBuild(o.build);
  // A worker has the same built-ins as this page and no way to receive the polyfill: without a native
  // withResolvers the default worker cannot run pdf.js, so parsing stays on the main thread.
  const workerCanRun = nativeWithResolvers();
  if (build === "legacy") installWithResolvers();
  const pdfjs = await importApi(build);
  const verbosity = VERBOSITY_ERRORS;
  if (o.workerPort) {
    return { pdfjs, build, mainThread: false, worker: pdfjs.PDFWorker.create({ port: o.workerPort, verbosity }) };
  }
  const src = o.workerSrc ?? (workerCanRun ? defaultWorkerUrl(build) : null);
  if (!o.disableWorker && src && typeof Worker === "function") {
    const port = await spawnWorker(src).catch(() => null);
    // PDFWorker.create() binds one PDFWorker per port (the constructor typings omit the port parameter).
    if (port) return { pdfjs, build, mainThread: false, worker: pdfjs.PDFWorker.create({ port, verbosity }) };
  }
  await importWorkerModule(build);
  const worker = new pdfjs.PDFWorker({ verbosity });
  await worker.promise;
  return { pdfjs, build, mainThread: true, worker };
}

/**
 * Returns the shared runtime for these options, starting it on first use.
 * The worker stays alive for later loads (documents are destroyed after each load).
 * A failed start is not cached, so the next load retries.
 */
export function getRuntime(o: ResolvedOptions): Promise<PdfRuntime> {
  if (o.workerPort) return startRuntime(o);
  const key = `${pickBuild(o.build)}|${o.disableWorker ? "main" : (o.workerSrc ?? "default")}`;
  let runtime = runtimes.get(key);
  if (!runtime) {
    runtime = startRuntime(o);
    runtimes.set(key, runtime);
    runtime.catch(() => runtimes.delete(key));
  }
  return runtime;
}

export { VERBOSITY_ERRORS };
