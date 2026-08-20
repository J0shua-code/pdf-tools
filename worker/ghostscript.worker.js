/*
 * Web Worker that loads the Ghostscript WASM module and compresses PDFs.
 *
 * Message protocol (main thread -> worker):
 *   {
 *     type: "compress",
 *     id:    "<job-id>",
 *     file:  ArrayBuffer,              // the PDF bytes
 *     options: { preset: "balanced" }  // one of GSPresets.PRESET_NAMES
 *   }
 *
 *   Legacy field `input` (Uint8Array) is also accepted for backwards
 *   compatibility with earlier versions.
 *
 * Response (worker -> main thread):
 *   { type: "ready", ... }                      after the WASM module loads
 *   { type: "progress", id, stage, message }    meaningful stages, no fake %
 *   { type: "result", id, success, ... }        final result (see below)
 *   { type: "recycle", id }                     main thread should terminate us
 *   { type: "error", id, error }
 *
 * Progress stages (never a fake percentage):
 *   loading -> initializing -> writing-input -> processing -> reading-output -> complete
 *
 * Result payload (success = true):
 *   bytes:             Uint8Array (the compressed PDF)
 *   originalSize:      number
 *   compressedSize:    number
 *   compressionRatio:  0..1 fraction saved (1 - compressed/original)
 *   processingTimeMs:  number
 *   heapBytesAfter:    number (WASM heap size after the job, informational)
 *
 * Error codes: INVALID_FILE (bad payload), EMPTY_FILE, FILE_TOO_LARGE
 *   (above the 256 MB safety limit), INVALID_PDF (missing %PDF- header),
 *   INVALID_PRESET, GHOSTSCRIPT_ERROR (Ghostscript rejected the input).
 */

importScripts('./ghostscript.js', './presets.js');

const MODULE_PROMISE = GhostscriptModule();

/*
 * Safety limits. The WASM heap is capped at MAXIMUM_MEMORY=512MB with
 * ALLOW_MEMORY_GROWTH=1 and starts at INITIAL_MEMORY=64MB (see
 * scripts/build.sh). pdfwrite needs several times the input size, so we
 * reject inputs that could plausibly exceed the heap instead of letting
 * the process crash or thrash.
 */
const MAX_SAFE_INPUT_BYTES = 256 * 1024 * 1024;      // 256 MB, rejected up-front
const RECYCLE_AFTER_BYTES = 64 * 1024 * 1024;        // 64 MB, terminate after
const RECYCLE_AFTER_HEAP_BYTES = 384 * 1024 * 1024;  // 384 MB heap, terminate after

const PROGRESS_STAGES = {
  loading: 'loading',
  initializing: 'initializing',
  writingInput: 'writing-input',
  processing: 'processing',
  readingOutput: 'reading-output',
  complete: 'complete'
};

let moduleLoaded = false;

function generateId() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function post(id, message) {
  self.postMessage(message);
}

function postProgress(id, stage, message) {
  post(id, { type: 'progress', id, stage, message });
}

function getErrorDetail(module) {
  try {
    const getLastError = module.cwrap('gs_get_last_error', 'string', []);
    return getLastError() || '';
  } catch (e) {
    return '';
  }
}

