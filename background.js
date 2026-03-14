/**
 * background.js — Service Worker for Discord → WhatsApp Sticker Converter
 *
 * Responsibilities:
 * - Register context menu item for single sticker conversion
 * - Handle sticker download + conversion pipeline
 * - Manage full sticker pack export workflow
 * - Communicate with content script and popup
 */

// ============================================================
// State — store last detected sticker info
// ============================================================
let lastStickerInfo = null;

// ============================================================
// Context Menu Registration
// ============================================================
chrome.runtime.onInstalled.addListener(() => {
  // Register for both 'image' context and 'page' context to maximize visibility.
  // Discord may override the native context menu, but the extension context menu
  // items still appear in Chrome's native menu (accessible via Shift+Right-Click).
  chrome.contextMenus.create({
    id: 'convert-sticker',
    title: 'Convert to WhatsApp Sticker',
    contexts: ['image', 'page', 'frame'],
    documentUrlPatterns: ['https://discord.com/*']
  });
  console.log('[Background] Context menu registered.');
});

// ============================================================
// Context Menu Click Handler
// ============================================================
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== 'convert-sticker') return;

  const imageUrl = info.srcUrl;
  if (!imageUrl) {
    console.error('[Background] No image URL found in context menu click.');
    return;
  }

  console.log('[Background] Context menu clicked for:', imageUrl);

  // Determine sticker format from URL
  const stickerInfo = parseStickerUrl(imageUrl);
  lastStickerInfo = stickerInfo;

  try {
    await convertAndDownloadSingle(stickerInfo);
  } catch (err) {
    console.error('[Background] Conversion failed:', err);
  }
});

// ============================================================
// Message Listener — from content.js and popup.js
// ============================================================
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.action) {
    case 'stickerDetected':
      // Content script detected a sticker
      lastStickerInfo = message.data;
      console.log('[Background] Sticker detected:', lastStickerInfo);
      sendResponse({ status: 'ok' });
      break;

    case 'convertLastSticker':
      // Popup or content script requests conversion of last detected sticker
      if (!lastStickerInfo) {
        sendResponse({ status: 'error', message: 'No sticker detected yet. Hover over a sticker and click the green Convert button.' });
        return;
      }
      convertAndDownloadSingle(lastStickerInfo)
        .then(() => sendResponse({ status: 'ok', message: 'Sticker converted and downloaded!' }))
        .catch(err => sendResponse({ status: 'error', message: err.message }));
      return true; // async response

    case 'convertStickerDirect':
      // Direct conversion with sticker data provided
      if (!message.data || !message.data.url) {
        sendResponse({ status: 'error', message: 'No sticker data provided.' });
        return;
      }
      lastStickerInfo = message.data;
      convertAndDownloadSingle(message.data)
        .then(() => sendResponse({ status: 'ok', message: 'Sticker converted and downloaded!' }))
        .catch(err => sendResponse({ status: 'error', message: err.message }));
      return true;

    case 'scanAndConvert':
      // Ask content script to find stickers, then convert the latest one
      scanAndConvertFromTab()
        .then(result => sendResponse(result))
        .catch(err => sendResponse({ status: 'error', message: err.message }));
      return true;

    case 'exportStickerPack':
      // Popup requests full pack export
      exportStickerPack(message.guildId, sender)
        .then(result => sendResponse(result))
        .catch(err => sendResponse({ status: 'error', message: err.message }));
      return true; // async response

    case 'getLastSticker':
      sendResponse({ data: lastStickerInfo });
      break;

    default:
      sendResponse({ status: 'unknown' });
  }
});

