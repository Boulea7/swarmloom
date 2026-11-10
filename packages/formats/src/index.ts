/**
 * @swarmloom/formats: format detection and a lazy adapter registry.
 *
 * The registry holds only metadata and `import()` thunks, so importing this module is cheap; each
 * adapter (and its heavy dependencies such as pdf.js or three) is fetched the first time a file of
 * that type is opened.
 */

export { detect, type Inspection, inspect } from "./detect";
export { SourceError, type SourceErrorCode } from "./errors";
export { DEFAULT_MAX_BYTES, type FetchSourceOptions, fetchSource } from "./fetch";
export { type LoadOptions, load } from "./load";
export { createRegistry, FORMAT_META, type FormatEntry, type FormatMeta } from "./meta";
export { formats } from "./registry";
