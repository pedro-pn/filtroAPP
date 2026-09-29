import { createCanvas, loadImage } from '@napi-rs/canvas';

import { parseSignatureImageDataUrl } from '../signatures/common.js';

// Remove the empty canvas around a drawn signature (and white margins in uploads).
// The same cropped image is used by the final PDF and the live preview.
export async function signatureInkImage(dataUrl) {
  const parsed = parseSignatureImageDataUrl(dataUrl);
  if (!parsed) throw new Error('Imagem de assinatura inválida.');
  const image = await loadImage(parsed.bytes);
  const canvas = createCanvas(image.width, image.height);
  const context = canvas.getContext('2d');
  context.drawImage(image, 0, 0);
  const { data } = context.getImageData(0, 0, image.width, image.height);
  let left = image.width;
  let top = image.height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const offset = (y * image.width + x) * 4;
      const alpha = data[offset + 3];
      if (alpha < 32 || (data[offset] > 245 && data[offset + 1] > 245 && data[offset + 2] > 245)) continue;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  }
  if (right < left) return canvas.toBuffer('image/png');
  const width = right - left + 1;
  const height = bottom - top + 1;
  if (width === image.width && height === image.height) return canvas.toBuffer('image/png');
  const cropped = createCanvas(width, height);
  cropped.getContext('2d').drawImage(canvas, left, top, width, height, 0, 0, width, height);
  return cropped.toBuffer('image/png');
}
