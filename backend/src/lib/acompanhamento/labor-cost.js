/*
 * Custo de mão de obra — módulo Acompanhamento (modelo revisado 2026-07-08, das planilhas do motor).
 *
 * DIVISÃO MENSAL: o custo é calculado por mês-calendário (o salário mensal sai uma vez por mês). Mês
 * parcial (arquivo cobre só parte do mês) tem os custos FIXOS proporcionais aos dias cobertos.
 *
 * FOLHA (custo mensal do colaborador, por mês):
 *  - dias trabalhados = horas normais do ponto ÷ 8,8 (HORAS_POR_DIA).
 *  - há apropriação quando o dia com ponto tem relatório nominal; sem relatório no dia, a marcação
 *    da missão/EM VIAGEM precisa ser confirmada pela janela individual do Efetivo oficial. Projetos
 *    legados usam janela global somente para quem aparece nominalmente em RDO do próprio projeto.
 *  - em dias úteis apropriados, o total considerado (normal + HE) tem piso de 8,8h (8h48);
 *    marcações maiores e fins de semana preservam o total real do ponto.
 *  - diasCliente (periculosidade) = dias COM projeto (RDO ou viagem confirmada). Em projeto não-offshore, a configuração
 *    manual por colaborador define se o dia entra como diasFora (dorme fora) ou diasCasa (dorme em
 *    casa/gratificação). Dia com ponto sem nenhuma evidência de projeto não alimenta verbas variáveis.
 *  - Dia de semana sem ponto e sem alocação = folga: 8,8h zerados (só no denominador do HH).
 *  - HH = folha ÷ (horas do ponto + horas de folga).
 *
 * CUSTO POR PROJETO: recalcula o motor com as horas de RDO do projeto para os adicionais/HE
 * (composição), e rateia o FIXO (base do motor sem dias + custos anuais, proporcional no mês
 * parcial) pelas horas. SOBRA = folha − Σ projetos, quebrada em SEDE (ponto batido não alocado) e
 * FOLGA (dia de semana sem ponto). Prova real: Σ projetos + sede + folga = folha.
 */

import prisma from '../prisma.js';
import { computeMonthlyCost } from './cost-engine.js';
import { getAnnualCollaboratorCosts } from './settings.js';
import { buildProjectTagResolver, isPontoTravelTag } from '../pontomais/normalize.js';
import { checkWorkforceAvailability } from '../collaborators/availability-service.js';
import { collaboratorRoleAtDate, collaboratorRoleSegments } from '../collaborators/job-role-history.js';
import { annotateActualRowsWithWorkforceConflicts, classifyActualWorkforceDays } from '../workforce/actual-conflicts.js';
import { allocationPeriods } from '../efetivo/planning/allocation-period.js';

export { isPontoTravelTag } from '../pontomais/normalize.js';

const HORAS_POR_DIA = 8.8;

function isWeekday(dateKey) {
  const date = dateFromYmd(dateKey);
  if (Number.isNaN(date.getTime())) return false;
  const day = date.getUTCDay();
  return day >= 1 && day <= 5;
}

function costNormalHoursForDay(
  dateKey,
  recordedNormalHours,
  recordedHe70Hours,
  recordedHe100Hours,
  hasProjectAllocation
) {
  if (!hasProjectAllocation || !isWeekday(dateKey)) {
    return recordedNormalHours;
  }
  const recordedOvertimeHours = recordedHe70Hours + recordedHe100Hours;
  const recordedTotalHours = recordedNormalHours + recordedOvertimeHours;
  if (recordedTotalHours <= 0) return 0;

  // O piso substitui o total menor; ele não é somado às horas do ponto. Mantemos a HE real e
  // completamos somente a parcela normal necessária para o total chegar a 8h48.
  return Math.max(recordedNormalHours, HORAS_POR_DIA - recordedOvertimeHours);
}

function dateKeyUTC(value) {
  return new Date(value).toISOString().slice(0, 10);
}

function yearKeyUTC(value) {
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : String(d.getUTCFullYear());
}

function parseHm(value) {
  if (!value || typeof value !== 'string') return null;
  const match = value.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

export function serviceIntervalsWorkedMinutes(services = []) {
  const intervals = (services || [])
    .map(service => {
      const start = parseHm(service?.startTime);
      const rawEnd = parseHm(service?.endTime);
      if (start == null || rawEnd == null) return null;
      const end = rawEnd < start ? rawEnd + 24 * 60 : rawEnd;
      return { start, end };
    })
    .filter(Boolean)
    .sort((left, right) => left.start - right.start);

  let total = 0;
  let current = null;
  for (const interval of intervals) {
    if (!current) {
      current = { ...interval };
      continue;
    }
    if (interval.start <= current.end) {
      current.end = Math.max(current.end, interval.end);
      continue;
    }
    total += current.end - current.start;
    current = { ...interval };
  }
  if (current) total += current.end - current.start;
  return Math.max(0, total);
}

function endExclusive(date) {
  return new Date(new Date(date).getTime() + 24 * 60 * 60 * 1000);
}

function sleepModeFor(project, collaboratorId) {
  const map = project?.laborSleepModeByCollaborator;
  if (map && typeof map === 'object' && !Array.isArray(map) && map[collaboratorId] === 'HOME') return 'HOME';
  return 'AWAY';
}

function projectHours(p) {
  const rdoDaysHours = p.rdoDaysHours || 0;
  const explicitSleepHours = p.awayDaysHours != null || p.homeDaysHours != null || p.offshoreDaysHours != null;
  if (!explicitSleepHours) {
    return {
      clientHours: rdoDaysHours,
      awayHours: p.offshore ? 0 : rdoDaysHours,
      homeHours: 0,
      offshoreHours: p.offshore ? rdoDaysHours : 0
    };
  }
  const awayHours = p.awayDaysHours || 0;
  const homeHours = p.homeDaysHours || 0;
  const offshoreHours = p.offshoreDaysHours || 0;
  return {
    clientHours: rdoDaysHours || awayHours + homeHours + offshoreHours,
    awayHours,
    homeHours,
    offshoreHours
  };
}

// Dias de semana (seg–sex) no intervalo que não estão no ponto = folga.
function countFolgaWeekdays(rangeStart, rangeEnd, workedDatesSet) {
  let count = 0;
  const end = new Date(rangeEnd);
  for (const d = new Date(rangeStart); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const dow = d.getUTCDay(); // 0=dom, 6=sáb
    if (dow >= 1 && dow <= 5 && !workedDatesSet.has(d.toISOString().slice(0, 10))) count += 1;
  }
  return count;
}

function totalCost(params, inputs, fixedAnnualCostMensal) {
  return computeMonthlyCost(params, inputs).totalMensal + fixedAnnualCostMensal;
}

function dateFromYmd(value) {
  return new Date(`${value}T00:00:00.000Z`);
}

function pontoImportScopeFromRows(imports) {
  if (!imports.length) return null;
  const latest = [...imports].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
  const periodStart = imports.reduce((min, item) => (
    !min || new Date(item.periodStart) < new Date(min) ? item.periodStart : min
  ), null);
  const periodEnd = imports.reduce((max, item) => (
    !max || new Date(item.periodEnd) > new Date(max) ? item.periodEnd : max
  ), null);
  return {
    pontoImport: latest,
    pontoImports: imports,
    periodStart,
    periodEnd,
    fileName: imports.length === 1 ? latest.fileName : `${imports.length} planilhas importadas`
  };
}

async function getPontoImportScope(importId) {
  if (importId) {
    const item = await prisma.pontoImport.findUnique({ where: { id: importId } });
    return item ? pontoImportScopeFromRows([item]) : null;
  }
  const imports = await prisma.pontoImport.findMany({ orderBy: { createdAt: 'asc' } });
  return pontoImportScopeFromRows(imports);
}

function numberValue(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function uniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map(value => String(value || '').trim())
    .filter(Boolean))];
}

function monthlyPayload(value) {
  const monthly = value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  if (!monthly) return { schemaVersion: 1, months: null };
  if (monthly.schemaVersion === 2 && monthly.months && typeof monthly.months === 'object' && !Array.isArray(monthly.months)) {
    return { schemaVersion: 2, months: monthly.months };
  }
  return { schemaVersion: 1, months: monthly };
}

function effectiveDateKey(set) {
  return set?.effectiveDate ? dateKeyUTC(set.effectiveDate) : '1970-01-01';
}

function createdAtTime(set) {
  const time = set?.createdAt ? new Date(set.createdAt).getTime() : 0;
  return Number.isFinite(time) ? time : 0;
}

function sortParameterSets(sets = []) {
  return [...sets].sort((left, right) => {
    const byDate = effectiveDateKey(left).localeCompare(effectiveDateKey(right));
    if (byDate !== 0) return byDate;
    const byVersion = (Number(left.version) || 0) - (Number(right.version) || 0);
    if (byVersion !== 0) return byVersion;
    return createdAtTime(left) - createdAtTime(right);
  });
}

export function effectiveParameterSetAt(sets = [], dateKey) {
  let selected = null;
  for (const set of sortParameterSets(sets)) {
    if (effectiveDateKey(set) <= dateKey) selected = set;
    else break;
  }
  return selected;
}

function maxDateKey(...keys) {
  return keys.filter(Boolean).sort().at(-1);
}

function minDateKey(...keys) {
  return keys.filter(Boolean).sort()[0];
}

function addDaysKey(dateKey, days) {
  const d = dateFromYmd(dateKey);
  d.setUTCDate(d.getUTCDate() + days);
  return dateKeyUTC(d);
}

function daysInclusive(startKey, endKey) {
  if (!startKey || !endKey || startKey > endKey) return 0;
  return Math.round((dateFromYmd(endKey).getTime() - dateFromYmd(startKey).getTime()) / 86400000) + 1;
}

function monthBounds(monthKey) {
  const [y, m] = monthKey.split('-').map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return {
    monthStartKey: `${monthKey}-01`,
    monthEndKey: `${monthKey}-${String(lastDay).padStart(2, '0')}`,
    daysInMonth: lastDay
  };
}

function coverageForRange(monthKey, fileStart, fileEnd, segmentStartKey, segmentEndKey) {
  const bounds = monthBounds(monthKey);
  const startKey = maxDateKey(bounds.monthStartKey, dateKeyUTC(fileStart), segmentStartKey);
  const endKey = minDateKey(bounds.monthEndKey, dateKeyUTC(fileEnd), segmentEndKey);
  const days = daysInclusive(startKey, endKey);
  return {
    fraction: days > 0 ? days / bounds.daysInMonth : 0,
    start: days > 0 ? dateFromYmd(startKey) : dateFromYmd(bounds.monthStartKey),
    end: days > 0 ? dateFromYmd(endKey) : dateFromYmd(bounds.monthStartKey),
    startKey,
    endKey,
    days
  };
}

