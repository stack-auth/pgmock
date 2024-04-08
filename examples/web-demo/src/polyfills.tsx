export function applyPolyfills() {
  console.log("Applying polyfills...");

  /**
   * The `node-postgres` module uses `Error.captureStackTrace`, which isn't supported on all modules. This is a polyfill for that.
   * 
   * constructorOpt is not supported by this polyfill.
   */
  Error.captureStackTrace ||= (error: Error, constructorOpt?: any) => {
    error.stack = new Error().stack;
  };
}
