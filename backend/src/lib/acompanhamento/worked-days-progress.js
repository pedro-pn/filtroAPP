import { normalizeAdditionalMetricInclusion } from '../../../../shared/modules/additional-proposal-metrics.js';
import { isValidReportDate } from '../../../../shared/modules/report-date.js';
import { reportAllCollaboratorIds } from './report-time.js';
import { scaleProposalValue } from './proposal-percentage.js';

const round = (value, places = 1) => Math.round(value * 10 ** places) / 10 ** places;
const number = value => value == null ? null : Number(value);
const sum = values => values.some(value => value != null)
  ? values.reduce((total, value) => total + (number(value) ?? 0), 0) : null;

export function validateProgressConfiguration(current, patch) {
  const progressModel = patch.progressModel ?? current.progressModel ?? 'QUANTITIES';
  const plannedCollaborators = patch.plannedCollaborators !== undefined
    ? patch.plannedCollaborators : current.plannedCollaborators;
  if (!['QUANTITIES', 'WORKED_DAYS'].includes(progressModel)) throw new Error('Modelo de avanço inválido.');
  if (plannedCollaborators != null && (!Number.isInteger(plannedCollaborators)
    || plannedCollaborators <= 0 || plannedCollaborators > 2147483647)) {
    throw new Error('Informe uma quantidade inteira e positiva de colaboradores planejados.');
  }
  if (progressModel === 'WORKED_DAYS' && plannedCollaborators == null) {
    throw new Error('Informe os colaboradores planejados para usar o avanço por dias trabalhados.');
  }
}

// Lê apenas projetos que escolheram este modelo. As metas continuam ligadas à revisão
// vigente e às métricas habilitadas nos adicionais, sem salvar uma cópia dos dias.
export async function loadWorkedDaysSources(projects, database) {
  const ids = projects.filter(project => project.progressModel === 'WORKED_DAYS').map(project => project.id);
  if (!ids.length) return new Map();
  const [plans, reports] = await Promise.all([
    database.project.findMany({ where: { id: { in: ids } }, select: {
      id: true, proposalPercentage: true,
      budgets: { where: { version: 1 }, select: { source: true, sourceProposalCodBd: true, plannedDays: true } },
      additionalProposals: { where: { active: true }, select: {
        source: true, sourceProposalCodBd: true, metricInclusion: true
      } }
    } }),
    database.report.findMany({ where: { projectId: { in: ids }, reportType: 'RDO', deletedAt: null }, select: {
      id: true, projectId: true, reportType: true, deletedAt: true, reportDate: true,
      specialConditions: true, collaborators: { select: { collaboratorId: true } }
    } })
  ]);
  const selections = plans.flatMap(project => [...project.budgets, ...project.additionalProposals]);
  const codBds = [...new Set(selections.filter(row => row.source !== 'COMERCIAL_APP')
    .map(row => row.sourceProposalCodBd).filter(Number.isInteger))];
  const proposals = codBds.length ? await database.commercialProposal.findMany({
    where: { codBd: { in: codBds } }, select: { codBd: true, plannedDays: true, workedDays: true }
  }) : [];
  const byCodBd = new Map(proposals.map(row => [row.codBd, row]));
  const reportsByProject = new Map(ids.map(id => [id, []]));
  for (const report of reports) reportsByProject.get(report.projectId)?.push(report);
  return new Map(plans.map(project => {
    const budget = project.budgets[0];
    const source = budget?.source === 'COMERCIAL_APP' ? null : byCodBd.get(budget?.sourceProposalCodBd);
    const additionals = project.additionalProposals.filter(row => row.source !== 'COMERCIAL_APP').map(row => ({
      proposal: byCodBd.get(row.sourceProposalCodBd), metrics: normalizeAdditionalMetricInclusion(row.metricInclusion)
    }));
    const workedDays = sum([source?.workedDays, ...additionals.map(row => row.metrics.workedDays ? row.proposal?.workedDays : null)]);
    const plannedDays = sum([budget?.plannedDays ?? source?.plannedDays,
      ...additionals.map(row => row.metrics.plannedDays ? row.proposal?.plannedDays : null)]);
    return [project.id, {
      plannedDays: scaleProposalValue(workedDays ?? plannedDays, project.proposalPercentage),
      reports: reportsByProject.get(project.id) ?? []
    }];
  }));
}

// Cada RDO vale um dia para cada pessoa marcada. A mesma pessoa em dois turnos
// conta uma vez no RDO; dois RDOs na mesma data continuam sendo dois lançamentos.
export function buildWorkedDaysProgress({ plannedDays = null, plannedCollaborators = null, reports = [] } = {}) {
  const plannedPersonDays = plannedDays > 0 && plannedCollaborators > 0 ? plannedDays * plannedCollaborators : null;
  const byDate = new Map();
  const seen = new Set();
  let realizedPersonDays = 0, rdoCount = 0;
  for (const report of reports) {
    if (report.reportType !== 'RDO' || report.deletedAt || seen.has(report.id)) continue;
    seen.add(report.id);
    const people = reportAllCollaboratorIds(report).length;
    realizedPersonDays += people;
    rdoCount++;
    const date = new Date(report.reportDate).toISOString().slice(0, 10);
    if (isValidReportDate(date)) byDate.set(date, (byDate.get(date) ?? 0) + people);
  }
  const percent = realized => plannedPersonDays ? round(realized / plannedPersonDays * 100) : null;
  const progressPct = percent(realizedPersonDays);
  let accumulated = 0;
  const dailyProgressHistory = [...byDate].sort(([a], [b]) => a.localeCompare(b)).map(([date, people]) => {
    accumulated += people;
    return { date, progressPct: percent(accumulated), services: [{
      serviceType: 'DIAS_TRABALHADOS', progressPct: percent(accumulated),
      quantities: [{ unit: 'PESSOA_DIA', realizedQty: accumulated }]
    }] };
  }).filter(point => point.progressPct != null);
  return {
    progress: {
      hasScope: plannedPersonDays != null, progressPct, progressMethod: 'WORKED_DAYS',
      workedDays: { plannedDays, plannedCollaborators, plannedPersonDays, realizedPersonDays, rdoCount,
        equivalentWorkedDays: plannedCollaborators > 0 ? round(realizedPersonDays / plannedCollaborators, 2) : null },
      services: [{ serviceType: 'DIAS_TRABALHADOS', weight: 100, executionPct: progressPct, systems: [{
        systemType: 'DIAS_TRABALHADOS', unit: 'PESSOA_DIA', plannedQty: plannedPersonDays,
        realizedQty: realizedPersonDays, pct: progressPct
      }] }]
    },
    dailyProgressHistory
  };
}
