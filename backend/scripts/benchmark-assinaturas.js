import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { PDFDocument, rgb } from 'pdf-lib';

import { buildFinalPdfBytes } from '../src/lib/assinaturas/final-pdf.js';
import { renderPage } from '../src/lib/assinaturas/preview.js';

const signatureImageDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=';

function elapsed(startedAt) {
  return Math.round((performance.now() - startedAt) * 100) / 100;
}

const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'assinaturas-benchmark-'));
try {
  const pdf = await PDFDocument.create();
  for (let index = 0; index < 30; index += 1) {
    const page = pdf.addPage([612, 792]);
    page.drawRectangle({ x: 40, y: 40, width: 532, height: 712, borderColor: rgb(0.2, 0.4, 0.3), borderWidth: 1 });
    page.drawText(`Página de benchmark ${index + 1}`, { x: 60, y: 720, size: 14 });
  }
  const sourceBytes = Buffer.from(await pdf.save({ useObjectStreams: false }));
  const sourceDocumentHash = createHash('sha256').update(sourceBytes).digest('hex');
  const relativePath = 'Assinaturas/Documentos/benchmark.pdf';
  const targetPath = path.join(rootDir, ...relativePath.split('/'));
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, sourceBytes);
  const previewDocument = {
    id: '00000000-0000-4000-8000-000000000099',
    pageCount: 30,
    sourceStoragePath: relativePath,
    sourceDocumentHash
  };

  let startedAt = performance.now();
  await renderPage(previewDocument, 1, { rootDir });
  const initialPreviewMs = elapsed(startedAt);
  startedAt = performance.now();
  await renderPage(previewDocument, 1, { rootDir });
  const cachedPreviewMs = elapsed(startedAt);

  const signers = Array.from({ length: 10 }, (_, index) => ({
    id: `signer-${index + 1}`,
    name: `Assinante ${index + 1}`,
    email: `assinante-${index + 1}@example.com`,
    declaredSignerName: `Assinante ${index + 1}`,
    signatureImageDataUrl,
    signedAt: new Date('2026-08-28T15:00:00.000Z'),
    ipAddress: '203.0.113.10',
    userAgent: 'Benchmark local'
  }));
  const fields = signers.map((signer, index) => ({
    signerId: signer.id,
    pageNumber: index + 1,
    x: 0.1,
    y: 0.72,
    width: 0.32,
    height: 0.1
  }));
  startedAt = performance.now();
  const finalBytes = await buildFinalPdfBytes({
    id: previewDocument.id,
    title: 'Benchmark de assinaturas',
    originalFileName: 'benchmark.pdf',
    requesterNameSnapshot: 'Benchmark',
    validationCode: 'benchmark-validation-code',
    sourceDocumentHash,
    signers,
    fields
  }, sourceBytes);
  const finalizationMs = elapsed(startedAt);

  const result = {
    fixture: { pages: 30, signers: 10, sourceBytes: sourceBytes.length, finalBytes: finalBytes.length },
    initialPreviewMs,
    cachedPreviewMs,
    finalizationMs,
    targets: { initialPreviewMs: 2000, cachedPreviewMs: 250, finalizationMs: 5000 },
    passed: initialPreviewMs <= 2000 && cachedPreviewMs <= 250 && finalizationMs <= 5000
  };
  console.log(JSON.stringify(result, null, 2));
  if (!result.passed) process.exitCode = 1;
} finally {
  await fs.rm(rootDir, { recursive: true, force: true });
}
