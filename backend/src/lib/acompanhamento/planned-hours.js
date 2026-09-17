import { createHash } from 'node:crypto';
import prisma from '../prisma.js';

export const PLANNED_HOURS_DIVERGENCE_PCT = 10;
const NORMAL_FIELDS = ['hh_util_diurno', 'hh_util_noturno'];
const EXTRA_FIELDS = ['hh_util_extra_diurno', 'hh_util_extra_noturno', 'hh_sab_diurno', 'hh_sab_noturno', 'hh_dom_diurno', 'hh_dom_noturno'];
const HOUR_FIELDS = ['hh_total', ...NORMAL_FIELDS, ...EXTRA_FIELDS];
const round = value => Math.round((value + Number.EPSILON) * 100) / 100;
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

function number(value) {
  if (value == null || typeof value === 'boolean' || String(value).trim() === '') return null;
  const text = String(value).trim();
  const n = Number(text.includes(',') ? text.replace(/\./g, '').replace(',', '.') : text);
  return Number.isFinite(n) && n >= 0 ? round(n) : null;
}

// Access stores person-hours, already summed across the crew. Weekends and explicit
// overtime are extra hours; normal hours are the two weekday shifts.
export function readCommercialHours(rawRow = {}) {
  const values = Object.fromEntries(HOUR_FIELDS.map(key => [key, number(rawRow?.[key])]));
  const total = values.hh_total;
  if (total == null || total === 0) return { status: 'MISSING', values };
  if ([...NORMAL_FIELDS, ...EXTRA_FIELDS].some(key => values[key] == null)) {
    return { status: 'INCOMPLETE', values };
  }
  const normal = round(NORMAL_FIELDS.reduce((sum, key) => sum + values[key], 0));
  const overtime = round(EXTRA_FIELDS.reduce((sum, key) => sum + values[key], 0));
  if (Math.abs(round(normal + overtime) - total) > 0.01) return { status: 'INCONSISTENT', values };
  return { status: 'AVAILABLE', values, normal, overtime, total };
}

const sumHours = rows => round(rows.reduce((sum, row) => sum + (number(row.hours) ?? 0), 0));
const canonicalRows = rows => rows.map(row => [row.jobRoleId ?? null, row.roleName ?? null, number(row.hours)])
  .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));

export function resolvePlannedHours({ normalHours = [], overtime = [], sources = [], resolution = null } = {}) {
  const parsed = sources.map(source => ({ ...source, parsed: readCommercialHours(source.rawRow) }))
    .sort((a, b) => a.codBd - b.codBd);
  const manual = { normal: sumHours(normalHours), overtime: sumHours(overtime) };
  manual.total = round(manual.normal + manual.overtime);
  const hasManual = normalHours.length > 0 || overtime.length > 0;
  const complete = parsed.length > 0 && parsed.every(source => source.parsed.status === 'AVAILABLE');
  const commercial = complete ? parsed.reduce((sum, source) => ({
    normal: round(sum.normal + source.parsed.normal), overtime: round(sum.overtime + source.parsed.overtime),
    total: round(sum.total + source.parsed.total)
  }), { normal: 0, overtime: 0, total: 0 }) : null;
  const basis = hash({ policy: 1, threshold: PLANNED_HOURS_DIVERGENCE_PCT,
    sources: parsed.map(source => [source.codBd, source.codProp, source.nRev, source.parsed.values]),
    normal: canonicalRows(normalHours), overtime: canonicalRows(overtime) });
  const decision = resolution?.basis === basis ? resolution.choice : null;
  const differences = commercial ? ['normal', 'overtime', 'total'].map(kind => ({
    kind, hours: round(manual[kind] - commercial[kind]),
    percent: commercial[kind] > 0 ? round(Math.abs(manual[kind] - commercial[kind]) / commercial[kind] * 100) : null,
    significant: Math.abs(manual[kind] - commercial[kind]) > Math.max(0.01, commercial[kind] * PLANNED_HOURS_DIVERGENCE_PCT / 100) + 1e-8
  })) : [];
  const pending = hasManual && differences.some(item => item.significant) && !decision;
  const source = commercial && !pending && decision !== 'MANUAL' ? 'COMMERCIAL' : hasManual ? 'MANUAL' : 'NONE';
  const issues = parsed.flatMap(item => {
    const label = `Proposta ${item.codProp ?? item.codBd}, rev. ${item.nRev ?? 0}`;
    if (item.parsed.status === 'INCONSISTENT') return [`${label}: o total de horas difere da soma dos componentes.`];
    if (item.parsed.status === 'INCOMPLETE') return [`${label}: falta o detalhamento de horas normais e extras.`];
    if (item.parsed.status === 'MISSING' && parsed.some(s => s.parsed.status !== 'MISSING')) return [`${label}: sem horas previstas. O conjunto de propostas está incompleto.`];
    return [];
  });
  return {
    normalHours: source === 'COMMERCIAL' ? [{ roleName: 'Comercial', hours: commercial.normal, collaboratorCount: 1 }] : normalHours,
    overtime: source === 'COMMERCIAL' ? [{ roleName: 'Comercial', hours: commercial.overtime, collaboratorCount: 1 }] : overtime,
    hoursPlan: {
      source, pending, thresholdPct: PLANNED_HOURS_DIVERGENCE_PCT, manual: hasManual ? manual : null, commercial,
      differences: hasManual ? differences : [], issues, decision,
      resolvedAt: decision ? resolution.resolvedAt : null,
      fingerprint: hash({ basis, resolution }),
      proposals: parsed.map(item => ({ codBd: item.codBd, codProp: item.codProp, nRev: item.nRev, status: item.parsed.status }))
    },
    basis
  };
}

