import { Router } from 'express';
import { ReportStatus, ReportType } from '@prisma/client';
import { z } from 'zod';

import asyncHandler from '../../lib/async-handler.js';
import prisma from '../../lib/prisma.js';
import { requireAuth } from '../../middleware/auth.js';

const router = Router();
const SAO_PAULO_OFFSET_HOURS = 3;
const MAX_RANGE_DAYS = 731;
const SERVICE_LABELS = {
  filtragem: 'Filtragem',
  flushing: 'Flushing',
  limpeza: 'Limpeza química',
  pressao: 'Teste de pressão',
  mecanica: 'Mecânica',
  inibicao: 'Inibição'
};

function requireManagerOrCoordinator(req, res, next) {
  if (!req.auth || !['MANAGER', 'COORDINATOR'].includes(req.auth.user.role)) {
    return res.status(403).json({ error: 'Acesso restrito ao gestor ou coordenador.' });
  }
  next();
}

router.use(requireAuth, requireManagerOrCoordinator);

const querySchema = z.object({
  projectId: z.union([z.string(), z.array(z.string())]).optional(),
  segment: z.string().trim().optional(),
  projectStatus: z.enum(['active', 'archived', 'all']).default('all'),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  granularity: z.enum(['day', 'week', 'month', 'year']).default('month'),
  section: z.enum(['summary', 'byProject', 'services']).optional()
});

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function defaultFromDate() {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - 365);
  return isoDate(date);
}

function parseLocalDateStart(value) {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day, SAO_PAULO_OFFSET_HOURS, 0, 0, 0));
}

function parseLocalDateEnd(value) {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + 1, SAO_PAULO_OFFSET_HOURS, 0, 0, -1));
}

function localDateParts(date) {
  const shifted = new Date(date.getTime() - SAO_PAULO_OFFSET_HOURS * 60 * 60 * 1000);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate()
  };
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

function startOfLocalWeek(parts) {
  const utc = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  const day = utc.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  utc.setUTCDate(utc.getUTCDate() + diff);
  return {
    year: utc.getUTCFullYear(),
    month: utc.getUTCMonth() + 1,
    day: utc.getUTCDate()
  };
}

function periodForDate(date, granularity) {
  const parts = localDateParts(date);
  if (granularity === 'year') {
    return { key: String(parts.year), label: String(parts.year) };
  }
  if (granularity === 'month') {
    const key = `${parts.year}-${pad2(parts.month)}`;
    return {
      key,
      label: new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric', timeZone: 'America/Sao_Paulo' }).format(date)
    };
  }
  if (granularity === 'week') {
    const week = startOfLocalWeek(parts);
    const key = `${week.year}-${pad2(week.month)}-${pad2(week.day)}`;
    return { key, label: `Semana de ${pad2(week.day)}/${pad2(week.month)}/${week.year}` };
  }
  const key = `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}`;
  return { key, label: `${pad2(parts.day)}/${pad2(parts.month)}/${parts.year}` };
}

function parseProjectIds(raw) {
  const values = Array.isArray(raw) ? raw : String(raw || '').split(',');
  return values.map(value => String(value || '').trim()).filter(value => value && value !== 'all');
}

function normalizeText(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '');
}

function parseNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const normalized = String(value || '').trim().replace(/\./g, '').replace(',', '.');
  const match = normalized.match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function parseValueWithUnit(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return { value, unit: '' };
  const text = String(value).trim();
  const number = parseNumber(text);
  if (number === null) return null;
  const unit = text.replace(/[-\d.,\s]+/g, '').trim();
  return { value: number, unit };
}

function toLiters(value) {
  const parsed = parseValueWithUnit(value);
  if (!parsed) return null;
  const unit = normalizeText(parsed.unit || 'l');
  if (['l', 'lt', 'lts', 'litro', 'litros'].includes(unit)) return parsed.value;
  if (['ml', 'mililitro', 'mililitros'].includes(unit)) return parsed.value / 1000;
  if (['m3', 'm³', 'metro cubico', 'metros cubicos'].includes(unit)) return parsed.value * 1000;
  return null;
}