function dayRowsFromPeriod(period) {
  const rows = [];
  const sourceCreatedAt = period.import?.createdAt || period.createdAt || new Date(0);
  const { schemaVersion, months: monthly } = monthlyPayload(period.monthly);

  if (monthly) {
    for (const [monthKey, monthData] of Object.entries(monthly)) {
      const month = monthData && typeof monthData === 'object' && !Array.isArray(monthData) ? monthData : {};
      if (Array.isArray(month.days) && month.days.length) {
        for (const day of month.days) {
          if (!day?.date) continue;
          const explicitOvertime = schemaVersion >= 2;
          const genericOvertimeMinutes = explicitOvertime
            ? numberValue(day.genericOvertimeMinutes)
            : numberValue(day.extrasMinutes);
          const he70Minutes = explicitOvertime ? numberValue(day.he70Minutes) : 0;
          const he100Minutes = explicitOvertime ? numberValue(day.he100Minutes) : 0;
          rows.push({
            date: String(day.date),
            workedMinutes: numberValue(day.workedMinutes),
            extrasMinutes: genericOvertimeMinutes + he70Minutes + he100Minutes,
            genericOvertimeMinutes,
            he70Minutes,
            he100Minutes,
            nightMinutes: numberValue(day.nightMinutes),
            tags: uniqueStrings(day.tags),
            schemaVersion,
            explicitOvertime,
            sourceCreatedAt
          });
        }
        continue;
      }

      const workedDates = Array.isArray(month.workedDates) ? month.workedDates : [];
      if (!workedDates.length) continue;
      const normalPerDay = numberValue(month.normalMinutes) / workedDates.length;
      const genericOvertimePerDay = (schemaVersion >= 2
        ? numberValue(month.genericOvertimeMinutes)
        : numberValue(month.extrasMinutes)) / workedDates.length;
      const he70PerDay = (schemaVersion >= 2 ? numberValue(month.he70Minutes) : 0) / workedDates.length;
      const he100PerDay = (schemaVersion >= 2 ? numberValue(month.he100Minutes) : 0) / workedDates.length;
      const nightPerDay = numberValue(month.nightMinutes) / workedDates.length;
      for (const date of workedDates) {
        rows.push({
          date: String(date || monthKey),
          workedMinutes: normalPerDay,
          extrasMinutes: genericOvertimePerDay + he70PerDay + he100PerDay,
          genericOvertimeMinutes: genericOvertimePerDay,
          he70Minutes: he70PerDay,
          he100Minutes: he100PerDay,
          nightMinutes: nightPerDay,
          tags: [],
          schemaVersion,
          explicitOvertime: false,
          sourceCreatedAt
        });
      }
    }
    if (rows.length) return rows;
  }

  const workedDates = Array.isArray(period.workedDates) ? period.workedDates : [];
  if (!workedDates.length) return rows;
  const normalPerDay = numberValue(period.workedMinutes) / workedDates.length;
  const extrasPerDay = (numberValue(period.he70Minutes) + numberValue(period.he100Minutes)) / workedDates.length;
  const nightPerDay = numberValue(period.nightMinutes) / workedDates.length;
  for (const date of workedDates) {
    rows.push({
      date: String(date),
      workedMinutes: normalPerDay,
      extrasMinutes: extrasPerDay,
      genericOvertimeMinutes: extrasPerDay,
      he70Minutes: 0,
      he100Minutes: 0,
      nightMinutes: nightPerDay,
      tags: [],
      schemaVersion: 1,
      explicitOvertime: false,
      sourceCreatedAt
    });
  }
  return rows;
}

export function mergePontoPeriods(periods = []) {
  const byCollaborator = new Map();
  const sorted = [...periods].sort((left, right) => (
    new Date(left.import?.createdAt || left.createdAt || 0).getTime()
    - new Date(right.import?.createdAt || right.createdAt || 0).getTime()
  ));

  for (const period of sorted) {
    if (!period.collaboratorId) continue;
    let entry = byCollaborator.get(period.collaboratorId);
    if (!entry) {
      entry = {
        collaboratorId: period.collaboratorId,
        rawName: period.rawName,
        normalizedName: period.normalizedName,
        collaborator: period.collaborator || null,
        dayMap: new Map()
      };
      byCollaborator.set(period.collaboratorId, entry);
    }
    entry.rawName = period.rawName || entry.rawName;
    entry.normalizedName = period.normalizedName || entry.normalizedName;
    entry.collaborator = period.collaborator || entry.collaborator;
    for (const row of dayRowsFromPeriod(period)) {
      if (!row.date) continue;
      entry.dayMap.set(row.date, row);
    }
  }

  return [...byCollaborator.values()].map(entry => {
    const days = [...entry.dayMap.values()].sort((a, b) => a.date.localeCompare(b.date));
    const monthly = {};
    let schemaVersion = 1;
    for (const day of days) {
      schemaVersion = Math.max(schemaVersion, numberValue(day.schemaVersion) || 1);
      const monthKey = day.date.slice(0, 7);
      if (!monthly[monthKey]) monthly[monthKey] = {
        normalMinutes: 0,
        extrasMinutes: 0,
        genericOvertimeMinutes: 0,
        he70Minutes: 0,
        he100Minutes: 0,
        nightMinutes: 0,
        workedDates: [],
        days: []
      };
      monthly[monthKey].normalMinutes += day.workedMinutes;
      monthly[monthKey].extrasMinutes += day.extrasMinutes;
      monthly[monthKey].genericOvertimeMinutes += day.genericOvertimeMinutes;
      monthly[monthKey].he70Minutes += day.he70Minutes;
      monthly[monthKey].he100Minutes += day.he100Minutes;
      monthly[monthKey].nightMinutes += day.nightMinutes;
      if (day.workedMinutes > 0) monthly[monthKey].workedDates.push(day.date);
      monthly[monthKey].days.push({
        date: day.date,
        workedMinutes: day.workedMinutes,
        extrasMinutes: day.extrasMinutes,
        genericOvertimeMinutes: day.genericOvertimeMinutes,
        he70Minutes: day.he70Minutes,
        he100Minutes: day.he100Minutes,
        nightMinutes: day.nightMinutes,
        tags: uniqueStrings(day.tags),
        explicitOvertime: Boolean(day.explicitOvertime)
      });
    }
    const workedDates = days.filter(day => day.workedMinutes > 0).map(day => day.date);
    const workedMinutes = days.reduce((sum, day) => sum + day.workedMinutes, 0);
    const he70Minutes = days.reduce((sum, day) => sum + day.he70Minutes, 0);
    const he100Minutes = days.reduce((sum, day) => sum + day.he100Minutes, 0);
    const nightMinutes = days.reduce((sum, day) => sum + day.nightMinutes, 0);
    const dates = days.map(day => day.date);
    return {
      collaboratorId: entry.collaboratorId,
      rawName: entry.rawName,
      normalizedName: entry.normalizedName,
      collaborator: entry.collaborator,
      periodStart: dates[0] ? dateFromYmd(dates[0]) : null,
      periodEnd: dates[dates.length - 1] ? dateFromYmd(dates[dates.length - 1]) : null,
      workedMinutes,
      he70Minutes,
      he100Minutes,
      nightMinutes,
      workedDates,
      monthly: schemaVersion >= 2 ? { schemaVersion: 2, months: monthly } : monthly
    };
  });
}

export function filterIgnoredPontoPeriods(periods = [], ignoredExternalEmployeeIds = []) {
  const ignored = new Set(ignoredExternalEmployeeIds.map(String));
  if (!ignored.size) return periods;
  return periods.filter(period => (
    !period.externalEmployeeId || !ignored.has(String(period.externalEmployeeId))
  ));
}

// Cargo canônico (Collaborator.jobRoleId -> JobRole) -> parâmetros efetivos por data. O cargo herda do modelo
// que estava vigente na data calculada e sobrescreve o salário base. A insalubridade vem do salário
// mínimo no motor novo.
export function buildRoleParamsResolver({ roles = [], models = [] } = {}) {
  const modelSetsByKey = new Map();
  for (const model of models) {
    const sets = sortParameterSets(model.parameterSets || []);
    if (sets.length) modelSetsByKey.set(model.key, sets);
  }
  const fallbackModelKey = modelSetsByKey.has('operador')
    ? 'operador'
    : modelSetsByKey.keys().next().value;

  const roleSetsByName = new Map();
  for (const role of roles) {
    const sets = sortParameterSets(role.costProfile?.parameterSets || []);
    if (sets.length) roleSetsByName.set(role.name, sets);
  }

  function paramsFor(roleName, dateKey) {
    const roleSet = effectiveParameterSetAt(roleSetsByName.get(roleName) || [], dateKey);
    if (!roleSet) return null;
    const override = roleSet.params || {};
    const modelKey = typeof override.baseModel === 'string' && override.baseModel
      ? override.baseModel
      : fallbackModelKey;
    const modelSet = effectiveParameterSetAt(modelSetsByKey.get(modelKey) || [], dateKey)
      || effectiveParameterSetAt(modelSetsByKey.get(fallbackModelKey) || [], dateKey);
    if (!modelSet) return null;

    const effective = { ...(modelSet.params || {}) };
    if (override.salarioBase != null) effective.salarioBase = override.salarioBase;
    return effective;
  }

  function hasProfile(roleName) {
    return roleSetsByName.has(roleName);
  }

  function changeDatesFor(roleName, startKey, endKey) {
    const dates = new Set([startKey]);
    const add = set => {
      const key = effectiveDateKey(set);
      if (key > startKey && key <= endKey) dates.add(key);
    };
    for (const set of roleSetsByName.get(roleName) || []) add(set);
    for (const sets of modelSetsByKey.values()) {
      for (const set of sets) add(set);
    }
    return [...dates].sort();
  }

  function segmentsFor(roleName, startKey, endKey) {
    return changeDatesFor(roleName, startKey, endKey)
      .map((startKeyForSegment, index, starts) => {
        const nextStart = starts[index + 1];
        return {
          startKey: startKeyForSegment,
          endKey: nextStart ? addDaysKey(nextStart, -1) : endKey,
          params: paramsFor(roleName, startKeyForSegment)
        };
      })
      .filter(segment => segment.startKey <= segment.endKey);
  }

  return { paramsFor, segmentsFor, hasProfile };
}

export function buildCollaboratorRoleCostSegments({ collaborator, roleParams, startKey, endKey }) {
  return collaboratorRoleSegments(collaborator, startKey, endKey).flatMap(roleSegment => (
    roleParams.segmentsFor(roleSegment.roleName, roleSegment.startKey, roleSegment.endKey)
      .map(parameterSegment => ({
        ...parameterSegment,
        jobRoleId: roleSegment.jobRoleId,
        roleName: roleSegment.roleName,
        roleEffectiveDate: roleSegment.effectiveDate
      }))
  ));
}

async function getRoleParamsResolver() {
  const [roles, models] = await Promise.all([
    prisma.jobRole.findMany({
      include: { costProfile: { include: { parameterSets: true } } }
    }),
    prisma.costProfile.findMany({
      where: { jobRoleId: null },
      include: { parameterSets: true }
    })
  ]);
  return buildRoleParamsResolver({ roles, models });
}

function reportWorkedMinutes(report) {
  const recorded = (Number(report.daytimeWorkedMinutes) || 0) + (Number(report.nighttimeWorkedMinutes) || 0);
  if (recorded > 0 || report.reportType === 'RDO') return recorded;
  return serviceIntervalsWorkedMinutes(report.services || []);
}

export function rdoDataByCollaboratorFromReports(reports) {
  const map = new Map();
  for (const report of reports) {
    const workedMinutes = reportWorkedMinutes(report);
    if (report.reportType !== 'RDO' && workedMinutes <= 0) continue;
    const dk = dateKeyUTC(report.reportDate);
    const workedHours = workedMinutes / 60;
    const offshore = Boolean(report.project?.offshore);
    const mobilizationDate = report.project?.mobilizationDate
      ? dateKeyUTC(report.project.mobilizationDate)
      : null;
    for (const link of report.collaborators || []) {
      const sleepMode = sleepModeFor(report.project, link.collaboratorId);
      let c = map.get(link.collaboratorId);
      if (!c) {
        c = {
          byProject: new Map(),
          dayProjects: new Map(),
          nominalRdoProjectsByDate: new Map(),
          rdoProjectIds: new Set(),
          mobilizationProjectsByDate: new Map()
        };
        map.set(link.collaboratorId, c);
      }
      let p = c.byProject.get(report.projectId);
      if (!p) { p = { offshore, sleepMode }; c.byProject.set(report.projectId, p); }
      let projectsForDay = c.dayProjects.get(dk);
      if (!projectsForDay) {
        projectsForDay = new Map();
        c.dayProjects.set(dk, projectsForDay);
      }
      const existing = projectsForDay.get(report.projectId);
      if (!existing || workedHours > existing.hours) {
        projectsForDay.set(report.projectId, {
          projectId: report.projectId,
          hours: workedHours,
          offshore,
          sleepMode,
          ...(report.project?.code ? { projectCode: String(report.project.code) } : {}),
          ...(report.reportType === 'RDO' && report.sequenceNumber != null
            ? { rdoNumber: report.sequenceNumber }
            : existing?.rdoNumber != null ? { rdoNumber: existing.rdoNumber } : {})
        });
      } else if (report.reportType === 'RDO' && report.sequenceNumber != null && existing.rdoNumber == null) {
        // Um relatório de serviço do mesmo dia pode ter mais horas e continuar sendo a fonte da
        // jornada, mas não deve apagar o número do RDO em que o colaborador também aparece.
        projectsForDay.set(report.projectId, {
          ...existing,
          rdoNumber: report.sequenceNumber,
          ...(report.project?.code ? { projectCode: String(report.project.code) } : {})
        });
      }
      if (report.reportType === 'RDO') {
        c.rdoProjectIds.add(report.projectId);
        let nominalProjects = c.nominalRdoProjectsByDate.get(dk);
        if (!nominalProjects) {
          nominalProjects = new Set();
          c.nominalRdoProjectsByDate.set(dk, nominalProjects);
        }
        nominalProjects.add(report.projectId);
      }
      if (report.reportType === 'RDO' && mobilizationDate && dk > mobilizationDate) {
        let mobilizationProjects = c.mobilizationProjectsByDate.get(mobilizationDate);
        if (!mobilizationProjects) {
          mobilizationProjects = new Set();
          c.mobilizationProjectsByDate.set(mobilizationDate, mobilizationProjects);
        }
        mobilizationProjects.add(report.projectId);
      }
    }
  }
  return map;
}

