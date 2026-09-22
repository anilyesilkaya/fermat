/**
 * Ambient module declarations for non-TS imports that the bundler resolves at
 * build time (Vite handles these; tsc only needs to know they exist).
 */

/** CSS side-effect imports, e.g. `import 'katex/dist/katex.min.css'`. */
declare module '*.css';

/** Vite `?url` asset imports resolve to a string URL. */
declare module '*?url' {
  const url: string;
  export default url;
}

/** Vite `?worker` imports resolve to a Worker constructor. */
declare module '*?worker' {
  const workerConstructor: new () => Worker;
  export default workerConstructor;
}
