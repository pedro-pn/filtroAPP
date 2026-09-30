import assert from 'node:assert/strict';
import test from 'node:test';
import { createCanvas, loadImage } from '@napi-rs/canvas';

import { MAX_SIGNATURE_IMAGE_BYTES, MAX_SIGNATURE_IMAGE_DATA_URL_LENGTH } from '../src/lib/assinaturas/image-limits.js';
import { signatureInkImage } from '../src/lib/assinaturas/signature-image.js';
import { decodableSignatureImageDataUrl, parseSignatureImageDataUrl } from '../src/lib/signatures/common.js';

test('remove margens vazias da assinatura desenhada e da imagem enviada', async () => {
  for (const background of ['transparent', 'white']) {
    const canvas = createCanvas(100, 50);
    const context = canvas.getContext('2d');
    if (background === 'white') {
      context.fillStyle = '#fff';
      context.fillRect(0, 0, 100, 50);
    }
    context.fillStyle = '#111827';
    context.fillRect(30, 15, 40, 12);
    const dataUrl = `data:image/png;base64,${canvas.toBuffer('image/png').toString('base64')}`;
    const cropped = await loadImage(await signatureInkImage(dataUrl));
    assert.equal(cropped.width, 40);
    assert.equal(cropped.height, 12);
  }
});

test('imagem JPEG enviada também é convertida para uma assinatura sem margens brancas', async () => {
  const canvas = createCanvas(100, 50);
  const context = canvas.getContext('2d');
  context.fillStyle = '#fff';
  context.fillRect(0, 0, 100, 50);
  context.fillStyle = '#000';
  context.fillRect(30, 15, 40, 12);
  const dataUrl = `data:image/jpeg;base64,${canvas.toBuffer('image/jpeg').toString('base64')}`;
  const cropped = await loadImage(await signatureInkImage(dataUrl));
  assert.ok(cropped.width < 60 && cropped.width >= 40);
  assert.ok(cropped.height < 30 && cropped.height >= 12);
});

test('imagem válida acima do limite antigo pode ser recebida e renderizada na assinatura avulsa', async () => {
  const canvas = createCanvas(1024, 768);
  const context = canvas.getContext('2d');
  const image = context.createImageData(canvas.width, canvas.height);
  let seed = 1;
  for (let index = 0; index < image.data.length; index += 4) {
    for (let color = 0; color < 3; color += 1) {
      seed = ((seed * 1664525) + 1013904223) >>> 0;
      image.data[index + color] = seed >>> 24;
    }
    image.data[index + 3] = 255;
  }
  context.putImageData(image, 0, 0);
  const bytes = canvas.toBuffer('image/png');
  const dataUrl = `data:image/png;base64,${bytes.toString('base64')}`;

  assert.ok(bytes.length > 1.5 * 1024 * 1024);
  assert.ok(bytes.length <= MAX_SIGNATURE_IMAGE_BYTES);
  assert.ok(dataUrl.length <= MAX_SIGNATURE_IMAGE_DATA_URL_LENGTH);
  assert.equal(parseSignatureImageDataUrl(dataUrl), null, 'outros fluxos preservam o limite anterior');
  assert.ok(await decodableSignatureImageDataUrl(dataUrl, { maxBytes: MAX_SIGNATURE_IMAGE_BYTES }));
  assert.ok((await signatureInkImage(dataUrl)).length > 0);

  const oversizedBytes = Buffer.concat([bytes, Buffer.alloc(MAX_SIGNATURE_IMAGE_BYTES + 1 - bytes.length)]);
  const oversizedDataUrl = `data:image/png;base64,${oversizedBytes.toString('base64')}`;
  assert.equal(parseSignatureImageDataUrl(oversizedDataUrl, { maxBytes: MAX_SIGNATURE_IMAGE_BYTES }), null);
});
