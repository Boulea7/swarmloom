import type { AdapterContext, SourceInput } from "@swarmloom/core";

/** Validates the adapter context the contract requires. */
export function checkContext(ctx: AdapterContext, what: string): void {
  if (!ctx || typeof ctx !== "object" || !ctx.document)
    throw new TypeError(`${what}: AdapterContext with a document is required`);
  if (!Number.isFinite(ctx.width) || ctx.width <= 0)
    throw new RangeError(`${what}: ctx.width must be positive, got ${ctx.width}`);
}

/** The file name without directories, from `input.name` or the URL path. */
export function baseName(input: SourceInput): string | undefined {
  let name = input.name;
  if (!name && input.url && !/^(?:data|blob):/i.test(input.url)) {
    try {
      name = decodeURIComponent(new URL(input.url, "http://x.invalid/").pathname);
    } catch {
      name = undefined;
    }
  }
  const base = name?.split(/[\\/]/).pop();
  return base || undefined;
}
