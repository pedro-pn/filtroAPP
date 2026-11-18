import { Router } from 'express';

import asyncHandler from '../../lib/async-handler.js';
import { buildMonthlyAllocationPdf, buildMonthlyAllocationSummary, sendMonthlyAllocationReport, validateYearMonth } from '../../lib/allocation-monthly-report.js';
import prisma from '../../lib/prisma.js';
import { statisticsProjectsCache } from '../../lib/resource-list-cache.js';
import { requireAuth, requireModuleRole } from '../../middleware/auth.js';

const router = Router();
const requireRdoStats = requireModuleRole('rdo:manager', 'rdo:coordinator');
const MAX_YEARS = 2;
const MAX_STATS_REPORTS = 5000;
const MAX_DAILY_REPORTS = 500;

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function parseLocalDate(str, endOfDay = false) {
  const match = String(str || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return new Date(NaN);
  const [, y, m, d] = match.map(Number);
  const date = endOfDay
    ? new Date(Date.UTC(y, m - 1, d, 23, 59, 59, 999))
    : new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) {
    return new Date(NaN);
  }
  return date;
}

export function toLocalDateStr(date) {
  const d = new Date(date);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

export function validateDateRange(fromStr, toStr) {
  const fromDate = parseLocalDate(fromStr);
  const toDate = parseLocalDate(toStr);
  if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
    return 'Período inválido. Use datas no formato YYYY-MM-DD.';
  }
  if (toDate < fromDate) {
    return 'Data final não pode ser anterior à data inicial.';
  }
  const diffYears = (toDate - fromDate) / (365.25 * 24 * 3600 * 1000);
  if (diffYears > MAX_YEARS) {
    return `Período máximo permitido é de ${MAX_YEARS} anos.`;
  }
  return null;
}

function isoWeek(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return { year: d.getUTCFullYear(), week };
}

export function periodKey(date, granularity) {
  const d = new Date(date);
  const y = d.getUTCFullYear();
  const mo = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  if (granularity === 'day') return `${y}-${mo}-${day}`;
  if (granularity === 'week') {
    const { year, week } = isoWeek(d);
    return `${year}-W${String(week).padStart(2, '0')}`;
  }
  if (granularity === 'year') return `${y}`;
  return `${y}-${mo}`;
}

function periodLabel(key, granularity) {
  const MONTHS = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho',
    'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
  if (granularity === 'day') {
    const [, m, d] = key.split('-');
    return `${d}/${m}`;
  }
  if (granularity === 'week') return key.replace('-', ' ');
  if (granularity === 'year') return key;
  const [year, month] = key.split('-');
  return `${MONTHS[parseInt(month, 10) - 1]} ${year}`;
}

function parseMinutes(val) {
  if (!val) return 0;
  if (typeof val === 'number') return val;
  const str = String(val).trim();
  if (/^\d+$/.test(str)) return parseInt(str, 10);
  const parts = str.split(':');
  if (parts.length >= 2) return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
  return 0;
}

export function parseDecimal(val) {
  const str = String(val).trim();
  const normalized = str.includes(',') && str.includes('.')
    ? str.replace(/\./g, '').replace(',', '.')
    : str.replace(',', '.');
  const num = parseFloat(normalized);
  return Number.isNaN(num) ? null : num;
}

export function parseVolumeOleo(service) {
  // extraData may have volumeOleo + volumeOleoUnit or a combined 'Volume de óleo'
  const extra = service.extraData || {};

  // New format: separate fields
  const vol = extra.volumeOleo ?? extra['Volume de óleo'];
  let unit = extra.volumeOleoUnit ?? extra['Unidade de volume de óleo'];

  if (vol === undefined || vol === null || vol === '') return { liters: null, ignored: true };

  let numericValue = vol;
  const combined = String(vol).trim().match(/^([+-]?\d+(?:[.,]\d+)?)\s*([a-zA-Z³]+)?$/u);
  if (combined) {
    numericValue = combined[1];
    unit = unit ?? combined[2];
  }

  const num = parseDecimal(numericValue);
  if (num == null) return { liters: null, ignored: true };

  const unitStr = String(unit || 'L').trim().toLowerCase();
  if (unitStr === 'ml') return { liters: num / 1000, ignored: false };
  if (unitStr === 'm³' || unitStr === 'm3') return { liters: num * 1000, ignored: false };
  // L, litro, litros, l
  return { liters: num, ignored: false };
}