// RDO por colaborador: por projeto (offshore) e o projeto/horas de cada dia.
async function getRdoDataByCollaborator(periodStart, periodEndExclusive) {
  const reports = await prisma.report.findMany({
    where: {
      deletedAt: null,
      OR: [
        { reportType: 'RDO' },
        {
          reportDate: { gte: periodStart, lt: periodEndExclusive },
          OR: [
            { daytimeWorkedMinutes: { gt: 0 } },
            { nighttimeWorkedMinutes: { gt: 0 } },
            { services: { some: { startTime: { not: null }, endTime: { not: null } } } }
          ]
        }
      ]
    },
    select: {
      reportType: true,
      sequenceNumber: true,
      projectId: true,
      reportDate: true,
      daytimeWorkedMinutes: true,
      nighttimeWorkedMinutes: true,
      project: { select: { code: true, offshore: true, laborSleepModeByCollaborator: true, mobilizationDate: true } },
      collaborators: { select: { collaboratorId: true } },
      services: { select: { startTime: true, endTime: true } }
    }
  });
  return rdoDataByCollaboratorFromReports(reports);
}

async function getProjectAllocationContext() {
  const [projects, tagAliases, missionGroups, effectiveAllocations, effectiveMissions] = await Promise.all([
    prisma.project.findMany({
      select: {
        id: true,
        code: true,
        offshore: true,
        laborSleepModeByCollaborator: true,
        laborCollaboratorIds: true,
        operatorId: true,
        mobilizationDate: true,
        demobilizationDate: true,
        deletedAt: true
      }
    }),
    prisma.pontoProjectTagAlias.findMany({
      select: { normalizedTag: true, projectId: true }
    }),
    prisma.acompanhamentoMissionGroup.findMany({
      where: { status: 'ACTIVE' },
      select: {
        id: true,
        laborAllocationMode: true,
        primaryLaborProjectId: true,
        members: { select: { projectId: true } }
      }
    }),
    prisma.efetivoMissionAllocation.findMany({
      where: {
        deletedAt: null,
        mission: {
          deletedAt: null,
          scheduleStatus: 'CONFIRMED',
          plan: { kind: 'OFFICIAL', status: 'ACTIVE' }
        }
      },
      select: {
        id: true,
        collaboratorId: true,
        deletedAt: true,
        mobilizationDate: true,
        demobilizationDate: true,
        cycles: { select: { id: true, mobilizationDate: true, demobilizationDate: true } },
        mission: {
          select: {
            id: true,
            projectId: true,
            scheduleStatus: true,
            deletedAt: true,
            mobilizationDate: true,
            executionEndDate: true,
            returnDate: true,
            cycles: { select: { id: true, mobilizationDate: true, demobilizationDate: true } },
            plan: { select: { kind: true, status: true } }
          }
        }
      }
    }),
    prisma.efetivoMissionPlan.findMany({
      where: {
        deletedAt: null,
        scheduleStatus: 'CONFIRMED',
        plan: { kind: 'OFFICIAL', status: 'ACTIVE' }
      },
      select: { projectId: true }
    })
  ]);
  const effectiveMissionProjectIds = new Set(effectiveMissions.map(mission => mission.projectId));
  return {
    projects,
    resolveTag: buildProjectTagResolver({ projects, tagAliases }),
    missionGroupProjectsByProjectId: buildMissionGroupProjectIndex(missionGroups),
    scheduleWindows: buildScheduleWindows(projects, effectiveMissionProjectIds),
    effectiveAllocationIndex: buildEffectiveAllocationIndex(effectiveAllocations)
  };
}

/*
 * Efetivo oficial: ciclos individuais prevalecem sobre os ciclos gerais da missão. Quando não
 * há personalização, o colaborador herda todos os ciclos do projeto, preservando as pausas.
 * Cenários, missões não confirmadas e registros excluídos são filtrados na consulta.
 */
export function buildEffectiveAllocationIndex(allocations = []) {
  const result = new Map();
  for (const item of allocations || []) {
    if (!item?.collaboratorId || !item?.mission?.projectId) continue;
    if (item.deletedAt || item.mission.deletedAt) continue;
    if (item.mission.scheduleStatus && item.mission.scheduleStatus !== 'CONFIRMED') continue;
    if (item.mission.plan && (
      item.mission.plan.kind !== 'OFFICIAL'
      || item.mission.plan.status !== 'ACTIVE'
    )) continue;
    let periods;
    try {
      periods = allocationPeriods(item, item.mission);
    } catch {
      continue;
    }
    let context = result.get(item.collaboratorId);
    if (!context) {
      context = { projectIds: new Set(), windows: [] };
      result.set(item.collaboratorId, context);
    }
    context.projectIds.add(item.mission.projectId);
    for (const period of periods) {
      if (!period?.startDate || !period?.endDate || period.startDate > period.endDate) continue;
      context.windows.push({
        allocationId: item.id || null,
        cycleId: period.id || null,
        missionId: item.mission.id || null,
        projectId: item.mission.projectId,
        startKey: period.startDate,
        endKey: period.endDate
      });
    }
  }
  for (const context of result.values()) {
    context.windows.sort((left, right) => (
      left.startKey.localeCompare(right.startKey)
      || left.endKey.localeCompare(right.endKey)
      || String(left.projectId).localeCompare(String(right.projectId))
    ));
  }
  return result;
}

export function effectiveProjectsForDay({
  effectiveAllocationIndex = new Map(),
  collaboratorId = null,
  dateKey = null
} = {}) {
  if (!collaboratorId || !dateKey) return [];
  const context = effectiveAllocationIndex.get(collaboratorId);
  if (!context) return [];
  return [...new Set(context.windows
    .filter(window => dateKey >= window.startKey && dateKey <= window.endKey)
    .map(window => window.projectId))].sort();
}

export function effectiveProjectsForCollaborator(effectiveAllocationIndex = new Map(), collaboratorId = null) {
  return collaboratorId && effectiveAllocationIndex.get(collaboratorId)
    ? [...effectiveAllocationIndex.get(collaboratorId).projectIds].sort()
    : [];
}

/*
 * Janelas de cronograma: só entram projetos com mobilização E desmobilização preenchidas.
 *
 * A desmobilização é preenchida depois do fato, então é dado mais forte que uma previsão. Enquanto
 * ela estiver vazia, a obra está em andamento e a janela global não é usada. Projetos presentes no
 * Efetivo oficial também são excluídos daqui: para eles só valem as datas individuais do Efetivo.
 */
export function buildScheduleWindows(projects = [], excludedProjectIds = new Set()) {
  const excluded = excludedProjectIds instanceof Set
    ? excludedProjectIds
    : new Set(excludedProjectIds || []);
  return projects
    .filter(project => (
      project?.id
      && !excluded.has(project.id)
      && project.mobilizationDate
      && project.demobilizationDate
    ))
    .map(project => {
      const startKey = dateKeyUTC(project.mobilizationDate);
      const endKey = dateKeyUTC(project.demobilizationDate);
      return startKey && endKey && startKey <= endKey
        ? {
          projectId: project.id,
          startKey,
          endKey
        }
        : null;
    })
    .filter(Boolean);
}

/*
 * Fallback legado: a janela global do projeto só é elegível para quem aparece nominalmente em ao
 * menos um RDO do próprio projeto dentro dela. Operador e lista manual do Project não substituem o
 * Efetivo individual; são campos históricos que causavam os falsos positivos desta regra.
 *
 * O recorte por janela é o que impede o vazamento histórico: quem fez um RDO do projeto em março
 * não vira elegível para a janela de julho. Quem entrou só por RDO fora da janela já está coberto
 * pela evidência do próprio RDO.
 */
export function buildScheduleWindowEligibility(scheduleWindows = [], rdoDataByCollaborator = new Map()) {
  const eligibleByProject = new Map(scheduleWindows.map(window => [window.projectId, new Set()]));

  for (const [collaboratorId, rdo] of rdoDataByCollaborator) {
    for (const [dateKey, projectIds] of rdo.nominalRdoProjectsByDate || new Map()) {
      for (const projectId of projectIds) {
        const window = scheduleWindows.find(item => item.projectId === projectId);
        if (!window || dateKey < window.startKey || dateKey > window.endKey) continue;
        eligibleByProject.get(projectId)?.add(collaboratorId);
      }
    }
  }
  return eligibleByProject;
}

/*
 * Janelas que cobrem um dia e para as quais o colaborador é elegível. Duas ou mais são devolvidas
 * na íntegra de propósito: a decisão é do chamador, que transforma o empate em pendência em vez de
 * chutar um projeto.
 */
export function scheduleWindowsForDay({
  scheduleWindows = [],
  eligibleByProject = new Map(),
  collaboratorId = null,
  dateKey = null
} = {}) {
  if (!collaboratorId || !dateKey) return [];
  return scheduleWindows
    .filter(window => (
      dateKey >= window.startKey
      && dateKey <= window.endKey
      && eligibleByProject.get(window.projectId)?.has(collaboratorId)
    ))
    .map(window => window.projectId)
    .sort();
}

function projectMetaForCollaborator(projects, collaboratorId) {
  return new Map(projects.map(project => [project.id, {
    code: project.code ? String(project.code) : null,
    offshore: Boolean(project.offshore),
    sleepMode: sleepModeFor(project, collaboratorId)
  }]));
}

function manualProjectsByCollaborator(overrides = []) {
  const result = new Map();
  for (const override of overrides) {
    if (!override?.collaboratorId || !override?.projectId || !override?.workDate) continue;
    if (!result.has(override.collaboratorId)) result.set(override.collaboratorId, new Map());
    const byDate = result.get(override.collaboratorId);
    const date = dateKeyUTC(override.workDate);
    const projectIds = byDate.get(date) || [];
    if (!projectIds.includes(override.projectId)) projectIds.push(override.projectId);
    projectIds.sort();
    byDate.set(date, projectIds);
  }
  return result;
}

export function buildMissionGroupProjectIndex(missionGroups = []) {
  const result = new Map();
  for (const group of missionGroups || []) {
    const projectIds = [...new Set((group?.members || [])
      .map(member => member?.projectId)
      .filter(Boolean))];
    if (projectIds.length < 2) continue;
    const context = {
      id: group?.id || null,
      members: new Set(projectIds),
      laborAllocationMode: group?.laborAllocationMode || 'VISUAL_ONLY',
      primaryLaborProjectId: group?.primaryLaborProjectId || null
    };
    for (const projectId of projectIds) result.set(projectId, context);
  }
  return result;
}

function missionGroupMembers(group) {
  if (!group) return null;
  return group.members instanceof Set ? group.members : group instanceof Set ? group : null;
}

function mergedGroupSingleRdoFallback(taggedProjectIds, rdoByProject, missionGroupProjectsByProjectId) {
  if (!taggedProjectIds.length || !(missionGroupProjectsByProjectId instanceof Map)) return null;
  const groups = taggedProjectIds.map(projectId => missionGroupProjectsByProjectId.get(projectId));
  if (groups.some(group => !group) || groups.some(group => group !== groups[0])) return null;
  const members = missionGroupMembers(groups[0]);
  if (!members) return null;
  const eligible = [...rdoByProject.values()].filter(item => members.has(item.projectId));
  if (eligible.length !== 1) return null;
  return {
    allocations: [{ projectId: eligible[0].projectId, weight: 1, rdo: eligible[0] }],
    reason: 'MERGED_GROUP_SINGLE_RDO_FALLBACK'
  };
}

