import type { RomaneioCatalogItem } from '../api/romaneio';
import { romaneioUsesVariableQuantity } from './romaneioMeasure';

const ROMANEIO_QR_PREFIX = 'FILTROVALI:ROMANEIO_ITEM:1:';
const CATALOG_ITEM_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

// A arte de referência é horizontal (proporção 2,9039:1); as alturas abaixo
// derivam das larguras para que os três tamanhos sejam a mesma etiqueta em escala.
export const ROMANEIO_QR_LABEL_SIZES = [
  { id: 'large', label: 'Grande', widthMillimeters: 120, heightMillimeters: 41.3 },
  { id: 'medium', label: 'Média', widthMillimeters: 80, heightMillimeters: 27.5 },
  { id: 'small', label: 'Pequena', widthMillimeters: 60, heightMillimeters: 20.7 }
] as const;

export type RomaneioQrLabelSize = typeof ROMANEIO_QR_LABEL_SIZES[number];
export type RomaneioQrLabelSizeId = RomaneioQrLabelSize['id'];

export interface RomaneioQrLabelPageEntry<T> {
  item: T;
  size: RomaneioQrLabelSize;
}

export interface RomaneioQrLabelPageRow<T> {
  entries: RomaneioQrLabelPageEntry<T>[];
  heightMillimeters: number;
  widthMillimeters: number;
}

export interface RomaneioQrLabelPage<T> {
  rows: RomaneioQrLabelPageRow<T>[];
}

export const ROMANEIO_QR_LABEL_SHEET = {
  widthMillimeters: 210,
  heightMillimeters: 297,
  marginMillimeters: 10,
  contentWidthMillimeters: 190,
  contentHeightMillimeters: 277,
  gapMillimeters: 5
} as const;

const A4_LABEL_CONTENT_WIDTH_MM = ROMANEIO_QR_LABEL_SHEET.contentWidthMillimeters;
const A4_LABEL_CONTENT_HEIGHT_MM = ROMANEIO_QR_LABEL_SHEET.contentHeightMillimeters;
const A4_LABEL_GAP_MM = ROMANEIO_QR_LABEL_SHEET.gapMillimeters;

export function buildRomaneioItemQrValue(catalogItemId: string) {
  const normalizedId = catalogItemId.trim();
  if (!CATALOG_ITEM_ID_PATTERN.test(normalizedId)) {
    throw new Error('Identificador de item inválido para QR code.');
  }
  return `${ROMANEIO_QR_PREFIX}${normalizedId}`;
}

const QR_PAGE_PATH = /^\/q\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?$/i;

/** Token público de uma URL `https://…/q/<token>` (formato novo do QR code). */
export function parseRomaneioQrPageToken(value: string) {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return QR_PAGE_PATH.exec(url.pathname)?.[1]?.toLowerCase() ?? null;
  } catch {
    return null;
  }
}

export type RomaneioQrScan =
  | { kind: 'legacy'; catalogItemId: string }
  | { kind: 'token'; token: string };

/** Lê o QR em qualquer formato: o antigo (`FILTROVALI:ROMANEIO_ITEM:1:<id>`) ou a URL da página pública. */
export function parseRomaneioQrScan(value: string): RomaneioQrScan | null {
  const legacyId = parseRomaneioItemQrValue(value);
  if (legacyId) return { kind: 'legacy', catalogItemId: legacyId };
  const token = parseRomaneioQrPageToken(value);
  return token ? { kind: 'token', token } : null;
}

/** Item do catálogo que corresponde a uma leitura de QR (por id no formato antigo, por token no novo). */
export function findCatalogItemForQrScan<T extends { id: string; publicToken?: string | null; isActive: boolean }>(items: readonly T[], scan: RomaneioQrScan) {
  return items.find(item => item.isActive && (scan.kind === 'legacy' ? item.id === scan.catalogItemId : item.publicToken?.toLowerCase() === scan.token)) ?? null;
}

/** Conteúdo gravado no QR: a URL da página pública (quando o servidor informa) ou, por compatibilidade, o formato antigo. */
export function romaneioItemQrContent(item: { id: string; qrUrl?: string | null }) {
  const url = String(item.qrUrl || '').trim();
  if (!url) return buildRomaneioItemQrValue(item.id);
  return url.startsWith('/') && typeof window !== 'undefined' ? `${window.location.origin}${url}` : url;
}

export function parseRomaneioItemQrValue(value: string) {
  const normalizedValue = value.trim();
  if (!normalizedValue.startsWith(ROMANEIO_QR_PREFIX)) return null;
  const catalogItemId = normalizedValue.slice(ROMANEIO_QR_PREFIX.length);
  return CATALOG_ITEM_ID_PATTERN.test(catalogItemId) ? catalogItemId : null;
}

export function romaneioQrRequiresQuantity(
  item: Pick<RomaneioCatalogItem, 'isSerialized' | 'measureType'>
) {
  return !item.isSerialized || romaneioUsesVariableQuantity(item.measureType);
}

export function paginateRomaneioQrLabels<T>(
  items: readonly T[],
  selectedSizeIds: readonly RomaneioQrLabelSizeId[]
): RomaneioQrLabelPage<T>[] {
  const sizes = ROMANEIO_QR_LABEL_SIZES.filter(size => selectedSizeIds.includes(size.id));
  const entries = items.flatMap(item => sizes.map(size => ({ item, size })));
  const pages: RomaneioQrLabelPage<T>[] = [];

  entries.forEach(entry => {
    let page = pages.at(-1);
    if (!page) {
      page = { rows: [] };
      pages.push(page);
    }

    const lastRow = page.rows.at(-1);
    if (lastRow) {
      const nextWidth = lastRow.widthMillimeters + A4_LABEL_GAP_MM + entry.size.widthMillimeters;
      const nextHeight = Math.max(lastRow.heightMillimeters, entry.size.heightMillimeters);
      const currentPageHeight = page.rows.reduce((total, row) => total + row.heightMillimeters, 0)
        + Math.max(0, page.rows.length - 1) * A4_LABEL_GAP_MM;
      const nextPageHeight = currentPageHeight - lastRow.heightMillimeters + nextHeight;

      if (nextWidth <= A4_LABEL_CONTENT_WIDTH_MM && nextPageHeight <= A4_LABEL_CONTENT_HEIGHT_MM) {
        lastRow.entries.push(entry);
        lastRow.widthMillimeters = nextWidth;
        lastRow.heightMillimeters = nextHeight;
        return;
      }
    }

    const currentPageHeight = page.rows.reduce((total, row) => total + row.heightMillimeters, 0)
      + Math.max(0, page.rows.length - 1) * A4_LABEL_GAP_MM;
    const nextPageHeight = currentPageHeight + (page.rows.length ? A4_LABEL_GAP_MM : 0)
      + entry.size.heightMillimeters;

    if (page.rows.length > 0 && nextPageHeight > A4_LABEL_CONTENT_HEIGHT_MM) {
      page = { rows: [] };
      pages.push(page);
    }

    page.rows.push({
      entries: [entry],
      heightMillimeters: entry.size.heightMillimeters,
      widthMillimeters: entry.size.widthMillimeters
    });
  });

  return pages;
}
