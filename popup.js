/**
 * popup.js — Popup Script for Discord → WhatsApp Sticker Converter
 *
 * Wires up UI button handlers, communicates with the background service worker,
 * and manages status/progress display.
 */

// ============================================================
// DOM Elements
// ============================================================
const btnConvertLast = document.getElementById('btn-convert-last');
const btnExportPack = document.getElementById('btn-export-pack');
const progressSection = document.getElementById('progress-section');
const progressBar = document.getElementById('progress-bar');
const progressText = document.getElementById('progress-text');
const statusText = document.getElementById('status-text');

// ============================================================
// State
// ============================================================
let isProcessing = false;

// ============================================================
// Initialize — check for last detected sticker
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
  // Check if there's a last detected sticker
  chrome.runtime.sendMessage({ action: 'getLastSticker' }, (response) => {
    if (response && response.data) {
      setStatus(`Last sticker: ${response.data.name} (${response.data.format.toUpperCase()})`, 'info');
    } else {
      setStatus('Right-click a Discord sticker → "Convert to WhatsApp Sticker"', 'default');
    }
  });
});

// ============================================================
// Convert Last Sticker Button
// ============================================================
btnConvertLast.addEventListener('click', async () => {
  if (isProcessing) return;

  setProcessing(true);
  setStatus('Converting sticker...', 'processing');

  try {
    const response = await sendMessage({ action: 'convertLastSticker' });

    if (response.status === 'ok') {
      setStatus(response.message || 'Sticker converted successfully!', 'success');
    } else {
      setStatus(response.message || 'No sticker to convert.', 'error');
    }
  } catch (err) {
    setStatus(`Error: ${err.message}`, 'error');
  } finally {
    setProcessing(false);
  }
});

// ============================================================
// Export Sticker Pack Button
// ============================================================
btnExportPack.addEventListener('click', async () => {
  if (isProcessing) return;

  setProcessing(true);
  showProgress(true);
  setProgress(0, 'Scanning for stickers...');

  try {
    const response = await sendMessage({ action: 'exportStickerPack' });

    if (response.status === 'ok') {
      setProgress(100, 'Complete!');
      setStatus(response.message || 'Sticker pack exported!', 'success');
    } else {
      setStatus(response.message || 'Failed to export sticker pack.', 'error');
    }
  } catch (err) {
    setStatus(`Error: ${err.message}`, 'error');
  } finally {
    setProcessing(false);
    // Hide progress after a delay
    setTimeout(() => showProgress(false), 3000);
  }
});

// ============================================================
// Listen for progress updates from background
// ============================================================
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'exportProgress') {
    const percent = Math.round((message.current / message.total) * 100);
    setProgress(percent, `Converting ${message.current}/${message.total} stickers...`);
  }
});

// ============================================================
// Helper — send message to background script
// ============================================================
function sendMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else if (!response) {
        reject(new Error('No response from background script.'));
      } else {
        resolve(response);
      }
    });
  });
}

// ============================================================
// UI Helpers
// ============================================================

/**
 * Set the status text with a specific style
 * @param {string} text - Status message
 * @param {'default'|'info'|'success'|'error'|'processing'} type
 */
function setStatus(text, type = 'default') {
  statusText.textContent = text;
  statusText.className = `status-text status-${type}`;
}

/**
 * Toggle processing state (disable/enable buttons)
 * @param {boolean} processing
 */
function setProcessing(processing) {
  isProcessing = processing;
  btnConvertLast.disabled = processing;
  btnExportPack.disabled = processing;

  if (processing) {
    btnConvertLast.classList.add('disabled');
    btnExportPack.classList.add('disabled');
  } else {
    btnConvertLast.classList.remove('disabled');
    btnExportPack.classList.remove('disabled');
  }
}

/**
 * Show/hide the progress section
 * @param {boolean} visible
 */
function showProgress(visible) {
  if (visible) {
    progressSection.classList.remove('hidden');
  } else {
    progressSection.classList.add('hidden');
  }
}

/**
 * Update the progress bar and text
 * @param {number} percent - 0–100
 * @param {string} text - Progress message
 */
function setProgress(percent, text) {
  progressBar.style.width = `${Math.min(100, Math.max(0, percent))}%`;
  progressText.textContent = text;
}
