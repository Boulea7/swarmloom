/**
 * Asset import queries understood by Vite and by this package's tsup build (see tsup.config.ts):
 * `?raw` imports a file as a string, `?inline` as a base64 data URL.
 */
declare module "*?raw" {
  const text: string;
  export default text;
}

declare module "*?inline" {
  const dataUrl: string;
  export default dataUrl;
}
