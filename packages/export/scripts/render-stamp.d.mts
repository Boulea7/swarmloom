/** Where the stamp lives, relative to the package: beside dist/render, so it never ships. */
export declare const STAMP: string;
/** Writes the stamp of `files` (absolute paths; unreadable ones are left out) for the package at `pkgDir`. */
export declare function writeStamp(pkgDir: string, files: Iterable<string>): Promise<void>;
/** Stamped files that changed or are gone since the render page was built, or `[STAMP]` when it has no stamp. */
export declare function staleFiles(pkgDir: string): Promise<string[]>;
