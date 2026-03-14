/**
 * content.js — Content Script for Discord → WhatsApp Sticker Converter
 *
 * Runs on: https://discord.com/*
 *
 * Responsibilities:
 * - Detect sticker elements in the Discord DOM
 * - Show a floating "Convert" button when hovering over stickers
 * - Capture sticker image URLs
 * - Identify sticker format (PNG/APNG/Lottie)
 * - Send sticker data to the background script
 * - Scrape all visible stickers for pack export
 *
 * Note: Discord overrides the browser's native right-click context menu
 * with its own custom menu, so Chrome extension context menu items won't
 * appear. We use a floating button overlay instead.
 */

(() => {
  'use strict';

  // ============================================================
  // Constants — Discord sticker URL patterns
  // ============================================================
  const STICKER_URL_REGEX = /(?:media\.discordapp\.net|cdn\.discordapp\.com)\/stickers\/(\d+)\.(png|webp|gif|json)/i;
  const STICKER_CDN_PATTERN = /(?:media\.discordapp\.net|cdn\.discordapp\.com)\/stickers\//i;

  // Broader set of selectors to match Discord's rendered stickers
  // Discord uses hashed class names that change, so we also match by URL patterns
  const STICKER_CONTAINER_SELECTORS = [
    '[class*="stickerAsset"]',
    '[class*="sticker"] img',
    '[class*="Sticker"] img',
    '[data-type="sticker"]',
    '[class*="stickerContainer"]',
    '[class*="stickerWrapper"]',
    'img[class*="clickable"][src*="stickers"]',
    'img[src*="stickers"]'  // Broadest fallback
  ];

  // ============================================================
  // State
  // ============================================================
  let lastDetectedSticker = null;
  let floatingBtn = null;
  let currentHoveredSticker = null;

  // ============================================================
  // Floating Convert Button — appears on sticker hover
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

    // Click handler — convert the sticker
    floatingBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();

      if (currentHoveredSticker) {
        const stickerInfo = extractStickerInfo(currentHoveredSticker);
        console.log('[Content] Converting sticker:', stickerInfo);

        // Send to background for conversion
        chrome.runtime.sendMessage({
          action: 'stickerDetected',
          data: stickerInfo
        });

        chrome.runtime.sendMessage({
          action: 'convertLastSticker'
        }, (response) => {
          if (response && response.status === 'ok') {
            showToast('✅ Sticker converted & downloading!');
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
      // Small delay before hiding to allow click
      setTimeout(() => {
        if (!floatingBtn.matches(':hover') && !currentHoveredSticker?.matches(':hover')) {
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

    // Position above the sticker
    btn.style.left = `${rect.left + rect.width / 2}px`;
    btn.style.top = `${rect.top - 10}px`;
    btn.style.transform = 'translate(-50%, -100%)';
    btn.style.display = 'block';
  }

  function hideFloatingButton() {
    if (floatingBtn) {
      floatingBtn.style.display = 'none';
    }
    currentHoveredSticker = null;
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

    // Add animation keyframes
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
  // Sticker Detection — check if an element is a sticker
  // ============================================================
  function isStickerElement(element) {
    if (!element) return false;

    // Check direct src
    if (element.tagName === 'IMG' && element.src) {
      if (STICKER_CDN_PATTERN.test(element.src)) return true;
    }

    // Check if it has a sticker URL in srcset
    if (element.srcset && STICKER_CDN_PATTERN.test(element.srcset)) return true;

    // Check parent containers for sticker-related class names
    let parent = element;
    for (let i = 0; i < 5; i++) {
      if (!parent) break;
      const className = (parent.className || '').toString().toLowerCase();
      if (className.includes('sticker')) return true;
      parent = parent.parentElement;
    }

    // Check if child images have sticker URLs
    if (element.tagName !== 'IMG') {
      const imgs = element.querySelectorAll('img');
      for (const img of imgs) {
        if (STICKER_CDN_PATTERN.test(img.src)) return true;
      }
    }

    return false;
  }

  /**
   * Find the sticker image element from a target element
   * (the target might be a wrapper, not the img itself)
   */
  function findStickerImage(element) {
    // If it's an img with sticker URL, return directly
    if (element.tagName === 'IMG' && STICKER_CDN_PATTERN.test(element.src)) {
      return element;
    }

    // Search children for sticker img
    const img = element.querySelector('img[src*="stickers"]');
    if (img) return img;

    // Search siblings/parents
    let parent = element.parentElement;
    for (let i = 0; i < 5; i++) {
      if (!parent) break;
      const img = parent.querySelector('img[src*="stickers"]');
      if (img) return img;
      parent = parent.parentElement;
    }

    return null;
  }

  // ============================================================
  // Extract sticker info from an element
  // ============================================================
  function extractStickerInfo(element) {
    const imgEl = (element.tagName === 'IMG') ? element : findStickerImage(element);
    const url = imgEl?.src || '';

    const info = {
      url: url,
      id: null,
      format: 'png',
      name: 'sticker',
      width: imgEl?.naturalWidth || imgEl?.width || 0,
      height: imgEl?.naturalHeight || imgEl?.height || 0
    };

    // Parse the URL
    const match = url.match(STICKER_URL_REGEX);
    if (match) {
      info.id = match[1];
      const ext = match[2].toLowerCase();
      info.format = (ext === 'json') ? 'lottie' : ext;
    }

    // Get sticker name from alt text or aria-label
    const altText = imgEl?.alt || imgEl?.getAttribute('aria-label') || '';
    if (altText && altText.trim()) {
      info.name = altText.trim().replace(/[^a-zA-Z0-9_\-\s]/g, '').replace(/\s+/g, '_');
    }

    // Fallback name
    if (!info.name || info.name === 'sticker') {
      info.name = `sticker_${info.id || Date.now()}`;
    }

    // Clean the URL — remove size constraints, get full resolution
    if (info.id) {
      info.url = `https://media.discordapp.net/stickers/${info.id}.png?size=512`;
    }

    return info;
  }

  // ============================================================
  // Event Delegation — detect sticker hovers globally
  // ============================================================
  document.addEventListener('mouseover', (e) => {
    const target = e.target;

    // Check if we're hovering over a sticker or a sticker container
    if (isStickerElement(target)) {
      const stickerImg = findStickerImage(target) || target;
      currentHoveredSticker = stickerImg;
      showFloatingButton(stickerImg);
    }
  }, true);

  document.addEventListener('mouseout', (e) => {
    const target = e.target;
    const relatedTarget = e.relatedTarget;

    // Don't hide if moving to the floating button itself
    if (floatingBtn && (floatingBtn.contains(relatedTarget) || floatingBtn === relatedTarget)) {
      return;
    }

    // Don't hide if still within the same sticker area
    if (relatedTarget && isStickerElement(relatedTarget)) {
      return;
    }

    // Hide with a small delay to allow moving to the button
    setTimeout(() => {
      if (floatingBtn && !floatingBtn.matches(':hover')) {
        hideFloatingButton();
      }
    }, 200);
  }, true);

  // ============================================================
  // Right-click handler — intercept right-clicks on stickers
  // and send sticker info even if Discord blocks native menu
  // ============================================================
  document.addEventListener('contextmenu', (e) => {
    const target = e.target;

    if (isStickerElement(target) || (target.tagName === 'IMG' && STICKER_CDN_PATTERN.test(target.src))) {
      const stickerImg = findStickerImage(target) || target;
      const stickerInfo = extractStickerInfo(stickerImg);
      lastDetectedSticker = stickerInfo;

      // Notify background script
      chrome.runtime.sendMessage({
        action: 'stickerDetected',
        data: stickerInfo
      });

      console.log('[Content] Sticker detected on right-click:', stickerInfo);
    }
  }, true);

  // ============================================================
  // Periodic Scanner — scan for new stickers every few seconds
  // This catches stickers that MutationObserver might miss
  // ============================================================
  function scanForStickers() {
    const allImages = document.querySelectorAll('img');
    let count = 0;

    allImages.forEach(img => {
      if (STICKER_CDN_PATTERN.test(img.src) && !img.dataset.waConverterTracked) {
        img.dataset.waConverterTracked = 'true';
        count++;

        // Store the most recent sticker
        const info = extractStickerInfo(img);
        lastDetectedSticker = info;

        // Notify background
        chrome.runtime.sendMessage({
          action: 'stickerDetected',
          data: info
        });
      }
    });

    if (count > 0) {
      console.log(`[Content] Found ${count} new stickers.`);
    }
  }

  // ============================================================
  // MutationObserver — detect dynamically loaded stickers
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
      // Debounce scanning
      clearTimeout(observer._scanTimeout);
      observer._scanTimeout = setTimeout(scanForStickers, 500);
    }
  });

  // Start observing once the page is ready
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
        const stickers = scrapeAllStickers();
        sendResponse({ stickers });
        break;
      }

      case 'getLastSticker': {
        // If no sticker cached, try scanning  
        if (!lastDetectedSticker) {
          scanForStickers();
        }
        sendResponse({ data: lastDetectedSticker });
        break;
      }

      case 'scanNow': {
        scanForStickers();
        sendResponse({ data: lastDetectedSticker, status: 'ok' });
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
  // Scrape All Stickers — for full pack export
  // ============================================================
  function scrapeAllStickers() {
    const stickerSet = new Map();

    // Method 1: Find all images with sticker URLs
    document.querySelectorAll('img').forEach(img => {
      if (STICKER_CDN_PATTERN.test(img.src)) {
        const info = extractStickerInfo(img);
        if (info.id && !stickerSet.has(info.id)) {
          stickerSet.set(info.id, info);
        }
      }
    });

    // Method 2: Search using container selectors
    STICKER_CONTAINER_SELECTORS.forEach(selector => {
      try {
        document.querySelectorAll(selector).forEach(el => {
          const img = (el.tagName === 'IMG') ? el : el.querySelector('img');
          if (img && STICKER_CDN_PATTERN.test(img.src)) {
            const info = extractStickerInfo(img);
            if (info.id && !stickerSet.has(info.id)) {
              stickerSet.set(info.id, info);
            }
          }
        });
      } catch (e) {
        // Selector might be invalid, ignore
      }
    });

    const stickers = Array.from(stickerSet.values());
    console.log(`[Content] Scraped ${stickers.length} unique stickers.`);
    return stickers;
  }

  // ============================================================
  // Initialize
  // ============================================================
  function init() {
    console.log('[Content] Discord → WhatsApp Sticker Converter loaded.');
    scanForStickers();
    startObserving();

    // Periodic re-scan every 5 seconds
    setInterval(scanForStickers, 5000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
