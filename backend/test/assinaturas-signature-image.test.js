import assert from 'node:assert/strict';
import test from 'node:test';
import { createCanvas, loadImage } from '@napi-rs/canvas';

import { signatureInkImage } from '../src/lib/assinaturas/signature-image.js';

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