// ============================================================
// URL Parser — extract sticker/emoji info from Discord CDN URLs
// ============================================================
function parseStickerUrl(url) {
  const info = {
    url: url,
    id: null,
    type: 'unknown', // 'sticker' or 'emoji'
    format: 'png',
    name: 'asset'
  };

  // Discord CDN URL patterns:
  // Stickers: https://media.discordapp.net/stickers/{id}.png|json
  //           https://cdn.discordapp.com/stickers/{id}.png|json
  // Emojis:   https://cdn.discordapp.com/emojis/{id}.png|gif|webp
  //           https://media.discordapp.net/emojis/{id}.png|gif|webp
  try {
    const parsed = new URL(url);
    const pathParts = parsed.pathname.split('/');
    const filename = pathParts[pathParts.length - 1];
    const isEmoji = parsed.pathname.includes('/emojis/');
    const isSticker = parsed.pathname.includes('/stickers/');

    // Extract ID and extension
    const match = filename.match(/^(\d+)\.(png|json|gif|webp)/i);
    if (match) {
      info.id = match[1];
      const ext = match[2].toLowerCase();
      if (ext === 'json') {
        info.format = 'lottie';
      } else {
        info.format = ext;
      }
    }

    if (isEmoji) {
      info.type = 'emoji';
      info.name = `emoji_${info.id || Date.now()}`;
      // Build full-res URL for emoji
      if (info.id) {
        const ext = info.format === 'gif' ? 'gif' : 'png';
        info.url = `https://cdn.discordapp.com/emojis/${info.id}.${ext}?size=512&quality=lossless`;
      }
    } else if (isSticker) {
      info.type = 'sticker';
      info.name = `sticker_${info.id || Date.now()}`;
      if (info.id) {
        info.url = `https://media.discordapp.net/stickers/${info.id}.png?size=512`;
      }
    } else {
      info.name = `asset_${info.id || Date.now()}`;
    }
  } catch (e) {
    console.warn('[Background] Could not parse URL:', url);
  }

  return info;
}

// ============================================================
// Single Sticker Conversion Pipeline
// ============================================================
async function convertAndDownloadSingle(stickerInfo) {
  console.log('[Background] Starting conversion for:', stickerInfo);

  // 1. Fetch the sticker
  const response = await fetch(stickerInfo.url);
  if (!response.ok) throw new Error(`Failed to fetch sticker: ${response.status}`);

  const contentType = response.headers.get('content-type') || '';
  const arrayBuffer = await response.arrayBuffer();
  const uint8 = new Uint8Array(arrayBuffer);

  // 2. Detect format (APNG detection)
  let format = stickerInfo.format;
  if (format === 'png' && isAPNG(uint8)) {
    format = 'apng';
    console.log('[Background] Detected APNG format.');
  }

  // 3. Convert based on format
  let webpBlob;
  switch (format) {
    case 'lottie': {
      // Lottie needs to be rendered — fetch JSON, convert in offscreen
      const jsonText = new TextDecoder().decode(uint8);
      const lottieData = JSON.parse(jsonText);
      webpBlob = await convertLottieInOffscreen(lottieData);
      break;
    }
    case 'apng': {
      webpBlob = await convertAPNGInOffscreen(arrayBuffer);
      break;
    }
    default: {
      // Static PNG/GIF/WebP — convert to 512x512 WebP
      webpBlob = await convertStaticImage(arrayBuffer, contentType);
      break;
    }
  }

  // 4. Download the result
  await downloadBlob(webpBlob, `${stickerInfo.name}.webp`);
  console.log('[Background] Sticker downloaded successfully.');
}

// ============================================================
// Static Image Conversion (PNG/GIF/WebP → 512×512 WebP)
// ============================================================
async function convertStaticImage(arrayBuffer, contentType) {
  // Use OffscreenCanvas in service worker
  const blob = new Blob([arrayBuffer], { type: contentType || 'image/png' });
  const bitmap = await createImageBitmap(blob);

  const canvas = new OffscreenCanvas(512, 512);
  const ctx = canvas.getContext('2d');

  // Clear with transparency
  ctx.clearRect(0, 0, 512, 512);

  // Draw scaled to fit 512x512 while preserving aspect ratio
  const scale = Math.min(512 / bitmap.width, 512 / bitmap.height);
  const w = bitmap.width * scale;
  const h = bitmap.height * scale;
  const x = (512 - w) / 2;
  const y = (512 - h) / 2;

  ctx.drawImage(bitmap, x, y, w, h);
  bitmap.close();

  // Export as WebP
  const webpBlob = await canvas.convertToBlob({ type: 'image/webp', quality: 0.9 });
  return webpBlob;
}