export function parseTubulacoes(service) {
  const extra = service.extraData || {};
  const raw = extra['Diâmetros e comprimentos'] || extra['Diametros e comprimentos'] || extra.diametros || extra.tubes || [];
  if (!Array.isArray(raw)) return { byDiameter: {}, ignoredCount: 0 };

  const byDiameter = {};
  let ignoredCount = 0;

  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      ignoredCount++;
      continue;
    }
    const d = item.d || item.diametro;
    const dUnit = String(item.unit || item.dUnit || '').trim(); // "pol" | "mm" | ""
    const c = item.c ?? item.comprimento;
    const cUnit = String(item.lengthUnit || item.comprimentoUnit || 'm').toLowerCase();

    if (!d || c === undefined || c === null) { ignoredCount++; continue; }

    const meters = parseDecimal(c);
    if (meters == null) { ignoredCount++; continue; }

    const normalizedMeters = cUnit === 'cm' ? meters / 100 : cUnit === 'mm' ? meters / 1000 : meters;
    const key = dUnit ? `${String(d).trim()} ${dUnit}` : String(d).trim();
    byDiameter[key] = (byDiameter[key] || 0) + normalizedMeters;
  }

  return { byDiameter, ignoredCount };
}

function emptyServiceStats() {
  return { serviceCount: 0, volumeOleoLiters: 0, tubesByDiameter: {}, hasTubulacao: 0 };
}

function serviceEquipmentName(service) {
  if (service.equipment) return `${service.equipment.code} - ${service.equipment.name}`;
  const extra = service.extraData || {};
  const raw = extra['Equipamento(s)'] || extra.equipmentName || extra.equipment || null;
  return raw ? String(raw) : null;
}

function serviceSystemName(service) {
  const extra = service.extraData || {};
  return service.system || extra.Sistema || extra.system || null;
}

function normalizedText(value) {
  return String(value || '')
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function extraDataKeyMatch(value) {
  const repaired = String(value || '')
    .replace(/Ã§/g, 'ç')
    .replace(/Ã£/g, 'ã')
    .replace(/Ã¡/g, 'á')
    .replace(/Ã©/g, 'é')
    .replace(/Ã­/g, 'í')
    .replace(/Ã³/g, 'ó')
    .replace(/Ãº/g, 'ú');
  return normalizedText(repaired)
    .replace(/[^a-z0-9]+/g, '');
}

function getExtraDataValue(extra, keys) {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(extra, key)) return extra[key];
  }

  const wanted = new Set(keys.map(extraDataKeyMatch));
  for (const [key, value] of Object.entries(extra || {})) {
    if (wanted.has(extraDataKeyMatch(key))) return value;
  }
  return undefined;
}

export function isServiceFinalized(service) {
  if (service.finalized === true) return true;
  if (service.finalized === false) return false;
  const extra = service.extraData || {};
  const stored = getExtraDataValue(extra, [
    'Serviço finalizado?',
    'Serviço finalizado',
    'Servico finalizado?',
    'Servico finalizado',
    'ServiÃ§o finalizado?'
  ]);
  return ['sim', 'true', 'finalizado'].includes(normalizedText(stored));
}

function mergeServiceStats(acc, s) {
  acc.serviceCount += s.serviceCount;
  acc.volumeOleoLiters += s.volumeOleoLiters;
  acc.hasTubulacao += s.hasTubulacao;
  for (const [d, m] of Object.entries(s.tubesByDiameter)) {
    acc.tubesByDiameter[d] = (acc.tubesByDiameter[d] || 0) + m;
  }
}

function mergeServicesMap(acc, src) {
  for (const [type, stats] of Object.entries(src)) {
    if (!acc[type]) acc[type] = emptyServiceStats();
    mergeServiceStats(acc[type], stats);
  }
}

export function buildServiceStats(services, ignoredRows) {
  const result = {};

  for (const svc of services) {
    const type = (svc.serviceType || '').toLowerCase();
    if (!isServiceFinalized(svc)) continue;

    if (!result[type]) result[type] = emptyServiceStats();
    result[type].serviceCount += 1;

    if (type === 'filtragem') {
      const { liters, ignored } = parseVolumeOleo(svc);
      if (ignored) { ignoredRows.volumeOleo += 1; }
      else if (liters !== null) { result[type].volumeOleoLiters += liters; }
    }

    if (type === 'flushing' || type === 'limpeza' || type === 'pressao') {
      const { byDiameter, ignoredCount } = parseTubulacoes(svc);
      ignoredRows.tubulacao += ignoredCount;
      for (const [d, m] of Object.entries(byDiameter)) {
        result[type].tubesByDiameter[d] = (result[type].tubesByDiameter[d] || 0) + m;
      }
      const extra = svc.extraData || {};
      const tubFlag = extra['Flushing em tubulação?'] || extra['Flushing em tubulação'] || extra.flushingEmTubulacao;
      if (tubFlag && String(tubFlag).toLowerCase() === 'sim') result[type].hasTubulacao += 1;
    }
  }

  return result;
}

