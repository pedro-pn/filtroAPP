import fs from 'node:fs/promises';
import zlib from 'node:zlib';

import { PDFDocument, PDFName, PDFRawStream, PDFString } from 'pdf-lib';

const HYPERLINK_BLUE = '0.0196078431 0.3882352941 0.756862745 rg';

function clean(value) {
  return String(value || '').trim();
}

function uniqueLinks(links) {
  const seen = new Set();
  return (links || [])
    .map(link => ({
      label: clean(link?.label),
      url: clean(link?.url)
    }))
    .filter(link => link.label && link.url)
    .filter(link => {
      const key = `${link.label}:${link.url}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function streamText(stream) {
  if (!(stream instanceof PDFRawStream)) return '';
  let bytes = stream.contents;
  try {
    bytes = zlib.inflateSync(bytes);
  } catch {
    // Some PDF streams are already uncompressed.
  }
  return Buffer.from(bytes).toString('latin1');
}

function pageContentStreams(pdfDoc, page) {
  const contents = page.node.Contents();
  if (!contents) return [];
  const lookedUp = pdfDoc.context.lookup(contents);
  if (lookedUp?.size) {
    return Array.from({ length: lookedUp.size() }, (_, index) => pdfDoc.context.lookup(lookedUp.get(index)));
  }
  return [lookedUp];
}

function hyperlinkTextPositions(pdfDoc) {
  const positions = [];
  pdfDoc.getPages().forEach((page, pageIndex) => {
    for (const stream of pageContentStreams(pdfDoc, page)) {
      const content = streamText(stream);
      const pattern = new RegExp(`${HYPERLINK_BLUE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\nBT\\n([0-9.]+) ([0-9.]+) Td`, 'g');
      let match;
      while ((match = pattern.exec(content))) {
        positions.push({
          pageIndex,
          x: Number(match[1]),
          y: Number(match[2])
        });
      }
    }
  });
  return positions.filter(position => Number.isFinite(position.x) && Number.isFinite(position.y));
}

function existingUriSet(pdfDoc) {
  const uris = new Set();
  for (const page of pdfDoc.getPages()) {
    const annots = page.node.Annots();
    if (!annots) continue;
    const annotations = pdfDoc.context.lookup(annots);
    for (let index = 0; index < annotations.size(); index += 1) {
      const annotation = pdfDoc.context.lookup(annotations.get(index));
      const action = pdfDoc.context.lookup(annotation.get(PDFName.of('A')));
      const uri = action?.get?.(PDFName.of('URI'));
      if (uri instanceof PDFString) uris.add(uri.decodeText());
    }
  }
  return uris;
}

function addLinkAnnotation(pdfDoc, page, { x, y, width, height, url }) {
  const annotation = pdfDoc.context.obj({
    Type: PDFName.of('Annot'),
    Subtype: PDFName.of('Link'),
    Rect: [x, y, x + width, y + height],
    Border: [0, 0, 0],
    A: {
      Type: PDFName.of('Action'),
      S: PDFName.of('URI'),
      URI: PDFString.of(url)
    }
  });
  const ref = pdfDoc.context.register(annotation);
  const annots = page.node.Annots();
  if (annots) {
    annots.push(ref);
  } else {
    page.node.set(PDFName.of('Annots'), pdfDoc.context.obj([ref]));
  }
}

export async function addPdfAnnotationsToHyperlinkText(pdfPath, links) {
  const items = uniqueLinks(links);
  if (!items.length) return;

  const pdfDoc = await PDFDocument.load(await fs.readFile(pdfPath));
  const existingUris = existingUriSet(pdfDoc);
  const missingItems = items.filter(item => !existingUris.has(item.url));
  if (!missingItems.length) return;

  const positions = hyperlinkTextPositions(pdfDoc);
  let changed = false;
  missingItems.forEach((item, index) => {
    const position = positions[index];
    if (!position) return;
    const page = pdfDoc.getPage(position.pageIndex);
    addLinkAnnotation(pdfDoc, page, {
      x: position.x,
      y: position.y - 2,
      width: Math.max(42, item.label.length * 4.8),
      height: 12,
      url: item.url
    });
    changed = true;
  });

  if (changed) await fs.writeFile(pdfPath, await pdfDoc.save());
}
