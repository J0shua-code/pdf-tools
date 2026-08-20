/*
 * Compression preset definitions — single source of truth.
 *
 * This file is intentionally a plain script (no ESM import/export) so it
 * works in BOTH environments:
 *
 *   - Classic web worker: loaded with importScripts('./presets.js');
 *     exposes the bundle as a global `GSPresets`.
 *   - Node (tests/scripts): importing it as a module executes it and the
 *     global side-effect sets `globalThis.GSPresets` (the package is
 *     "type": "module", so the CommonJS branch is skipped there).
 *
 * SECURITY: these are the ONLY Ghostscript arguments the web API ever
 * passes. The public API accepts a preset NAME; arbitrary arguments are
 * never accepted from untrusted website code. Do not add a way to inject
 * raw arguments from the main thread.
 *
 * Presets are ordered most aggressive -> least aggressive.
 */

(function (root) {
  'use strict';

  var PRESETS = {
    extreme: {
      label: 'Extreme',
      description: 'Smallest file size. Aggressive downsampling and JPEG.',
      args: [
        '-dPDFSETTINGS=/screen',
        '-dColorImageResolution=60',
        '-dGrayImageResolution=60',
        '-dMonoImageResolution=150',
        '-dColorImageDownsampleType=/Bicubic',
        '-dGrayImageDownsampleType=/Bicubic',
        '-dMonoImageDownsampleType=/Subsample',
        '-dDownsampleColorImages=true',
        '-dDownsampleGrayImages=true',
        '-dDownsampleMonoImages=true',
        '-dAutoFilterColorImages=true',
        '-dAutoFilterGrayImages=true',
        '-dColorImageFilter=/DCTEncode',
        '-dGrayImageFilter=/DCTEncode',
        '-dEncodeColorImages=true',
        '-dEncodeGrayImages=true',
        '-dEncodeMonoImages=true',
        '-dJPEGQ=35',
        '-dEmbedAllFonts=true',
        '-dSubsetFonts=true',
        '-dCompressPages=true',
        '-dCompressFonts=true'
      ]
    },

    balanced: {
      label: 'Balanced',
      description: 'Recommended default. Good quality with solid savings.',
      args: [
        '-dPDFSETTINGS=/ebook',
        '-dColorImageResolution=110',
        '-dGrayImageResolution=110',
        '-dMonoImageResolution=300',
        '-dColorImageDownsampleType=/Bicubic',
        '-dGrayImageDownsampleType=/Bicubic',
        '-dMonoImageDownsampleType=/Subsample',
        '-dDownsampleColorImages=true',
        '-dDownsampleGrayImages=true',
        '-dDownsampleMonoImages=true',
        '-dAutoFilterColorImages=true',
        '-dAutoFilterGrayImages=true',
        '-dEncodeColorImages=true',
        '-dEncodeGrayImages=true',
        '-dEncodeMonoImages=true',
        '-dJPEGQ=75',
        '-dEmbedAllFonts=true',
        '-dSubsetFonts=true',
        '-dCompressPages=true',
        '-dCompressFonts=true'
      ]
    },

    highQuality: {
      label: 'High Quality',
      description: 'Preserve quality. Minimal lossy processing.',
      args: [
        '-dPDFSETTINGS=/printer',
        '-dColorImageResolution=300',
        '-dGrayImageResolution=300',
        '-dMonoImageResolution=600',
        '-dColorImageDownsampleType=/Bicubic',
        '-dGrayImageDownsampleType=/Bicubic',
        '-dMonoImageDownsampleType=/Subsample',
        '-dDownsampleColorImages=true',
        '-dDownsampleGrayImages=true',
        '-dDownsampleMonoImages=true',
        '-dAutoFilterColorImages=true',
        '-dAutoFilterGrayImages=true',
        '-dEncodeColorImages=true',
        '-dEncodeGrayImages=true',
        '-dEncodeMonoImages=true',
        '-dJPEGQ=92',
        '-dEmbedAllFonts=true',
        '-dSubsetFonts=true',
        '-dCompressPages=true',
        '-dCompressFonts=true'
      ]
    }
  };

  var PRESET_NAMES = Object.freeze(['extreme', 'balanced', 'highQuality']);

  var bundle = Object.freeze({
    PRESETS: PRESETS,
    PRESET_NAMES: PRESET_NAMES
  });

  root.GSPresets = bundle;

  // CommonJS consumers (e.g. Node scripts running outside "type": "module").
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = bundle;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