function summarize(reports) {
  const summary = {
    reportCount: 0,
    totalDays: 0,
    daytimeWorkedMinutes: 0,
    nighttimeWorkedMinutes: 0,
    daytimeOvertimeMinutes: 0,
    nighttimeOvertimeMinutes: 0,
    standbyCount: 0,
    standbyMinutes: 0,
    avgDaytimeCollaborators: 0,
    avgNighttimeCollaborators: 0
  };

  let daytimeColTotal = 0;
  let nighttimeColTotal = 0;

  for (const r of reports) {
    summary.reportCount += 1;
    summary.totalDays += 1;
    summary.daytimeWorkedMinutes += r.daytimeWorkedMinutes || 0;
    summary.nighttimeWorkedMinutes += r.nighttimeWorkedMinutes || 0;
    summary.daytimeOvertimeMinutes += r.daytimeOvertimeMinutes || 0;
    summary.nighttimeOvertimeMinutes += r.nighttimeOvertimeMinutes || 0;

    const sc = r.specialConditions || {};
    if (sc.standby === true) {
      summary.standbyCount += 1;
      summary.standbyMinutes += parseMinutes(sc.standbyDetails?.total);
    }

    daytimeColTotal += r.daytimeCount || 0;
    const noturnoIds = sc.noturnoDetails?.collaboratorIds;
    nighttimeColTotal += Array.isArray(noturnoIds) ? noturnoIds.length : 0;
  }

  if (summary.reportCount > 0) {
    summary.avgDaytimeCollaborators = Math.round((daytimeColTotal / summary.reportCount) * 10) / 10;
    summary.avgNighttimeCollaborators = Math.round((nighttimeColTotal / summary.reportCount) * 10) / 10;
  }

  return summary;
}

export function buildDailyReport(r) {
  const sc = r.specialConditions || {};
  const noturnoIds = sc.noturnoDetails?.collaboratorIds;
  const isStandby = sc.standby === true;

  const servicesByType = {};
  const ignoredRows = { volumeOleo: 0, tubulacao: 0 };

  for (const svc of (r.services || [])) {
    const type = (svc.serviceType || '').toLowerCase();
    const finalized = isServiceFinalized(svc);
    if (!finalized) continue;

    if (!servicesByType[type]) {
      servicesByType[type] = { serviceCount: 0, volumeOleoLiters: 0, tubesByDiameter: {}, hasTubulacao: 0, items: [] };
    }
    servicesByType[type].serviceCount += 1;

    const item = {
      serviceId: svc.id,
      system: serviceSystemName(svc),
      equipmentName: serviceEquipmentName(svc),
      volumeOleoLiters: null,
      tubesByDiameter: {}
    };

    if (type === 'filtragem') {
      const { liters, ignored } = parseVolumeOleo(svc);
      if (ignored) ignoredRows.volumeOleo += 1;
      else if (liters !== null) {
        item.volumeOleoLiters = liters;
        servicesByType[type].volumeOleoLiters += liters;
      }
    }

    if (type === 'flushing' || type === 'limpeza' || type === 'pressao') {
      const { byDiameter, ignoredCount } = parseTubulacoes(svc);
      ignoredRows.tubulacao += ignoredCount;
      item.tubesByDiameter = byDiameter;
      for (const [d, m] of Object.entries(byDiameter)) {
        servicesByType[type].tubesByDiameter[d] = (servicesByType[type].tubesByDiameter[d] || 0) + m;
      }
      const extra = svc.extraData || {};
      const tubFlag = extra['Flushing em tubulação?'] || extra['Flushing em tubulação'] || extra.flushingEmTubulacao;
      if (tubFlag && String(tubFlag).toLowerCase() === 'sim') servicesByType[type].hasTubulacao += 1;
    }

    servicesByType[type].items.push(item);
  }

  return {
    reportId: r.id,
    reportDate: r.reportDate,
    sequenceNumber: r.sequenceNumber,
    status: r.status,
    daytimeWorkedMinutes: r.daytimeWorkedMinutes || 0,
    nighttimeWorkedMinutes: r.nighttimeWorkedMinutes || 0,
    daytimeOvertimeMinutes: r.daytimeOvertimeMinutes || 0,
    nighttimeOvertimeMinutes: r.nighttimeOvertimeMinutes || 0,
    standby: isStandby,
    standbyMinutes: isStandby ? parseMinutes(sc.standbyDetails?.total) : 0,
    daytimeCollaborators: r.daytimeCount || 0,
    nighttimeCollaborators: Array.isArray(noturnoIds) ? noturnoIds.length : 0,
    services: servicesByType
  };
}

