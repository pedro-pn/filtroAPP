import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { manualPdfTextFromItems, parseManualReportPdfFields } from './manual-pdf-fields.js';

const require = createRequire(import.meta.url);
const MAX_PDF_BYTES = 20 * 1024 * 1024;
const MAX_OCR_PAGES = 3;
let extractionTail = Promise.resolve();

export function decodeManualReportPdfDataUrl(value) {
  const match = String(value || '').match(/^data:application\/pdf;base64,([a-z0-9+/=\s]+)$/i);
  function invalidPdf(message) {
    const error = new Error(message);
    error.statusCode = 400;
    throw error;
  }
  if (!match) invalidPdf('Envie um PDF válido.');
  const encoded = match[1].replace(/\s/g, '');
  if (!encoded || encoded.length % 4 === 1) invalidPdf('PDF enviado está corrompido.');
  const bytes = Buffer.from(encoded, 'base64');
  if (!bytes.length || bytes.length > MAX_PDF_BYTES) invalidPdf('PDF inválido ou maior que 20 MB.');
  if (bytes.subarray(0, 5).toString('latin1') !== '%PDF-') invalidPdf('Arquivo enviado não parece ser um PDF.');
  return bytes;
}

export function manualPdfExtractionWarnings(fields) {
  const warnings = [];
  if (!fields.arrivalTime || !fields.departureTime) warnings.push('Confira os horários de entrada e saída; a leitura não identificou ambos.');
  if ((fields.arrivalTime || fields.departureTime) && !fields.lunchBreak) warnings.push('Confira o intervalo diurno; ele não foi identificado no PDF.');
  if (fields.standby && !fields.standbyMotivo) warnings.push('Informe o motivo do stand-by identificado no PDF.');
  if (fields.noturno && (!fields.noturnoStart || !fields.noturnoEnd)) warnings.push('Confira os horários do turno noturno; a leitura ficou incompleta.');
  if (fields.noturno && !fields.noturnoInterval) warnings.push('Confira o intervalo noturno; ele não foi identificado no PDF.');
  return warnings;
}

export async function extractManualReportPdfFields(bytes) {
  // Serialize rendering/OCR to bound memory during batch uploads.
  const previous = extractionTail;
  let release;
  extractionTail = new Promise(resolve => { release = resolve; });
  await previous;
  try {
    return await extractPdf(bytes);
  } finally {
    release();
  }
}

async function extractPdf(bytes) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const assetPath = folder => fileURLToPath(new URL(`./${folder}/`, import.meta.resolve('pdfjs-dist/package.json')));
  const loading = pdfjs.getDocument({
    data: new Uint8Array(bytes),
    useSystemFonts: false,
    standardFontDataUrl: assetPath('standard_fonts'),
    wasmUrl: assetPath('wasm'),
    cMapUrl: assetPath('cmaps'),
    cMapPacked: true,
    isEvalSupported: false,
    verbosity: pdfjs.VerbosityLevel.ERRORS
  });
  let worker;
  try {
    const pdf = await loading.promise;
    const texts = [];
    for (let number = 1; number <= pdf.numPages; number += 1) {
      const page = await pdf.getPage(number);
      texts.push(manualPdfTextFromItems((await page.getTextContent()).items));
      page.cleanup();
    }
    let fields = parseManualReportPdfFields(texts.join('\n'));
    let source = 'text';
    const warnings = [];
    if (!fields.arrivalTime || !fields.departureTime) {
      const { createCanvas } = await import('@napi-rs/canvas');
      const { createWorker } = await import('tesseract.js');
      const porData = require('@tesseract.js-data/por');
      worker = await createWorker('por', 1, { langPath: porData.langPath, gzip: porData.gzip, cacheMethod: 'none' });
      const ocrTexts = [];
      for (let number = 1; number <= Math.min(pdf.numPages, MAX_OCR_PAGES); number += 1) {
        const page = await pdf.getPage(number);
        const initial = page.getViewport({ scale: 2 });
        const viewport = page.getViewport({ scale: Math.min(2, 2200 / Math.max(initial.width / 2, initial.height / 2)) });
        const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
        await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
        ocrTexts.push((await worker.recognize(canvas.toBuffer('image/png'))).data.text);
        page.cleanup();
      }
      fields = { ...parseManualReportPdfFields(ocrTexts.join('\n')), ...fields };
      source = 'ocr';
      if (pdf.numPages > MAX_OCR_PAGES) warnings.push('A leitura por imagem verificou as três primeiras páginas. Confira os horários nas demais páginas.');
    }
    return { fields, source, warnings: [...warnings, ...manualPdfExtractionWarnings(fields)] };
  } finally {
    try {
      if (worker) await worker.terminate();
    } finally {
      await loading.destroy();
    }
  }
}
