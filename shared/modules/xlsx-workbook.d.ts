export const XLSX_MIME_TYPE: string;

export type XlsxColumnType =
  | 'text'
  | 'integer'
  | 'decimal'
  | 'currency'
  | 'percent'
  /** Valor em minutos, exibido como [h]:mm. */
  | 'duration'
  | 'date'
  | 'datetime';

export type XlsxTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

export type XlsxCellValue = string | number | boolean | Date | null | undefined | readonly string[];

export interface XlsxColumn {
  header: string;
  type?: XlsxColumnType;
  /** Casas decimais para `decimal`/`percent` (padrão 2 / 1). */
  decimals?: number;
  /** Código de formato do Excel que substitui o padrão do tipo. */
  numFmt?: string;
  /** Largura em caracteres; sem ela, a largura acompanha o conteúdo. */
  width?: number;
  align?: 'left' | 'center' | 'right';
  wrap?: boolean;
  /** Linha de totais com SUBTOTAL (respeita o autofiltro). */
  total?: 'sum' | 'avg' | 'count';
  /** Formato só da célula de total (ex.: média com uma casa em coluna de inteiros). */
  totalNumFmt?: string;
  /** "Badge" colorido como no app (ex.: status). */
  tone?: (value: XlsxCellValue, row: readonly XlsxCellValue[], rowIndex: number) => XlsxTone | null | undefined;
}

export interface XlsxSheet {
  /** Nome da aba (máx. 31 caracteres; sanitizado). */
  name: string;
  /** Título grande da faixa superior. */
  title?: string;
  /** Módulo/área exibido após "FILTROVALI ·". */
  subtitle?: string;
  /** Linhas de contexto: [rótulo, valor]. Valores vazios são omitidos. */
  meta?: ReadonlyArray<readonly [string, string | number | null | undefined]>;
  columns: readonly XlsxColumn[];
  rows: ReadonlyArray<readonly XlsxCellValue[]>;
  recordCount?: number;
  totalsLabel?: string;
  emptyMessage?: string;
}

export interface XlsxWorkbookSpec {
  title?: string;
  sheets: readonly XlsxSheet[];
  generatedAt?: Date | string;
  /** Fuso para converter datas/horas (padrão America/Sao_Paulo). */
  timeZone?: string;
}

export interface XlsxFile {
  name: string;
  data: Uint8Array;
}

export function columnLetter(index: number): string;
export function sanitizeSheetName(name: string, fallback?: string): string;
export function buildXlsxFiles(spec: XlsxWorkbookSpec): { files: XlsxFile[]; generatedAt: Date };
export function zipFiles(files: readonly XlsxFile[], compressed?: ReadonlyArray<Uint8Array | null | undefined>, modifiedAt?: Date): Uint8Array;
export function buildXlsxWorkbook(spec: XlsxWorkbookSpec, options?: { deflateRaw?: (data: Uint8Array) => Uint8Array }): Uint8Array;
export function buildXlsxWorkbookAsync(
  spec: XlsxWorkbookSpec,
  options?: { deflateRaw?: (data: Uint8Array) => Promise<Uint8Array> }
): Promise<Uint8Array>;