function explicitMissionGroupDecision({
  taggedProjectIds,
  rdoByProject,
  missionGroupProjectsByProjectId,
  allocationAxis
}) {
  if (rdoByProject.size === 0 || !(missionGroupProjectsByProjectId instanceof Map)) return null;
  const rdoGroups = [...rdoByProject.keys()].map(projectId => missionGroupProjectsByProjectId.get(projectId));
  if (rdoGroups.some(group => !group) || rdoGroups.some(group => group !== rdoGroups[0])) return null;
  const group = rdoGroups[0];
  const members = missionGroupMembers(group);
  if (!members || taggedProjectIds.some(projectId => !members.has(projectId))) return null;

  const rdoItems = [...rdoByProject.values()].sort((left, right) => (
    String(left.projectId).localeCompare(String(right.projectId))
  ));
  if (group.laborAllocationMode === 'CONSOLIDATE_PRIMARY' && group.primaryLaborProjectId) {
    return {
      allocations: [{
        projectId: group.primaryLaborProjectId,
        weight: 1,
        rdo: rdoByProject.get(group.primaryLaborProjectId) || rdoItems[0] || null
      }],
      reason: 'CONSOLIDATE_PRIMARY'
    };
  }
  if (group.laborAllocationMode !== 'SHARED_EXECUTION' || rdoItems.length < 2) return null;
  if (allocationAxis === 'ANALYTICAL') {
    return {
      allocations: rdoItems.map(item => ({ projectId: item.projectId, weight: 1, rdo: item })),
      reason: 'SHARED_EXECUTION_ANALYTICAL'
    };
  }
  const positiveTotal = rdoItems.reduce((sum, item) => sum + Math.max(0, Number(item.hours) || 0), 0);
  return {
    allocations: rdoItems.map(item => ({
      projectId: item.projectId,
      weight: positiveTotal > 0
        ? Math.max(0, Number(item.hours) || 0) / positiveTotal
        : 1 / rdoItems.length,
      rdo: item
    })),
    reason: 'SHARED_EXECUTION_ACCOUNTING'
  };
}

export function buildDailyProjectWeights({
  tags = [],
  rdoProjects = new Map(),
  resolveTag = () => null,
  manualProjectId = null,
  manualProjectIds = null,
  mobilizationProjectIds = null,
  effectiveProjectIds = [],
  scheduleWindowProjectIds = [],
  missionGroupProjectsByProjectId = new Map(),
  allocationAxis = 'ACCOUNTING'
} = {}) {
  const rdoByProject = rdoProjects instanceof Map
    ? rdoProjects
    : new Map((rdoProjects || []).map(item => [item.projectId, item]));
  const selectedManualProjectIds = [...new Set([
    ...(Array.isArray(manualProjectIds) ? manualProjectIds : []),
    ...(manualProjectId ? [manualProjectId] : [])
  ].filter(Boolean))].sort();
  const taggedProjectIds = [...new Set((tags || []).map(resolveTag).filter(Boolean))].sort();
  const effectiveIds = [...new Set((effectiveProjectIds || []).filter(Boolean))].sort();
  const scheduledProjectIds = [...new Set(scheduleWindowProjectIds.filter(Boolean))].sort();
  const taggedEffectiveProjectIds = taggedProjectIds.filter(projectId => effectiveIds.includes(projectId));
  const taggedScheduledProjectIds = taggedProjectIds.filter(projectId => scheduledProjectIds.includes(projectId));
  const hasTravelTag = (tags || []).some(isPontoTravelTag);

  // A seleção explícita do gestor é uma resolução auditada e, por isso, vale mesmo quando o dia
  // não possui RDO. Antes ela era lida somente depois do retorno NO_RDO_EVIDENCE, o que fazia o dia
  // reaparecer na fila imediatamente após ser resolvido.
  if (selectedManualProjectIds.length > 0) {
    const selectedRdos = selectedManualProjectIds.map(projectId => rdoByProject.get(projectId)).filter(Boolean);
    const rdoTotal = selectedRdos.reduce((sum, item) => sum + Math.max(0, Number(item.hours) || 0), 0);
    const hasCompleteRdoWeights = selectedRdos.length === selectedManualProjectIds.length
      && selectedRdos.every(item => Math.max(0, Number(item.hours) || 0) > 0);
    return {
      allocations: selectedManualProjectIds.map(projectId => {
        const rdo = rdoByProject.get(projectId) || null;
        const weight = allocationAxis === 'ANALYTICAL' || selectedManualProjectIds.length === 1
          ? 1
          : hasCompleteRdoWeights && rdoTotal > 0 && rdo
            ? Math.max(0, Number(rdo.hours) || 0) / rdoTotal
            : 1 / selectedManualProjectIds.length;
        return { projectId, weight, rdo };
      }),
      reason: selectedManualProjectIds.length === 1 ? 'MANUAL_OVERRIDE' : 'MANUAL_SHARED_OVERRIDE'
    };
  }

  /*
   * Sem relatório no próprio dia, o Efetivo oficial é a fonte principal, mas não substitui a
   * marcação do ponto. A janela individual autoriza uma missão somente quando o próprio ponto
   * identifica a missão ou registra EM VIAGEM. Sem qualquer uma dessas evidências, o dia continua
   * fora dos projetos e também não vira pendência.
   */
  if (rdoByProject.size === 0) {
    if (taggedEffectiveProjectIds.length === 1) {
      return {
        allocations: [{ projectId: taggedEffectiveProjectIds[0], weight: 1, rdo: null }],
        reason: 'EFFECTIVE_PROJECT_TAG_TRAVEL',
        travelContext: true
      };
    }
    if (taggedEffectiveProjectIds.length > 1) {
      return {
        allocations: [],
        candidateProjectIds: [...new Set([...effectiveIds, ...taggedProjectIds])].sort(),
        reason: 'EFFECTIVE_ALLOCATION_AMBIGUOUS'
      };
    }
    if (effectiveIds.length === 1 && taggedProjectIds.length === 0 && hasTravelTag) {
      return {
        allocations: [{ projectId: effectiveIds[0], weight: 1, rdo: null }],
        reason: 'EFFECTIVE_ALLOCATION_TRAVEL',
        travelContext: true
      };
    }
    if (effectiveIds.length > 0 && (taggedProjectIds.length > 0 || hasTravelTag)) {
      return {
        allocations: [],
        candidateProjectIds: [...new Set([...effectiveIds, ...taggedProjectIds])].sort(),
        reason: effectiveIds.length > 1
          ? 'EFFECTIVE_ALLOCATION_AMBIGUOUS'
          : 'EFFECTIVE_TAG_CONFLICT'
      };
    }

    // Projetos antigos podem não existir no Efetivo. Neles, uma janela global fechada só fica
    // disponível se o colaborador aparece nominalmente em RDO daquela mesma janela.
    if (taggedScheduledProjectIds.length === 1) {
      return {
        allocations: [{ projectId: taggedScheduledProjectIds[0], weight: 1, rdo: null }],
        reason: 'SCHEDULE_PROJECT_TAG_TRAVEL',
        travelContext: true
      };
    }
    if (taggedScheduledProjectIds.length > 1) {
      return {
        allocations: [],
        candidateProjectIds: [...new Set([...scheduledProjectIds, ...taggedProjectIds])].sort(),
        reason: 'SCHEDULE_WINDOW_AMBIGUOUS'
      };
    }
    if (scheduledProjectIds.length === 1 && taggedProjectIds.length === 0 && hasTravelTag) {
      return {
        allocations: [{ projectId: scheduledProjectIds[0], weight: 1, rdo: null }],
        reason: 'SCHEDULE_TRAVEL_TAG',
        travelContext: true
      };
    }
    if (scheduledProjectIds.length > 0 && (taggedProjectIds.length > 0 || hasTravelTag)) {
      return {
        allocations: [],
        candidateProjectIds: [...new Set([...scheduledProjectIds, ...taggedProjectIds])].sort(),
        reason: 'SCHEDULE_WINDOW_AMBIGUOUS'
      };
    }

    const mobilizationIds = mobilizationProjectIds instanceof Set
      ? [...mobilizationProjectIds]
      : Array.isArray(mobilizationProjectIds) ? mobilizationProjectIds : [];
    // Evidência histórica de outro dia não transforma o ponto atual em pendência. Só a data de
    // mobilização nominal, inferida de um RDO real, é uma exceção útil para projetos legados.
    const taggedMobilizationIds = taggedProjectIds.filter(projectId => mobilizationIds.includes(projectId));
    const nominalCandidates = [...new Set([
      ...taggedMobilizationIds,
      ...(hasTravelTag ? mobilizationIds : [])
    ])].filter(Boolean).sort();
    if (nominalCandidates.length > 0) {
      return {
        allocations: [],
        candidateProjectIds: nominalCandidates,
        reason: 'RDO_PERIOD_MISMATCH'
      };
    }
    return {
      allocations: [],
      candidateProjectIds: taggedProjectIds,
      reason: 'NO_PROJECT_EVIDENCE'
    };
  }
  const explicitGroupDecision = explicitMissionGroupDecision({
    taggedProjectIds,
    rdoByProject,
    missionGroupProjectsByProjectId,
    allocationAxis
  });
  if (explicitGroupDecision) return explicitGroupDecision;

  if (taggedProjectIds.length === 1) {
    const projectId = taggedProjectIds[0];
    if (rdoByProject.size > 0 && !rdoByProject.has(projectId)) {
      if (rdoByProject.size === 1) {
        const onlyRdo = [...rdoByProject.values()][0];
        return {
          allocations: [{ projectId: onlyRdo.projectId, weight: 1, rdo: onlyRdo }],
          reason: 'SINGLE_RDO_OVERRIDES_TAG'
        };
      }
      const groupedFallback = mergedGroupSingleRdoFallback(
        taggedProjectIds,
        rdoByProject,
        missionGroupProjectsByProjectId
      );
      if (groupedFallback) return groupedFallback;
      return { allocations: [], reason: 'TAG_RDO_CONFLICT' };
    }
    return {
      allocations: [{ projectId, weight: 1, rdo: rdoByProject.get(projectId) || null }],
      reason: 'SINGLE_TAG'
    };
  }

  if (taggedProjectIds.length > 1) {
    const confirmed = taggedProjectIds
      .filter(projectId => rdoByProject.has(projectId))
      .map(projectId => rdoByProject.get(projectId));
    if (confirmed.length === 1) {
      return {
        allocations: [{ projectId: confirmed[0].projectId, weight: 1, rdo: confirmed[0] }],
        reason: 'SINGLE_CONFIRMED_TAG'
      };
    }
    if (confirmed.length > 1) {
      const totalRdoHours = confirmed.reduce((sum, item) => sum + Math.max(0, Number(item.hours) || 0), 0);
      if (totalRdoHours > 0) {
        return {
          allocations: confirmed
            .filter(item => (Number(item.hours) || 0) > 0)
            .map(item => ({
              projectId: item.projectId,
              weight: Math.max(0, Number(item.hours) || 0) / totalRdoHours,
              rdo: item
            })),
          reason: 'MULTIPLE_CONFIRMED_TAGS'
        };
      }
    }
    const groupedFallback = mergedGroupSingleRdoFallback(
      taggedProjectIds,
      rdoByProject,
      missionGroupProjectsByProjectId
    );
    if (groupedFallback) return groupedFallback;
    return { allocations: [], reason: 'UNCONFIRMED_MULTIPLE_TAGS' };
  }

  if (rdoByProject.size === 1) {
    const onlyRdo = [...rdoByProject.values()][0];
    return {
      allocations: [{ projectId: onlyRdo.projectId, weight: 1, rdo: onlyRdo }],
      reason: 'SINGLE_RDO_FALLBACK'
    };
  }
  return {
    allocations: [],
    reason: 'AMBIGUOUS_WITHOUT_TAGS'
  };
}

const NON_ACTIONABLE_ALLOCATION_REASONS = new Set([
  'NO_POINT_HOURS',
  'NO_PROJECT_EVIDENCE',
  'NO_RDO_EVIDENCE'
]);

export function allocationDecisionRequiresAction(decision) {
  return Boolean(
    decision
    && (decision.allocations || []).length === 0
    && !NON_ACTIONABLE_ALLOCATION_REASONS.has(decision.reason)
  );
}

