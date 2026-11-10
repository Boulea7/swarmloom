/** Vite `?raw` imports: the browser tests load the examples as strings. */
declare module "*?raw" {
  const text: string;
  export default text;
}