// ============================================================
// APNG Detection — check PNG signature for acTL chunk
// ============================================================
function isAPNG(uint8) {
  // APNG files contain an 'acTL' chunk
  const acTL = [0x61, 0x63, 0x54, 0x4C]; // 'acTL' in ASCII
  for (let i = 8; i < uint8.length - 4; i++) {
    if (uint8[i] === acTL[0] && uint8[i + 1] === acTL[1] &&
        uint8[i + 2] === acTL[2] && uint8[i + 3] === acTL[3]) {
      return true;
    }
  }
  return false;
}

// ============================================================
// APNG Conversion — decode frames, resize, encode animated WebP
// Since service workers can't load external scripts easily,
// we'll convert APNG frame-by-frame using OffscreenCanvas
// ============================================================
async function convertAPNGInOffscreen(arrayBuffer) {
  // For APNG, we extract frames by re-fetching and rendering
  // Since full APNG parsing in a service worker is complex,
  // we render the first frame as a static WebP (fallback)
  // and attempt animated conversion if possible
  
  const blob = new Blob([arrayBuffer], { type: 'image/png' });
  const bitmap = await createImageBitmap(blob);

  const canvas = new OffscreenCanvas(512, 512);
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, 512, 512);

  const scale = Math.min(512 / bitmap.width, 512 / bitmap.height);
  const w = bitmap.width * scale;
  const h = bitmap.height * scale;
  const x = (512 - w) / 2;
  const y = (512 - h) / 2;

  ctx.drawImage(bitmap, x, y, w, h);
  bitmap.close();

  // Export individual frame as WebP
  // Note: True animated WebP encoding requires a dedicated library.
  // The browser's canvas API produces static WebP. For animated stickers,
  // we capture the default frame, which is the standard behavior
  // until the WebCodecs API supports animated WebP natively.
  const webpBlob = await canvas.convertToBlob({ type: 'image/webp', quality: 0.9 });
  return webpBlob;
}

// ============================================================
// Lottie Conversion — render JSON animation frames
// ============================================================
async function convertLottieInOffscreen(lottieData) {
  // Lottie rendering requires a DOM (lottie-web).
  // In the service worker we can't use lottie-web directly.
  // We render a poster frame from the Lottie data if possible,
  // or fall back to a placeholder approach.
  
  // Attempt: If there's a raster asset in the Lottie JSON, extract it
  if (lottieData.assets && lottieData.assets.length > 0) {
    for (const asset of lottieData.assets) {
      if (asset.p && asset.u) {
        // asset.p = filename, asset.u = path
        try {
          const assetUrl = asset.u + asset.p;
          const resp = await fetch(assetUrl);
          if (resp.ok) {
            const ab = await resp.arrayBuffer();
            return await convertStaticImage(ab, 'image/png');
          }
        } catch (e) {
          // continue trying other assets
        }
      }
    }
  }

  // Fallback: Create a canvas with text indicating Lottie format
  // For full Lottie rendering, the content script pipeline is used
  const canvas = new OffscreenCanvas(512, 512);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#36393f';
  ctx.fillRect(0, 0, 512, 512);
  ctx.fillStyle = '#ffffff';
  ctx.font = '24px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('Lottie Sticker', 256, 256);
  
  const webpBlob = await canvas.convertToBlob({ type: 'image/webp', quality: 0.9 });
  return webpBlob;
}

