/**
 * lottieHandler.js — Lottie Animation Rendering
 *
 * Uses lottie-web to render Lottie JSON animations frame-by-frame,
 * capture them via Canvas, and prepare them for WebP encoding.
 *
 * Pipeline:
 * Lottie JSON → render frames using lottie-web → capture frames via Canvas → return frames
 */

// ============================================================
// Lottie Handler Class
// ============================================================
class LottieHandler {
  /**
   * Render a Lottie animation and capture all frames
   * @param {Object} animationData - Parsed Lottie JSON data
   * @param {Object} options - Rendering options
   * @param {number} [options.width=512] - Output frame width
   * @param {number} [options.height=512] - Output frame height
   * @param {number} [options.fps=30] - Frames per second to capture
   * @returns {Promise<{frames: Blob[], delays: number[], duration: number}>}
   */
  static async renderFrames(animationData, options = {}) {
    const {
      width = 512,
      height = 512,
      fps = 30
    } = options;

    // Validate lottie-web is available
    if (typeof lottie === 'undefined') {
      throw new Error('lottie-web library is not loaded. Please ensure libs/lottie.min.js is included.');
    }

    // Create off-screen container for rendering
    const container = document.createElement('div');
    container.style.cssText = `
      width: ${width}px;
      height: ${height}px;
      position: fixed;
      left: -99999px;
      top: -99999px;
      overflow: hidden;
    `;
    document.body.appendChild(container);

    try {
      // Load the animation with canvas renderer
      const anim = lottie.loadAnimation({
        container: container,
        renderer: 'canvas',
        loop: false,
        autoplay: false,
        animationData: animationData,
        rendererSettings: {
          clearCanvas: true,
          progressiveLoad: false
        }
      });

      // Wait for animation to be fully loaded
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Lottie load timeout')), 10000);
        anim.addEventListener('DOMLoaded', () => {
          clearTimeout(timeout);
          resolve();
        });
        anim.addEventListener('error', (err) => {
          clearTimeout(timeout);
          reject(err);
        });
      });

      // Calculate frame information
      const totalFrames = anim.totalFrames;
      const animFps = anim.frameRate || 30;
      const duration = totalFrames / animFps;
      const frameDelay = Math.round(1000 / fps);

      // Calculate which animation frames to capture
      const captureCount = Math.min(Math.ceil(duration * fps), 300); // Cap at 300 frames
      const frameStep = totalFrames / captureCount;

      const frames = [];
      const delays = [];

      // Get the canvas element created by lottie
      const lottieCanvas = container.querySelector('canvas');
      if (!lottieCanvas) {
        throw new Error('Lottie canvas element not found');
      }

      // Capture each frame
      for (let i = 0; i < captureCount; i++) {
        const frameNum = Math.floor(i * frameStep);
        anim.goToAndStop(frameNum, true);

        // Create output canvas at target size
        const outCanvas = new OffscreenCanvas(width, height);
        const outCtx = outCanvas.getContext('2d');
        outCtx.clearRect(0, 0, width, height);
        outCtx.drawImage(lottieCanvas, 0, 0, width, height);

        // Convert to WebP blob
        const frameBlob = await outCanvas.convertToBlob({
          type: 'image/webp',
          quality: 0.85
        });

        frames.push(frameBlob);
        delays.push(frameDelay);
      }

      // Cleanup
      anim.destroy();

      return { frames, delays, duration };
    } finally {
      // Always remove the container
      if (container.parentNode) {
        document.body.removeChild(container);
      }
    }
  }

  /**
   * Render a single frame (poster/thumbnail) from a Lottie animation
   * @param {Object} animationData - Parsed Lottie JSON
   * @param {number} [frameNum=0] - Frame number to render
   * @returns {Promise<Blob>} - WebP blob of the rendered frame
   */
  static async renderSingleFrame(animationData, frameNum = 0) {
    if (typeof lottie === 'undefined') {
      throw new Error('lottie-web library is not loaded.');
    }

    const container = document.createElement('div');
    container.style.cssText = `
      width: 512px;
      height: 512px;
      position: fixed;
      left: -99999px;
      top: -99999px;
    `;
    document.body.appendChild(container);

    try {
      const anim = lottie.loadAnimation({
        container,
        renderer: 'canvas',
        loop: false,
        autoplay: false,
        animationData
      });

      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Timeout')), 10000);
        anim.addEventListener('DOMLoaded', () => {
          clearTimeout(timeout);
          resolve();
        });
      });

      anim.goToAndStop(frameNum, true);

      const lottieCanvas = container.querySelector('canvas');
      const outCanvas = new OffscreenCanvas(512, 512);
      const outCtx = outCanvas.getContext('2d');
      outCtx.clearRect(0, 0, 512, 512);
      outCtx.drawImage(lottieCanvas, 0, 0, 512, 512);

      anim.destroy();

      return outCanvas.convertToBlob({ type: 'image/webp', quality: 0.9 });
    } finally {
      if (container.parentNode) {
        document.body.removeChild(container);
      }
    }
  }

  /**
   * Validate Lottie JSON data structure
   * @param {Object} data - The data to validate
   * @returns {boolean}
   */
  static isValidLottie(data) {
    return (
      data &&
      typeof data === 'object' &&
      typeof data.v === 'string' &&     // version
      typeof data.fr === 'number' &&    // frame rate
      typeof data.ip === 'number' &&    // in point
      typeof data.op === 'number' &&    // out point
      typeof data.w === 'number' &&     // width
      typeof data.h === 'number' &&     // height
      Array.isArray(data.layers)        // layers array
    );
  }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = LottieHandler;
}
