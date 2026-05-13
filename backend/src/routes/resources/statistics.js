import { Router } from 'express';

import asyncHandler from '../../lib/async-handler.js';
import prisma from '../../lib/prisma.js';
import { requireAuth } from '../../middleware/auth.js';

const router = Router();
const MAX_YEARS = 2;
// Brazil abolished DST in 2019; always UTC-3
const BRT_OFFSET_MS = -3 * 60 * 60 * 1000;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toBRT(date) {
  return new Date(date.getTime() + BRT_OFFSET_MS);
}

function parseLocalDate(str) {
  // YYYY-MM-DD → midnight UTC-3 → UTC
  const [y, m, d] = str.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) - BRT_OFFSET_MS);
}

function toLocalDateStr(date) {
  const d = toBRT(date);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function isoWeek(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return { year: d.getUTCFullYear(), week };
}

function periodKey(date, granularity) {
  const d = toBRT(date);
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

function parseVolumeOleo(service) {
  // extraData may have volumeOleo + volumeOleoUnit or a combined 'Volume de óleo'
  const extra = service.extraData || {};

  // New format: separate fields
  const vol = extra.volumeOleo ?? extra['Volume de óleo'];
  const unit = extra.volumeOleoUnit ?? extra['Unidade de volume de óleo'];

  if (vol === undefined || vol === null || vol === '') return { liters: null, ignored: true };

  const num = parseFloat(String(vol).replace(',', '.'));
  if (isNaN(num)) return { liters: null, ignored: true };

  const unitStr = String(unit || 'L').trim().toLowerCase();
  if (unitStr === 'ml' || unitStr === 'ml') return { liters: num / 1000, ignored: false };
  if (unitStr === 'm³' || unitStr === 'm3') return { liters: num * 1000, ignored: false };
  // L, litro, litros, l
  return { liters: num, ignored: false };
}

function parseTubulacoes(service) {
  const extra = service.extraData || {};
  const raw = extra['Diâmetros e comprimentos'] || extra.diametros || [];
  if (!Array.isArray(raw)) return { byDiameter: {}, ignoredCount: 0 };

  const byDiameter = {};
  let ignoredCount = 0;

  for (const item of raw) {
    const d = item.d || item.diametro;
    const dUnit = (item.unit || item.dUnit || '').trim(); // "pol" | "mm" | ""
    const c = item.c ?? item.comprimento;
    const cUnit = (item.lengthUnit || item.comprimentoUnit || 'm').toLowerCase();

    if (!d || c === undefined || c === null) { ignoredCount++; continue; }

    const meters = parseFloat(String(c).replace(',', '.'));
    if (isNaN(meters)) { ignoredCount++; continue; }

    const normalizedMeters = cUnit === 'cm' ? meters / 100 : cUnit === 'mm' ? meters / 1000 : meters;
    const key = dUnit ? `${String(d).trim()} ${dUnit}` : String(d).trim();
    byDiameter[key] = (byDiameter[key] || 0) + normalizedMeters;
  }

  return { byDiameter, ignoredCount };
}

function emptyServiceStats() {
  return { serviceCount: 0, volumeOleoLiters: 0, tubesByDiameter: {}, hasTubulacao: 0 };
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

function buildServiceStats(services, ignoredRows) {
  const result = {};

  for (const svc of services) {
    const type = (svc.serviceType || '').toLowerCase();
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
      const tubFlag = extra['Flushing em tubulação'] || extra.flushingEmTubulacao;
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

function buildDailyReport(r) {
  const sc = r.specialConditions || {};
  const noturnoIds = sc.noturnoDetails?.collaboratorIds;
  const isStandby = sc.standby === true;

  const servicesByType = {};
  const ignoredRows = { volumeOleo: 0, tubulacao: 0 };

  for (const svc of (r.services || [])) {
    const type = (svc.serviceType || '').toLowerCase();
    if (!servicesByType[type]) {
      servicesByType[type] = { serviceCount: 0, volumeOleoLiters: 0, tubesByDiameter: {}, hasTubulacao: 0, items: [] };
    }
    servicesByType[type].serviceCount += 1;

    const item = {
      serviceId: svc.id,
      system: svc.system || null,
      equipmentName: svc.equipment ? `${svc.equipment.code} - ${svc.equipment.name}` : null,
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
      const tubFlag = extra['Flushing em tubulação'] || extra.flushingEmTubulacao;
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

router.get('/projects', requireAuth, asyncHandler(async (req, res) => {
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

  // Validate date range (max 2 years)
  const fromDate = parseLocalDate(fromStr);
  const toDate = parseLocalDate(toStr);
  const diffYears = (toDate - fromDate) / (365.25 * 24 * 3600 * 1000);
  if (diffYears > MAX_YEARS) {
    return res.status(400).json({ error: `Período máximo permitido é de ${MAX_YEARS} anos.` });
  }

  // Resolve project IDs
  const projectWhere = {};
  if (projectStatus === 'active') projectWhere.isActive = true;
  if (projectStatus === 'archived') projectWhere.isActive = false;
  if (segment) projectWhere.clientSegment = segment;
  if (role === 'COORDINATOR') projectWhere.managerOnly = false;

  const rawProjectIds = req.query.projectId;
  if (rawProjectIds && rawProjectIds !== 'all') {
    const ids = Array.isArray(rawProjectIds) ? rawProjectIds : [rawProjectIds];
    projectWhere.id = { in: ids };
  }

  const projects = await prisma.project.findMany({
    where: projectWhere,
    select: { id: true, code: true, name: true, clientSegment: true, clientName: true }
  });

  if (projects.length === 0) {
    return res.json({
      projects: [],
      meta: { from: fromStr, to: toStr, granularity, projectStatus, includedStatuses: ['APPROVED', 'SIGNED'], generatedAt: new Date(), ignoredLegacyRows: { volumeOleo: 0, tubulacao: 0 } },
      summary: summarize([]),
      services: {},
      timeline: [],
      byProject: []
    });
  }

  const projectIds = projects.map(p => p.id);

  const reports = await prisma.report.findMany({
    where: {
      reportType: 'RDO',
      status: { in: ['APPROVED', 'SIGNED'] },
      reportDate: { gte: fromDate, lte: toDate },
      projectId: { in: projectIds }
    },
    include: {
      services: {
        include: { equipment: { select: { code: true, name: true } } }
      }
    },
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
    ignoredRows.volumeOleo += pIgnored.volumeOleo;
    ignoredRows.tubulacao += pIgnored.tubulacao;
    return {
      projectId: p.id,
      code: p.code,
      name: p.name,
      summary: summarize(pReports),
      services: pServices,
      dailyReports: pReports.map(r => buildDailyReport(r))
    };
  });

  // Re-compute globalServices without double-counting (already done above per report)
  res.json({
    projects: projects.map(p => ({ id: p.id, code: p.code, name: p.name, clientName: p.clientName, clientSegment: p.clientSegment })),
    meta: {
      from: fromStr,
      to: toStr,
      granularity,
      projectStatus,
      includedStatuses: ['APPROVED', 'SIGNED'],
      generatedAt: new Date(),
      ignoredLegacyRows: ignoredRows
    },
    summary: globalSummary,
    services: globalServices,
    timeline,
    byProject
  });
}));

// ─── CSV Export ───────────────────────────────────────────────────────────────

router.get('/projects/export', requireAuth, asyncHandler(async (req, res) => {
  const role = req.auth.user.role;
  if (role !== 'MANAGER' && role !== 'COORDINATOR') {
    return res.status(403).json({ error: 'Acesso restrito a gestor e coordenador.' });
  }

  // Reuse the same query by calling internal logic
  const section = req.query.section || 'summary';

  // Build a fake req to delegate to the main route handler (simpler: just inline)
  const now = new Date();
  const defaultFrom = new Date(now);
  defaultFrom.setFullYear(defaultFrom.getFullYear() - 1);

  const fromStr = req.query.from || toLocalDateStr(defaultFrom);
  const toStr = req.query.to || toLocalDateStr(now);
  const projectStatus = ['active', 'archived', 'all'].includes(req.query.projectStatus)
    ? req.query.projectStatus : 'all';
  const segment = req.query.segment || null;

  const fromDate = parseLocalDate(fromStr);
  const toDate = parseLocalDate(toStr);

  const projectWhere = {};
  if (projectStatus === 'active') projectWhere.isActive = true;
  if (projectStatus === 'archived') projectWhere.isActive = false;
  if (segment) projectWhere.clientSegment = segment;
  if (role === 'COORDINATOR') projectWhere.managerOnly = false;

  const rawProjectIds = req.query.projectId;
  if (rawProjectIds && rawProjectIds !== 'all') {
    const ids = Array.isArray(rawProjectIds) ? rawProjectIds : [rawProjectIds];
    projectWhere.id = { in: ids };
  }

  const projects = await prisma.project.findMany({
    where: projectWhere,
    select: { id: true, code: true, name: true, clientName: true, clientSegment: true }
  });

  const reports = projects.length === 0 ? [] : await prisma.report.findMany({
    where: {
      reportType: 'RDO',
      status: { in: ['APPROVED', 'SIGNED'] },
      reportDate: { gte: fromDate, lte: toDate },
      projectId: { in: projects.map(p => p.id) }
    },
    include: { services: { include: { equipment: { select: { code: true, name: true } } } } },
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
      for (const svc of (r.services || [])) {
        const type = (svc.serviceType || '').toLowerCase();
        const dateStr = toLocalDateStr(r.reportDate);
        const eqName = svc.equipment ? `${svc.equipment.code} - ${svc.equipment.name}` : '';
        if (type === 'filtragem') {
          const { liters, ignored } = parseVolumeOleo(svc);
          if (!ignored) {
            res.write(csvRow([dateStr, proj?.code || r.projectId, r.sequenceNumber || '',
              type, svc.system || '', eqName, liters !== null ? liters.toFixed(2) : '', '', '']) + '\n');
          }
        } else {
          const { byDiameter } = parseTubulacoes(svc);
          const entries = Object.entries(byDiameter);
          if (entries.length === 0) {
            res.write(csvRow([dateStr, proj?.code || r.projectId, r.sequenceNumber || '',
              type, svc.system || '', eqName, '', '', '']) + '\n');
          }
          for (const [d, m] of entries) {
            res.write(csvRow([dateStr, proj?.code || r.projectId, r.sequenceNumber || '',
              type, svc.system || '', eqName, '', d, m.toFixed(2)]) + '\n');
          }
        }
      }
    }
  }

  res.end();
}));

export default router;
