import type { ReportSummary } from '../../types/domain';
import { fileToDataUrl } from '../../utils/fileToDataUrl';
import { manualReportMetadataFromFileName } from '../../utils/reportFileName';

export interface PhysicalSignatureUpload {
  id: string;
  fileName: string;
  pdfDataUrl: string;
}

export interface PhysicalSignatureBatchFile {
  id: string;
  file: File;
  projectId: string;
  reportId: string;
  suggested: boolean;
  status: 'pending' | 'uploading' | 'success' | 'error';
  error?: string;
}

export function canReceivePhysicalSignature(report: ReportSummary) {
  const special = report.specialConditions || {};
  const rejectedAt = typeof special.__clientRejectedAt === 'string' ? special.__clientRejectedAt : '';
  const resolvedAt = typeof special.__clientRejectionResolvedAt === 'string' ? special.__clientRejectionResolvedAt : '';
  const hasRejection = rejectedAt && (!resolvedAt || new Date(rejectedAt).getTime() > new Date(resolvedAt).getTime());
  return report.reportType === 'RDO' && report.status === 'APPROVED'
    && !report.physicalSignedAt && !report.deletedAt && !report.project.deletedAt
    && !hasRejection
    && !report.reportSignatures?.some(signature => signature.status === 'SIGNED');
}

export function validatePhysicalSignatureFile(file: File) {
  if (!/\.pdf$/i.test(file.name)) return 'Selecione um arquivo PDF.';
  if (!file.size) return 'O PDF está vazio.';
  if (file.size > 50 * 1024 * 1024) return 'O PDF assinado deve ter até 50 MB.';
  return '';
}

function normalize(value: string) {
  return value.normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/_/g, ' ').toLowerCase();
}

export function suggestPhysicalSignatureReport(fileName: string, reports: ReportSummary[], projectId: string) {
  const name = normalize(fileName);
  const mission = name.match(/\b(?:missao|projeto)\s*[-_:]?\s*([a-z0-9]+)/)?.[1];
  let candidates = reports.filter(report => report.projectId === projectId && canReceivePhysicalSignature(report));
  if (mission) candidates = candidates.filter(report => normalize(report.project.code) === mission);

  // Never infer an RDO from a file explicitly named as a service report.
  if (/\b(?:rtp|rlq|rcpu|rlm|rli|rlf)(?=[\s\d-])/i.test(name)) return { projectId, reportId: '' };
  const metadata = manualReportMetadataFromFileName(fileName, 'RDO');
  const isoDate = name.match(/\b(\d{4})[-_.](\d{2})[-_.](\d{2})(?!\d)/);
  const reportDate = metadata.reportDate || (isoDate ? `${isoDate[1]}-${isoDate[2]}-${isoDate[3]}` : '');
  if (!metadata.sequenceNumber && !reportDate) return { projectId, reportId: '' };
  if (metadata.sequenceNumber) candidates = candidates.filter(report => report.sequenceNumber === Number(metadata.sequenceNumber));
  if (reportDate) candidates = candidates.filter(report => report.reportDate.slice(0, 10) === reportDate);
  return candidates.length === 1
    ? { projectId: candidates[0].projectId, reportId: candidates[0].id }
    : { projectId, reportId: '' };
}

export function physicalSignatureBatchErrors(files: PhysicalSignatureBatchFile[], reports: ReportSummary[], projectId: string) {
  const errors: Record<string, string> = {};
  const pending = files.filter(file => file.status !== 'success');
  for (const entry of pending) {
    const fileError = validatePhysicalSignatureFile(entry.file);
    const target = entry.projectId === projectId && reports.find(report => report.id === entry.reportId && report.projectId === projectId && canReceivePhysicalSignature(report));
    if (fileError) errors[entry.id] = fileError;
    else if (!target) errors[entry.id] = 'Selecione um RDO deste projeto para o arquivo.';
    else if (files.some(other => other.id !== entry.id && other.reportId === entry.reportId)) {
      errors[entry.id] = 'Este RDO já está associado a outro arquivo do lote.';
    }
  }
  return errors;
}

export async function uploadPhysicalSignatureBatch(
  files: PhysicalSignatureBatchFile[],
  reports: ReportSummary[],
  projectId: string,
  upload: (payload: PhysicalSignatureUpload) => Promise<unknown>,
  onUpdate: (id: string, patch: Partial<PhysicalSignatureBatchFile>) => void,
  readFile: (file: File) => Promise<string> = fileToDataUrl
) {
  if (Object.keys(physicalSignatureBatchErrors(files, reports, projectId)).length) {
    throw new Error('Revise as associações dos arquivos antes de enviar.');
  }
  let saved = 0;
  let failed = 0;
  for (const entry of files.filter(file => file.status !== 'success')) {
    onUpdate(entry.id, { status: 'uploading', error: undefined });
    try {
      await upload({ id: entry.reportId, fileName: entry.file.name, pdfDataUrl: await readFile(entry.file) });
      saved += 1;
      onUpdate(entry.id, { status: 'success' });
    } catch (error) {
      failed += 1;
      onUpdate(entry.id, { status: 'error', error: error instanceof Error ? error.message : 'Não foi possível enviar este PDF.' });
    }
  }
  return { saved, failed };
}
