/*
 * Client-side API for the Ghostscript WASM PDF compressor.
 *
 * Lazy loading: the worker (and therefore the ~17 MB WASM engine) is only
 * created/downloaded on the FIRST compressPDF() call. Nothing is fetched
 * when the page loads.
 *
 * The API accepts only a preset NAME. Raw Ghostscript arguments are never
 * accepted here; they are hard-coded in shared/presets.js inside the
 * worker's closed preset set.
 */

export const PRESET_META = [
  {
    id: 'extreme',
    label: 'Extreme',
    description: 'Smallest file size. Aggressive downsampling and JPEG.'
  },
  {
    id: 'balanced',
    label: 'Balanced',
    description: 'Recommended default. Good quality with solid savings.'
  },
  {
    id: 'highQuality',
    label: 'High Quality',
    description: 'Preserve quality. Minimal lossy processing.'
  }
];

let worker = null;
let jobCounter = 0;
const activeJobs = new Map();

function generateId() {
  return `job-${Date.now().toString(36)}-${(jobCounter++).toString(36)}`;
}

function createWorker() {
  const w = new Worker('./ghostscript.worker.js', { type: 'classic' });

  w.onmessage = (event) => {
    handleWorkerMessage(event.data);
  };

  w.onerror = (event) => {
    const err = new Error(event.message || 'Worker crashed unexpectedly');
    err.code = 'WORKER_CRASH';
    failAllJobs(err);
    terminateWorker();
  };

  return w;
}

function ensureWorker() {
  if (!worker) {
    worker = createWorker();
  }
  return worker;
}

export function isWorkerLoaded() {
  return worker !== null;
}

function handleWorkerMessage(data) {
  switch (data.type) {
    case 'ready':
      return;

    case 'progress': {
      const job = activeJobs.get(data.id);
      if (job && typeof job.onProgress === 'function') {
        job.onProgress(data.stage, data.message, data);
      }
      return;
    }

    case 'recycle':
      terminateWorker();
      return;

    case 'result': {
      const job = activeJobs.get(data.id);
      if (!job) {
        return;
      }
      activeJobs.delete(data.id);

      if (data.success) {
        job.resolve({
          bytes: data.bytes,
          originalSize: data.originalSize,
          compressedSize: data.compressedSize,
          compressionRatio: data.compressionRatio,
          processingTimeMs: data.processingTimeMs,
          preset: data.preset
        });
        if (data.recycle) {
          // Large job: release the memory by starting fresh next time.
          terminateWorker();
        }
      } else {
        const err = new Error(data.error || 'Compression failed');
        err.code = data.code;
        err.gsCode = data.gsCode;
        job.reject(err);
      }
      return;
    }

    case 'error': {
      const err = new Error(data.error || 'Worker error');
      err.code = 'WORKER_ERROR';
      failAllJobs(err);
      terminateWorker();
      return;
    }

    default:
      return;
  }
}

function failAllJobs(err) {
  for (const [, job] of activeJobs) {
    job.reject(err);
  }
  activeJobs.clear();
}

function terminateWorker() {
  if (worker) {
    worker.terminate();
    worker = null;
  }
}

/**
 * Compress a PDF file entirely in the browser.
 *
 * @param {object} options
 * @param {ArrayBuffer} options.file       PDF bytes
 * @param {string} options.preset          one of PRESET_META ids
 * @param {(stage: string, message: string, progress: object) => void} [options.onProgress]
 * @param {boolean} [options.transfer=true] transfer the ArrayBuffer to the
 *        worker (zero-copy). The caller loses ownership of `file`.
 * @returns {Promise<{
 *   bytes: Uint8Array,
 *   originalSize: number,
 *   compressedSize: number,
 *   compressionRatio: number,
 *   processingTimeMs: number,
 *   preset: string
 * }>}
 */
export function compressPDF(options) {
  const { file, preset, onProgress, transfer } = options || {};

  if (!file || !(file instanceof ArrayBuffer)) {
    return Promise.reject(
      Object.assign(new Error('compressPDF: file must be an ArrayBuffer'), { code: 'INVALID_FILE' })
    );
  }
  if (!PRESET_META.some((p) => p.id === preset)) {
    return Promise.reject(
      Object.assign(new Error(`compressPDF: unknown preset "${preset}"`), { code: 'INVALID_PRESET' })
    );
  }

  return new Promise((resolve, reject) => {
    const id = generateId();
    activeJobs.set(id, { resolve, reject, onProgress });

    const w = ensureWorker();
    const transferList = transfer === false ? undefined : [file];
    w.postMessage({ type: 'compress', id, file, options: { preset } }, transferList);
  });
}

/**
 * Terminate the worker and release its memory. Safe to call any time;
 * the next compressPDF() lazily creates a fresh worker.
 */
export function dispose() {
  failAllJobs(Object.assign(new Error('disposed'), { code: 'DISPOSED' }));
  terminateWorker();
}