function toMeters(value, unitValue) {
  const parsed = unitValue ? { value: parseNumber(value), unit: unitValue } : parseValueWithUnit(value);
  if (!parsed || parsed.value === null || !Number.isFinite(parsed.value)) return null;
  const unit = normalizeText(parsed.unit || 'm');
  if (['m', 'metro', 'metros'].includes(unit)) return parsed.value;
  if (['cm', 'centimetro', 'centimetros'].includes(unit)) return parsed.value / 100;
  if (['mm', 'milimetro', 'milimetros'].includes(unit)) return parsed.value / 1000;
  if (['km', 'quilometro', 'quilometros'].includes(unit)) return parsed.value * 1000;
  return null;
}

function parseStandbyMinutes(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const text = String(value || '').trim();
  if (!text) return 0;
  const parts = text.split(':').map(part => Number(part));
  if (parts.length >= 2 && parts.every(Number.isFinite)) {
    return (parts[0] * 60) + parts[1] + (parts[2] ? Math.round(parts[2] / 60) : 0);
  }
  const minutes = parseNumber(text);
  return minutes === null ? 0 : minutes;
}

function serviceExtraData(service) {
  return service?.extraData && typeof service.extraData === 'object' && !Array.isArray(service.extraData)
    ? service.extraData
    : {};
}

function tubeRows(service) {
  const extra = serviceExtraData(service);
  const rows = extra['Diâmetros e comprimentos'] || extra['Diametros e comprimentos'] || extra.tubes;
  return Array.isArray(rows) ? rows : [];
}

function tubeDiameter(row) {
  const diameter = row?.d ?? row?.diametro ?? row?.diameter;
  const unit = row?.unit ?? row?.dUnit ?? row?.diametroUnit ?? '';
  const text = String(diameter || '').trim();
  if (!text) return '';
  return unit && !text.includes(String(unit)) ? `${text} ${unit}` : text;
}

function tubeMeters(row) {
  return toMeters(row?.c ?? row?.comprimento ?? row?.length, row?.lengthUnit ?? row?.cUnit ?? row?.comprimentoUnit);
}

function addTubeStats(target, service, ignored) {
  for (const row of tubeRows(service)) {
    const diameter = tubeDiameter(row);
    const meters = tubeMeters(row);
    if (!diameter || meters === null) {
      ignored.tubulacao += 1;
      continue;
    }
    target.tubesByDiameter[diameter] ??= { meters: 0 };
    target.tubesByDiameter[diameter].meters += meters;
  }
}

function mergeTubeStats(target, source) {
  for (const [diameter, value] of Object.entries(source || {})) {
    target[diameter] ??= { meters: 0 };
    target[diameter].meters += value.meters || 0;
  }
}

function serviceSystemName(service) {
  const extra = serviceExtraData(service);
  return String(service.system || extra.Sistema || extra.system || '').trim() || null;
}

function serviceEquipmentName(service) {
  const extra = serviceExtraData(service);
  if (service.equipment) {
    return [service.equipment.code, service.equipment.name].filter(Boolean).join(' - ') || service.equipment.name || service.equipment.code;
  }
  const raw = extra['Equipamento(s)'] || extra.equipment || extra.equipmentName;
  if (typeof raw === 'string') return raw.trim() || null;
  return null;
}

function breakdownKey(system, equipmentName) {
  return `${system || 'Sem sistema'}||${equipmentName || 'Sem equipamento'}`;
}

