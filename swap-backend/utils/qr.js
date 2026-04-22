// utils/qr.js
const QRCode = require('qrcode');
const { v4: uuidv4 } = require('uuid');

/**
 * Generate a unique QR token for a pet
 */
function generateQRToken() {
  return `swap_${uuidv4().replace(/-/g, '').substring(0, 16)}`;
}

/**
 * Generate QR code as base64 data URL
 * @param {string} petId - Pet UUID
 * @param {string} token - QR token
 * @param {string} baseUrl - Your domain base URL
 */
async function generateQRCode(petId, token, baseUrl) {
  const url = `${baseUrl}/pet/${token}`;
  
  try {
    const qrDataUrl = await QRCode.toDataURL(url, {
      errorCorrectionLevel: 'H',
      type: 'image/png',
      quality: 0.95,
      margin: 2,
      width: 300,
      color: {
        dark: '#141C27',
        light: '#FFFFFF',
      },
    });
    return { url, qrDataUrl, token };
  } catch (err) {
    throw new Error('QR generation failed: ' + err.message);
  }
}

/**
 * Generate QR code as SVG string
 */
async function generateQRCodeSVG(token, baseUrl) {
  const url = `${baseUrl}/pet/${token}`;
  try {
    const svg = await QRCode.toString(url, {
      type: 'svg',
      errorCorrectionLevel: 'H',
      margin: 2,
      color: { dark: '#141C27', light: '#FFFFFF' },
    });
    return { url, svg, token };
  } catch (err) {
    throw new Error('QR SVG generation failed: ' + err.message);
  }
}

module.exports = { generateQRToken, generateQRCode, generateQRCodeSVG };
