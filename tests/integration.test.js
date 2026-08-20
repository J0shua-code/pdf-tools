/*
 * Node.js integration test for the Ghostscript WASM module.
 *
 * Validates the full pipeline against the C wrapper directly:
 *   input PDF -> virtual FS -> gs_process_pdf_argv(preset args) -> output PDF
 *
 * The preset definitions (shared/presets.js) are the same closed set the
 * web worker uses.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadModule, getPresets, compressBytes, isValidPdf } from './helpers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const INPUT_DIR = path.join(ROOT, 'tests', 'input');
const OUTPUT_DIR = path.join(ROOT, 'tests', 'output');

const INPUTS = ['simple.pdf', 'images.pdf', 'large.pdf'];

async function run() {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });

  const module = await loadModule(DIST);
  const presets = getPresets();
  const presetNames = Object.keys(presets);

  let failures = 0;

  for (const inputName of INPUTS) {
    const inputPath = path.join(INPUT_DIR, inputName);
    const inputBytes = await fs.readFile(inputPath);

    for (const preset of presetNames) {
      const outputPath = path.join(OUTPUT_DIR, `${inputName.replace(/\.pdf$/, '')}-${preset}.pdf`);

      try {
        const result = await compressBytes(module, inputBytes, preset);

        if (result.code !== 0) {
          throw new Error(`Ghostscript exited with code ${result.code}`);
        }
        if (!isValidPdf(result.bytes)) {
          throw new Error('Output is not a valid PDF (bad magic bytes)');
        }
        if (!(result.compressionRatio >= 0 && result.compressionRatio <= 1)) {
          throw new Error(`compressionRatio out of range: ${result.compressionRatio}`);
        }

        await fs.writeFile(outputPath, result.bytes);

        const saved = (result.compressionRatio * 100).toFixed(1);
        console.log(
          `✓ ${inputName} @ ${preset}: ${result.originalSize} -> ${result.compressedSize} bytes ` +
          `(${saved}% saved, ${result.processingTimeMs} ms)`
        );
      } catch (err) {
        failures++;
        console.error(`✗ ${inputName} @ ${preset}: ${err.message}`);
      }
    }
  }

  if (failures > 0) {
    console.error(`\n${failures} failure(s).`);
    process.exit(1);
  }

  console.log('\nAll integration tests passed.');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});