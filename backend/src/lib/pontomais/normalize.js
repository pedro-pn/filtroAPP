import { createHash } from 'node:crypto';

import { PontoMaisError } from './client.js';

function stripAccents(value) {
  return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

export function normalizeName(value) {
  return stripAccents(value).toLowerCase().replace(/\s+/g, ' ').trim();
}

export function normalizeRegistrationNumber(value) {
  const compact = String(value ?? '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (/^\d+$/.test(compact)) return compact.replace(/^0+(?=\d)/, '');
  return compact;
}

export function normalizeCpf(value) {
  return String(value ?? '').replace(/\D/g, '');
}

export function normalizeProjectTag(value) {
  return normalizeName(value);
}

export function isPontoTravelTag(value) {
  return /(?:^|\b)em\s+viagem(?:\b|\s*[-–—:])/.test(normalizeProjectTag(value));
}

export function extractMissionCode(value) {
  const match = normalizeProjectTag(value).match(/(?:^|\b)missao\s*#?\s*(\d{3,})(?:\b|$)/i);
  return match?.[1] || null;
}

function tagText(value) {
  if (typeof value === 'string') return value.trim();
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
  for (const key of ['value', 'name', 'title', 'label']) {
    if (typeof value[key] === 'string' && value[key].trim()) return value[key].trim();
  }
  return '';
}

function uniqueStrings(values) {
  return [...new Set(values.map(value => String(value || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
}

function parseDateKey(value) {
  const text = String(value || '');
  const br = text.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  const iso = text.match(/(\d{4})-(\d{2})-(\d{2})/);
  return iso ? `${iso[1]}-${iso[2]}-${iso[3]}` : null;
}

function hmToMinutes(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.round(value));
  const match = String(value || '').trim().match(/^(\d+):(\d{2})(?::\d{2})?$/);
  if (!match) return 0;
  return Math.max(0, Number(match[1]) * 60 + Number(match[2]));
}

function rawSecondsToMinutes(value, fallback) {
  const seconds = Number(value);
  return Number.isFinite(seconds) ? Math.max(0, Math.round(seconds / 60)) : hmToMinutes(fallback);
}

function normalMinutesFromRow(row) {
  if (!Array.isArray(row.summary)) return hmToMinutes(row.summary);
  const subheaders = row.__header?.summary?.subheader;
  if (Array.isArray(subheaders)) {
    const index = subheaders.findIndex(item => normalizeName(item?.csv_title || item?.title).includes('horas normais'));
    if (index >= 0) return hmToMinutes(row.summary[index]);
  }
  return hmToMinutes(row.summary[3]);
}

function overtimeMinutes(row, percent) {
  if (!Array.isArray(row.extra_time)) return 0;
  return row.extra_time.reduce((sum, item) => {
    if (Number(item?.percent) !== percent) return sum;
    return sum + rawSecondsToMinutes(item?.raw_value, item?.value);
  }, 0);
}

function genericOvertimeMinutes(row) {
  if (!Array.isArray(row.extra_time)) return 0;
  return row.extra_time.reduce((sum, item) => {
    if (item?.percent !== null && item?.percent !== undefined && item?.percent !== '') return sum;
    return sum + rawSecondsToMinutes(item?.raw_value, item?.value);
  }, 0);
}

function uniqueIndex(items, keyOf) {
  const values = new Map();
  for (const item of items) {
    const key = keyOf(item);
    if (!key) continue;
    const current = values.get(key);
    if (current === undefined) values.set(key, item.id);
    else if (current !== item.id) values.set(key, null);
  }
  return values;
}

function employeeName(employee, fallback = '') {
  const direct = String(employee?.name || '').trim();
  if (direct) return direct;
  return `${employee?.first_name || ''} ${employee?.last_name || ''}`.replace(/\s+/g, ' ').trim() || fallback;
}

function invalidSnapshot() {
  throw new PontoMaisError('O Ponto Mais retornou conteúdo incompleto.', { code: 'INVALID_RESPONSE' });
}

function validateSnapshotCollections({ employees, workDays, timeCards }) {
  if (![employees, workDays, timeCards].every(Array.isArray)) invalidSnapshot();
  if (employees.some(employee => (
    !employee || typeof employee !== 'object' || Array.isArray(employee)
    || employee.id === undefined || employee.id === null || String(employee.id).trim() === ''
  ))) invalidSnapshot();

  for (const row of workDays) {
    if (!row || typeof row !== 'object' || Array.isArray(row)
      || !parseDateKey(row.date)
      || (row.employee_id === undefined
        && !normalizeRegistrationNumber(row.registration_number)
        && !normalizeName(row.employee_name))
      || !Object.hasOwn(row, 'summary')
      || !Object.hasOwn(row, 'extra_time')
      || !Array.isArray(row.extra_time)
      || !Object.hasOwn(row, 'overnight_time')) invalidSnapshot();
  }

  for (const row of timeCards) {
    if (!row || typeof row !== 'object' || Array.isArray(row)
      || !parseDateKey(row.date)
      || typeof row.time !== 'string' || !row.time.trim()
      || (!normalizeRegistrationNumber(row.registration_number) && !normalizeName(row.employee_name))
      || !Object.hasOwn(row, 'tag_manager')) invalidSnapshot();
  }
}

export function buildProjectTagResolver({ projects = [], tagAliases = [] } = {}) {
  const projectByCode = new Map(projects
    .filter(project => project?.id && project?.code)
    .map(project => [String(project.code).trim(), project]));
  const aliasByTag = new Map(tagAliases
    .filter(alias => alias?.normalizedTag && alias?.projectId)
    .map(alias => [normalizeProjectTag(alias.normalizedTag), alias.projectId]));
  return rawTag => {
    const normalizedTag = normalizeProjectTag(rawTag);
    if (!normalizedTag) return null;
    if (isPontoTravelTag(rawTag)) return null;
    const aliasProjectId = aliasByTag.get(normalizedTag);
    if (aliasProjectId) return aliasProjectId;
    const code = extractMissionCode(rawTag);
    return code ? projectByCode.get(code)?.id || null : null;
  };
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableValue(value[key])]));
  }
  return value;
}

function contentHashFor(periods, periodStart, periodEnd) {
  const source = periods.map(period => ({
    sourceKey: period.sourceKey,
    registrationNumber: period.registrationNumber,
    rawName: period.rawName,
    monthly: period.monthly
  })).sort((left, right) => left.sourceKey.localeCompare(right.sourceKey));
  return createHash('sha256')
    .update(JSON.stringify(stableValue({ periodStart, periodEnd, periods: source })))
    .digest('hex');
}

function buildMonthlyV2(days) {
  const months = {};
  for (const day of days) {
    const monthKey = day.date.slice(0, 7);
    if (!months[monthKey]) {
      months[monthKey] = {
        normalMinutes: 0,
        genericOvertimeMinutes: 0,
        he70Minutes: 0,
        he100Minutes: 0,
        nightMinutes: 0,
        workedDates: [],
        days: []
      };
    }
    const month = months[monthKey];
    month.normalMinutes += day.workedMinutes;
    month.genericOvertimeMinutes += day.genericOvertimeMinutes;
    month.he70Minutes += day.he70Minutes;
    month.he100Minutes += day.he100Minutes;
    month.nightMinutes += day.nightMinutes;
    if (day.workedMinutes > 0) month.workedDates.push(day.date);
    month.days.push(day);
  }
  return { schemaVersion: 2, months };
}

export function normalizePontoMaisSnapshot({
  periodStart,
  periodEnd,
  employees = [],
  workDays = [],
  timeCards = [],
  collaborators = [],
  externalLinks = [],
  ignoredExternalEmployeeIds = [],
  projects = [],
  tagAliases = []
} = {}) {
  validateSnapshotCollections({ employees, workDays, timeCards });
  const collaboratorsById = new Map(collaborators.map(item => [item.id, item]));
  const collaboratorByRegistration = uniqueIndex(collaborators, item => normalizeRegistrationNumber(item.registrationNumber));
  const collaboratorByCpf = uniqueIndex(collaborators, item => normalizeCpf(item.cpf));
  const collaboratorByName = uniqueIndex(collaborators, item => normalizeName(item.name));
  const linksByExternalId = new Map(externalLinks.map(link => [String(link.externalEmployeeId), link.collaboratorId]));
  const ignoredExternalIds = new Set(ignoredExternalEmployeeIds.map(String));

  const employeesById = new Map(employees.map(employee => [String(employee.id), employee]));
  const employeesByRegistration = uniqueIndex(
    employees.map(employee => ({ ...employee, id: String(employee.id) })),
    employee => normalizeRegistrationNumber(employee.registration_number)
  );
  const employeesByName = uniqueIndex(
    employees.map(employee => ({ ...employee, id: String(employee.id) })),
    employee => normalizeName(employeeName(employee))
  );

  const tagResolver = buildProjectTagResolver({ projects, tagAliases });
  const tagsByRegistrationDate = new Map();
  const tagsByNameDate = new Map();
  for (const card of timeCards) {
    const date = parseDateKey(card.date);
    const tag = tagText(card.tag_manager);
    if (!date || !tag) continue;
    const registration = normalizeRegistrationNumber(card.registration_number);
    const normalizedEmployeeName = normalizeName(card.employee_name);
    for (const [map, key] of [
      [tagsByRegistrationDate, registration ? `${registration}|${date}` : ''],
      [tagsByNameDate, normalizedEmployeeName ? `${normalizedEmployeeName}|${date}` : '']
    ]) {
      if (!key) continue;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(tag);
    }
  }

  const rowsByExternalId = new Map();
  for (const row of workDays) {
    const date = parseDateKey(row.date);
    if (!date) continue;
    const registration = normalizeRegistrationNumber(row.registration_number);
    const normalizedEmployeeName = normalizeName(row.employee_name);
    const externalId = row.employee_id != null
      ? String(row.employee_id)
      : employeesByRegistration.get(registration) || employeesByName.get(normalizedEmployeeName);
    if (!externalId || ignoredExternalIds.has(externalId)) continue;
    const tags = uniqueStrings([
      ...(tagsByRegistrationDate.get(`${registration}|${date}`) || []),
      ...(tagsByNameDate.get(`${normalizedEmployeeName}|${date}`) || [])
    ]);
    const day = {
      date,
      workedMinutes: normalMinutesFromRow(row),
      genericOvertimeMinutes: genericOvertimeMinutes(row),
      he70Minutes: overtimeMinutes(row, 70),
      he100Minutes: overtimeMinutes(row, 100),
      nightMinutes: hmToMinutes(row.overnight_time),
      tags
    };
    if (!rowsByExternalId.has(externalId)) rowsByExternalId.set(externalId, []);
    rowsByExternalId.get(externalId).push(day);
  }

  const pendingEmployees = [];
  const periods = [];
  for (const [externalId, rawDays] of rowsByExternalId) {
    const employee = employeesById.get(externalId) || {};
    const firstRow = workDays.find(row => String(row.employee_id ?? '') === externalId) || {};
    const rawName = employeeName(employee, firstRow.employee_name || `Colaborador ${externalId}`);
    const registrationNumber = normalizeRegistrationNumber(employee.registration_number || firstRow.registration_number);
    const cpf = normalizeCpf(employee.cpf);
    const linkedId = linksByExternalId.get(externalId);
    const collaboratorId = linkedId && collaboratorsById.has(linkedId)
      ? linkedId
      : collaboratorByRegistration.get(registrationNumber)
        || collaboratorByCpf.get(cpf)
        || collaboratorByName.get(normalizeName(rawName))
        || null;

    if (!collaboratorId) {
      pendingEmployees.push({
        externalEmployeeId: externalId,
        registrationNumber: registrationNumber || null,
        externalName: rawName,
        reason: 'NO_UNIQUE_MATCH'
      });
    }

    const dayByDate = new Map();
    for (const day of rawDays) dayByDate.set(day.date, day);
    const days = [...dayByDate.values()].sort((left, right) => left.date.localeCompare(right.date));
    periods.push({
      sourceKey: `pontomais:${externalId}`,
      externalEmployeeId: externalId,
      registrationNumber: registrationNumber || null,
      collaboratorId,
      rawName,
      normalizedName: normalizeName(rawName),
      periodStart: new Date(`${periodStart}T00:00:00.000Z`),
      periodEnd: new Date(`${periodEnd}T00:00:00.000Z`),
      workedMinutes: days.reduce((sum, day) => sum + day.workedMinutes, 0),
      he70Minutes: days.reduce((sum, day) => sum + day.he70Minutes, 0),
      he100Minutes: days.reduce((sum, day) => sum + day.he100Minutes, 0),
      nightMinutes: days.reduce((sum, day) => sum + day.nightMinutes, 0),
      workedDates: days.filter(day => day.workedMinutes > 0).map(day => day.date),
      monthly: buildMonthlyV2(days)
    });
  }
  periods.sort((left, right) => left.sourceKey.localeCompare(right.sourceKey));

  const allTags = uniqueStrings(periods.flatMap(period => (
    Object.values(period.monthly.months).flatMap(month => month.days.flatMap(day => day.tags))
  )));
  const pendingProjectTags = allTags
    .filter(tag => !tagResolver(tag) && !isPontoTravelTag(tag))
    .map(rawTag => ({ rawTag, normalizedTag: normalizeProjectTag(rawTag), reason: 'PROJECT_NOT_FOUND' }));
  const pending = { employees: pendingEmployees, projectTags: pendingProjectTags, ambiguousDays: [] };

  return {
    periods,
    pending,
    contentHash: contentHashFor(periods, periodStart, periodEnd),
    rowsRead: workDays.length,
    collaboratorsTotal: periods.length,
    collaboratorsMatched: periods.length - pendingEmployees.length
  };
}