export function classifyProjectHours(
  dayRows,
  rdo,
  resolveTag = () => null,
  projectMetaById = new Map(),
  manualProjectByDate = new Map(),
  missionGroupProjectsByProjectId = new Map(),
  allocationAxis = 'ACCOUNTING',
  scheduleWindowContext = null
) {
  const byProject = new Map();
  const unresolvedDays = [];
  const dayTrail = [];
  const dayProjects = rdo?.dayProjects || new Map();
  const knownEffectiveProjectIds = effectiveProjectsForCollaborator(
    scheduleWindowContext?.effectiveAllocationIndex,
    scheduleWindowContext?.collaboratorId
  );
  let costNormalHours = 0;

  for (const row of dayRows) {
    const rdoProjects = dayProjects.get(row.date) || new Map();
    const effectiveProjectIds = effectiveProjectsForDay({
      effectiveAllocationIndex: scheduleWindowContext?.effectiveAllocationIndex,
      collaboratorId: scheduleWindowContext?.collaboratorId,
      dateKey: row.date
    });
    const mobilizationProjectIds = rdo?.mobilizationProjectsByDate?.get(row.date) || null;
    const manualProjectIds = manualProjectByDate.get(row.date) || null;
    const dayNormalHours = Math.max(0, Number(row.normalHours) || 0);
    const dayHe70Hours = Math.max(0, Number(row.he70Horas) || 0);
    const dayHe100Hours = Math.max(0, Number(row.he100Horas) || 0);
    const dayTotalHours = dayNormalHours + dayHe70Hours + dayHe100Hours;
    const decision = dayTotalHours > 0
      ? buildDailyProjectWeights({
        tags: row.tags,
        rdoProjects,
        resolveTag,
        manualProjectIds,
        mobilizationProjectIds,
        effectiveProjectIds,
        scheduleWindowProjectIds: scheduleWindowsForDay({
          scheduleWindows: scheduleWindowContext?.windows,
          eligibleByProject: scheduleWindowContext?.eligibleByProject,
          collaboratorId: scheduleWindowContext?.collaboratorId,
          dateKey: row.date
        }),
        missionGroupProjectsByProjectId,
        allocationAxis
      })
      : { allocations: [], reason: 'NO_POINT_HOURS' };
    const pending = allocationDecisionRequiresAction(decision);
    const effectiveProjectSet = new Set(effectiveProjectIds);
    const planningMismatch = rdoProjects.size > 0
      && knownEffectiveProjectIds.length > 0
      && [...rdoProjects.keys()].some(projectId => !effectiveProjectSet.has(projectId));
    // EM VIAGEM só complementa a ausência de RDO. Quando o colaborador consta nominalmente em um
    // RDO do dia, o relatório é a fonte do contexto e a etiqueta do ponto não vira deslocamento.
    const travelContext = rdoProjects.size === 0
      && Boolean(decision.travelContext || (row.tags || []).some(isPontoTravelTag));
    const dayCostNormalHours = costNormalHoursForDay(
      row.date,
      dayNormalHours,
      dayHe70Hours,
      dayHe100Hours,
      decision.allocations.length > 0
    );
    costNormalHours += dayCostNormalHours;
    // Trilha da decisão de cada dia: base única do painel de auditoria e das pendências.
    dayTrail.push({
      date: row.date,
      normalHours: dayNormalHours,
      costNormalHours: dayCostNormalHours,
      minimumNormalHoursApplied: dayCostNormalHours > dayNormalHours,
      he70Hours: dayHe70Hours,
      he100Hours: dayHe100Hours,
      tags: uniqueStrings(row.tags),
      tagProjectIds: [...new Set((row.tags || []).map(resolveTag).filter(Boolean))].sort(),
      rdoProjects: [...rdoProjects.values()].map(item => ({
        projectId: item.projectId,
        hours: Math.max(0, Number(item.hours) || 0),
        ...(item.projectCode ? { projectCode: String(item.projectCode) } : {}),
        ...(item.rdoNumber != null ? { rdoNumber: item.rdoNumber } : {})
      })),
      manualProjectIds: manualProjectIds ? [...manualProjectIds] : [],
      effectiveProjectIds,
      knownEffectiveProjectIds,
      allocations: decision.allocations.map(item => ({ projectId: item.projectId, weight: item.weight })),
      candidateProjectIds: decision.candidateProjectIds ? [...decision.candidateProjectIds] : [],
      travelContext,
      planningMismatch,
      pending,
      reason: decision.reason
    });
    if (decision.allocations.length === 0) {
      // Dia sem hora nenhuma é folga, não pendência — nunca vira item para o gestor resolver.
      if (dayTotalHours > 0) {
        unresolvedDays.push({
          date: row.date,
          reason: decision.reason,
          pending,
          normalHours: dayNormalHours,
          he70Hours: dayHe70Hours,
          he100Hours: dayHe100Hours
        });
      }
      continue;
    }

    for (const allocation of decision.allocations) {
      const rdoProject = allocation.rdo || rdo?.byProject?.get(allocation.projectId) || null;
      const projectMeta = projectMetaById.get(allocation.projectId) || rdoProject || {};
      let project = byProject.get(allocation.projectId);
      if (!project) {
        project = {
          projectId: allocation.projectId,
          normalHours: 0,
          he70Hours: 0,
          he100Hours: 0,
          rdoWorkedHours: 0,
          awayHours: 0,
          homeHours: 0,
          offshoreHours: 0,
          travelHours: 0,
          offshore: Boolean(projectMeta.offshore),
          sleepMode: projectMeta.sleepMode === 'HOME' ? 'HOME' : 'AWAY'
        };
        byProject.set(allocation.projectId, project);
      }
      const allocatedNormalHours = dayCostNormalHours * allocation.weight;
      const allocatedHe70Hours = Math.max(0, Number(row.he70Horas) || 0) * allocation.weight;
      const allocatedHe100Hours = Math.max(0, Number(row.he100Horas) || 0) * allocation.weight;
      project.normalHours += allocatedNormalHours;
      project.he70Hours += allocatedHe70Hours;
      project.he100Hours += allocatedHe100Hours;
      project.rdoWorkedHours += Math.max(0, Number(allocation.rdo?.hours) || 0);
      if (project.offshore) project.offshoreHours += allocatedNormalHours;
      else if (travelContext || project.sleepMode !== 'HOME') project.awayHours += allocatedNormalHours;
      else project.homeHours += allocatedNormalHours;
      if (travelContext) project.travelHours += allocatedNormalHours + allocatedHe70Hours + allocatedHe100Hours;
    }
  }

  return { byProject, unresolvedDays, dayTrail, costNormalHours };
}

// Fração do mês coberta pelo arquivo (para proporcionalizar o fixo no mês parcial).
function monthCoverage(monthKey, fileStart, fileEnd) {
  const bounds = monthBounds(monthKey);
  return coverageForRange(monthKey, fileStart, fileEnd, bounds.monthStartKey, bounds.monthEndKey);
}

// Divide a hora extra do mês em 70% e 100% com teto de HE70 (padrão 30h/mês): o excesso vira 100%.
export function splitOvertime(extrasHoras, cap = 30) {
  const he70Horas = Math.min(cap, Math.max(0, extrasHoras));
  const he100Horas = Math.max(0, extrasHoras - cap);
  return { he70Horas, he100Horas };
}

export function splitOvertimeDays(days, cap = 30) {
  let he70Remaining = Math.max(0, cap);
  return days.map(day => {
    const genericOvertimeHoras = Math.max(0, Number(day.genericOvertimeHoras) || 0);
    const genericHe70Horas = Math.min(he70Remaining, genericOvertimeHoras);
    he70Remaining -= genericHe70Horas;
    return {
      ...day,
      he70Horas: Math.max(0, Number(day.he70Horas) || 0) + genericHe70Horas,
      he100Horas: Math.max(0, Number(day.he100Horas) || 0) + Math.max(0, genericOvertimeHoras - genericHe70Horas)
    };
  });
}

