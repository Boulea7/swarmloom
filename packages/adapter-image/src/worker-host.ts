import { type Analysis, type AnalyzeOptions, createKernel, type Kernel } from "./kernel";

/** How the pixel analysis ran. */
export type AnalysisMode = "worker" | "sync";

interface WorkerRequest {
  id: number;
  rgba: Uint8ClampedArray;
  width: number;
  height: number;
  opts: AnalyzeOptions;
}

type WorkerResponse = { id: number; ok: true; result: Analysis } | { id: number; ok: false; error: string };

/** Worker source: the self-contained kernel plus a message loop. */
function workerSource(): string {
  return `"use strict";
const kernel = (${createKernel.toString()})();
self.onmessage = (event) => {
  const req = event.data;
  try {
    const result = kernel.analyze(req.rgba, req.width, req.height, req.opts);
    self.postMessage({ id: req.id, ok: true, result });
  } catch (error) {
    self.postMessage({ id: req.id, ok: false, error: String(error && error.message || error) });
  }
};`;
}

let syncKernel: Kernel | null = null;
let sharedUrl: string | null = null;
let nextId = 1;

function kernel(): Kernel {
  syncKernel ??= createKernel();
  return syncKernel;
}

function workerUrl(): string | null {
  if (sharedUrl) return sharedUrl;
  if (typeof Worker === "undefined" || typeof Blob === "undefined" || typeof URL?.createObjectURL !== "function") {
    return null;
  }
  sharedUrl = URL.createObjectURL(new Blob([workerSource()], { type: "text/javascript" }));
  return sharedUrl;
}

function runInWorker(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  opts: AnalyzeOptions,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<Analysis> {
  const url = workerUrl();
  if (!url) return Promise.reject(new Error("Web Workers are not available"));
  return new Promise<Analysis>((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(url);
    } catch (error) {
      // CSP or an embedding context that forbids blob: workers.
      reject(error);
      return;
    }
    const id = nextId++;
    const done = (fn: () => void): void => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      worker.terminate();
      fn();
    };
    const onAbort = (): void => done(() => reject(signal?.reason ?? new DOMException("Aborted", "AbortError")));
    const timer = setTimeout(() => done(() => reject(new Error("Image analysis worker timed out"))), timeoutMs);
    signal?.addEventListener("abort", onAbort, { once: true });
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const res = event.data;
      if (res.id !== id) return;
      done(() => (res.ok ? resolve(res.result) : reject(new Error(res.error))));
    };
    worker.onerror = (event) => {
      event.preventDefault();
      done(() => reject(new Error(event.message || "Image analysis worker failed")));
    };
    // The pixels are a private copy, so the buffer can be transferred instead of cloned.
    const req: WorkerRequest = { id, rgba, width, height, opts };
    worker.postMessage(req, [rgba.buffer]);
  });
}

export interface RunOptions {
  /** Try a Web Worker first (default true). */
  worker: boolean;
  timeoutMs: number;
  signal?: AbortSignal;
}

/**
 * Runs the pixel analysis in a Web Worker when possible, otherwise (or when the worker cannot be
 * created, fails or times out) on the calling thread. Both paths run the same kernel code.
 */
export async function analyzePixels(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  opts: AnalyzeOptions,
  run: RunOptions,
): Promise<{ analysis: Analysis; mode: AnalysisMode }> {
  if (run.worker) {
    // Keep a copy: a transferred buffer is gone if the worker path fails.
    const copy = rgba.slice();
    try {
      return { analysis: await runInWorker(copy, width, height, opts, run.timeoutMs, run.signal), mode: "worker" };
    } catch (error) {
      if (run.signal?.aborted) throw error;
    }
  }
  return { analysis: kernel().analyze(rgba, width, height, opts), mode: "sync" };
}
