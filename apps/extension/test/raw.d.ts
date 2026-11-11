/** Vite `?raw` imports: the browser tests load the extension pages and their styles as strings. */
declare module "*?raw" {
  const text: string;
  export default text;
}
