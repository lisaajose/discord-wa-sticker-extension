/**
 * content.js — Content Script for Discord → WhatsApp Sticker Converter
 *
 * Runs on: https://discord.com/*
 *
 * Responsibilities:
 * - Detect sticker elements in the Discord DOM
 * - Capture sticker image URLs
 * - Identify sticker format (PNG/APNG/Lottie)
 * - Send sticker data to the background script
 * - Handle right-click context for sticker detection
 * - Scrape all visible stickers for pack export
 */

// ============================================================
// Constants
// ============================================================
const STICKER_SELECTORS = [
  'img[src*="/stickers/"]',
  'img[data-type="sticker"]',
  '[class*="stickerAsset"]',
  '[class*="sticker"] img',
  'img[src*="media.discordapp.net/stickers"]',
  'img[src*="cdn.discordapp.com/stickers"]'
];

const STICKER_URL_PATTERNS = [
  /media\.discordapp\.net\/stickers\/\d+/,
  /cdn\.discordapp\.com\/stickers\/\d+/
];

// ============================================================
// Track last right-clicked sticker
// ============================================================
let lastRightClickedSticker = null;

// ============================================================
// Right-Click Detection — identify sticker on context menu
// ============================================================
document.addEventListener('contextmenu', (event) => {
  const target = event.target;

  // Check if the right-clicked element is a sticker image
  if (target.tagName === 'IMG' && isStickerUrl(target.src)) {
    const stickerInfo = extractStickerInfo(target);
    lastRightClickedSticker = stickerInfo;

    // Send to background script
    chrome.runtime.sendMessage({
      action: 'stickerDetected',
      data: stickerInfo
    });

    console.log('[Content] Sticker detected on right-click:', stickerInfo);
  }
}, true);

// ============================================================
// MutationObserver — detect dynamically loaded stickers
// ============================================================
const observer = new MutationObserver((mutations) => {
  for (const mutation of mutations) {
    for (const node of mutation.addedNodes) {
      if (node.nodeType !== Node.ELEMENT_NODE) continue;

      // Check if the added node itself is a sticker
      if (node.tagName === 'IMG' && isStickerUrl(node.src)) {
        markSticker(node);
      }

      // Check children for sticker images
      const imgs = node.querySelectorAll ? node.querySelectorAll('img') : [];
      imgs.forEach(img => {
        if (isStickerUrl(img.src)) {
          markSticker(img);
        }
      });
    }
  }
});

// Start observing
observer.observe(document.body, {
  childList: true,
  subtree: true
});

// ============================================================
// Initial scan — find stickers already on the page
// ============================================================
function initialScan() {
  STICKER_SELECTORS.forEach(selector => {
    document.querySelectorAll(selector).forEach(el => {
      if (el.tagName === 'IMG' && isStickerUrl(el.src)) {
        markSticker(el);
      }
    });
  });
}

// Run initial scan when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initialScan);
} else {
  initialScan();
}

// ============================================================
// Helper — check if a URL is a Discord sticker URL
// ============================================================
function isStickerUrl(url) {
  if (!url) return false;
  return STICKER_URL_PATTERNS.some(pattern => pattern.test(url));
}

// ============================================================
// Helper — extract sticker info from an image element
// ============================================================
function extractStickerInfo(imgElement) {
  const url = imgElement.src;
  const info = {
    url: url,
    id: null,
    format: 'png',
    name: 'sticker',
    width: imgElement.naturalWidth || imgElement.width,
    height: imgElement.naturalHeight || imgElement.height
  };

  try {
    const parsed = new URL(url);
    const pathParts = parsed.pathname.split('/');
    const filename = pathParts[pathParts.length - 1];

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

    // Try to get the sticker name from surrounding DOM
    const parent = imgElement.closest('[class*="sticker"]') || imgElement.parentElement;
    if (parent) {
      const altText = imgElement.alt || imgElement.getAttribute('aria-label') || '';
      if (altText) {
        info.name = altText.replace(/[^a-zA-Z0-9_-]/g, '_');
      }
    }

    if (!info.name || info.name === 'sticker') {
      info.name = `sticker_${info.id || Date.now()}`;
    }
  } catch (e) {
    console.warn('[Content] Error extracting sticker info:', e);
  }

  return info;
}

// ============================================================
// Helper — mark a sticker element (add visual indicator)
// ============================================================
function markSticker(imgElement) {
  if (imgElement.dataset.stickerConverterDetected) return;
  imgElement.dataset.stickerConverterDetected = 'true';

  // Add a subtle border on hover to indicate the sticker is convertible
  imgElement.addEventListener('mouseenter', () => {
    imgElement.style.outline = '2px solid #5865F2';
    imgElement.style.outlineOffset = '2px';
    imgElement.style.borderRadius = '4px';
    imgElement.style.cursor = 'pointer';
  });

  imgElement.addEventListener('mouseleave', () => {
    imgElement.style.outline = '';
    imgElement.style.outlineOffset = '';
    imgElement.style.borderRadius = '';
    imgElement.style.cursor = '';
  });
}

// ============================================================
// Message Listener — handle requests from background/popup
// ============================================================
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.action) {
    case 'scrapeStickers':
      // Scrape all visible stickers on the page
      const stickers = scrapeAllStickers();
      sendResponse({ stickers });
      break;

    case 'getLastSticker':
      sendResponse({ data: lastRightClickedSticker });
      break;

    case 'ping':
      sendResponse({ status: 'ok' });
      break;

    default:
      sendResponse({ status: 'unknown' });
  }
});

// ============================================================
// Scrape All Stickers — for full pack export
// ============================================================
function scrapeAllStickers() {
  const stickerSet = new Map(); // Use Map to deduplicate by ID

  STICKER_SELECTORS.forEach(selector => {
    document.querySelectorAll(selector).forEach(el => {
      let imgEl = el;
      if (el.tagName !== 'IMG') {
        const img = el.querySelector('img');
        if (img) imgEl = img;
        else return;
      }

      if (!isStickerUrl(imgEl.src)) return;

      const info = extractStickerInfo(imgEl);
      if (info.id && !stickerSet.has(info.id)) {
        stickerSet.set(info.id, info);
      }
    });
  });

  // Also check all images on the page as a fallback
  document.querySelectorAll('img').forEach(img => {
    if (isStickerUrl(img.src)) {
      const info = extractStickerInfo(img);
      if (info.id && !stickerSet.has(info.id)) {
        stickerSet.set(info.id, info);
      }
    }
  });

  const stickers = Array.from(stickerSet.values());
  console.log(`[Content] Scraped ${stickers.length} unique stickers.`);
  return stickers;
}

console.log('[Content] Discord → WhatsApp Sticker Converter content script loaded.');