function monthRowsFromMonthlyData(monthKey, monthData, schemaVersion = 1) {
  const month = monthData && typeof monthData === 'object' && !Array.isArray(monthData) ? monthData : {};
  if (Array.isArray(month.days) && month.days.length) {
    return month.days
      .filter(day => day?.date)
      .map(day => ({
        date: String(day.date),
        normalHours: numberValue(day.workedMinutes) / 60,
        extrasHoras: numberValue(day.extrasMinutes) / 60,
        genericOvertimeHoras: (schemaVersion >= 2
          ? numberValue(day.genericOvertimeMinutes)
          : numberValue(day.extrasMinutes)) / 60,
        he70Horas: (schemaVersion >= 2 ? numberValue(day.he70Minutes) : 0) / 60,
        he100Horas: (schemaVersion >= 2 ? numberValue(day.he100Minutes) : 0) / 60,
        tags: uniqueStrings(day.tags),
        explicitOvertime: schemaVersion >= 2
      }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  const workedDates = Array.isArray(month.workedDates) ? month.workedDates : [];
  if (!workedDates.length) return [];
  const normalPerDay = numberValue(month.normalMinutes) / workedDates.length / 60;
  const extrasPerDay = numberValue(month.extrasMinutes) / workedDates.length / 60;
  return workedDates
    .filter(Boolean)
    .map(date => ({
      date: String(date || monthKey),
      normalHours: normalPerDay,
      extrasHoras: extrasPerDay,
      genericOvertimeHoras: extrasPerDay,
      he70Horas: 0,
      he100Horas: 0,
      explicitOvertime: false
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

// Detalhe por mês do colaborador: usa os dias do ponto quando disponíveis; se ausentes (imports
// antigos), apropria os totais do período pela proporção de dias trabalhados.
function monthsOf(period) {
  const { schemaVersion, months: monthly } = monthlyPayload(period.monthly);
  if (monthly && Object.keys(monthly).length) {
    return Object.entries(monthly).map(([monthKey, month]) => {
      const days = monthRowsFromMonthlyData(monthKey, month, schemaVersion);
      return {
        monthKey,
        days,
        workedDates: days.filter(day => day.normalHours > 0).map(day => day.date)
      };
    });
  }
  const workedDates = period.workedDates || [];
  const total = workedDates.length || 1;
  const byMonth = new Map();
  for (const d of workedDates) { const mk = d.slice(0, 7); if (!byMonth.has(mk)) byMonth.set(mk, []); byMonth.get(mk).push(d); }
  return [...byMonth.entries()].map(([monthKey, dates]) => {
    const ratio = dates.length / total;
    const normalPerDay = ((period.workedMinutes / 60) * ratio) / (dates.length || 1);
    const extrasPerDay = (((period.he70Minutes + period.he100Minutes) / 60) * ratio) / (dates.length || 1);
    return {
      monthKey,
      days: dates.map(date => ({
        date,
        normalHours: normalPerDay,
        extrasHoras: extrasPerDay,
        genericOvertimeHoras: extrasPerDay,
        he70Horas: 0,
        he100Horas: 0,
        explicitOvertime: false
      })),
      workedDates: dates
    };
  });
}

function yearsForPeriod(start, end) {
  const startYear = Number(yearKeyUTC(start));
  const endYear = Number(yearKeyUTC(end));
  if (!Number.isFinite(startYear) || !Number.isFinite(endYear)) return [];
  const years = [];
  for (let year = startYear; year <= endYear; year += 1) years.push(String(year));
  return years;
}

export function offshoreYearsByCollaboratorFromReports(reports = []) {
  const map = new Map();
  for (const report of reports) {
    if (!report?.project?.offshore) continue;
    const year = yearKeyUTC(report.reportDate);
    if (!year) continue;
    for (const link of report.collaborators || []) {
      const collaboratorId = link.collaboratorId;
      if (!collaboratorId) continue;
      if (!map.has(collaboratorId)) map.set(collaboratorId, new Set());
      map.get(collaboratorId).add(year);
    }
  }
  return map;
}

async function getOffshoreYearsByCollaborator(periodStart, periodEnd) {
  const years = yearsForPeriod(periodStart, periodEnd);
  if (years.length === 0) return new Map();
  const minYear = Number(years[0]);
  const maxYear = Number(years[years.length - 1]);
  const reports = await prisma.report.findMany({
    where: {
      deletedAt: null,
      reportDate: {
        gte: new Date(`${minYear}-01-01T00:00:00.000Z`),
        lt: new Date(`${maxYear + 1}-01-01T00:00:00.000Z`)
      },
      project: { offshore: true }
    },
    select: {
      reportDate: true,
      project: { select: { offshore: true } },
      collaborators: { select: { collaboratorId: true } }
    }
  });
  return offshoreYearsByCollaboratorFromReports(reports);
}

export function examsTrainingAnnualCostForMonth({
  collaboratorId,
  monthKey,
  offshoreYearsByCollaborator,
  examsTrainingAnnualCost = 0,
  offshoreExamsTrainingAnnualCost = 0
}) {
  const year = String(monthKey || '').slice(0, 4);
  const offshoreYears = offshoreYearsByCollaborator?.get(collaboratorId);
  return offshoreYears?.has(year) ? offshoreExamsTrainingAnnualCost : examsTrainingAnnualCost;
}

function moneyCents(value, label) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < -1e-7) {
    throw new Error(`Parcela monetária inválida em ${label}.`);
  }
  return Math.round(Math.max(0, numeric) * 100);
}

function reconcileMoneyAxis({ total, byProject, idle, key }) {
  const targetCents = moneyCents(total, `total.${key}`);
  const projectEntries = Object.entries(byProject)
    .map(([projectId, item]) => ({
      projectId,
      item,
      cents: moneyCents(item[key], `projeto.${projectId}.${key}`)
    }))
    .sort((left, right) => right.item.hours - left.item.hours || left.projectId.localeCompare(right.projectId));
  const sede = { item: idle.sede, cents: moneyCents(idle.sede[key], `sede.${key}`) };
  const folga = { item: idle.folga, cents: moneyCents(idle.folga[key], `folga.${key}`) };
  const allEntries = [...projectEntries, sede, folga];
  let residual = targetCents - allEntries.reduce((sum, entry) => sum + entry.cents, 0);

  const candidates = [];
  if (idle.sede.hours > 0 || sede.cents > 0) candidates.push(sede);
  if (idle.folga.hours > 0 || folga.cents > 0) candidates.push(folga);
  if (projectEntries[0]) candidates.push(projectEntries[0]);
  if (candidates.length === 0) candidates.push(sede);

  if (residual >= 0) {
    candidates[0].cents += residual;
    residual = 0;
  } else {
    for (const candidate of candidates) {
      const reduction = Math.min(candidate.cents, -residual);
      candidate.cents -= reduction;
      residual += reduction;
      if (residual === 0) break;
    }
  }
  if (residual !== 0) throw new Error(`Não foi possível reconciliar ${key} sem parcela negativa.`);

  for (const entry of projectEntries) entry.item[key] = entry.cents / 100;
  idle.sede[key] = sede.cents / 100;
  idle.folga[key] = folga.cents / 100;
  return targetCents / 100;
}

/*
 * Função pura (testável): folha + custo por projeto + sobra (sede/folga) de um colaborador num mês.
 *   projects: [{ pid, rdoDaysHours, awayDaysHours, homeDaysHours, offshoreDaysHours, rdoWorkedHours, offshore }]
 *   fixedCoverage: fração do mês coberta (1 = mês cheio; <1 no mês parcial → fixo proporcional).
 * Garante: Σ projetos + sede + folga = folha.
 */
export function computeCollaboratorCost({ params, epiMensal = 0, examsTrainingMensal = 0, normalHours, he70Horas, he100Horas, folgaHours, projects = [], fixedCoverage = 1 }) {
  const dpd = HORAS_POR_DIA;
  const fixedAnnualCostMensal = epiMensal + examsTrainingMensal;
  const hourGroups = projects.map(projectHours);
  const projectDaysHours = hourGroups.reduce((s, p) => s + p.clientHours, 0);
  const awayDaysHours = hourGroups.reduce((s, p) => s + p.awayHours, 0);
  const homeDaysHours = hourGroups.reduce((s, p) => s + p.homeHours, 0);
  const offshoreDaysHours = hourGroups.reduce((s, p) => s + p.offshoreHours, 0);
  const totalRdoWorked = projects.reduce((s, p) => s + p.rdoWorkedHours, 0);
  const totalHours = normalHours + he70Horas + he100Horas + folgaHours;
  const explicitOvertimeFlags = projects.map(p => Object.hasOwn(p, 'he70Hours') || Object.hasOwn(p, 'he100Hours'));
  const usesExplicitOvertime = explicitOvertimeFlags.some(Boolean);
  if (usesExplicitOvertime && explicitOvertimeFlags.some(value => !value)) {
    throw new Error('A apropriação explícita de horas extras deve ser informada para todos os projetos.');
  }
  if (projectDaysHours > normalHours + 1e-7) throw new Error('Horas normais apropriadas excedem o ponto do colaborador.');
  if (usesExplicitOvertime) {
    const allocatedHe70 = projects.reduce((sum, p) => sum + Math.max(0, Number(p.he70Hours) || 0), 0);
    const allocatedHe100 = projects.reduce((sum, p) => sum + Math.max(0, Number(p.he100Hours) || 0), 0);
    if (allocatedHe70 > he70Horas + 1e-7 || allocatedHe100 > he100Horas + 1e-7) {
      throw new Error('Horas extras apropriadas excedem o ponto do colaborador.');
    }
  }

  const folhaInputs = {
    diasCliente: projectDaysHours / dpd,
    diasFora: awayDaysHours / dpd,
    offshoreDays: offshoreDaysHours / dpd,
    diasCasa: homeDaysHours / dpd,
    he70Horas,
    he100Horas
  };
  const fixedBaseFull = totalCost(params, {}, fixedAnnualCostMensal); // base + encargos + benefícios + custos anuais (mês cheio)
  const fixedBase = fixedBaseFull * fixedCoverage;         // proporcional no mês parcial
  const variavelMensal = totalCost(params, folhaInputs, fixedAnnualCostMensal) - fixedBaseFull;
  const variavelMensalBase = totalCost(params, { ...folhaInputs, diasFora: (awayDaysHours + offshoreDaysHours) / dpd, offshoreDays: 0 }, fixedAnnualCostMensal) - fixedBaseFull;
  const folha = fixedBase + variavelMensal;
  const folhaBase = fixedBase + variavelMensalBase;

  const zeroNoEpi = computeMonthlyCost(params, {}).totalMensal; // base do incremento variável por obra
  const byProject = {};
  let sumCost = 0;
  let sumCostBase = 0;
  let sumProjectHours = 0;
  for (const p of projects) {
    const he70P = usesExplicitOvertime
      ? Math.max(0, Number(p.he70Hours) || 0)
      : totalRdoWorked > 0 ? he70Horas * (p.rdoWorkedHours / totalRdoWorked) : 0;
    const he100P = usesExplicitOvertime
      ? Math.max(0, Number(p.he100Hours) || 0)
      : totalRdoWorked > 0 ? he100Horas * (p.rdoWorkedHours / totalRdoWorked) : 0;
    const hours = projectHours(p);
    const projectHoursTotal = hours.clientHours;
    const inputsP = {
      diasCliente: hours.clientHours / dpd,
      diasFora: hours.awayHours / dpd,
      offshoreDays: hours.offshoreHours / dpd,
      diasCasa: hours.homeHours / dpd,
      he70Horas: he70P,
      he100Horas: he100P
    };
    const variavelP = computeMonthlyCost(params, inputsP).totalMensal - zeroNoEpi;
    const variavelPBase = computeMonthlyCost(params, { ...inputsP, diasFora: (hours.awayHours + hours.offshoreHours) / dpd, offshoreDays: 0 }).totalMensal - zeroNoEpi;
    const hoursForProration = projectHoursTotal + he70P + he100P;
    const fixoP = totalHours > 0 ? fixedBase * (hoursForProration / totalHours) : 0;
    byProject[p.pid] = {
      cost: fixoP + variavelP,
      costBase: fixoP + variavelPBase,
      hours: hoursForProration,
      travelHours: Math.min(hoursForProration, Math.max(0, Number(p.travelHours) || 0))
    };
    sumCost += fixoP + variavelP;
    sumCostBase += fixoP + variavelPBase;
    sumProjectHours += hoursForProration;
  }

  // Sobra = folha − Σ projetos, quebrada em folga (dias de semana sem ponto) e sede (o resto).
  const idleHours = totalHours > 0 ? Math.max(0, totalHours - sumProjectHours) : 0;
  const rawIdleCost = folha - sumCost;
  const rawIdleCostBase = folhaBase - sumCostBase;
  if (rawIdleCost < -1e-7 || rawIdleCostBase < -1e-7) {
    throw new Error('A apropriação dos projetos ultrapassou o custo mensal do colaborador.');
  }
  const idleCost = Math.max(0, rawIdleCost);
  const idleCostBase = Math.max(0, rawIdleCostBase);
  const folgaH = totalHours > 0 ? Math.min(folgaHours, idleHours) : 0;
  const sedeH = totalHours > 0 ? Math.max(0, idleHours - folgaH) : 0;
  const sedeFrac = idleHours > 0 ? sedeH / idleHours : 1;
  const idle = {
    sede: { cost: idleCost * sedeFrac, costBase: idleCostBase * sedeFrac, hours: sedeH },
    folga: { cost: idleCost * (1 - sedeFrac), costBase: idleCostBase * (1 - sedeFrac), hours: folgaH }
  };

  const reconciledFolha = reconcileMoneyAxis({ total: folha, byProject, idle, key: 'cost' });
  const reconciledFolhaBase = reconcileMoneyAxis({ total: folhaBase, byProject, idle, key: 'costBase' });

  return {
    folha: reconciledFolha,
    folhaBase: reconciledFolhaBase,
    fixoMensal: fixedBase,
    variavelMensal,
    totalHours,
    byProject,
    idle
  };
}

// Projeção de consumo por projeto. Diferentemente de computeCollaboratorCost, esta saída não
// reconcilia a soma dos projetos contra a folha: uma execução compartilhada pode consumir a
// mesma jornada integral em mais de um contrato, embora o desembolso do colaborador seja único.
export function computeAnalyticalProjectCosts({ params, fixedBase = 0, totalHours = 0, projects = [] }) {
  const zeroNoEpi = computeMonthlyCost(params, {}).totalMensal;
  const result = {};
  for (const project of projects) {
    const hours = projectHours(project);
    const he70Hours = Math.max(0, Number(project.he70Hours) || 0);
    const he100Hours = Math.max(0, Number(project.he100Hours) || 0);
    const inputs = {
      diasCliente: hours.clientHours / HORAS_POR_DIA,
      diasFora: hours.awayHours / HORAS_POR_DIA,
      offshoreDays: hours.offshoreHours / HORAS_POR_DIA,
      diasCasa: hours.homeHours / HORAS_POR_DIA,
      he70Horas: he70Hours,
      he100Horas: he100Hours
    };
    const baseInputs = {
      ...inputs,
      diasFora: (hours.awayHours + hours.offshoreHours) / HORAS_POR_DIA,
      offshoreDays: 0
    };
    const hoursForProration = hours.clientHours + he70Hours + he100Hours;
    const fixedProject = totalHours > 0 ? fixedBase * (hoursForProration / totalHours) : 0;
    const variableProject = computeMonthlyCost(params, inputs).totalMensal - zeroNoEpi;
    const variableProjectBase = computeMonthlyCost(params, baseInputs).totalMensal - zeroNoEpi;
    result[project.pid] = {
      cost: Math.round((fixedProject + variableProject) * 100) / 100,
      costBase: Math.round((fixedProject + variableProjectBase) * 100) / 100,
      hours: hoursForProration,
      travelHours: Math.min(hoursForProration, Math.max(0, Number(project.travelHours) || 0))
    };
  }
  return result;
}

function costProjectsFromClassification(classified) {
  return [...classified.byProject.values()].map(project => ({
    pid: project.projectId,
    rdoDaysHours: project.normalHours,
    awayDaysHours: project.awayHours,
    homeDaysHours: project.homeHours,
    offshoreDaysHours: project.offshoreHours,
    rdoWorkedHours: project.rdoWorkedHours,
    travelHours: project.travelHours,
    he70Hours: project.he70Hours,
    he100Hours: project.he100Hours,
    offshore: project.offshore
  }));
}

// Custo/hora e rateio por obra de cada colaborador para o ponto vigente (ou o import indicado),
// somando a divisão mensal.
export async function computeCollaboratorRates(importId = null) {
  const pontoScope = await getPontoImportScope(importId);
  if (!pontoScope) return { pontoImport: null, pontoImports: [], periodStart: null, periodEnd: null, fileName: null, rates: [], byCollaboratorId: new Map() };

  const importIds = pontoScope.pontoImports.map(item => item.id);
  const periodEndExclusive = endExclusive(pontoScope.periodEnd);
  const fileStart = pontoScope.periodStart;
  const fileEnd = pontoScope.periodEnd;
  const [
    periodRows,
    ignoredEmployees,
    roleParams,
    rdoData,
    offshoreYearsByCollaborator,
    annualCosts,
    projectAllocationContext,
    manualDayOverrides
  ] = await Promise.all([
    prisma.pontoPeriodSummary.findMany({
      where: { importId: { in: importIds }, collaboratorId: { not: null } },
      include: {
        collaborator: {
          select: {
            id: true,
            name: true,
            jobRoleId: true,
            jobRole: { select: { id: true, name: true } },
            jobRoleHistory: {
              select: { jobRoleId: true, effectiveDate: true, jobRole: { select: { id: true, name: true } } },
              orderBy: { effectiveDate: 'asc' }
            }
          }
        },
        import: { select: { createdAt: true } }
      }
    }),
    prisma.pontoExternalEmployee.findMany({
      where: { ignoredAt: { not: null } },
      select: { externalEmployeeId: true }
    }),
    getRoleParamsResolver(),
    getRdoDataByCollaborator(pontoScope.periodStart, periodEndExclusive),
    getOffshoreYearsByCollaborator(pontoScope.periodStart, pontoScope.periodEnd),
    getAnnualCollaboratorCosts(),
    getProjectAllocationContext(),
    prisma.pontoDayProjectOverride.findMany({
      where: { workDate: { gte: pontoScope.periodStart, lt: periodEndExclusive } },
      select: { collaboratorId: true, workDate: true, projectId: true }
    })
  ]);
  const periods = mergePontoPeriods(filterIgnoredPontoPeriods(
    periodRows,
    ignoredEmployees.map(item => item.externalEmployeeId)
  ));
  const actualAvailability = periods.length
    ? await checkWorkforceAvailability(prisma, {
        collaboratorIds: periods.map(period => period.collaboratorId).filter(Boolean),
        startDate: dateKeyUTC(pontoScope.periodStart),
        endDate: dateKeyUTC(pontoScope.periodEnd),
        context: 'ACTUAL_REPORT'
      })
    : { calendarRevision: 1, conflicts: [] };
  const manualProjects = manualProjectsByCollaborator(manualDayOverrides);
  const scheduleWindowEligibility = buildScheduleWindowEligibility(
    projectAllocationContext.scheduleWindows,
    rdoData
  );
  const epiMensal = annualCosts.epiAnnualCost / 12;

  const rates = [];
  const byCollaboratorId = new Map();
  for (const period of periods) {
    const role = collaboratorRoleAtDate(period.collaborator, fileEnd)?.roleName
      || period.collaborator?.jobRole?.name
      || null;
    const rdo = rdoData.get(period.collaboratorId) || {
      byProject: new Map(),
      dayProjects: new Map(),
      mobilizationProjectsByDate: new Map()
    };
    const projectMetaById = projectMetaForCollaborator(projectAllocationContext.projects, period.collaboratorId);
    const scheduleWindowContext = {
      windows: projectAllocationContext.scheduleWindows,
      eligibleByProject: scheduleWindowEligibility,
      effectiveAllocationIndex: projectAllocationContext.effectiveAllocationIndex,
      collaboratorId: period.collaboratorId
    };

    const he70Horas = period.he70Minutes / 60;
    const he100Horas = period.he100Minutes / 60;
    const normalHours = period.workedMinutes / 60;
    const workedDates = period.workedDates || [];
    const workedSet = new Set(workedDates);
    const totalWorkedDays = workedDates.length;

    const entry = {
      collaboratorId: period.collaboratorId,
      name: period.collaborator?.name || period.rawName,
      role,
      hasCostProfile: false,
      normalHoras: normalHours,
      he70Horas,
      he100Horas,
      totalHoras: normalHours + he70Horas + he100Horas,
      workedDates,
      folgaHours: 0,
      totalMensal: null,
      totalMensalBase: null,
      fixoMensal: null,
      variavelMensal: null,
      custoHora: null,
      custoHoraBase: null,
      idle: { sede: { cost: 0, costBase: 0, hours: 0 }, folga: { cost: 0, costBase: 0, hours: 0 } },
      byProject: {},
      analyticalByProject: {},
      allocationTrail: [], // decisão de alocação de cada dia (auditoria)
      analyticalAllocationTrail: [], // mesma trilha no eixo analítico usado pelo dashboard do projeto
      unresolvedDays: [], // dias com horas que não chegaram a projeto nenhum (pendência)
      months: [] // detalhe por mês (para o filtro da aba Custo/hora)
    };

    // A trilha também define se uma marcação positiva menor que 8h48 recebe o piso de projeto.
    // Ela fica fora do bloco de custo porque colaboradores sem perfil configurado ainda precisam
    // aparecer na auditoria e nas pendências.
    const trailDays = monthsOf(period).flatMap(mrec => splitOvertimeDays(
      mrec.days || [],
      Number(roleParams.paramsFor(
        collaboratorRoleAtDate(period.collaborator, `${mrec.monthKey}-01`)?.roleName || role,
        `${mrec.monthKey}-01`
      )?.he70LimiteHoras) || 30
    ));
    trailDays.sort((left, right) => left.date.localeCompare(right.date));
    const trail = classifyProjectHours(
      trailDays,
      rdo,
      projectAllocationContext.resolveTag,
      projectMetaById,
      manualProjects.get(period.collaboratorId) || new Map(),
      projectAllocationContext.missionGroupProjectsByProjectId,
      'ACCOUNTING',
      scheduleWindowContext
    );
    entry.allocationTrail = trail.dayTrail;
    entry.unresolvedDays = trail.unresolvedDays;
    const hasMinimumPaidProjectDay = trail.dayTrail.some(day => day.minimumNormalHoursApplied);

    const costRoleSegments = collaboratorRoleSegments(period.collaborator, dateKeyUTC(fileStart), dateKeyUTC(fileEnd));
    if (costRoleSegments.some(segment => roleParams.hasProfile(segment.roleName)) && (totalWorkedDays > 0 || hasMinimumPaidProjectDay)) {
      const months = monthsOf(period);

      const agg = { folha: 0, folhaBase: 0, fixo: 0, variavel: 0, totalHours: 0, folga: 0, normal: 0, he70: 0, he100: 0 };
      const idle = { sede: { cost: 0, costBase: 0, hours: 0 }, folga: { cost: 0, costBase: 0, hours: 0 } };
      const byProject = {};
      const analyticalByProject = {};
      let computedAny = false;

      for (const mrec of months) {
        const mk = mrec.monthKey;
        const monthCov = monthCoverage(mk, fileStart, fileEnd);
        if (monthCov.days <= 0) continue;
        const monthRole = collaboratorRoleAtDate(period.collaborator, monthCov.startKey)?.roleName || role;
        const capParams = roleParams.paramsFor(monthRole, monthCov.startKey) || roleParams.paramsFor(monthRole, `${mk}-01`);
        const cap = Number(capParams?.he70LimiteHoras) || 30; // teto de HE70 por mês (excesso vira 100%)
        const daysWithOvertime = splitOvertimeDays(mrec.days || [], cap);
        const segments = buildCollaboratorRoleCostSegments({
          collaborator: period.collaborator,
          roleParams,
          startKey: monthCov.startKey,
          endKey: monthCov.endKey
        });

        const monthAgg = { folha: 0, folhaBase: 0, fixo: 0, variavel: 0, totalHours: 0, folga: 0, normal: 0, he70: 0, he100: 0 };
        const monthIdle = { sede: { cost: 0, costBase: 0, hours: 0 }, folga: { cost: 0, costBase: 0, hours: 0 } };
        const monthByProject = {};
        const monthAnalyticalByProject = {};

        for (const segment of segments) {
          if (!segment.params) continue;
          const segCov = coverageForRange(mk, fileStart, fileEnd, segment.startKey, segment.endKey);
          if (segCov.days <= 0) continue;
          const segmentDays = daysWithOvertime.filter(day => day.date >= segCov.startKey && day.date <= segCov.endKey);
          const he70S = segmentDays.reduce((sum, day) => sum + (day.he70Horas || 0), 0);
          const he100S = segmentDays.reduce((sum, day) => sum + (day.he100Horas || 0), 0);

          const classified = classifyProjectHours(
            segmentDays,
            rdo,
            projectAllocationContext.resolveTag,
            projectMetaById,
            manualProjects.get(period.collaboratorId) || new Map(),
            projectAllocationContext.missionGroupProjectsByProjectId,
            'ACCOUNTING',
            scheduleWindowContext
          );
          const normalHoursS = classified.costNormalHours;
          const costWorkedSet = new Set(workedSet);
          for (const day of classified.dayTrail) {
            if (day.costNormalHours > 0) costWorkedSet.add(day.date);
          }
          const folgaS = countFolgaWeekdays(segCov.start, segCov.end, costWorkedSet) * HORAS_POR_DIA;
          const analyticalClassified = classifyProjectHours(
            segmentDays,
            rdo,
            projectAllocationContext.resolveTag,
            projectMetaById,
            manualProjects.get(period.collaboratorId) || new Map(),
            projectAllocationContext.missionGroupProjectsByProjectId,
            'ANALYTICAL',
            scheduleWindowContext
          );
          // O dashboard detalha exatamente os segmentos que participaram do custo. Manter esta
          // trilha aqui evita exibir dias fora da vigência do perfil financeiro do colaborador.
          entry.analyticalAllocationTrail.push(...analyticalClassified.dayTrail);
          const projects = costProjectsFromClassification(classified);
          const analyticalProjects = costProjectsFromClassification(analyticalClassified);
          const examsTrainingMensal = examsTrainingAnnualCostForMonth({
            collaboratorId: period.collaboratorId,
            monthKey: mk,
            offshoreYearsByCollaborator,
            examsTrainingAnnualCost: annualCosts.examsTrainingAnnualCost,
            offshoreExamsTrainingAnnualCost: annualCosts.offshoreExamsTrainingAnnualCost
          }) / 12;

          const res = computeCollaboratorCost({
            params: segment.params, epiMensal, examsTrainingMensal, normalHours: normalHoursS, he70Horas: he70S, he100Horas: he100S,
            folgaHours: folgaS, projects, fixedCoverage: segCov.fraction
          });
          const analyticalCosts = computeAnalyticalProjectCosts({
            params: segment.params,
            fixedBase: res.fixoMensal,
            totalHours: res.totalHours,
            projects: analyticalProjects
          });

          computedAny = true;
          monthAgg.folha += res.folha; monthAgg.folhaBase += res.folhaBase; monthAgg.fixo += res.fixoMensal;
          monthAgg.variavel += res.variavelMensal; monthAgg.totalHours += res.totalHours; monthAgg.folga += folgaS;
          monthAgg.normal += normalHoursS; monthAgg.he70 += he70S; monthAgg.he100 += he100S;
          for (const [pid, a] of Object.entries(res.byProject)) {
            if (!monthByProject[pid]) monthByProject[pid] = { cost: 0, costBase: 0, hours: 0, travelHours: 0 };
            monthByProject[pid].cost += a.cost; monthByProject[pid].costBase += a.costBase; monthByProject[pid].hours += a.hours;
            monthByProject[pid].travelHours += a.travelHours || 0;
          }
          for (const [pid, a] of Object.entries(analyticalCosts)) {
            if (!monthAnalyticalByProject[pid]) monthAnalyticalByProject[pid] = { cost: 0, costBase: 0, hours: 0, travelHours: 0 };
            monthAnalyticalByProject[pid].cost += a.cost;
            monthAnalyticalByProject[pid].costBase += a.costBase;
            monthAnalyticalByProject[pid].hours += a.hours;
            monthAnalyticalByProject[pid].travelHours += a.travelHours || 0;
          }
          monthIdle.sede.cost += res.idle.sede.cost; monthIdle.sede.costBase += res.idle.sede.costBase; monthIdle.sede.hours += res.idle.sede.hours;
          monthIdle.folga.cost += res.idle.folga.cost; monthIdle.folga.costBase += res.idle.folga.costBase; monthIdle.folga.hours += res.idle.folga.hours;
        }

        if (monthAgg.totalHours <= 0 && monthAgg.folha === 0) continue;
        agg.folha += monthAgg.folha; agg.folhaBase += monthAgg.folhaBase; agg.fixo += monthAgg.fixo;
        agg.variavel += monthAgg.variavel; agg.totalHours += monthAgg.totalHours; agg.folga += monthAgg.folga;
        agg.normal += monthAgg.normal; agg.he70 += monthAgg.he70; agg.he100 += monthAgg.he100;
        for (const [pid, a] of Object.entries(monthByProject)) {
          if (!byProject[pid]) byProject[pid] = { cost: 0, costBase: 0, hours: 0, travelHours: 0 };
          byProject[pid].cost += a.cost; byProject[pid].costBase += a.costBase; byProject[pid].hours += a.hours;
          byProject[pid].travelHours += a.travelHours || 0;
        }
        for (const [pid, a] of Object.entries(monthAnalyticalByProject)) {
          if (!analyticalByProject[pid]) analyticalByProject[pid] = { cost: 0, costBase: 0, hours: 0, travelHours: 0 };
          analyticalByProject[pid].cost += a.cost;
          analyticalByProject[pid].costBase += a.costBase;
          analyticalByProject[pid].hours += a.hours;
          analyticalByProject[pid].travelHours += a.travelHours || 0;
        }
        idle.sede.cost += monthIdle.sede.cost; idle.sede.costBase += monthIdle.sede.costBase; idle.sede.hours += monthIdle.sede.hours;
        idle.folga.cost += monthIdle.folga.cost; idle.folga.costBase += monthIdle.folga.costBase; idle.folga.hours += monthIdle.folga.hours;

        entry.months.push({
          month: mk,
          normalHoras: monthAgg.normal,
          he70Horas: monthAgg.he70,
          he100Horas: monthAgg.he100,
          totalMensal: monthAgg.folha,
          totalMensalBase: monthAgg.folhaBase,
          fixoMensal: monthAgg.fixo,
          variavelMensal: monthAgg.variavel,
          custoHora: monthAgg.totalHours > 0 ? monthAgg.folha / monthAgg.totalHours : 0,
          custoHoraBase: monthAgg.totalHours > 0 ? monthAgg.folhaBase / monthAgg.totalHours : 0,
          idle: monthIdle,
          byProject: monthByProject,
          analyticalByProject: monthAnalyticalByProject
        });
      }
      entry.months.sort((a, b) => a.month.localeCompare(b.month));
      entry.analyticalAllocationTrail.sort((a, b) => a.date.localeCompare(b.date));

      if (computedAny) {
        entry.hasCostProfile = true;
        entry.totalMensal = agg.folha;
        entry.totalMensalBase = agg.folhaBase;
        entry.fixoMensal = agg.fixo;
        entry.variavelMensal = agg.variavel;
        entry.custoHora = agg.totalHours > 0 ? agg.folha / agg.totalHours : 0;
        entry.custoHoraBase = agg.totalHours > 0 ? agg.folhaBase / agg.totalHours : 0;
        entry.folgaHours = agg.folga;
        // Horas do somado = Σ dos meses (a HE já com teto por mês, pode diferir do split bruto do arquivo).
        entry.normalHoras = agg.normal;
        entry.he70Horas = agg.he70;
        entry.he100Horas = agg.he100;
        entry.totalHoras = agg.normal + agg.he70 + agg.he100;
        entry.byProject = byProject;
        entry.analyticalByProject = analyticalByProject;
        entry.idle = idle;
      }
    }

    rates.push(entry);
    byCollaboratorId.set(period.collaboratorId, entry);
  }
  const annotatedRates = annotateActualRowsWithWorkforceConflicts(rates, actualAvailability.conflicts).map(entry => ({
    ...entry,
    workforceCalendarRevision: actualAvailability.calendarRevision,
    workforceDays: classifyActualWorkforceDays({
      startDate: dateKeyUTC(pontoScope.periodStart),
      endDate: dateKeyUTC(pontoScope.periodEnd),
      workedDates: entry.workedDates,
      conflicts: actualAvailability.conflicts.filter(conflict => conflict.collaboratorId === entry.collaboratorId)
    })
  }));
  const annotatedByCollaboratorId = new Map(annotatedRates.map(entry => [entry.collaboratorId, entry]));
  return {
    pontoImport: pontoScope.pontoImport,
    pontoImports: pontoScope.pontoImports,
    periodStart: pontoScope.periodStart,
    periodEnd: pontoScope.periodEnd,
    fileName: pontoScope.fileName,
    rates: annotatedRates,
    byCollaboratorId: annotatedByCollaboratorId
  };
}

// Diagnóstico: mostra os parâmetros (campos amarelos) e os inputs do motor (Simulador) usados para
// calcular a folha de um colaborador num mês, além do detalhamento do motor. Uso via script.
export async function debugCollaboratorMonth(nameQuery, monthKey, importId = null) {
  const pontoScope = await getPontoImportScope(importId);
  if (!pontoScope) throw new Error('Sem import de ponto.');
  const importIds = pontoScope.pontoImports.map(item => item.id);
  const periodEndExclusive = endExclusive(pontoScope.periodEnd);
  const [
    periodRows,
    ignoredEmployees,
    roleParams,
    rdoData,
    offshoreYearsByCollaborator,
    annualCosts,
    projectAllocationContext,
    manualDayOverrides
  ] = await Promise.all([
    prisma.pontoPeriodSummary.findMany({
      where: { importId: { in: importIds }, collaboratorId: { not: null } },
      include: {
        collaborator: {
          select: {
            id: true,
            name: true,
            jobRoleId: true,
            jobRole: { select: { id: true, name: true } },
            jobRoleHistory: {
              select: { jobRoleId: true, effectiveDate: true, jobRole: { select: { id: true, name: true } } },
              orderBy: { effectiveDate: 'asc' }
            }
          }
        },
        import: { select: { createdAt: true } }
      }
    }),
    prisma.pontoExternalEmployee.findMany({
      where: { ignoredAt: { not: null } },
      select: { externalEmployeeId: true }
    }),
    getRoleParamsResolver(),
    getRdoDataByCollaborator(pontoScope.periodStart, periodEndExclusive),
    getOffshoreYearsByCollaborator(pontoScope.periodStart, pontoScope.periodEnd),
    getAnnualCollaboratorCosts(),
    getProjectAllocationContext(),
    prisma.pontoDayProjectOverride.findMany({
      where: { workDate: { gte: pontoScope.periodStart, lt: periodEndExclusive } },
      select: { collaboratorId: true, workDate: true, projectId: true }
    })
  ]);
  const query = String(nameQuery || '').trim().toLowerCase();
  const period = mergePontoPeriods(filterIgnoredPontoPeriods(
    periodRows,
    ignoredEmployees.map(item => item.externalEmployeeId)
  )).find(item => (
    String(item.collaborator?.name || item.rawName || '').toLowerCase().includes(query)
  ));
  if (!period) throw new Error(`Colaborador "${nameQuery}" não encontrado no ponto vigente.`);

  const cov = monthCoverage(monthKey, pontoScope.periodStart, pontoScope.periodEnd);
  const role = collaboratorRoleAtDate(period.collaborator, cov.startKey)?.roleName
    || period.collaborator.jobRole?.name;
  const params = roleParams.paramsFor(role, cov.startKey);
  if (!params) throw new Error(`Cargo "${role}" sem custo configurado.`);
  const rdo = rdoData.get(period.collaboratorId) || { byProject: new Map(), dayProjects: new Map() };

  const cap = Number(params.he70LimiteHoras) || 30;
  const mrec = monthsOf(period).find(m => m.monthKey === monthKey);
  if (!mrec) throw new Error(`Sem dados de ${nameQuery} no mês ${monthKey}.`);
  const daysM = splitOvertimeDays(mrec.days || [], cap);
  const he70M = daysM.reduce((sum, day) => sum + (day.he70Horas || 0), 0);
  const he100M = daysM.reduce((sum, day) => sum + (day.he100Horas || 0), 0);

  const classified = classifyProjectHours(
    daysM,
    rdo,
    projectAllocationContext.resolveTag,
    projectMetaForCollaborator(projectAllocationContext.projects, period.collaboratorId),
    manualProjectsByCollaborator(manualDayOverrides).get(period.collaboratorId) || new Map(),
    projectAllocationContext.missionGroupProjectsByProjectId,
    'ACCOUNTING',
    {
      windows: projectAllocationContext.scheduleWindows,
      eligibleByProject: buildScheduleWindowEligibility(projectAllocationContext.scheduleWindows, rdoData),
      effectiveAllocationIndex: projectAllocationContext.effectiveAllocationIndex,
      collaboratorId: period.collaboratorId
    }
  );
  const normalHoursM = classified.costNormalHours;
  const costWorkedSet = new Set(period.workedDates || []);
  for (const day of classified.dayTrail) {
    if (day.costNormalHours > 0) costWorkedSet.add(day.date);
  }
  const folgaHours = countFolgaWeekdays(cov.start, cov.end, costWorkedSet) * HORAS_POR_DIA;
  let projectDaysHours = 0;
  let awayDaysHours = 0;
  let homeDaysHours = 0;
  let offshoreDaysHours = 0;
  for (const project of classified.byProject.values()) {
    const away = project.awayHours || 0;
    const home = project.homeHours || 0;
    const offshore = project.offshoreHours || 0;
    awayDaysHours += away;
    homeDaysHours += home;
    offshoreDaysHours += offshore;
    projectDaysHours += away + home + offshore;
  }

  const inputs = {
    diasCliente: projectDaysHours / HORAS_POR_DIA,
    diasFora: awayDaysHours / HORAS_POR_DIA,
    offshoreDays: offshoreDaysHours / HORAS_POR_DIA,
    diasCasa: homeDaysHours / HORAS_POR_DIA,
    he70Horas: he70M,
    he100Horas: he100M
  };
  const breakdown = computeMonthlyCost(params, inputs);
  const epiMensal = annualCosts.epiAnnualCost / 12;
  const offshoreExamsTrainingApplied = Boolean(offshoreYearsByCollaborator
    .get(period.collaboratorId)
    ?.has(String(monthKey).slice(0, 4)));
  const examsTrainingAnnualCost = examsTrainingAnnualCostForMonth({
    collaboratorId: period.collaboratorId,
    monthKey,
    offshoreYearsByCollaborator,
    examsTrainingAnnualCost: annualCosts.examsTrainingAnnualCost,
    offshoreExamsTrainingAnnualCost: annualCosts.offshoreExamsTrainingAnnualCost
  });
  const examsTrainingMensal = examsTrainingAnnualCost / 12;
  const fixedAnnualCostMensal = epiMensal + examsTrainingMensal;
  const fixedBaseFull = computeMonthlyCost(params, {}).totalMensal + fixedAnnualCostMensal;
  const variavel = (breakdown.totalMensal + fixedAnnualCostMensal) - fixedBaseFull;
  const folha = fixedBaseFull * cov.fraction + variavel;

  return {
    name: period.collaborator.name, role, monthKey,
    fixedCoverage: cov.fraction, folgaHours, epiMensal, examsTrainingMensal, examsTrainingAnnualCost,
    offshoreExamsTrainingApplied,
    normalHoursMes: normalHoursM,
    params, inputs, breakdown,
    fixoMensal: fixedBaseFull * cov.fraction, variavelMensal: variavel, folha
  };
}

// Custo de mão de obra por projeto (mapa projectId -> { laborCost, laborCostBase, hours }) + sobra total.
export async function laborCostByProject(importId = null) {
  const { pontoImport, periodStart, periodEnd, byCollaboratorId } = await computeCollaboratorRates(importId);
  if (!pontoImport) {
    return { pontoImport: null, periodStart: null, periodEnd: null, byProjectId: new Map(), idle: { cost: 0, costBase: 0, hours: 0 }, byCollaboratorId: new Map() };
  }
  const byProjectId = new Map();
  const idle = { cost: 0, costBase: 0, hours: 0 };
  for (const entry of byCollaboratorId.values()) {
    for (const [pid, alloc] of Object.entries(entry.analyticalByProject || entry.byProject)) {
      let agg = byProjectId.get(pid);
      if (!agg) { agg = { laborCost: 0, laborCostBase: 0, hours: 0 }; byProjectId.set(pid, agg); }
      agg.laborCost += alloc.cost;
      agg.laborCostBase += alloc.costBase;
      agg.hours += alloc.hours;
    }
    idle.cost += entry.idle.sede.cost + entry.idle.folga.cost;
    idle.costBase += entry.idle.sede.costBase + entry.idle.folga.costBase;
    idle.hours += entry.idle.sede.hours + entry.idle.folga.hours;
  }
  return { pontoImport, periodStart, periodEnd, byProjectId, idle, byCollaboratorId };
}