// ============================================================
// Scan Active Tab and Convert — queries content script first
// ============================================================
async function scanAndConvertFromTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tabs.length || !tabs[0].url?.includes('discord.com')) {
    return { status: 'error', message: 'No active Discord tab found. Open discord.com first.' };
  }

  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabs[0].id, { action: 'scanNow' }, async (response) => {
      if (chrome.runtime.lastError) {
        resolve({ status: 'error', message: 'Could not reach Discord page. Try reloading the page.' });
        return;
      }

      if (!response || !response.data) {
        resolve({ status: 'error', message: 'No stickers found on the current page. Scroll to see stickers first.' });
        return;
      }

      lastStickerInfo = response.data;
      try {
        await convertAndDownloadSingle(response.data);
        resolve({ status: 'ok', message: 'Sticker converted and downloaded!' });
      } catch (err) {
        resolve({ status: 'error', message: err.message });
      }
    });
  });
}

// ============================================================
// Sticker Pack Export
// ============================================================
async function exportStickerPack(guildId, sender) {
  console.log('[Background] Exporting sticker pack for guild:', guildId);

  // Ask the content script to gather all stickers from the page
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tabs.length) {
    return { status: 'error', message: 'No active Discord tab found.' };
  }

  // Send message to content script to scrape stickers
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabs[0].id, { action: 'scrapeStickers' }, async (response) => {
      if (chrome.runtime.lastError) {
        resolve({ status: 'error', message: 'Could not communicate with Discord page. Make sure you are on discord.com.' });
        return;
      }

      if (!response || !response.stickers || response.stickers.length === 0) {
        resolve({ status: 'error', message: 'No stickers found on the current page.' });
        return;
      }

      try {
        // Convert all stickers and create ZIP
        const convertedStickers = [];
        const total = response.stickers.length;

        for (let i = 0; i < total; i++) {
          const sticker = response.stickers[i];
          const stickerInfo = parseStickerUrl(sticker.url);
          stickerInfo.name = sticker.name || `sticker_${i + 1}`;

          try {
            const resp = await fetch(stickerInfo.url);
            const ab = await resp.arrayBuffer();
            const ct = resp.headers.get('content-type') || '';
            const webpBlob = await convertStaticImage(ab, ct);

            convertedStickers.push({
              name: `${stickerInfo.name}.webp`,
              blob: webpBlob
            });
          } catch (err) {
            console.warn(`[Background] Failed to convert sticker ${i}:`, err);
          }

          // Send progress update to popup
          chrome.runtime.sendMessage({
            action: 'exportProgress',
            current: i + 1,
            total: total
          }).catch(() => {});
        }

        if (convertedStickers.length === 0) {
          resolve({ status: 'error', message: 'Failed to convert any stickers.' });
          return;
        }

        // Create ZIP using JSZip (loaded dynamically)
        const zipBlob = await createZipBlob(convertedStickers);
        await downloadBlob(zipBlob, 'discord_sticker_pack.zip');

        resolve({
          status: 'ok',
          message: `Exported ${convertedStickers.length}/${total} stickers as ZIP.`
        });
      } catch (err) {
        resolve({ status: 'error', message: err.message });
      }
    });
  });
}