// Two bounded queries for all requested projects; used by the schedule, cards and
// detail so a newly imported proposal changes every view without copying over manual rows.
export async function loadPlannedHours(projectIds, client = prisma) {
  if (!projectIds.length) return new Map();
  const projects = await client.project.findMany({
    where: { id: { in: projectIds }, deletedAt: null },
    select: {
      id: true, plannedHoursResolution: true,
      plannedNormalHours: { orderBy: [{ order: 'asc' }, { createdAt: 'asc' }], include: { jobRole: { select: { name: true } } } },
      plannedOvertime: { orderBy: [{ order: 'asc' }, { createdAt: 'asc' }], include: { jobRole: { select: { name: true } } } },
      budgets: { where: { version: 1 }, select: { sourceProposalCodBd: true } },
      additionalProposals: { select: { sourceProposalCodBd: true } }
    }
  });
  const selections = project => [...new Set([...project.budgets, ...project.additionalProposals].map(row => row.sourceProposalCodBd).filter(Number.isInteger))];
  const codBds = [...new Set(projects.flatMap(selections))];
  const proposals = codBds.length ? await client.commercialProposal.findMany({
    where: { codBd: { in: codBds } }, select: { codBd: true, codProp: true, nRev: true, rawRow: true }
  }) : [];
  const byCodBd = new Map(proposals.map(row => [row.codBd, row]));
  const hoursRow = row => ({ ...row, roleName: row.roleName ?? row.jobRole?.name ?? null });
  return new Map(projects.map(project => [project.id, resolvePlannedHours({
    normalHours: project.plannedNormalHours.map(hoursRow), overtime: project.plannedOvertime.map(hoursRow),
    sources: selections(project).map(codBd => byCodBd.get(codBd) ?? { codBd }), resolution: project.plannedHoursResolution
  })]));
}

export function plannedHoursAlerts(plan) {
  return plan?.pending ? [{ code: 'HORAS_PREVISTAS', level: 'warn', label: 'Horas previstas divergentes — resolver no cronograma' }] : [];
}

export function plannedHoursConflict(message = 'As horas ou a proposta mudaram. Atualize o cronograma e confira os valores novamente.') {
  return Object.assign(new Error(message), { status: 409 });
}

export async function resolvePlannedHoursDecision(projectId, { choice, fingerprint }, userId, client = prisma) {
  await client.$transaction(async tx => {
    const current = (await loadPlannedHours([projectId], tx)).get(projectId);
    if (!current) throw Object.assign(new Error('Projeto não encontrado.'), { status: 404 });
    if (current.hoursPlan.fingerprint !== fingerprint) throw plannedHoursConflict();
    if (!current.hoursPlan.commercial || !['COMMERCIAL', 'MANUAL'].includes(choice)) throw plannedHoursConflict('Não há horas comerciais válidas para esta decisão.');
    if (choice === 'MANUAL' && !current.hoursPlan.manual) throw plannedHoursConflict('Cadastre as horas manuais antes de confirmá-las.');
    await tx.project.update({ where: { id: projectId }, data: { plannedHoursResolution: {
      basis: current.basis, choice, resolvedByUserId: userId, resolvedAt: new Date().toISOString(),
      manual: current.hoursPlan.manual, commercial: current.hoursPlan.commercial
    } } });
  }, { isolationLevel: 'Serializable' });
}
