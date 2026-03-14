/**
 * converter.js — Sticker Conversion Utilities
 *
 * Provides functions for converting sticker images to WhatsApp-compatible
 * WebP format (512×512, transparency preserved).
 *
 * Functions:
 * - convertPNGtoWebP(blob) → WebP Blob
 * - convertAPNGtoWebP(blob) → WebP Blob (first frame or animated)
 * - convertLottieToWebP(jsonData) → WebP Blob
 *
 * Uses Canvas API and OffscreenCanvas for rendering.
 */

// ============================================================
// Convert Static PNG/Image → 512×512 WebP
// ============================================================
async function convertPNGtoWebP(blob) {
  const bitmap = await createImageBitmap(blob);

  const canvas = new OffscreenCanvas(512, 512);
  const ctx = canvas.getContext('2d');

  // Clear canvas with transparency
  ctx.clearRect(0, 0, 512, 512);

  // Calculate scaling to fit 512×512 while preserving aspect ratio
  const scale = Math.min(512 / bitmap.width, 512 / bitmap.height);
  const w = bitmap.width * scale;
  const h = bitmap.height * scale;
  const x = (512 - w) / 2;
  const y = (512 - h) / 2;

  // Draw the image centered
  ctx.drawImage(bitmap, x, y, w, h);
  bitmap.close();

  // Export as WebP with high quality
  const webpBlob = await canvas.convertToBlob({
    type: 'image/webp',
    quality: 0.9
  });

  return webpBlob;
}

// ============================================================
// Convert APNG → WebP (extracts first frame as static WebP)
// For full animated WebP, see apngHandler.js
// ============================================================
async function convertAPNGtoWebP(blob) {
  // APNG can be rendered as a static image by createImageBitmap
  // which extracts the default/first frame
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

  const webpBlob = await canvas.convertToBlob({
    type: 'image/webp',
    quality: 0.9
  });

  return webpBlob;
}

// ============================================================
// Convert Lottie JSON → WebP
// Renders Lottie animation frames and exports as static WebP
// For animated rendering, see lottieHandler.js
// ============================================================
async function convertLottieToWebP(jsonData) {
  // Create a container for lottie-web rendering
  const container = document.createElement('div');
  container.style.width = '512px';
  container.style.height = '512px';
  container.style.position = 'fixed';
  container.style.left = '-9999px';
  container.style.top = '-9999px';
  document.body.appendChild(container);

  try {
    // Check if lottie library is available
    if (typeof lottie === 'undefined') {
      throw new Error('lottie-web library not available');
    }

    const anim = lottie.loadAnimation({
      container: container,
      renderer: 'canvas',
      loop: false,
      autoplay: false,
      animationData: jsonData
    });

    // Wait for animation to be ready
    await new Promise((resolve, reject) => {
      anim.addEventListener('DOMLoaded', resolve);
      anim.addEventListener('error', reject);
      setTimeout(reject, 5000); // Timeout after 5s
    });

    // Go to first frame
    anim.goToAndStop(0, true);

    // Get the canvas element
    const lottieCanvas = container.querySelector('canvas');
    if (!lottieCanvas) {
      throw new Error('Could not find Lottie canvas');
    }

    // Create output canvas at 512×512
    const outCanvas = new OffscreenCanvas(512, 512);
    const outCtx = outCanvas.getContext('2d');
    outCtx.clearRect(0, 0, 512, 512);
    outCtx.drawImage(lottieCanvas, 0, 0, 512, 512);

    // Cleanup
    anim.destroy();

    const webpBlob = await outCanvas.convertToBlob({
      type: 'image/webp',
      quality: 0.9
    });

    return webpBlob;
  } finally {
    document.body.removeChild(container);
  }
}

// ============================================================
// Convert multiple frames to animated WebP
// Note: Browser Canvas API does not natively support animated WebP
// encoding. This creates individual frame WebPs and returns them.
// ============================================================
async function convertFramesToWebP(frames, frameDelay = 100) {
  const results = [];

  for (const frame of frames) {
    const canvas = new OffscreenCanvas(512, 512);
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, 512, 512);

    if (frame instanceof ImageBitmap) {
      const scale = Math.min(512 / frame.width, 512 / frame.height);
      const w = frame.width * scale;
      const h = frame.height * scale;
      const x = (512 - w) / 2;
      const y = (512 - h) / 2;
      ctx.drawImage(frame, x, y, w, h);
    } else if (frame instanceof ImageData) {
      // Create temporary canvas for ImageData
      const tmpCanvas = new OffscreenCanvas(frame.width, frame.height);
      const tmpCtx = tmpCanvas.getContext('2d');
      tmpCtx.putImageData(frame, 0, 0);
      const scale = Math.min(512 / frame.width, 512 / frame.height);
      const w = frame.width * scale;
      const h = frame.height * scale;
      const x = (512 - w) / 2;
      const y = (512 - h) / 2;
      ctx.drawImage(tmpCanvas, x, y, w, h);
    }

    const webpBlob = await canvas.convertToBlob({
      type: 'image/webp',
      quality: 0.85
    });

    results.push(webpBlob);
  }

  return results;
}

// ============================================================
// Resize helper — resize an ImageData to 512×512
// ============================================================
function resizeImageData(imageData, targetWidth = 512, targetHeight = 512) {
  const srcCanvas = new OffscreenCanvas(imageData.width, imageData.height);
  const srcCtx = srcCanvas.getContext('2d');
  srcCtx.putImageData(imageData, 0, 0);

  const destCanvas = new OffscreenCanvas(targetWidth, targetHeight);
  const destCtx = destCanvas.getContext('2d');
  destCtx.clearRect(0, 0, targetWidth, targetHeight);

  const scale = Math.min(targetWidth / imageData.width, targetHeight / imageData.height);
  const w = imageData.width * scale;
  const h = imageData.height * scale;
  const x = (targetWidth - w) / 2;
  const y = (targetHeight - h) / 2;

  destCtx.drawImage(srcCanvas, x, y, w, h);

  return destCtx.getImageData(0, 0, targetWidth, targetHeight);
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    convertPNGtoWebP,
    convertAPNGtoWebP,
    convertLottieToWebP,
    convertFramesToWebP,
    resizeImageData
  };
}