// ─── Main route ───────────────────────────────────────────────────────────────

function normalizeProjectIds(rawProjectIds) {
  if (!rawProjectIds || rawProjectIds === 'all') return [];
  const ids = Array.isArray(rawProjectIds) ? rawProjectIds : [rawProjectIds];
  return ids.map(id => String(id).trim()).filter(id => id && id !== 'all');
}

function serviceSelect(includeEquipment = false) {
  return {
    id: true,
    serviceType: true,
    finalized: true,
    system: true,
    extraData: true,
    ...(includeEquipment ? { equipment: { select: { code: true, name: true } } } : {})
  };
}

function reportSelect(includeEquipment = false) {
  return {
    id: true,
    projectId: true,
    reportDate: true,
    sequenceNumber: true,
    status: true,
    daytimeWorkedMinutes: true,
    nighttimeWorkedMinutes: true,
    daytimeOvertimeMinutes: true,
    nighttimeOvertimeMinutes: true,
    daytimeCount: true,
    specialConditions: true,
    services: { select: serviceSelect(includeEquipment) }
  };
}

function reportLimitError(limit) {
  return `Consulta muito ampla para estatísticas. Refine por projeto, segmento ou período para até ${limit} RDOs.`;
}

function currentYearMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function normalizeRecipientEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function recipientEmailError(value) {
  const email = normalizeRecipientEmail(value);
  if (!email) return 'E-mail é obrigatório.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return 'E-mail inválido.';
  return null;
}

export function buildServiceExportRows(report, project) {
  const rows = [];
  const dateStr = toLocalDateStr(report.reportDate);

  for (const svc of (report.services || [])) {
    if (!isServiceFinalized(svc)) continue;

    const type = (svc.serviceType || '').toLowerCase();
    const eqName = svc.equipment ? `${svc.equipment.code} - ${svc.equipment.name}` : '';
    const base = [dateStr, project?.code || report.projectId, report.sequenceNumber || '', type, svc.system || '', eqName];

    if (type === 'filtragem') {
      const { liters, ignored } = parseVolumeOleo(svc);
      if (!ignored) rows.push([...base, liters !== null ? liters.toFixed(2) : '', '', '']);
      continue;
    }

    const { byDiameter } = parseTubulacoes(svc);
    const entries = Object.entries(byDiameter);
    if (entries.length === 0) {
      rows.push([...base, '', '', '']);
      continue;
    }
    for (const [d, m] of entries) {
      rows.push([...base, '', d, m.toFixed(2)]);
    }
  }

  return rows;
}

export function statsProjectWhere(extra = {}) {
  return {
    managerOnly: false,
    deletedAt: null,
    ...extra
  };
}

export function statsReportWhere(extra = {}) {
  const { project, ...rest } = extra;
  return {
    deletedAt: null,
    project: statsProjectWhere(project),
    ...rest
  };
}

