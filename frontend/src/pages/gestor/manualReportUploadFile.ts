import type { ManualReportOperationalFieldsValue } from '../../components/reports/ManualReportOperationalFields';
import type { ReportType } from '../../types/domain';
import { manualReportMetadataFromFileName } from '../../utils/reportFileName';

export interface ManualReportUploadFileState extends ManualReportOperationalFieldsValue {
  id: string;
  fileName: string;
  pdfDataUrl: string;
  sequenceNumber: string;
  reportDate: string;
  serviceEquipment: string;
  serviceSystem: string;
}

export function updateManualReportUploadFileType(
  file: ManualReportUploadFileState,
  previousType: ReportType,
  reportType: ReportType
): ManualReportUploadFileState {
  const previousNumber = manualReportMetadataFromFileName(file.fileName, previousType).sequenceNumber;
  const nextNumber = manualReportMetadataFromFileName(file.fileName, reportType).sequenceNumber;
  // Refresh inferred numbers while keeping numbers entered by the user.
  const sequenceNumber = !file.sequenceNumber || file.sequenceNumber === previousNumber
    ? nextNumber
    : file.sequenceNumber;

  return {
    ...file,
    sequenceNumber,
    ...(reportType === 'RDO' ? { serviceEquipment: '', serviceSystem: '' } : {})
  };
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
