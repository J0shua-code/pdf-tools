/*
 * Shared helpers for Node-based tests and the benchmark script.
 */

import path from 'node:path';

// Side-effect: this plain script sets `globalThis.GSPresets` when loaded
// as a module (the repo is "type": "module").
import '../shared/presets.js';

let loadedDist = null;

export async function loadModule(distDir) {
  if (loadedDist && loadedDist.dir === distDir) {
    return loadedDist.module;
  }
  const mod = await import(path.join(distDir, 'ghostscript.js'));
  const module = await mod.default();
  loadedDist = { dir: distDir, module };
  return module;
}

export function getPresets() {
  if (!globalThis.GSPresets) {
    throw new Error('GSPresets global not set; import shared/presets.js first');
  }
  return globalThis.GSPresets.PRESETS;
}

/**
 * Run one compression job directly against the WASM module (no worker).
 */
export async function compressBytes(module, inputBytes, presetName) {
  const presets = getPresets();
  const preset = presets[presetName];
  if (!preset) {
    throw new Error(`Unknown preset: ${presetName}`);
  }

  const started = performance.now();
  const jobId = Math.random().toString(36).slice(2);
  const workDir = `/work/helper-${jobId}`;
  const inputPath = `${workDir}/input.pdf`;
  const outputPath = `${workDir}/output.pdf`;
  const FS = module.FS;

  FS.mkdirTree(workDir);
  FS.writeFile(inputPath, inputBytes);

  const processPdf = module.cwrap('gs_process_pdf_argv', 'number', [
    'string',
    'string',
    'string'
  ]);
  const args = preset.args.join('\n');
  const code = processPdf(inputPath, outputPath, args);

  const bytes = code === 0 ? FS.readFile(outputPath) : new Uint8Array(0);
  const processingTimeMs = Math.round(performance.now() - started);

  try { FS.unlink(inputPath); } catch (e) { /* ignore */ }
  try { FS.unlink(outputPath); } catch (e) { /* ignore */ }
  try { FS.rmdir(workDir); } catch (e) { /* ignore */ }

  return {
    code,
    bytes,
    preset: presetName,
    originalSize: inputBytes.length,
    compressedSize: bytes.length,
    compressionRatio: inputBytes.length
      ? 1 - bytes.length / inputBytes.length
      : 0,
    processingTimeMs
  };
}

export function isValidPdf(bytes) {
  if (!bytes || bytes.length < 8) return false;
  const magic = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3], bytes[4]);
  return magic.startsWith('%PDF-');
}

/** Rough page counter (byte-scan of uncompressed structure). */
export function countPages(bytes) {
  const s = Buffer.from(bytes).toString('latin1');
  const re = /\/Type\s*\/Page[^s]/g;
  let n = 0;
  let m;
  while ((m = re.exec(s)) !== null) n++;
  return n;
}
