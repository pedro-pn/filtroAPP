import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createCanvas } from '@napi-rs/canvas';
import { degrees, PDFDocument, StandardFonts } from 'pdf-lib';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

import env from '../src/config/env.js';
import { sourcePdfBuffer, storeSourcePdf } from '../src/lib/assinaturas/document.js';
import { renderPage } from '../src/lib/assinaturas/preview.js';

test('prévia usa glifos das fontes padrão do PDF sem depender das fontes instaladas no servidor', async t => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'assinaturas-preview-'));
  t.after(() => fs.rm(rootDir, { recursive: true, force: true }));
  const source = await PDFDocument.create();
  for (const [index, name] of [StandardFonts.Helvetica, StandardFonts.TimesRoman].entries()) {
    const page = source.addPage([320, 200]);
    const font = await source.embedFont(name);
    page.drawText('Assinatura legível: João e Maria', { x: 15, y: 140, size: 16, font });
    if (index === 1) page.setRotation(degrees(90));
  }
  const bytes = Buffer.from(await source.save());
  const document = {
    id: 'preview-fonts', pageCount: 2,
    sourceStoragePath: await storeSourcePdf({ fileName: 'fontes.pdf', bytes, rootDir }),
    sourceDocumentHash: createHash('sha256').update(bytes).digest('hex')
  };
  const task = pdfjs.getDocument({
    data: new Uint8Array(bytes), useSystemFonts: false, isEvalSupported: false,
    standardFontDataUrl: fileURLToPath(new URL('./standard_fonts/', import.meta.resolve('pdfjs-dist/package.json')))
  });
  const pdf = await task.promise;
  t.after(() => task.destroy());
  for (const number of [1, 2]) {
    const page = await pdf.getPage(number);
    const viewport = page.getViewport({ scale: env.assinaturasPreviewScale });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    const expected = canvas.toBuffer('image/png');
    const actual = await renderPage(document, number, { rootDir });
    assert.ok(actual.equals(expected), `Página ${number}: glifos e rotação devem corresponder às fontes incluídas no PDF.js`);
    assert.ok((await renderPage(document, number, { rootDir })).equals(actual), 'cache preserva a prévia corrigida');
  }
  assert.deepEqual(await sourcePdfBuffer(document, { rootDir }), bytes, 'o PDF original não é alterado');
  for (const number of [0, 3, 1.5]) {
    await assert.rejects(() => renderPage(document, number, { rootDir }), error => error.statusCode === 404);
  }
});

test('prévia não reutiliza cache anterior à correção de fontes', async t => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'assinaturas-preview-cache-'));
  t.after(() => fs.rm(rootDir, { recursive: true, force: true }));
  const pdf = await PDFDocument.create();
  pdf.addPage([200, 200]);
  const bytes = Buffer.from(await pdf.save());
  const document = { id: 'preview-cache', pageCount: 1,
    sourceStoragePath: await storeSourcePdf({ fileName: 'cache.pdf', bytes, rootDir }),
    sourceDocumentHash: createHash('sha256').update(bytes).digest('hex') };
  const directory = path.join(rootDir, 'Assinaturas', 'Previews', document.id);
  await fs.mkdir(directory, { recursive: true });
  const legacy = Buffer.from('previa anterior');
  await fs.writeFile(path.join(directory, '1.png'), legacy);
  const actual = await renderPage(document, 1, { rootDir });
  assert.ok(!actual.equals(legacy), 'a nova renderização deve ignorar a imagem antiga');
  assert.equal(actual.subarray(1, 4).toString(), 'PNG');
  assert.deepEqual(await fs.readFile(path.join(directory, '1.png')), legacy, 'invalidação sem remoção destrutiva');
});
