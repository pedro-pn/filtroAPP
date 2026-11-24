import {
  XLSX_MIME_TYPE,
  buildXlsxWorkbookAsync,
  type XlsxWorkbookSpec
} from '../../../shared/modules/xlsx-workbook.js';
import { downloadBlob } from './download';

export type {
  XlsxCellValue,
  XlsxColumn,
  XlsxSheet,
  XlsxTone,
  XlsxWorkbookSpec
} from '../../../shared/modules/xlsx-workbook.js';

async function deflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Gera o .xlsx no modelo padrão Filtrovali e dispara o download. */
export async function downloadSpreadsheet(spec: XlsxWorkbookSpec, fileName: string): Promise<void> {
  const canCompress = typeof CompressionStream !== 'undefined';
  const bytes = await buildXlsxWorkbookAsync(spec, canCompress ? { deflateRaw } : {});
  const name = fileName.toLowerCase().endsWith('.xlsx') ? fileName : `${fileName}.xlsx`;
  downloadBlob(new Blob([bytes as BlobPart], { type: XLSX_MIME_TYPE }), name);
}
