// Type shims for pdfjs-dist entry files that ship without their own declarations.
// The modern and legacy builds expose the same API as the package root.

declare module "pdfjs-dist/build/pdf.mjs" {
  export * from "pdfjs-dist";
}

declare module "pdfjs-dist/legacy/build/pdf.mjs" {
  export * from "pdfjs-dist";
}

declare module "pdfjs-dist/build/pdf.worker.min.mjs" {
  export const WorkerMessageHandler: unknown;
}

declare module "pdfjs-dist/legacy/build/pdf.worker.min.mjs" {
  export const WorkerMessageHandler: unknown;
}