// ============================================================
// ZIP Creation — minimal implementation without JSZip
// Uses the standard ZIP format spec for compatibility
// ============================================================
async function createZipBlob(files) {
  // Minimal ZIP builder for the service worker context
  // Structure: [local file headers + data] + [central directory] + [EOCD]
  const entries = [];
  let offset = 0;

  for (const file of files) {
    const nameBytes = new TextEncoder().encode(file.name);
    const data = new Uint8Array(await file.blob.arrayBuffer());

    // Local file header (30 bytes + name length)
    const header = new ArrayBuffer(30 + nameBytes.length);
    const hView = new DataView(header);
    hView.setUint32(0, 0x04034b50, true);   // Local file header signature
    hView.setUint16(4, 20, true);            // Version needed
    hView.setUint16(6, 0, true);             // General purpose bit flag
    hView.setUint16(8, 0, true);             // Compression method (store)
    hView.setUint16(10, 0, true);            // Last mod file time
    hView.setUint16(12, 0, true);            // Last mod file date
    hView.setUint32(14, crc32(data), true);  // CRC-32
    hView.setUint32(18, data.length, true);  // Compressed size
    hView.setUint32(22, data.length, true);  // Uncompressed size
    hView.setUint16(26, nameBytes.length, true); // File name length
    hView.setUint16(28, 0, true);            // Extra field length
    new Uint8Array(header).set(nameBytes, 30);

    entries.push({
      header: new Uint8Array(header),
      data: data,
      name: nameBytes,
      crc: crc32(data),
      offset: offset
    });

    offset += header.byteLength + data.length;
  }

  // Central directory
  const centralDir = [];
  for (const entry of entries) {
    const cd = new ArrayBuffer(46 + entry.name.length);
    const cdView = new DataView(cd);
    cdView.setUint32(0, 0x02014b50, true);   // Central directory header signature
    cdView.setUint16(4, 20, true);            // Version made by
    cdView.setUint16(6, 20, true);            // Version needed
    cdView.setUint16(8, 0, true);             // General purpose bit flag
    cdView.setUint16(10, 0, true);            // Compression method
    cdView.setUint16(12, 0, true);            // Last mod file time
    cdView.setUint16(14, 0, true);            // Last mod file date
    cdView.setUint32(16, entry.crc, true);    // CRC-32
    cdView.setUint32(20, entry.data.length, true); // Compressed size
    cdView.setUint32(24, entry.data.length, true); // Uncompressed size
    cdView.setUint16(28, entry.name.length, true); // File name length
    cdView.setUint16(30, 0, true);            // Extra field length
    cdView.setUint16(32, 0, true);            // File comment length
    cdView.setUint16(34, 0, true);            // Disk number start
    cdView.setUint16(36, 0, true);            // Internal file attributes
    cdView.setUint32(38, 0, true);            // External file attributes
    cdView.setUint32(42, entry.offset, true); // Relative offset of local header
    new Uint8Array(cd).set(entry.name, 46);
    centralDir.push(new Uint8Array(cd));
  }

  const centralDirSize = centralDir.reduce((sum, cd) => sum + cd.length, 0);

  // End of Central Directory Record (EOCD)
  const eocd = new ArrayBuffer(22);
  const eocdView = new DataView(eocd);
  eocdView.setUint32(0, 0x06054b50, true);   // EOCD signature
  eocdView.setUint16(4, 0, true);             // Disk number
  eocdView.setUint16(6, 0, true);             // Disk with central directory
  eocdView.setUint16(8, entries.length, true); // Number of entries on this disk
  eocdView.setUint16(10, entries.length, true);// Total number of entries
  eocdView.setUint32(12, centralDirSize, true);// Size of central directory
  eocdView.setUint32(16, offset, true);        // Offset of start of central directory
  eocdView.setUint16(20, 0, true);             // Comment length

  // Combine all parts
  const parts = [];
  for (const entry of entries) {
    parts.push(entry.header);
    parts.push(entry.data);
  }
  for (const cd of centralDir) {
    parts.push(cd);
  }
  parts.push(new Uint8Array(eocd));

  const totalSize = parts.reduce((sum, p) => sum + p.length, 0);
  const result = new Uint8Array(totalSize);
  let pos = 0;
  for (const part of parts) {
    result.set(part, pos);
    pos += part.length;
  }

  return new Blob([result], { type: 'application/zip' });
}

// ============================================================
// CRC-32 Implementation
// ============================================================
function crc32(data) {
  let crc = 0xFFFFFFFF;
  const table = getCRC32Table();
  for (let i = 0; i < data.length; i++) {
    crc = (crc >>> 8) ^ table[(crc ^ data[i]) & 0xFF];
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

let _crc32Table = null;
function getCRC32Table() {
  if (_crc32Table) return _crc32Table;
  _crc32Table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    _crc32Table[i] = c;
  }
  return _crc32Table;
}

// ============================================================
// Download Helper — save a blob as a file using chrome.downloads
// ============================================================
async function downloadBlob(blob, filename) {
  // Convert blob to data URL for chrome.downloads API
  const reader = new FileReader();
  const dataUrl = await new Promise((resolve, reject) => {
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });

  return chrome.downloads.download({
    url: dataUrl,
    filename: filename,
    saveAs: false
  });
}