router.get('/projects', requireAuth, requireRdoStats, asyncHandler(async (req, res) => {
  const role = req.auth.user.role;
  if (role !== 'MANAGER' && role !== 'COORDINATOR') {
    return res.status(403).json({ error: 'Acesso restrito a gestor e coordenador.' });
  }

  const now = new Date();
  const defaultFrom = new Date(now);
  defaultFrom.setFullYear(defaultFrom.getFullYear() - 1);

  const fromStr = req.query.from || toLocalDateStr(defaultFrom);
  const toStr = req.query.to || toLocalDateStr(now);
  const granularity = ['day', 'week', 'month', 'year'].includes(req.query.granularity)
    ? req.query.granularity : 'month';
  const projectStatus = ['active', 'archived', 'all'].includes(req.query.projectStatus)
    ? req.query.projectStatus : 'all';
  const segment = req.query.segment || null;

  const rangeError = validateDateRange(fromStr, toStr);
  if (rangeError) {
    return res.status(400).json({ error: rangeError });
  }
  const fromDate = parseLocalDate(fromStr);
  const toDate = parseLocalDate(toStr, true);

  // Resolve project IDs
  const projectWhere = statsProjectWhere();
  if (projectStatus === 'active') projectWhere.isActive = true;
  if (projectStatus === 'archived') projectWhere.isActive = false;
  if (segment) projectWhere.clientSegment = segment;

  const projectIdFilter = normalizeProjectIds(req.query.projectId);
  if (projectIdFilter.length) projectWhere.id = { in: projectIdFilter };

  const wantsDailyReports = req.query.includeDailyReports === 'true' || projectIdFilter.length > 0;
  const cacheKey = JSON.stringify({
    from: fromStr,
    to: toStr,
    granularity,
    projectStatus,
    role,
    segment: segment || '',
    projectIds: [...projectIdFilter].sort(),
    wantsDailyReports
  });

  const result = await statisticsProjectsCache.get(cacheKey, async () => {
    const projects = await prisma.project.findMany({
      where: projectWhere,
      select: { id: true, code: true, name: true, clientSegment: true, clientName: true }
    });

    if (projects.length === 0) {
      return {
        statusCode: 200,
        body: {
          projects: [],
          meta: {
            from: fromStr,
            to: toStr,
            granularity,
            projectStatus,
            includedStatuses: ['APPROVED', 'SIGNED'],
            generatedAt: new Date(),
            ignoredLegacyRows: { volumeOleo: 0, tubulacao: 0 },
            reportCountLimit: MAX_STATS_REPORTS,
            dailyReportLimit: MAX_DAILY_REPORTS,
            dailyReportsIncluded: false
          },
          summary: summarize([]),
          services: {},
          timeline: [],
          byProject: []
        }
      };
    }

    const projectIds = projects.map(p => p.id);
    const reportWhere = statsReportWhere({
      reportType: 'RDO',
      status: { in: ['APPROVED', 'SIGNED'] },
      reportDate: { gte: fromDate, lte: toDate },
      projectId: { in: projectIds }
    });
    const reportCount = await prisma.report.count({ where: reportWhere });
    if (reportCount > MAX_STATS_REPORTS) {
      return { statusCode: 413, body: { error: reportLimitError(MAX_STATS_REPORTS) } };
    }

    const includeDailyReports = wantsDailyReports && reportCount <= MAX_DAILY_REPORTS;

    const reports = await prisma.report.findMany({
      where: reportWhere,
      select: reportSelect(includeDailyReports),
      orderBy: { reportDate: 'asc' }
    });

    const ignoredRows = { volumeOleo: 0, tubulacao: 0 };

    // Global summary & services
    const globalSummary = summarize(reports);
    const globalServices = {};
    for (const r of reports) {
      const s = buildServiceStats(r.services, ignoredRows);
      mergeServicesMap(globalServices, s);
    }

    // Timeline
    const timelineMap = new Map();
    for (const r of reports) {
      const key = periodKey(r.reportDate, granularity);
      if (!timelineMap.has(key)) {
        timelineMap.set(key, {
          period: key,
          label: periodLabel(key, granularity),
          reportCount: 0,
          daytimeWorkedMinutes: 0,
          nighttimeWorkedMinutes: 0,
          daytimeOvertimeMinutes: 0,
          nighttimeOvertimeMinutes: 0,
          standbyCount: 0,
          serviceBreakdown: {}
        });
      }
      const slot = timelineMap.get(key);
      slot.reportCount += 1;
      slot.daytimeWorkedMinutes += r.daytimeWorkedMinutes || 0;
      slot.nighttimeWorkedMinutes += r.nighttimeWorkedMinutes || 0;
      slot.daytimeOvertimeMinutes += r.daytimeOvertimeMinutes || 0;
      slot.nighttimeOvertimeMinutes += r.nighttimeOvertimeMinutes || 0;
      const sc = r.specialConditions || {};
      if (sc.standby === true) slot.standbyCount += 1;
      for (const svc of (r.services || [])) {
        if (!isServiceFinalized(svc)) continue;
        const type = (svc.serviceType || '').toLowerCase();
        slot.serviceBreakdown[type] = (slot.serviceBreakdown[type] || 0) + 1;
      }
    }
    const timeline = Array.from(timelineMap.values()).sort((a, b) => a.period.localeCompare(b.period));

    // By project
    const reportsByProject = new Map();
    for (const r of reports) {
      if (!reportsByProject.has(r.projectId)) reportsByProject.set(r.projectId, []);
      reportsByProject.get(r.projectId).push(r);
    }

    const byProject = projects.map(p => {
      const pReports = reportsByProject.get(p.id) || [];
      const pIgnored = { volumeOleo: 0, tubulacao: 0 };
      const pServices = {};
      for (const r of pReports) {
        mergeServicesMap(pServices, buildServiceStats(r.services, pIgnored));
      }
      return {
        projectId: p.id,
        code: p.code,
        name: p.name,
        summary: summarize(pReports),
        services: pServices,
        dailyReports: includeDailyReports ? pReports.map(r => buildDailyReport(r)) : []
      };
    });

    // Re-compute globalServices without double-counting (already done above per report)
    return {
      statusCode: 200,
      body: {
        projects: projects.map(p => ({ id: p.id, code: p.code, name: p.name, clientName: p.clientName, clientSegment: p.clientSegment })),
        meta: {
          from: fromStr,
          to: toStr,
          granularity,
          projectStatus,
          includedStatuses: ['APPROVED', 'SIGNED'],
          generatedAt: new Date(),
          ignoredLegacyRows: ignoredRows,
          reportCountLimit: MAX_STATS_REPORTS,
          dailyReportLimit: MAX_DAILY_REPORTS,
          dailyReportsIncluded: includeDailyReports
        },
        summary: globalSummary,
        services: globalServices,
        timeline,
        byProject
      }
    };
  });

  res.status(result.statusCode).json(result.body);
}));

