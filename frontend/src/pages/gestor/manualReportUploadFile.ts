import type { ManualReportOperationalFieldsValue } from '../../components/reports/ManualReportOperationalFields';
import type { ManualReportPdfExtraction } from '../../api/reports';
import { emptyManualReportOperationalFields } from '../../components/reports/manualReportOperationalData';
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
  extractionWarnings?: string[];
}

export async function readManualReportUploadFiles(
  files: File[],
  options: { reportType: ReportType; baseDate: string; serviceEquipment: string; serviceSystem: string },
  dependencies: { readDataUrl: (file: File) => Promise<string>; extract: (pdfDataUrl: string) => Promise<ManualReportPdfExtraction> }
): Promise<ManualReportUploadFileState[]> {
  const result: ManualReportUploadFileState[] = [];
  for (const file of files) {
    const metadata = manualReportMetadataFromFileName(file.name, options.reportType);
    const pdfDataUrl = await dependencies.readDataUrl(file);
    let extraction: ManualReportPdfExtraction;
    try {
      extraction = await dependencies.extract(pdfDataUrl);
    } catch {
      extraction = { fields: {}, source: 'text', warnings: ['Não foi possível ler os horários deste PDF. Preencha os campos manualmente.'] };
    }
    result.push({
      id: manualReportFileId(),
      fileName: file.name,
      pdfDataUrl,
      sequenceNumber: metadata.sequenceNumber,
      reportDate: metadata.reportDate || options.baseDate,
      serviceEquipment: options.serviceEquipment,
      serviceSystem: options.serviceSystem,
      ...emptyManualReportOperationalFields(),
      ...extraction.fields,
      extractionWarnings: extraction.warnings
    });
  }
  return result;
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
