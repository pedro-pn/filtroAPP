import type { ManualReportOperationalFieldsValue } from '../../components/reports/ManualReportOperationalFields';

export interface ManualReportUploadFileState extends ManualReportOperationalFieldsValue {
  id: string;
  fileName: string;
  pdfDataUrl: string;
  sequenceNumber: string;
  reportDate: string;
  serviceEquipment: string;
  serviceSystem: string;
}

export function manualReportFileId() {
  const random = Math.random().toString(36).slice(2, 8);
  return `manual-report-${Date.now()}-${random}`;
}

export function manualReportUploadListLabel(files: ManualReportUploadFileState[]) {
  if (!files.length) return '';
  if (files.length === 1) return files[0].fileName;
  return `${files.length} PDFs selecionados`;
}
