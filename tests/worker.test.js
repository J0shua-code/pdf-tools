/*
 * Worker protocol test.
 *
 * Runs the REAL web worker file (worker/ghostscript.worker.js, as copied
 * to dist/) inside a Node worker_thread with a small shim that provides
 * `self`, `postMessage`, `importScripts` and message routing. This
 * verifies the message contract used by the browser:
 *
 *   compress {type, id, file: ArrayBuffer, options: {preset}}
 *     -> progress {type:'progress', id, stage, message}
 *     -> result  {type:'result', id, success, bytes, originalSize,
 *                 compressedSize, compressionRatio, processingTimeMs}
 *
 * Also verifies graceful rejection of bad inputs (empty file, unknown
 * preset, over-limit file) — the "reject unsupported sizes gracefully"
 * requirement.
 */

import { Worker } from 'node:worker_threads';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { isValidPdf } from './helpers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const INPUT_DIR = path.join(ROOT, 'tests', 'input');

const BOOTSTRAP = `
const { parentPort, workerData } = require('node:worker_threads');
const fs = require('node:fs');
const path = require('node:path');

globalThis.__dirname = workerData.dist;
globalThis.require = require;
globalThis.process = process;

globalThis.importScripts = function (...urls) {
  for (const url of urls) {
    const file = path.resolve(workerData.dist, url);
    (0, eval)(fs.readFileSync(file, 'utf8'));
  }
};

globalThis.self = {
  postMessage(msg) {
    parentPort.postMessage(msg);
  }
};

parentPort.on('message', (msg) => {
  if (typeof self.onmessage === 'function') {
    self.onmessage({ data: msg });
  }
});

(0, eval)(fs.readFileSync(path.resolve(workerData.dist, 'ghostscript.worker.js'), 'utf8'));
`;

const MAX_SAFE_INPUT_BYTES = 256 * 1024 * 1024;

function spawnWorker() {
  const w = new Worker(BOOTSTRAP, { eval: true, workerData: { dist: DIST } });
  const listeners = new Set();

  w.on('message', (msg) => {
    for (const l of listeners) l(msg);
  });
  w.on('error', (err) => {
    for (const l of listeners) l({ type: 'error', error: err.message || String(err) });
  });
  w.on('exit', (code) => {
    for (const l of listeners) l({ type: 'exit', code });
  });

  return {
    onMessage(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    post(msg) {
      w.postMessage(msg);
    },
    terminate() {
      w.terminate();
    }
  };
}

function waitForReady(worker, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out waiting for ready')), timeoutMs);
    const off = worker.onMessage((msg) => {
      if (msg.type === 'ready') {
        clearTimeout(timer);
        off();
        resolve();
      } else if (msg.type === 'error' || msg.type === 'exit') {
        clearTimeout(timer);
        off();
        reject(new Error(msg.error || `worker exited with code ${msg.code}`));
      }
    });
  });
}

function runJob(worker, payload, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`job ${payload.id} timed out`)),
      timeoutMs
    );
    const stages = [];
    const off = worker.onMessage((msg) => {
      if (msg.type === 'progress' && msg.id === payload.id) {
        stages.push(msg.stage);
      } else if (msg.type === 'result' && msg.id === payload.id) {
        clearTimeout(timer);
        off();
        resolve({ result: msg, stages });
      } else if (msg.type === 'error' && msg.id === payload.id) {
        clearTimeout(timer);
        off();
        reject(new Error(msg.error));
      }
    });
    worker.post(payload);
  });
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
}

let failures = 0;

async function check(name, fn) {
  try {
    await fn();
    console.log(`✓ ${name}`);
  } catch (err) {
    failures++;
    console.error(`✗ ${name}: ${err.message}`);
  }
}

async function run() {
  const worker = spawnWorker();
  const simple = await fs.readFile(path.join(INPUT_DIR, 'simple.pdf'));

  try {
    await waitForReady(worker);

    await check('compresses a valid PDF with balanced preset', async () => {
      const { result, stages } = await runJob(worker, {
        type: 'compress',
        id: 'job-balanced',
        file: simple.buffer.slice(simple.byteOffset, simple.byteOffset + simple.byteLength),
        options: { preset: 'balanced' }
      });

      assert(result.success === true, 'success should be true');
      assert(isValidPdf(result.bytes), 'bytes should be a valid PDF');
      assert(result.originalSize === simple.length, 'originalSize mismatch');
      assert(result.compressedSize === result.bytes.length, 'compressedSize mismatch');
      assert(
        result.compressionRatio >= 0 && result.compressionRatio <= 1,
        'compressionRatio should be in [0,1]'
      );
      assert(
        typeof result.processingTimeMs === 'number' && result.processingTimeMs >= 0,
        'processingTimeMs should be a non-negative number'
      );
      assert(stages.length > 0, 'should emit at least one progress stage');
      assert(stages[stages.length - 1] === 'complete', 'last stage should be "complete"');
    });

    await check('reports meaningful progress stages', async () => {
      const { stages } = await runJob(worker, {
        type: 'compress',
        id: 'job-stages',
        file: simple.buffer.slice(simple.byteOffset, simple.byteOffset + simple.byteLength),
        options: { preset: 'extreme' }
      });

      const known = ['loading', 'initializing', 'writing-input', 'processing', 'reading-output', 'complete'];
      for (const s of stages) {
        assert(known.includes(s), `unexpected stage "${s}"`);
      }
      assert(stages.includes('processing'), 'should include processing stage');
    });

    await check('rejects an unknown preset gracefully', async () => {
      const { result } = await runJob(worker, {
        type: 'compress',
        id: 'job-badpreset',
        file: simple.buffer.slice(simple.byteOffset, simple.byteOffset + simple.byteLength),
        options: { preset: 'garbage-preset' }
      });

      assert(result.success === false, 'success should be false');
      assert(result.code === 'INVALID_PRESET', 'code should be INVALID_PRESET');
    });

    await check('rejects an empty file gracefully', async () => {
      const { result } = await runJob(worker, {
        type: 'compress',
        id: 'job-empty',
        file: new ArrayBuffer(0),
        options: { preset: 'balanced' }
      });

      assert(result.success === false, 'success should be false');
      assert(result.code === 'EMPTY_FILE', 'code should be EMPTY_FILE');
    });

    await check('rejects an over-limit file gracefully', async () => {
      const big = new ArrayBuffer(MAX_SAFE_INPUT_BYTES + 1);
      const { result } = await runJob(worker, {
        type: 'compress',
        id: 'job-toobig',
        file: big,
        options: { preset: 'balanced' }
      });

      assert(result.success === false, 'success should be false');
      assert(result.code === 'FILE_TOO_LARGE', 'code should be FILE_TOO_LARGE');
    });

    await check('handles a non-ArrayBuffer payload gracefully', async () => {
      const { result } = await runJob(worker, {
        type: 'compress',
        id: 'job-invalid',
        file: 'not-a-buffer',
        options: { preset: 'balanced' }
      });

      assert(result.success === false, 'success should be false');
      assert(result.code === 'INVALID_FILE', 'code should be INVALID_FILE');
    });
  } finally {
    worker.terminate();
  }

  if (failures > 0) {
    console.error(`\n${failures} worker test failure(s).`);
    process.exit(1);
  }

  console.log('\nAll worker protocol tests passed.');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});