async function compress(module, file, options, id) {
  if (!file || (typeof file.byteLength !== 'number' && !(file instanceof ArrayBuffer))) {
    const err = new Error('Invalid file data');
    err.code = 'INVALID_FILE';
    throw err;
  }

  const originalSize = file.byteLength;

  if (originalSize === 0) {
    const err = new Error('The selected file is empty.');
    err.code = 'EMPTY_FILE';
    throw err;
  }

  if (originalSize > MAX_SAFE_INPUT_BYTES) {
    const err = new Error(
      `File is ${(originalSize / 1024 / 1024).toFixed(1)} MB. ` +
      `This build can safely process files up to ${MAX_SAFE_INPUT_BYTES / 1024 / 1024} MB.`
    );
    err.code = 'FILE_TOO_LARGE';
    throw err;
  }

  // Content validation: never trust the filename or MIME type. Reject
  // anything that does not start with the PDF magic signature (%PDF-).
  // This also catches HTML documents or scripts uploaded with a .pdf name.
  const head = new Uint8Array(
    file instanceof ArrayBuffer ? file : file.buffer,
    file instanceof ArrayBuffer ? 0 : file.byteOffset,
    Math.min(5, originalSize)
  );
  const magic = String.fromCharCode(head[0], head[1], head[2], head[3], head[4]);
  if (magic !== '%PDF-') {
    const err = new Error(
      'The selected file is not a valid PDF (missing the %PDF- header).'
    );
    err.code = 'INVALID_PDF';
    throw err;
  }

  const presetName = options && options.preset;
  if (!presetName || !GSPresets.PRESETS[presetName]) {
    const err = new Error(`Unknown compression preset: "${presetName}"`);
    err.code = 'INVALID_PRESET';
    throw err;
  }

  const FS = module.FS;
  const started = performance.now();
  const jobId = generateId();
  const workDir = `/work/job-${jobId}`;
  const inputPath = `${workDir}/input.pdf`;
  const outputPath = `${workDir}/output.pdf`;

  try {
    postProgress(id, PROGRESS_STAGES.writingInput, 'Writing input PDF to memory…');
    FS.mkdirTree(workDir);
    FS.writeFile(inputPath, new Uint8Array(file));

    postProgress(id, PROGRESS_STAGES.initializing, 'Initializing Ghostscript…');

    const processPdf = module.cwrap('gs_process_pdf_argv', 'number', [
      'string',
      'string',
      'string'
    ]);

    const args = GSPresets.PRESETS[presetName].args.join('\n');

    postProgress(id, PROGRESS_STAGES.processing, 'Processing PDF…');

    const code = processPdf(inputPath, outputPath, args);

    if (code !== 0) {
      const detail = getErrorDetail(module);
      const err = new Error(
        `Ghostscript exited with code ${code}.` + (detail ? ` ${detail.trim()}` : '')
      );
      err.code = 'GHOSTSCRIPT_ERROR';
      err.gsCode = code;
      throw err;
    }

    postProgress(id, PROGRESS_STAGES.readingOutput, 'Reading compressed PDF…');

    const bytes = FS.readFile(outputPath);
    const compressedSize = bytes.length;
    const processingTimeMs = Math.round(performance.now() - started);
    const compressionRatio = originalSize > 0
      ? 1 - compressedSize / originalSize
      : 0;
    const heapBytesAfter = module.HEAPU8 ? module.HEAPU8.buffer.byteLength : 0;

    postProgress(id, PROGRESS_STAGES.complete, 'Complete.');

    return {
      bytes,
      originalSize,
      compressedSize,
      compressionRatio,
      processingTimeMs,
      heapBytesAfter,
      preset: presetName,
      recycle: originalSize >= RECYCLE_AFTER_BYTES || heapBytesAfter >= RECYCLE_AFTER_HEAP_BYTES
    };
  } finally {
    // Always clean up the virtual filesystem.
    try { FS.unlink(inputPath); } catch (e) { /* ignore */ }
    try { FS.unlink(outputPath); } catch (e) { /* ignore */ }
    try { FS.rmdir(workDir); } catch (e) { /* ignore */ }
  }
}

self.onmessage = async function (event) {
  const { type, id } = event.data;

  if (type !== 'compress') {
    self.postMessage({ type: 'error', id, error: `Unknown message type: ${type}` });
    return;
  }

  const file = event.data.file || event.data.input;
  const options = event.data.options || {};

  try {
    if (!moduleLoaded) {
      postProgress(id, PROGRESS_STAGES.loading, 'Loading Ghostscript engine…');
    }

    const module = await MODULE_PROMISE;
    moduleLoaded = true;

    const result = await compress(module, file, options, id);

    self.postMessage(
      {
        type: 'result',
        id,
        success: true,
        bytes: result.bytes,
        originalSize: result.originalSize,
        compressedSize: result.compressedSize,
        compressionRatio: result.compressionRatio,
        processingTimeMs: result.processingTimeMs,
        heapBytesAfter: result.heapBytesAfter,
        preset: result.preset,
        recycle: result.recycle
      },
      [result.bytes.buffer]
    );

    if (result.recycle) {
      // Large job consumed a lot of memory; ask the main thread to throw
      // us away so a fresh, low-memory worker is used for the next job.
      self.postMessage({ type: 'recycle', id });
    }
  } catch (err) {
    self.postMessage({
      type: 'result',
      id,
      success: false,
      code: err.code || 'UNKNOWN',
      gsCode: err.gsCode,
      error: err.message || String(err)
    });
  }
};

// Signal that the worker is ready once the module has loaded.
MODULE_PROMISE.then(() => {
  self.postMessage({ type: 'ready' });
}).catch((err) => {
  self.postMessage({ type: 'error', error: err.message || String(err) });
});
