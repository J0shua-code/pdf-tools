/*
 * Emscripten pre-js: runs before the module is initialised.
 *
 * Use this file to inject small JavaScript helpers or to set default
 * module properties that must be present before the WASM binary loads.
 */

// Ensure the module object exists even if the consumer does not provide one.
if (typeof Module === 'undefined') {
  var Module = {};
}

// Allow the host page or worker to set the locateFile callback to resolve
// the .wasm path relative to the worker/script location.
if (typeof Module.locateFile === 'undefined') {
  Module.locateFile = function(filename) {
    if (typeof __dirname !== 'undefined') {
      return __dirname + '/' + filename;
    }
    return filename;
  };
}
