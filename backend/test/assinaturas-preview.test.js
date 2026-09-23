import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { concatTransformationMatrix, degrees, drawObject, PDFDocument, popGraphicsState, pushGraphicsState, StandardFonts } from 'pdf-lib';
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

test('prévia não reutiliza caches anteriores às correções de fontes e scans', async t => {
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
  await fs.writeFile(path.join(directory, '1.v2.png'), legacy);
  const actual = await renderPage(document, 1, { rootDir });
  assert.ok(!actual.equals(legacy), 'a nova renderização deve ignorar a imagem antiga');
  assert.equal(actual.subarray(1, 4).toString(), 'PNG');
  assert.deepEqual(await fs.readFile(path.join(directory, '1.png')), legacy, 'invalidação sem remoção destrutiva');
  assert.deepEqual(await fs.readFile(path.join(directory, '1.v2.png')), legacy);
});

test('prévia decodifica scans CCITT nas páginas seguintes sem produzir imagens em branco', async t => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'assinaturas-preview-scan-'));
  t.after(() => fs.rm(rootDir, { recursive: true, force: true }));
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  pdf.addPage([96, 96]).drawText('Capa', { x: 10, y: 40, size: 16, font });
  // Imagem sintética 32x32: quadrado preto 16x16 e borda branca, codificada
  // com libtiff/CCITT Group 4. Não contém dados de documentos de usuários.
  const scan = pdf.context.register(pdf.context.stream(Buffer.from('/zMF////////H/ABABA=', 'base64'), {
    Type: 'XObject', Subtype: 'Image', Width: 32, Height: 32,
    ColorSpace: 'DeviceGray', BitsPerComponent: 1, Filter: 'CCITTFaxDecode',
    DecodeParms: { K: -1, Columns: 32, Rows: 32, BlackIs1: false }
  }));
  for (let index = 0; index < 2; index += 1) {
    const page = pdf.addPage([96, 96]);
    const name = page.node.newXObject('Scan', scan);
    page.pushOperators(pushGraphicsState(), concatTransformationMatrix(96, 0, 0, 96, 0, 0), drawObject(name), popGraphicsState());
  }
  const bytes = Buffer.from(await pdf.save());
  const document = { id: 'preview-scan', pageCount: 3,
    sourceStoragePath: await storeSourcePdf({ fileName: 'scan-sintetico.pdf', bytes, rootDir }),
    sourceDocumentHash: createHash('sha256').update(bytes).digest('hex') };
  for (const pageNumber of [2, 3]) {
    const png = await renderPage(document, pageNumber, { rootDir });
    const image = await loadImage(png);
    const canvas = createCanvas(image.width, image.height);
    const context = canvas.getContext('2d');
    context.drawImage(image, 0, 0);
    const center = context.getImageData(Math.floor(image.width / 2), Math.floor(image.height / 2), 1, 1).data;
    const border = context.getImageData(2, 2, 1, 1).data;
    assert.ok(center[0] < 10 && center[3] === 255, `Página ${pageNumber}: o centro do scan precisa ser preto`);
    assert.ok(border[0] > 245, `Página ${pageNumber}: a borda precisa ser branca`);
    assert.ok((await renderPage(document, pageNumber, { rootDir })).equals(png));
  }
  assert.deepEqual(await sourcePdfBuffer(document, { rootDir }), bytes);
});