function emptySummary() {
  return {
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
}

function emptyServices() {
  return {};
}

function ensureServiceBucket(services, type) {
  services[type] ??= {
    label: SERVICE_LABELS[type] || type,
    serviceCount: 0,
    volumeOleoLiters: 0,
    tubesByDiameter: {},
    hasTubulacao: 0,
    bySystemEquipment: {}
  };
  return services[type];
}

function addSummary(summary, report) {
  const special = report.specialConditions || {};
  const nightIds = Array.isArray(special.noturnoDetails?.collaboratorIds)
    ? special.noturnoDetails.collaboratorIds.filter(Boolean)
    : [];
  summary.reportCount += 1;
  summary.totalDays += 1;
  summary.daytimeWorkedMinutes += report.daytimeWorkedMinutes || 0;
  summary.nighttimeWorkedMinutes += report.nighttimeWorkedMinutes || 0;
  summary.daytimeOvertimeMinutes += report.daytimeOvertimeMinutes || 0;
  summary.nighttimeOvertimeMinutes += report.nighttimeOvertimeMinutes || 0;
  if (special.standby === true) {
    summary.standbyCount += 1;
    summary.standbyMinutes += parseStandbyMinutes(special.standbyDetails?.total);
  }
  summary._daytimeCollaborators = (summary._daytimeCollaborators || 0) + (report.daytimeCount ?? report.collaborators?.length ?? 0);
  summary._nighttimeCollaborators = (summary._nighttimeCollaborators || 0) + nightIds.length;
}

function finalizeSummary(summary) {
  const reportCount = summary.reportCount || 0;
  const daytimeTotal = summary._daytimeCollaborators || 0;
  const nighttimeTotal = summary._nighttimeCollaborators || 0;
  delete summary._daytimeCollaborators;
  delete summary._nighttimeCollaborators;
  summary.avgDaytimeCollaborators = reportCount ? Math.round((daytimeTotal / reportCount) * 10) / 10 : 0;
  summary.avgNighttimeCollaborators = reportCount ? Math.round((nighttimeTotal / reportCount) * 10) / 10 : 0;
  return summary;
}

function serviceMeasurements(service, type, ignored) {
  const extra = serviceExtraData(service);
  const measured = {
    volumeOleoLiters: 0,
    tubesByDiameter: {},
    hasTubulacao: 0
  };

  if (type === 'filtragem' || type === 'flushing') {
    const liters = toLiters(extra['Volume de óleo'] ?? extra.volumeOleo);
    if (liters === null) ignored.volumeOleo += 1;
    else measured.volumeOleoLiters += liters;
  }

  if (type === 'flushing') {
    if (normalizeText(extra['Flushing em tubulação?'] || extra['Flushing em tubulacao?'] || extra.flushingTubulacao) !== 'nao') {
      measured.hasTubulacao += 1;
      addTubeStats(measured, service, ignored);
    }
  } else if (type === 'limpeza') {
    if (normalizeText(extra['Limpeza de tubulação?'] || extra['Limpeza de tubulacao?'] || extra.limpezaTubulacao) !== 'nao') {
      addTubeStats(measured, service, ignored);
    }
  } else if (type === 'pressao') {
    addTubeStats(measured, service, ignored);
  }

  return measured;
}

function mergeMeasurements(target, measured) {
  target.volumeOleoLiters = (target.volumeOleoLiters || 0) + (measured.volumeOleoLiters || 0);
  target.hasTubulacao = (target.hasTubulacao || 0) + (measured.hasTubulacao || 0);
  target.tubesByDiameter ??= {};
  mergeTubeStats(target.tubesByDiameter, measured.tubesByDiameter);
}

function addServices(services, report, ignored, options = {}) {
  for (const service of report.services || []) {
    const type = String(service.serviceType || 'outro').trim().toLowerCase() || 'outro';
    const bucket = ensureServiceBucket(services, type);
    const system = serviceSystemName(service);
    const equipmentName = serviceEquipmentName(service);
    const measured = serviceMeasurements(service, type, ignored);
    bucket.serviceCount += 1;
    mergeMeasurements(bucket, measured);

    const key = breakdownKey(system, equipmentName);
    bucket.bySystemEquipment[key] ??= {
      system,
      equipmentName,
      serviceCount: 0,
      volumeOleoLiters: 0,
      tubesByDiameter: {},
      hasTubulacao: 0
    };
    bucket.bySystemEquipment[key].serviceCount += 1;
    mergeMeasurements(bucket.bySystemEquipment[key], measured);

    if (options.includeItems) {
      bucket.items ??= [];
      bucket.items.push({
        serviceId: service.id,
        system,
        equipmentName,
        volumeOleoLiters: measured.volumeOleoLiters,
        tubesByDiameter: measured.tubesByDiameter,
        hasTubulacao: measured.hasTubulacao > 0
      });
    }
  }
}

function roundServiceNumbers(services) {
  for (const bucket of Object.values(services)) {
    bucket.volumeOleoLiters = Math.round((bucket.volumeOleoLiters || 0) * 100) / 100;
    for (const tube of Object.values(bucket.tubesByDiameter || {})) {
      tube.meters = Math.round((tube.meters || 0) * 100) / 100;
    }
    const breakdown = Array.isArray(bucket.bySystemEquipment)
      ? bucket.bySystemEquipment
      : Object.values(bucket.bySystemEquipment || {});
    bucket.bySystemEquipment = breakdown
      .map(item => {
        item.volumeOleoLiters = Math.round((item.volumeOleoLiters || 0) * 100) / 100;
        for (const tube of Object.values(item.tubesByDiameter || {})) {
          tube.meters = Math.round((tube.meters || 0) * 100) / 100;
        }
        return item;
      })
      .sort((a, b) => b.serviceCount - a.serviceCount || String(a.system || '').localeCompare(String(b.system || ''), 'pt-BR'));
    if (Array.isArray(bucket.items)) {
      bucket.items = bucket.items.map(item => {
        item.volumeOleoLiters = Math.round((item.volumeOleoLiters || 0) * 100) / 100;
        for (const tube of Object.values(item.tubesByDiameter || {})) {
          tube.meters = Math.round((tube.meters || 0) * 100) / 100;
        }
        return item;
      });
    }
  }
  return services;
}

function sortServices(services) {
  return Object.fromEntries(Object.entries(services).sort((a, b) => b[1].serviceCount - a[1].serviceCount || a[0].localeCompare(b[0])));
}

function summarizeReportServices(report) {
  const ignored = { volumeOleo: 0, tubulacao: 0 };
  const services = emptyServices();
  addServices(services, report, ignored, { includeItems: true });
  return sortServices(roundServiceNumbers(services));
}

function reportDailySummary(report) {
  const special = report.specialConditions || {};
  const nightIds = Array.isArray(special.noturnoDetails?.collaboratorIds)
    ? special.noturnoDetails.collaboratorIds.filter(Boolean)
    : [];
  return {
    reportId: report.id,
    reportDate: report.reportDate.toISOString(),
    sequenceNumber: report.sequenceNumber,
    status: report.status,
    daytimeWorkedMinutes: report.daytimeWorkedMinutes || 0,
    nighttimeWorkedMinutes: report.nighttimeWorkedMinutes || 0,
    daytimeOvertimeMinutes: report.daytimeOvertimeMinutes || 0,
    nighttimeOvertimeMinutes: report.nighttimeOvertimeMinutes || 0,
    standby: special.standby === true,
    standbyMinutes: special.standby === true ? parseStandbyMinutes(special.standbyDetails?.total) : 0,
    daytimeCollaborators: report.daytimeCount ?? report.collaborators?.length ?? 0,
    nighttimeCollaborators: nightIds.length,
    services: summarizeReportServices(report)
  };
}

function buildStats(reports, params) {
  const ignoredLegacyRows = { volumeOleo: 0, tubulacao: 0 };
  const summary = emptySummary();
  const services = emptyServices();
  const byProjectMap = new Map();
  const timelineMap = new Map();
  const projectMap = new Map();

  for (const report of reports) {
    const project = report.project;
    if (project) {
      projectMap.set(project.id, {
        id: project.id,
        code: project.code,
        name: project.name,
        clientName: project.clientName,
        clientSegment: project.clientSegment || null,
        isActive: project.isActive
      });
    }

    addSummary(summary, report);
    addServices(services, report, ignoredLegacyRows);

    if (project) {
      if (!byProjectMap.has(project.id)) {
        byProjectMap.set(project.id, {
          projectId: project.id,
          code: project.code,
          name: project.name,
          clientName: project.clientName,
          clientSegment: project.clientSegment || null,
          isActive: project.isActive,
          summary: emptySummary(),
          services: emptyServices(),
          dailyReports: []
        });
      }
      const projectStats = byProjectMap.get(project.id);
      addSummary(projectStats.summary, report);
      addServices(projectStats.services, report, { volumeOleo: 0, tubulacao: 0 });
      projectStats.dailyReports.push(reportDailySummary(report));
    }

    const period = periodForDate(report.reportDate, params.granularity);
    if (!timelineMap.has(period.key)) {
      timelineMap.set(period.key, {
        period: period.key,
        label: period.label,
        reportCount: 0,
        daytimeWorkedMinutes: 0,
        nighttimeWorkedMinutes: 0,
        daytimeOvertimeMinutes: 0,
        nighttimeOvertimeMinutes: 0,
        standbyCount: 0,
        serviceBreakdown: {}
      });
    }
    const timeline = timelineMap.get(period.key);
    timeline.reportCount += 1;
    timeline.daytimeWorkedMinutes += report.daytimeWorkedMinutes || 0;
    timeline.nighttimeWorkedMinutes += report.nighttimeWorkedMinutes || 0;
    timeline.daytimeOvertimeMinutes += report.daytimeOvertimeMinutes || 0;
    timeline.nighttimeOvertimeMinutes += report.nighttimeOvertimeMinutes || 0;
    if (report.specialConditions?.standby === true) timeline.standbyCount += 1;
    for (const service of report.services || []) {
      const type = String(service.serviceType || 'outro').trim().toLowerCase() || 'outro';
      timeline.serviceBreakdown[type] = (timeline.serviceBreakdown[type] || 0) + 1;
    }
  }

  const byProject = Array.from(byProjectMap.values())
    .map(item => ({
      ...item,
      summary: finalizeSummary(item.summary),
      services: sortServices(roundServiceNumbers(item.services)),
      dailyReports: item.dailyReports.sort((a, b) => a.reportDate.localeCompare(b.reportDate) || (a.sequenceNumber || 0) - (b.sequenceNumber || 0))
    }))
    .sort((a, b) => String(a.code || '').localeCompare(String(b.code || ''), 'pt-BR'));

  return {
    projects: Array.from(projectMap.values()).sort((a, b) => String(a.code || '').localeCompare(String(b.code || ''), 'pt-BR')),
    meta: {
      from: params.from,
      to: params.to,
      granularity: params.granularity,
      includedStatuses: [ReportStatus.APPROVED, ReportStatus.SIGNED],
      projectStatus: params.projectStatus,
      generatedAt: new Date().toISOString(),
      ignoredLegacyRows
    },
    summary: finalizeSummary(summary),
    services: sortServices(roundServiceNumbers(services)),
    timeline: Array.from(timelineMap.values()).sort((a, b) => a.period.localeCompare(b.period)),
    byProject
  };
}

function csvEscape(value) {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\n\r;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function toCsv(rows) {
  return rows.map(row => row.map(csvEscape).join(';')).join('\n');
}

function csvForSection(stats, section) {
  if (section === 'byProject') {
    return toCsv([
      ['Projeto', 'Cliente', 'Status', 'RDOs', 'Dias', 'Horas diurnas', 'Horas noturnas', 'HE diurna', 'HE noturna', 'Standby'],
      ...stats.byProject.map(item => [
        `${item.code} - ${item.name}`,
        item.clientName || '',
        item.isActive ? 'Em andamento' : 'Arquivado',
        item.summary.reportCount,
        item.summary.totalDays,
        Math.round(item.summary.daytimeWorkedMinutes / 60 * 100) / 100,
        Math.round(item.summary.nighttimeWorkedMinutes / 60 * 100) / 100,
        Math.round(item.summary.daytimeOvertimeMinutes / 60 * 100) / 100,
        Math.round(item.summary.nighttimeOvertimeMinutes / 60 * 100) / 100,
        item.summary.standbyCount
      ])
    ]);
  }

  if (section === 'services') {
    const rows = [['Projeto', 'RDO', 'Data', 'Tipo', 'Sistema', 'Equipamento', 'Serviços', 'Volume óleo (L)', 'Tubulações']];
    for (const item of stats.byProject) {
      for (const day of item.dailyReports || []) {
        for (const [type, service] of Object.entries(day.services || {})) {
          const serviceItems = Array.isArray(service.items) && service.items.length
            ? service.items
            : [{ system: '', equipmentName: '', serviceCount: service.serviceCount, volumeOleoLiters: service.volumeOleoLiters || 0, tubesByDiameter: service.tubesByDiameter || {} }];
          for (const serviceItem of serviceItems) {
            const tubes = Object.entries(serviceItem.tubesByDiameter || {})
              .map(([diameter, value]) => `${diameter}: ${value.meters} m`)
              .join(' | ');
            rows.push([
              `${item.code} - ${item.name}`,
              day.sequenceNumber || '',
              day.reportDate ? day.reportDate.slice(0, 10) : '',
              service.label || type,
              serviceItem.system || '',
              serviceItem.equipmentName || '',
              serviceItem.serviceCount || 1,
              serviceItem.volumeOleoLiters || 0,
              tubes
            ]);
          }
        }
      }
    }
    return toCsv(rows);
  }

  return toCsv([
    ['Indicador', 'Valor'],
    ['RDOs', stats.summary.reportCount],
    ['Dias', stats.summary.totalDays],
    ['Horas diurnas', Math.round(stats.summary.daytimeWorkedMinutes / 60 * 100) / 100],
    ['Horas noturnas', Math.round(stats.summary.nighttimeWorkedMinutes / 60 * 100) / 100],
    ['HE diurna', Math.round(stats.summary.daytimeOvertimeMinutes / 60 * 100) / 100],
    ['HE noturna', Math.round(stats.summary.nighttimeOvertimeMinutes / 60 * 100) / 100],
    ['Standby dias', stats.summary.standbyCount],
    ['Standby horas', Math.round(stats.summary.standbyMinutes / 60 * 100) / 100],
    ['Colaboradores diurnos médios', stats.summary.avgDaytimeCollaborators],
    ['Colaboradores noturnos médios', stats.summary.avgNighttimeCollaborators]
  ]);
}

async function loadStats(req) {
  const parsed = querySchema.parse(req.query);
  const from = parsed.from || defaultFromDate();
  const to = parsed.to || isoDate(new Date());
  const fromDate = parseLocalDateStart(from);
  const toDate = parseLocalDateEnd(to);
  if (fromDate > toDate) {
    const error = new Error('Data inicial deve ser menor ou igual à data final.');
    error.status = 400;
    throw error;
  }
  const rangeDays = Math.ceil((toDate.getTime() - fromDate.getTime()) / (24 * 60 * 60 * 1000));
  if (rangeDays > MAX_RANGE_DAYS) {
    const error = new Error('O período máximo para estatísticas é de 2 anos.');
    error.status = 400;
    throw error;
  }

  const projectIds = parseProjectIds(parsed.projectId);
  const projectWhere = {};
  if (req.auth.user.role !== 'MANAGER') projectWhere.managerOnly = false;
  if (parsed.segment) projectWhere.clientSegment = parsed.segment;
  if (parsed.projectStatus === 'active') projectWhere.isActive = true;
  if (parsed.projectStatus === 'archived') projectWhere.isActive = false;

  const where = {
    reportType: ReportType.RDO,
    status: { in: [ReportStatus.APPROVED, ReportStatus.SIGNED] },
    reportDate: { gte: fromDate, lte: toDate },
    project: projectWhere
  };
  if (projectIds.length) where.projectId = { in: projectIds };

  const reports = await prisma.report.findMany({
    where,
    include: {
      project: true,
      collaborators: true,
      services: {
        include: {
          equipment: true
        }
      }
    },
    orderBy: [{ reportDate: 'asc' }, { createdAt: 'asc' }]
  });

  return buildStats(reports, {
    from,
    to,
    granularity: parsed.granularity,
    projectStatus: parsed.projectStatus
  });
}

router.get('/projects', asyncHandler(async (req, res) => {
  const stats = await loadStats(req);
  res.json(stats);
}));

router.get('/projects/export', asyncHandler(async (req, res) => {
  const parsed = querySchema.parse(req.query);
  const stats = await loadStats(req);
  const section = parsed.section || 'summary';
  const csv = `sep=;\n${csvForSection(stats, section)}`;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="estatisticas_${section}.csv"`);
  res.send(`\uFEFF${csv}`);
}));

export default router;
