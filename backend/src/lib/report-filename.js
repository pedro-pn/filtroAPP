function safeText(value) {
  if (value == null) return '';
  return String(value);
}

export function safePath(value) {
  return safeText(value).replace(/[<>:"/\\|?*\n\r]/g, '_').replace(/\s+/g, ' ').trim();
}

function toYMD(value) {
  if (!value) return null;
  if (value instanceof Date) {
    const y = value.getUTCFullYear();
    const m = String(value.getUTCMonth() + 1).padStart(2, '0');
    const d = String(value.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const s = String(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

function dateFilePart(value) {
  const ymd = toYMD(value);
  if (!ymd) return '--';
  const [year, month, day] = ymd.split('-');
  return `${day}-${month}-${year}`;
}

function weekdayNamePt(value) {
  const ymd = toYMD(value);
  if (!ymd) return '--';
  const [year, month, day] = ymd.split('-');
  return new Date(`${year}-${month}-${day}T12:00:00Z`).toLocaleDateString('pt-BR', {
    weekday: 'long',
    timeZone: 'UTC'
  });
}

function reportNumber(report) {
  return typeof report?.sequenceNumber === 'number' ? String(report.sequenceNumber) : '---';
}

function stringify(value) {
  if (value == null) return '';
  if (Array.isArray(value)) return value.filter(Boolean).join(', ');
  if (typeof value === 'boolean') return value ? 'Sim' : 'Não';
  if (typeof value === 'object') {
    if (Array.isArray(value.labels)) return value.labels.filter(Boolean).join(', ');
    return safeText(value.name || value.nome || value.code || value.codigo || value.id);
  }
  return String(value);
}

function canonicalize(value) {
  return safeText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s/()-]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function getField(fields, names) {
  for (const name of names) {
    if (fields?.[name] != null && fields[name] !== '') return fields[name];
    const wanted = canonicalize(name);
    const found = Object.keys(fields || {}).find(key => canonicalize(key) === wanted);
    if (found && fields[found] != null && fields[found] !== '') return fields[found];
  }
  return '';
}

function missionLabel(report) {
  return `Missão ${report?.project?.code || '---'} ${report?.project?.name || 'Sem projeto'}`;
}

function serviceEquipment(report) {
  const fields = report?.specialConditions?.serviceData || report?.services?.[0]?.extraData || {};
  return stringify(getField(fields, ['Equipamento(s)', 'Equipamento', 'ID da embarcação', 'ID da embarcacao']))
    || report?.services?.[0]?.equipmentId
    || 'Equipamento';
}

function serviceSystem(report) {
  const fields = report?.specialConditions?.serviceData || report?.services?.[0]?.extraData || {};
  return stringify(getField(fields, ['Sistema']))
    || report?.services?.[0]?.system
    || 'Sistema';
}

export function buildReportFileBaseName(report) {
  const type = report?.reportType || 'RDO';
  if (type === 'RDO') {
    return safePath(`${missionLabel(report)} - RDO ${reportNumber(report)} - ${dateFilePart(report?.reportDate)} - ${weekdayNamePt(report?.reportDate)}`);
  }

  return safePath(`${missionLabel(report)} - ${type} ${reportNumber(report)} - ${serviceEquipment(report)} - ${serviceSystem(report)}`);
}

export function buildReportFileName(report, extension) {
  const ext = String(extension || '').replace(/^\./, '');
  return `${buildReportFileBaseName(report)}${ext ? `.${ext}` : ''}`;
}
