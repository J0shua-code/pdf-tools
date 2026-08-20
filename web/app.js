/*
 * Demo UI for the Ghostscript WASM PDF compressor (Phase 13).
 *
 * The Ghostscript engine is loaded lazily: the worker is only created
 * when the user clicks "Compress PDF" (see gs-compress.js), so the WASM
 * is never downloaded on page load.
 */

import { compressPDF, PRESET_META } from './gs-compress.js';

const fileInput = document.getElementById('file-input');
const dropZone = document.getElementById('drop-zone');
const dropText = document.getElementById('drop-text');
const fileInfo = document.getElementById('file-info');
const fileNameEl = document.getElementById('file-name');
const fileSizeEl = document.getElementById('file-size');
const presetGroup = document.getElementById('preset-group');
const compressBtn = document.getElementById('compress-btn');
const progressEl = document.getElementById('progress');
const progressText = document.getElementById('progress-text');
const statusEl = document.getElementById('status');
const resultEl = document.getElementById('result');
const originalSizeEl = document.getElementById('original-size');
const compressedSizeEl = document.getElementById('compressed-size');
const savingsEl = document.getElementById('savings');
const processingNoteEl = document.getElementById('processing-note');
const downloadLink = document.getElementById('download-link');

const PRESET_IDS = PRESET_META.map((p) => p.id);

let currentFile = null;
let currentBlobUrl = null;

// ---- helpers ---------------------------------------------------------------

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1);
  return `${(bytes / Math.pow(k, i)).toFixed(bytes < 1024 ? 0 : 2)} ${sizes[i]}`;
}

function setStatus(message, type = 'info') {
  statusEl.textContent = message;
  statusEl.className = `status ${type}`;
}

function setProgress(visible, text) {
  progressEl.classList.toggle('hidden', !visible);
  if (text) progressText.textContent = text;
}

function showResult() {
  resultEl.classList.remove('hidden');
}

function hideResult() {
  resultEl.classList.add('hidden');
  revokeBlobUrl();
}

function revokeBlobUrl() {
  if (currentBlobUrl) {
    URL.revokeObjectURL(currentBlobUrl);
    currentBlobUrl = null;
    downloadLink.removeAttribute('href');
  }
}

// ---- preset radios ----------------------------------------------------------

function renderPresets() {
  for (const preset of PRESET_META) {
    const label = document.createElement('label');
    label.className = 'preset-option';

    const input = document.createElement('input');
    input.type = 'radio';
    input.name = 'preset';
    input.value = preset.id;
    if (preset.id === 'balanced') {
      input.checked = true;
    }

    const text = document.createElement('span');
    const name = document.createElement('strong');
    name.textContent = preset.label;
    const desc = document.createElement('small');
    desc.textContent = preset.description;
    text.appendChild(name);
    text.appendChild(desc);

    label.appendChild(input);
    label.appendChild(text);
    presetGroup.appendChild(label);
  }
}

function selectedPreset() {
  const checked = presetGroup.querySelector('input[name="preset"]:checked');
  return checked ? checked.value : 'balanced';
}

// ---- file selection ----------------------------------------------------------

function handleFile(file) {
  if (!file || file.type !== 'application/pdf') {
    setStatus('Please select a valid PDF file.', 'error');
    return;
  }

  currentFile = file;
  fileNameEl.textContent = file.name;
  fileSizeEl.textContent = formatBytes(file.size);
  fileInfo.classList.remove('hidden');
  dropText.textContent = 'Change PDF';
  compressBtn.disabled = false;
  hideResult();
  setStatus('PDF ready. Choose a preset and click "Compress PDF".');
}

fileInput.addEventListener('change', (e) => handleFile(e.target.files[0]));

dropZone.addEventListener('click', () => fileInput.click());
dropZone.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    fileInput.click();
  }
});

dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropZone.classList.add('dragover');
});

dropZone.addEventListener('dragleave', () => {
  dropZone.classList.remove('dragover');
});

dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('dragover');
  handleFile(e.dataTransfer.files[0]);
});

// ---- compression ---------------------------------------------------------------

const STAGE_MESSAGES = {
  loading: 'Loading Ghostscript engine…',
  initializing: 'Initializing Ghostscript…',
  'writing-input': 'Writing input PDF…',
  processing: 'Processing PDF…',
  'reading-output': 'Finalizing output…',
  complete: 'Complete.'
};

async function onCompress() {
  if (!currentFile) return;

  compressBtn.disabled = true;
  compressBtn.textContent = 'Compressing…';
  hideResult();
  setStatus('');
  setProgress(true, 'Loading Ghostscript engine…');

  const arrayBuffer = await currentFile.arrayBuffer();

  try {
    const result = await compressPDF({
      file: arrayBuffer,
      preset: selectedPreset(),
      transfer: true,
      onProgress: (stage, message) => {
        setProgress(true, STAGE_MESSAGES[stage] || message || stage);
      }
    });

    // Build the download using a Blob + object URL, then revoke on next use.
    revokeBlobUrl();
    const blob = new Blob([result.bytes], { type: 'application/pdf' });
    currentBlobUrl = URL.createObjectURL(blob);

    originalSizeEl.textContent = formatBytes(result.originalSize);
    compressedSizeEl.textContent = formatBytes(result.compressedSize);
    const savedPercent = (result.compressionRatio * 100).toFixed(0);
    savingsEl.textContent = `${savedPercent}%`;
    processingNoteEl.textContent = `Processed in ${result.processingTimeMs} ms.`;
    downloadLink.href = currentBlobUrl;
    downloadLink.download = `compressed-${currentFile.name.replace(/\.pdf$/i, '')}.pdf`;

    showResult();
    setStatus('', 'success');
  } catch (err) {
    setStatus(`Compression failed: ${err.message}`, 'error');
  } finally {
    compressBtn.disabled = false;
    compressBtn.textContent = 'Compress PDF';
    setProgress(false);
  }
}

compressBtn.addEventListener('click', onCompress);

// Revoke any lingering object URL when the page is unloaded.
window.addEventListener('beforeunload', revokeBlobUrl);

// ---- init ----------------------------------------------------------------------

renderPresets();
setStatus('Select a PDF to begin.');
