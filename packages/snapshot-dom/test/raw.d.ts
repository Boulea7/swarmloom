/** Vite `?raw` imports: the file content as a string (used to load examples/web/demo.html). */
declare module "*.html?raw" {
  const content: string;
  export default content;
}
