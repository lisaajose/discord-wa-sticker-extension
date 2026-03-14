/**
 * popup.js — Popup Script for Discord → WhatsApp Sticker Converter
 *
 * Wires up UI button handlers, communicates with the background service worker,
 * and manages status/progress display.
 *
 * NOTE: When the user clicks "Convert Last Sticker", the popup first tries
 * the cached sticker in the background. If none exists, it asks the content
 * script to scan the Discord page for stickers as a fallback.
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
  // First try background cache
  chrome.runtime.sendMessage({ action: 'getLastSticker' }, (response) => {
    if (response && response.data) {
      setStatus(`✅ Sticker ready: ${response.data.name} (${response.data.format.toUpperCase()})`, 'info');
    } else {
      // Try scanning the content script
      queryContentScript();
    }
  });
});

/**
 * Query the content script on the active tab for stickers
 */
function queryContentScript() {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs.length || !tabs[0].url?.includes('discord.com')) {
      setStatus('Open discord.com and hover over a sticker to convert it.', 'default');
      return;
    }

    chrome.tabs.sendMessage(tabs[0].id, { action: 'scanNow' }, (response) => {
      if (chrome.runtime.lastError) {
        setStatus('⚠️ Extension not connected. Try reloading the Discord page.', 'error');
        return;
      }

      if (response && response.data) {
        setStatus(`✅ Sticker found: ${response.data.name} (${response.data.format.toUpperCase()})`, 'info');
      } else {
        setStatus('Hover over a Discord sticker, then use the green button to convert.', 'default');
      }
    });
  });
}

// ============================================================
// Convert Last Sticker Button
// ============================================================
btnConvertLast.addEventListener('click', async () => {
  if (isProcessing) return;

  setProcessing(true);
  setStatus('🔄 Scanning for stickers...', 'processing');

  try {
    // First try the cached sticker
    let response = await sendMessage({ action: 'convertLastSticker' });

    // If no cached sticker, try scanning the page first
    if (response.status === 'error' && response.message.includes('No sticker detected')) {
      setStatus('🔍 Scanning Discord page for stickers...', 'processing');
      response = await sendMessage({ action: 'scanAndConvert' });
    }

    if (response.status === 'ok') {
      setStatus('✅ ' + (response.message || 'Sticker converted successfully!'), 'success');
    } else {
      setStatus('❌ ' + (response.message || 'No sticker to convert.'), 'error');
    }
  } catch (err) {
    setStatus(`❌ Error: ${err.message}`, 'error');
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
  setProgress(0, 'Scanning Discord page for stickers...');

  try {
    const response = await sendMessage({ action: 'exportStickerPack' });

    if (response.status === 'ok') {
      setProgress(100, 'Complete!');
      setStatus('✅ ' + (response.message || 'Sticker pack exported!'), 'success');
    } else {
      setStatus('❌ ' + (response.message || 'Failed to export sticker pack.'), 'error');
    }
  } catch (err) {
    setStatus(`❌ Error: ${err.message}`, 'error');
  } finally {
    setProcessing(false);
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

function setStatus(text, type = 'default') {
  statusText.textContent = text;
  statusText.className = `status-text status-${type}`;
}

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

function showProgress(visible) {
  progressSection.classList[visible ? 'remove' : 'add']('hidden');
}

function setProgress(percent, text) {
  progressBar.style.width = `${Math.min(100, Math.max(0, percent))}%`;
  progressText.textContent = text;
}
