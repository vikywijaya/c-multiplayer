/**
 * Lightweight QRCode shim – renders a canvas with the URL as a visual placeholder
 * Drop-in replacement for qrcodejs when offline / no CDN access.
 * In production replace this with the real qrcodejs library.
 */
(function (global) {
  'use strict';

  function QRCode(el, opts) {
    if (typeof opts === 'string') opts = { text: opts };
    const text  = opts.text || '';
    const size  = opts.width || 160;

    // Try to use native canvas API to render a simple visual
    const canvas = document.createElement('canvas');
    canvas.width  = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');

    // White background
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, size, size);

    // Dark border
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 4;
    ctx.strokeRect(6, 6, size - 12, size - 12);

    // Simple checkerboard pattern in centre as placeholder
    const cell = 6;
    ctx.fillStyle = '#000';
    for (let r = 0; r < 20; r++) {
      for (let c = 0; c < 20; c++) {
        // Pseudo-random based on URL + position
        const hash = (text.charCodeAt((r * 20 + c) % Math.max(text.length, 1)) + r + c) % 3;
        if (hash === 0) {
          ctx.fillRect(16 + c * cell, 16 + r * cell, cell, cell);
        }
      }
    }

    // Corner squares (QR-style)
    const sq = (x, y) => {
      ctx.fillStyle = '#000';
      ctx.fillRect(x, y, 30, 30);
      ctx.fillStyle = '#fff';
      ctx.fillRect(x + 4, y + 4, 22, 22);
      ctx.fillStyle = '#000';
      ctx.fillRect(x + 9, y + 9, 12, 12);
    };
    sq(8, 8);
    sq(size - 38, 8);
    sq(8, size - 38);

    if (el) el.appendChild(canvas);
  }

  global.QRCode = QRCode;
})(typeof window !== 'undefined' ? window : this);
