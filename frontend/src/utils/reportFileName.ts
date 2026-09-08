import type { ReportSummary } from '../types/domain';

function safePart(value: unknown) {
  return String(value ?? '')
    .replace(/[<>:"/\\|?*\n\r]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
}

function toYmd(value?: string | null) {
  if (!value) return '';
  const text = String(value).slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
}

function dateFilePart(value?: string | null) {
  const ymd = toYmd(value);
  if (!ymd) return '--';
  const [year, month, day] = ymd.split('-');
  return `${day}-${month}-${year}`;
}

function weekdayName(value?: string | null) {
  const ymd = toYmd(value);
  if (!ymd) return '--';
  return new Date(`${ymd}T12:00:00Z`).toLocaleDateString('pt-BR', {
    weekday: 'long',
    timeZone: 'UTC'
  });
}

function reportNumber(report: ReportSummary) {
  return report.sequenceNumber ? String(report.sequenceNumber) : '---';
}

function stringify(value: unknown): string {
  if (value == null) return '';
  if (Array.isArray(value)) return value.filter(Boolean).join(', ');
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (Array.isArray(record.labels)) return record.labels.filter(Boolean).join(', ');
    return String(record.name || record.nome || record.code || record.codigo || record.id || '');
  }
  return String(value);
}

function canonicalize(value: string) {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^\w\s/()-]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function getField(fields: Record<string, unknown>, names: string[]) {
  for (const name of names) {
    if (fields[name] != null && fields[name] !== '') return fields[name];
    const wanted = canonicalize(name);
    const found = Object.keys(fields).find(key => canonicalize(key) === wanted);
    if (found && fields[found] != null && fields[found] !== '') return fields[found];
  }
  return '';
}

function serviceData(report: ReportSummary) {
  return report.specialConditions?.serviceData && typeof report.specialConditions.serviceData === 'object'
    ? report.specialConditions.serviceData as Record<string, unknown>
    : report.services?.[0]?.extraData || {};
}

function serviceEquipment(report: ReportSummary) {
  const fields = serviceData(report);
  return stringify(getField(fields, ['Equipamento(s)', 'Equipamento', 'Embarcação', 'Embarcacao', 'ID da embarcação', 'ID da embarcacao']))
    || report.services?.[0]?.equipmentId
    || 'Equipamento';
}

function serviceSystem(report: ReportSummary) {
  const fields = serviceData(report);
  return stringify(getField(fields, ['Sistema']))
    || report.services?.[0]?.system
    || 'Sistema';
}

function serviceSystemCode(report: ReportSummary) {
  return serviceSystem(report).split(';')[0]?.trim() || 'Sistema';
}

function serviceStep(report: ReportSummary) {
  const fields = serviceData(report);
  return stringify(getField(fields, ['Steps', 'Step']))
    || 'STEP';
}

function serviceSystemStepFilePart(report: ReportSummary) {
  return `${serviceSystemCode(report)}M00${serviceStep(report).trim() || 'STEP'}`;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function dateFromFileName(fileName: string) {
  const match = fileName.match(/(?:^|\D)(\d{1,2})[-_.](\d{1,2})[-_.](\d{4})(?!\d)/);
  if (!match) return '';

  const day = Number.parseInt(match[1], 10);
  const month = Number.parseInt(match[2], 10);
  const year = Number.parseInt(match[3], 10);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) return '';

  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function manualReportMetadataFromFileName(
  fileName: string,
  reportType: ReportSummary['reportType']
) {
  const nameWithoutExtension = String(fileName || '').replace(/\.[^.]+$/, '');
  const typePattern = escapeRegExp(reportType);
  const sequenceMatch = nameWithoutExtension.match(new RegExp(
    `(?:^|[^a-z0-9])${typePattern}\\s*(?:n(?:[º°]|o\\.?|ro\\.?)?\\s*)?(?:[-_]+\\s*)?(\\d+)(?![a-z0-9])`,
    'i'
  ));
  const parsedSequence = sequenceMatch ? Number.parseInt(sequenceMatch[1], 10) : 0;

  return {
    sequenceNumber: parsedSequence > 0 ? String(parsedSequence) : '',
    reportDate: dateFromFileName(nameWithoutExtension)
  };
}

export function reportDownloadFileName(report: ReportSummary, extension: 'pdf' | 'docx') {
  const mission = `Missão ${report.project?.code || '---'} ${report.project?.name || 'Sem projeto'}`;
  let base: string;
  if (report.reportType === 'RDO') {
    base = `${mission} - RDO ${reportNumber(report)} - ${dateFilePart(report.reportDate)} - ${weekdayName(report.reportDate)}`;
  } else if (report.reportType === 'RLF' || report.reportType === 'RLI') {
    base = `${mission} - ${report.reportType} ${reportNumber(report)} - ${serviceSystemCode(report)} - ${serviceSystemStepFilePart(report)}`;
  } else {
    base = `${mission} - ${report.reportType} ${reportNumber(report)} - ${serviceEquipment(report)} - ${serviceSystem(report)}`;
  }

  return `${safePart(base)}.${extension}`;
}
