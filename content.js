/**
 * content.js — Content Script for Discord → WhatsApp Sticker Converter
 *
 * Runs on: https://discord.com/*
 *
 * Responsibilities:
 * - Detect STICKER and EMOJI elements in the Discord DOM
 * - Show a floating "Convert" button when hovering over stickers or emojis
 * - Capture image URLs for both stickers and custom emojis
 * - Identify format (PNG/APNG/GIF/Lottie)
 * - Send data to the background script for conversion
 * - Scrape all visible stickers + emojis for pack export
 *
 * Discord CDN patterns:
 *   Stickers: https://media.discordapp.net/stickers/{id}.png
 *             https://cdn.discordapp.com/stickers/{id}.png|json
 *   Emojis:   https://cdn.discordapp.com/emojis/{id}.png|gif|webp
 *             https://media.discordapp.net/emojis/{id}.png|gif|webp
 *
 * Note: Discord overrides the browser's native right-click context menu
 * with its own custom menu, so we use a floating button overlay instead.
 */

(() => {
  'use strict';

  // ============================================================
  // Constants — Discord sticker AND emoji URL patterns
  // ============================================================

  // Matches sticker URLs: /stickers/{id}.{ext}
  const STICKER_URL_REGEX = /(?:media\.discordapp\.net|cdn\.discordapp\.com)\/stickers\/(\d+)\.(png|webp|gif|json)/i;
  const STICKER_CDN_PATTERN = /(?:media\.discordapp\.net|cdn\.discordapp\.com)\/stickers\//i;

  // Matches emoji URLs: /emojis/{id}.{ext}
  const EMOJI_URL_REGEX = /(?:media\.discordapp\.net|cdn\.discordapp\.com)\/emojis\/(\d+)\.(png|webp|gif)/i;
  const EMOJI_CDN_PATTERN = /(?:media\.discordapp\.net|cdn\.discordapp\.com)\/emojis\//i;

  // Combined pattern — matches either stickers or emojis
  const DISCORD_ASSET_PATTERN = /(?:media\.discordapp\.net|cdn\.discordapp\.com)\/(?:stickers|emojis)\//i;

  // Selectors for sticker/emoji containers in Discord's DOM
  const ASSET_CONTAINER_SELECTORS = [
    // Sticker selectors
    '[class*="stickerAsset"]',
    '[class*="sticker"] img',
    '[class*="Sticker"] img',
    '[data-type="sticker"]',
    '[class*="stickerContainer"]',
    // Emoji selectors
    '[class*="emoji"]',
    'img[class*="emoji"]',
    'img[data-type="emoji"]',
    '[class*="emojiContainer"]',
    // Broad fallbacks
    'img[src*="stickers"]',
    'img[src*="emojis"]'
  ];

  // ============================================================
  // State
  // ============================================================
  let lastDetectedAsset = null;
  let floatingBtn = null;
  let currentHoveredAsset = null;

  // ============================================================
  // Floating Convert Button — appears on sticker/emoji hover
  // ============================================================
  function createFloatingButton() {
    if (floatingBtn) return floatingBtn;

    floatingBtn = document.createElement('div');
    floatingBtn.id = 'wa-sticker-convert-btn';
    floatingBtn.innerHTML = `
      <div style="
        display: flex;
        align-items: center;
        gap: 6px;
        background: linear-gradient(135deg, #25D366 0%, #128C7E 100%);
        color: white;
        padding: 6px 12px;
        border-radius: 6px;
        font-size: 12px;
        font-weight: 600;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        cursor: pointer;
        box-shadow: 0 2px 10px rgba(0,0,0,0.3);
        white-space: nowrap;
        z-index: 999999;
        user-select: none;
        transition: transform 0.15s ease, box-shadow 0.15s ease;
      ">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
          <polyline points="7 10 12 15 17 10"/>
          <line x1="12" y1="15" x2="12" y2="3"/>
        </svg>
        Convert to WhatsApp
      </div>
    `;

    floatingBtn.style.cssText = `
      position: fixed;
      z-index: 999999;
      pointer-events: auto;
      display: none;
    `;

    // Click handler — convert the sticker/emoji
    floatingBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();

      if (currentHoveredAsset) {
        const assetInfo = extractAssetInfo(currentHoveredAsset);
        console.log('[Content] Converting:', assetInfo);

        // Send to background for conversion
        chrome.runtime.sendMessage({
          action: 'stickerDetected',
          data: assetInfo
        });

        chrome.runtime.sendMessage({
          action: 'convertLastSticker'
        }, (response) => {
          if (response && response.status === 'ok') {
            showToast('✅ Converted & downloading!');
          } else {
            showToast('❌ ' + (response?.message || 'Conversion failed'));
          }
        });
      }

      hideFloatingButton();
    });

    // Hover effect
    floatingBtn.addEventListener('mouseenter', () => {
      floatingBtn.firstElementChild.style.transform = 'scale(1.05)';
      floatingBtn.firstElementChild.style.boxShadow = '0 4px 16px rgba(0,0,0,0.4)';
    });
    floatingBtn.addEventListener('mouseleave', () => {
      floatingBtn.firstElementChild.style.transform = '';
      floatingBtn.firstElementChild.style.boxShadow = '0 2px 10px rgba(0,0,0,0.3)';
      setTimeout(() => {
        if (!floatingBtn.matches(':hover') && !currentHoveredAsset?.matches(':hover')) {
          hideFloatingButton();
        }
      }, 300);
    });

    document.body.appendChild(floatingBtn);
    return floatingBtn;
  }

  function showFloatingButton(element) {
    const btn = createFloatingButton();
    const rect = element.getBoundingClientRect();

    // Position above the element
    btn.style.left = `${rect.left + rect.width / 2}px`;
    btn.style.top = `${rect.top - 10}px`;
    btn.style.transform = 'translate(-50%, -100%)';
    btn.style.display = 'block';
  }

  function hideFloatingButton() {
    if (floatingBtn) {
      floatingBtn.style.display = 'none';
    }
    currentHoveredAsset = null;
  }

  // ============================================================
  // Toast Notification
  // ============================================================
  function showToast(message) {
    const existing = document.getElementById('wa-sticker-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.id = 'wa-sticker-toast';
    toast.textContent = message;
    toast.style.cssText = `
      position: fixed;
      bottom: 24px;
      left: 50%;
      transform: translateX(-50%);
      background: #2b2d31;
      color: #dbdee1;
      padding: 10px 20px;
      border-radius: 8px;
      font-size: 13px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      box-shadow: 0 4px 20px rgba(0,0,0,0.4);
      z-index: 999999;
      border: 1px solid rgba(255,255,255,0.06);
      animation: waToastIn 0.3s ease;
    `;

    if (!document.getElementById('wa-sticker-styles')) {
      const style = document.createElement('style');
      style.id = 'wa-sticker-styles';
      style.textContent = `
        @keyframes waToastIn {
          from { opacity: 0; transform: translateX(-50%) translateY(10px); }
          to { opacity: 1; transform: translateX(-50%) translateY(0); }
        }
      `;
      document.head.appendChild(style);
    }

    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
  }

  // ============================================================
  // Asset Detection — check if an element is a sticker OR emoji
  // ============================================================
  function isConvertibleAsset(element) {
    if (!element) return false;

    // Check direct src for sticker or emoji URL
    if (element.tagName === 'IMG' && element.src) {
      if (DISCORD_ASSET_PATTERN.test(element.src)) return true;
    }

    // Check srcset
    if (element.srcset && DISCORD_ASSET_PATTERN.test(element.srcset)) return true;

    // Check parent containers for sticker/emoji class names
    let parent = element;
    for (let i = 0; i < 5; i++) {
      if (!parent) break;
      const className = (parent.className || '').toString().toLowerCase();
      if (className.includes('sticker') || className.includes('emoji')) {
        // Verify there's actually an img with a Discord CDN URL
        const img = parent.querySelector('img');
        if (img && DISCORD_ASSET_PATTERN.test(img.src)) return true;
      }
      parent = parent.parentElement;
    }

    // Check child images
    if (element.tagName !== 'IMG') {
      const imgs = element.querySelectorAll('img');
      for (const img of imgs) {
        if (DISCORD_ASSET_PATTERN.test(img.src)) return true;
      }
    }

    return false;
  }

  /**
   * Find the asset image element from a target element
   */
  function findAssetImage(element) {
    // Direct img with sticker/emoji URL
    if (element.tagName === 'IMG' && DISCORD_ASSET_PATTERN.test(element.src)) {
      return element;
    }

    // Search children
    const img = element.querySelector('img[src*="stickers"], img[src*="emojis"]');
    if (img) return img;

    // Search parents
    let parent = element.parentElement;
    for (let i = 0; i < 5; i++) {
      if (!parent) break;
      const img = parent.querySelector('img[src*="stickers"], img[src*="emojis"]');
      if (img) return img;
      parent = parent.parentElement;
    }

    return null;
  }

  // ============================================================
  // Extract asset info (works for both stickers and emojis)
  // ============================================================
  function extractAssetInfo(element) {
    const imgEl = (element.tagName === 'IMG') ? element : findAssetImage(element);
    const url = imgEl?.src || '';

    const info = {
      url: url,
      id: null,
      type: 'unknown', // 'sticker' or 'emoji'
      format: 'png',
      name: 'asset',
      width: imgEl?.naturalWidth || imgEl?.width || 0,
      height: imgEl?.naturalHeight || imgEl?.height || 0
    };

    // Try sticker URL first
    let match = url.match(STICKER_URL_REGEX);
    if (match) {
      info.id = match[1];
      info.type = 'sticker';
      const ext = match[2].toLowerCase();
      info.format = (ext === 'json') ? 'lottie' : ext;
    } else {
      // Try emoji URL
      match = url.match(EMOJI_URL_REGEX);
      if (match) {
        info.id = match[1];
        info.type = 'emoji';
        info.format = match[2].toLowerCase();
      }
    }

    // Get name from alt text or aria-label
    const altText = imgEl?.alt || imgEl?.getAttribute('aria-label') || '';
    if (altText && altText.trim()) {
      // Discord emoji alt text is usually like ":emoji_name:" — strip colons
      let cleanName = altText.trim().replace(/^:+|:+$/g, '');
      cleanName = cleanName.replace(/[^a-zA-Z0-9_\-\s]/g, '').replace(/\s+/g, '_');
      if (cleanName) info.name = cleanName;
    }

    // Fallback name
    if (info.name === 'asset' || !info.name) {
      info.name = `${info.type}_${info.id || Date.now()}`;
    }

    // Build clean full-resolution URL
    if (info.id) {
      if (info.type === 'sticker') {
        info.url = `https://media.discordapp.net/stickers/${info.id}.png?size=512`;
      } else if (info.type === 'emoji') {
        // For emojis, use the original format but request large size
        // GIF emojis are animated, PNG are static
        const ext = info.format === 'gif' ? 'gif' : 'png';
        info.url = `https://cdn.discordapp.com/emojis/${info.id}.${ext}?size=512&quality=lossless`;
      }
    }

    return info;
  }

  // ============================================================
  // Event Delegation — detect sticker/emoji hovers
  // ============================================================
  document.addEventListener('mouseover', (e) => {
    const target = e.target;

    if (isConvertibleAsset(target)) {
      const assetImg = findAssetImage(target) || target;
      currentHoveredAsset = assetImg;
      showFloatingButton(assetImg);
    }
  }, true);

  document.addEventListener('mouseout', (e) => {
    const relatedTarget = e.relatedTarget;

    // Don't hide if moving to the floating button
    if (floatingBtn && (floatingBtn.contains(relatedTarget) || floatingBtn === relatedTarget)) {
      return;
    }

    // Don't hide if still within a convertible asset
    if (relatedTarget && isConvertibleAsset(relatedTarget)) {
      return;
    }

    setTimeout(() => {
      if (floatingBtn && !floatingBtn.matches(':hover')) {
        hideFloatingButton();
      }
    }, 200);
  }, true);

  // ============================================================
  // Right-click handler — send asset info to background
  // ============================================================
  document.addEventListener('contextmenu', (e) => {
    const target = e.target;

    if (isConvertibleAsset(target) || (target.tagName === 'IMG' && DISCORD_ASSET_PATTERN.test(target.src))) {
      const assetImg = findAssetImage(target) || target;
      const assetInfo = extractAssetInfo(assetImg);
      lastDetectedAsset = assetInfo;

      chrome.runtime.sendMessage({
        action: 'stickerDetected',
        data: assetInfo
      });

      console.log(`[Content] ${assetInfo.type} detected on right-click:`, assetInfo);
    }
  }, true);

  // ============================================================
  // Periodic Scanner — scan for new stickers AND emojis
  // ============================================================
  function scanForAssets() {
    const allImages = document.querySelectorAll('img');
    let count = 0;

    allImages.forEach(img => {
      if (DISCORD_ASSET_PATTERN.test(img.src) && !img.dataset.waConverterTracked) {
        img.dataset.waConverterTracked = 'true';
        count++;

        const info = extractAssetInfo(img);
        lastDetectedAsset = info;

        chrome.runtime.sendMessage({
          action: 'stickerDetected',
          data: info
        });
      }
    });

    if (count > 0) {
      console.log(`[Content] Found ${count} new stickers/emojis.`);
    }
  }

  // ============================================================
  // MutationObserver — detect dynamically loaded content
  // ============================================================
  const observer = new MutationObserver((mutations) => {
    let hasNewNodes = false;
    for (const mutation of mutations) {
      if (mutation.addedNodes.length > 0) {
        hasNewNodes = true;
        break;
      }
    }
    if (hasNewNodes) {
      clearTimeout(observer._scanTimeout);
      observer._scanTimeout = setTimeout(scanForAssets, 500);
    }
  });

  function startObserving() {
    const chatContainer = document.querySelector('[class*="chat"]') || document.body;
    observer.observe(chatContainer, {
      childList: true,
      subtree: true
    });
    console.log('[Content] MutationObserver started on:', chatContainer.tagName);
  }

  // ============================================================
  // Message Listener — handle requests from background/popup
  // ============================================================
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message.action) {
      case 'scrapeStickers': {
        const assets = scrapeAllAssets();
        sendResponse({ stickers: assets }); // keep key name for back-compat
        break;
      }

      case 'getLastSticker': {
        if (!lastDetectedAsset) scanForAssets();
        sendResponse({ data: lastDetectedAsset });
        break;
      }

      case 'scanNow': {
        scanForAssets();
        sendResponse({ data: lastDetectedAsset, status: 'ok' });
        break;
      }

      case 'ping': {
        sendResponse({ status: 'ok' });
        break;
      }

      default:
        sendResponse({ status: 'unknown' });
    }
  });

  // ============================================================
  // Scrape All Assets — stickers + emojis for pack export
  // ============================================================
  function scrapeAllAssets() {
    const assetSet = new Map();

    // Find all images with sticker OR emoji URLs
    document.querySelectorAll('img').forEach(img => {
      if (DISCORD_ASSET_PATTERN.test(img.src)) {
        const info = extractAssetInfo(img);
        if (info.id && !assetSet.has(info.id)) {
          assetSet.set(info.id, info);
        }
      }
    });

    // Also search using container selectors
    ASSET_CONTAINER_SELECTORS.forEach(selector => {
      try {
        document.querySelectorAll(selector).forEach(el => {
          const img = (el.tagName === 'IMG') ? el : el.querySelector('img');
          if (img && DISCORD_ASSET_PATTERN.test(img.src)) {
            const info = extractAssetInfo(img);
            if (info.id && !assetSet.has(info.id)) {
              assetSet.set(info.id, info);
            }
          }
        });
      } catch (e) {
        // Selector might be invalid, ignore
      }
    });

    const assets = Array.from(assetSet.values());
    console.log(`[Content] Scraped ${assets.length} unique stickers/emojis.`);
    return assets;
  }

  // ============================================================
  // Initialize
  // ============================================================
  function init() {
    console.log('[Content] Discord → WhatsApp Sticker/Emoji Converter loaded.');
    scanForAssets();
    startObserving();
    setInterval(scanForAssets, 5000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