// ─── CSV Export ───────────────────────────────────────────────────────────────

router.get('/projects/export', requireAuth, requireRdoStats, asyncHandler(async (req, res) => {
  const role = req.auth.user.role;
  if (role !== 'MANAGER' && role !== 'COORDINATOR') {
    return res.status(403).json({ error: 'Acesso restrito a gestor e coordenador.' });
  }

  // Reuse the same query by calling internal logic
  const section = req.query.section || 'summary';
  if (!['summary', 'byProject', 'services'].includes(section)) {
    return res.status(400).json({ error: 'Seção de exportação inválida.' });
  }

  // Build a fake req to delegate to the main route handler (simpler: just inline)
  const now = new Date();
  const defaultFrom = new Date(now);
  defaultFrom.setFullYear(defaultFrom.getFullYear() - 1);

  const fromStr = req.query.from || toLocalDateStr(defaultFrom);
  const toStr = req.query.to || toLocalDateStr(now);
  const projectStatus = ['active', 'archived', 'all'].includes(req.query.projectStatus)
    ? req.query.projectStatus : 'all';
  const segment = req.query.segment || null;

  const rangeError = validateDateRange(fromStr, toStr);
  if (rangeError) {
    return res.status(400).json({ error: rangeError });
  }
  const fromDate = parseLocalDate(fromStr);
  const toDate = parseLocalDate(toStr, true);

  const projectWhere = statsProjectWhere();
  if (projectStatus === 'active') projectWhere.isActive = true;
  if (projectStatus === 'archived') projectWhere.isActive = false;
  if (segment) projectWhere.clientSegment = segment;

  const projectIdFilter = normalizeProjectIds(req.query.projectId);
  if (projectIdFilter.length) projectWhere.id = { in: projectIdFilter };

  const projects = await prisma.project.findMany({
    where: projectWhere,
    select: { id: true, code: true, name: true, clientName: true, clientSegment: true }
  });

  const reportWhere = statsReportWhere({
    reportType: 'RDO',
    status: { in: ['APPROVED', 'SIGNED'] },
    reportDate: { gte: fromDate, lte: toDate },
    projectId: { in: projects.map(p => p.id) }
  });

  const reportCount = projects.length === 0 ? 0 : await prisma.report.count({ where: reportWhere });
  if (reportCount > MAX_STATS_REPORTS) {
    return res.status(413).json({ error: reportLimitError(MAX_STATS_REPORTS) });
  }

  const exportReportSelect = {
    id: true,
    projectId: true,
    reportDate: true,
    sequenceNumber: true,
    status: true,
    daytimeWorkedMinutes: true,
    nighttimeWorkedMinutes: true,
    daytimeOvertimeMinutes: true,
    nighttimeOvertimeMinutes: true,
    daytimeCount: true,
    specialConditions: true,
    ...(section === 'services' ? { services: { select: serviceSelect(true) } } : {})
  };

  const reports = projects.length === 0 ? [] : await prisma.report.findMany({
    where: reportWhere,
    select: exportReportSelect,
    orderBy: { reportDate: 'asc' }
  });

  const ignoredRows = { volumeOleo: 0, tubulacao: 0 };

  function csvRow(values) {
    return values.map(v => {
      const s = String(v ?? '');
      return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(',');
  }

  const filename = `estatisticas-${section}-${fromStr}-${toStr}.csv`;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.write('﻿'); // BOM for Excel

  if (section === 'summary') {
    const globalSummary = summarize(reports);
    res.write(csvRow(['Período de', 'Período até', 'Relatórios', 'Dias executados',
      'Horas diurnas (min)', 'Horas noturnas (min)', 'HE diurna (min)', 'HE noturna (min)',
      'Standby (dias)', 'Standby (min)', 'Colaboradores diurnos (média)', 'Colaboradores noturnos (média)']) + '\n');
    res.write(csvRow([fromStr, toStr, globalSummary.reportCount, globalSummary.totalDays,
      globalSummary.daytimeWorkedMinutes, globalSummary.nighttimeWorkedMinutes,
      globalSummary.daytimeOvertimeMinutes, globalSummary.nighttimeOvertimeMinutes,
      globalSummary.standbyCount, globalSummary.standbyMinutes,
      globalSummary.avgDaytimeCollaborators, globalSummary.avgNighttimeCollaborators]) + '\n');
  } else if (section === 'byProject') {
    res.write(csvRow(['Código', 'Projeto', 'Relatórios', 'Dias',
      'H. diurnas (min)', 'H. noturnas (min)', 'HE diurna (min)', 'HE noturna (min)',
      'Standby (dias)', 'Standby (min)']) + '\n');
    const byProjMap = new Map(projects.map(p => [p.id, p]));
    const reportsByProject = new Map();
    for (const r of reports) {
      if (!reportsByProject.has(r.projectId)) reportsByProject.set(r.projectId, []);
      reportsByProject.get(r.projectId).push(r);
    }
    for (const [pid, proj] of byProjMap) {
      const s = summarize(reportsByProject.get(pid) || []);
      res.write(csvRow([proj.code, proj.name, s.reportCount, s.totalDays,
        s.daytimeWorkedMinutes, s.nighttimeWorkedMinutes,
        s.daytimeOvertimeMinutes, s.nighttimeOvertimeMinutes,
        s.standbyCount, s.standbyMinutes]) + '\n');
    }
  } else if (section === 'services') {
    res.write(csvRow(['Data', 'Projeto', 'RDO #', 'Tipo serviço', 'Sistema', 'Equipamento',
      'Volume óleo (L)', 'Diâmetro', 'Comprimento (m)']) + '\n');
    for (const r of reports) {
      const proj = projects.find(p => p.id === r.projectId);
      for (const row of buildServiceExportRows(r, proj)) {
        res.write(csvRow(row) + '\n');
      }
    }
  }

  res.end();
}));

// ─── Monthly collaborator allocation report ──────────────────────────────────

router.get('/allocation-report', requireAuth, requireRdoStats, asyncHandler(async (req, res) => {
  const yearMonth = String(req.query.yearMonth || currentYearMonth());
  if (!validateYearMonth(yearMonth)) {
    return res.status(400).json({ error: 'Mês inválido. Use o formato YYYY-MM.' });
  }

  const data = await buildMonthlyAllocationSummary({ yearMonth });
  res.json(data);
}));

router.get('/allocation-report/pdf', requireAuth, requireRdoStats, asyncHandler(async (req, res) => {
  const yearMonth = String(req.query.yearMonth || currentYearMonth());
  if (!validateYearMonth(yearMonth)) {
    return res.status(400).json({ error: 'Mês inválido. Use o formato YYYY-MM.' });
  }

  const data = await buildMonthlyAllocationSummary({ yearMonth });
  const pdf = await buildMonthlyAllocationPdf(data);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="alocacao-colaboradores-${yearMonth}.pdf"`);
  res.send(pdf);
}));

router.post('/allocation-report/send', requireAuth, requireRdoStats, asyncHandler(async (req, res) => {
  const yearMonth = String(req.body?.yearMonth || currentYearMonth());
  if (!validateYearMonth(yearMonth)) {
    return res.status(400).json({ error: 'Mês inválido. Use o formato YYYY-MM.' });
  }

  const result = await sendMonthlyAllocationReport({ yearMonth });
  res.json({ yearMonth, ...result });
}));

router.get('/allocation-report/recipients', requireAuth, requireRdoStats, asyncHandler(async (_req, res) => {
  const recipients = await prisma.allocationReportRecipient.findMany({
    orderBy: [{ isActive: 'desc' }, { email: 'asc' }]
  });
  res.json(recipients);
}));

router.post('/allocation-report/recipients', requireAuth, requireRdoStats, asyncHandler(async (req, res) => {
  const email = normalizeRecipientEmail(req.body?.email);
  const emailError = recipientEmailError(email);
  if (emailError) return res.status(400).json({ error: emailError });

  const name = String(req.body?.name || '').trim() || null;
  const recipient = await prisma.allocationReportRecipient.upsert({
    where: { email },
    create: { email, name, isActive: true },
    update: { name, isActive: true }
  });
  res.status(201).json(recipient);
}));

router.patch('/allocation-report/recipients/:id', requireAuth, requireRdoStats, asyncHandler(async (req, res) => {
  const data = {};
  if (Object.prototype.hasOwnProperty.call(req.body || {}, 'name')) {
    data.name = String(req.body.name || '').trim() || null;
  }
  if (Object.prototype.hasOwnProperty.call(req.body || {}, 'email')) {
    const email = normalizeRecipientEmail(req.body.email);
    const emailError = recipientEmailError(email);
    if (emailError) return res.status(400).json({ error: emailError });
    data.email = email;
  }
  if (Object.prototype.hasOwnProperty.call(req.body || {}, 'isActive')) {
    data.isActive = Boolean(req.body.isActive);
  }

  const recipient = await prisma.allocationReportRecipient.update({
    where: { id: req.params.id },
    data
  });
  res.json(recipient);
}));

router.delete('/allocation-report/recipients/:id', requireAuth, requireRdoStats, asyncHandler(async (req, res) => {
  await prisma.allocationReportRecipient.delete({ where: { id: req.params.id } });
  res.status(204).end();
}));

// ─── Overview (mini dashboard) ───────────────────────────────────────────────

router.get('/overview', requireAuth, requireRdoStats, asyncHandler(async (req, res) => {
  const role = req.auth.user.role;
  if (role !== 'MANAGER' && role !== 'COORDINATOR') {
    return res.status(403).json({ error: 'Acesso restrito a gestor e coordenador.' });
  }

  const baseWhere = statsProjectWhere();

  const [reportGroups, projects] = await Promise.all([
    prisma.report.groupBy({
      by: ['projectId', 'reportType'],
      where: statsReportWhere({
        project: baseWhere,
        status: { in: ['APPROVED', 'SIGNED'] }
      }),
      _count: { id: true }
    }),
    prisma.project.findMany({
      where: baseWhere,
      select: { id: true, code: true, name: true, isActive: true }
    })
  ]);

  const activeCount = projects.filter(p => p.isActive).length;
  const archivedCount = projects.filter(p => !p.isActive).length;

  // Build per-project map
  const projectMap = new Map(projects.map(p => [p.id, p]));
  const byProject = new Map();

  for (const g of reportGroups) {
    const p = projectMap.get(g.projectId);
    if (!p) continue;
    if (!byProject.has(g.projectId)) {
      byProject.set(g.projectId, {
        projectId: g.projectId,
        code: p.code,
        name: p.name,
        isActive: p.isActive,
        reportCounts: {},
        rdoCount: 0
      });
    }
    const entry = byProject.get(g.projectId);
    entry.reportCounts[g.reportType] = g._count.id;
    if (g.reportType === 'RDO') entry.rdoCount = g._count.id;
  }

  // Add projects with zero reports (active only, to show in active count)
  for (const p of projects) {
    if (!byProject.has(p.id)) {
      byProject.set(p.id, {
        projectId: p.id, code: p.code, name: p.name, isActive: p.isActive,
        reportCounts: {}, rdoCount: 0
      });
    }
  }

  const sorted = Array.from(byProject.values())
    .sort((a, b) => b.rdoCount - a.rdoCount);

  res.json({
    projectCounts: { active: activeCount, archived: archivedCount, total: activeCount + archivedCount },
    byProject: sorted
  });
}));

export default router;
