import { detail as fixture } from '../test/fixtures/project-detail.mjs';
import { apiClient } from '../src/api/client';
import type { ProjectCard, ProjectDetail, ProjectManagementNote } from '../src/api/acompanhamentoComercial';
import { corporateToday, weekStartKey, type WeeklyProgressTarget } from '../../shared/modules/mission-weekly-progress.js';

const today = corporateToday();
const week = weekStartKey(today)!;
const shift = (key: string, days: number) => new Date(new Date(`${key}T12:00:00Z`).getTime() + days * 86400000).toISOString().slice(0, 10);
const asIso = (key: string) => `${key}T12:00:00Z`;
const history = [
  { date: shift(week, -35), progressPct: 0 },
  { date: shift(week, -22), progressPct: 10 },
  { date: shift(week, -15), progressPct: 25 },
  { date: shift(week, -8), progressPct: 37 },
  { date: shift(week, -1), progressPct: 60 },
  { date: today, progressPct: 62.5 },
].map(point => ({ ...point, date: asIso(point.date) }));
const timeFacts: Record<string, { elapsed: number; standby: number; weekdays: number }> = {
  '4069': { elapsed: 29, standby: 4, weekdays: 21 },
  '4072': { elapsed: 24, standby: 6, weekdays: 18 },
  '4081': { elapsed: 35, standby: 2, weekdays: 25 },
};
export const previewTimeFacts = (code: string) => timeFacts[code] ?? timeFacts['4069'];

const baseFixture = structuredClone(fixture) as unknown as ProjectDetail;
const primary: ProjectDetail = {
  ...baseFixture,
  canViewProjectFinancials: true,
  plannedScope: { ...baseFixture.plannedScope!, normalHours: [{ hours: 360 }], overtime: [{ hours: 40 }] },
  requiredWeeklyProgress: { ...baseFixture.requiredWeeklyProgress!, services: [
    ...baseFixture.requiredWeeklyProgress!.services,
    { serviceType: 'FILTRAGEM', executionPct: 62.5, systems: [{ systemType: 'OLEO', unit: 'L', plannedQty: 5000, realizedQty: 3125, remainingQty: 1875, requiredQtyPerWeek: 625, status: 'REQUIRED' }] },
  ] },
  header: { code: '4069', clientName: 'Companhia Industrial de Tratamento de Fluidos', proposalCode: 'PROP-2026-4069', lastRdoDate: asIso(today), segment: 'Papel e celulose' },
  alerts: [{ code: 'COST_ABOVE_PROGRESS', level: 'warn', label: 'Custo consumido acima do avanço do escopo' }],
  avancoMethod: 'RDO',
  diasCorridos: { elapsed: 29, planned: 50, pct: 58 },
  diasTrabalhados: { worked: 20, planned: 36, pct: 55.6 },
  standby: { count: 4, minutes: 1440 },
  progressHistory: history,
  dailyProgressHistory: history.slice(1).map(point => ({ ...point, services: [{ serviceType: 'LIMPEZA_QUIMICA', progressPct: point.progressPct, quantities: [{ unit: 'M', realizedQty: point.progressPct * 10 }] }] })),
  footer: { mobilizationDate: asIso(shift(week, -30)), startDate: asIso(shift(week, -28)), expectedEndDate: asIso(shift(week, 22)), projectedEndByPace: asIso(shift(week, 20)) },
  ultimosDias: Array.from({ length: 7 }, (_, i) => ({ date: asIso(shift(today, i - 6)), status: i === 2 || i === 4 ? 'PARADO' as const : i === 3 ? 'STANDBY' as const : 'TRABALHADO' as const, workedMinutes: i === 2 || i === 4 ? 0 : 480, standbyMinutes: i === 2 || i === 4 ? 480 : i === 3 ? 120 : 0 })),
  equipamentos: fixture.equipamentos.map((equipment, i) => ({ ...equipment, code: `EQ-${100 + i}`, since: asIso(shift(week, -28 + i * 4)) })),
};
const details: Record<string, ProjectDetail> = { p1: primary };
for (const [id, code, name, progress, spent] of [
  ['p2', '4072', 'Terminal de Operações', 42, 57],
  ['p3', '4081', 'Unidade de Óleo e Energia', 86, 81],
] as const) {
  const time = previewTimeFacts(code);
  details[id] = { ...structuredClone(primary), header: { ...primary.header, code, clientName: name, proposalCode: `PROP-2026-${code}` }, avancoPct: progress,
    diasCorridos: { ...primary.diasCorridos, elapsed: time.elapsed }, standby: { ...primary.standby, count: time.standby },
    consumo: { ...primary.consumo, gasto: spent * 1000 - 30000, omie: spent * 1000 - 45000 },
    alerts: id === 'p2' ? [{ code: 'STANDBY', level: 'warn', label: 'Missão em stand-by' }] : [],
    progressHistory: history.map(point => ({ ...point, progressPct: Math.round(point.progressPct / 62.5 * progress * 10) / 10 })),
  };
}
const names = { p1: 'Limpeza do circuito hidráulico', p2: 'Filtragem e teste de pressão', p3: 'Condicionamento do sistema de óleo' };
let cards: ProjectCard[] = Object.entries(details).map(([projectId, d]) => ({
  kind: 'PROJECT', projectId, code: d.header.code, name: names[projectId as keyof typeof names], clientName: d.header.clientName,
  canViewProjectFinancials: true, archived: false, archivedInReports: false, archivedInAcompanhamento: false, reviewed: false, reviewedAt: null, reportArchivedAt: null, category: 'ANDAMENTO',
  workedDays: d.diasTrabalhados.worked, totalDays: d.diasTrabalhados.planned, daysConsumedPct: d.diasTrabalhados.pct,
  workedHours: d.workedHours, progressPct: d.avancoPct, progressMethod: 'RDO', plannedCost: d.consumo.previsto,
  originalPlannedCost: d.consumo.previstoOriginal, additionalPlannedCost: d.consumo.previstoAdicional,
  realizedCost: d.consumo.gasto + (d.maoDeObra.custo ?? 0), costConsumedPct: (d.consumo.gasto + (d.maoDeObra.custo ?? 0)) / d.consumo.previsto! * 100,
  lastDay: { date: asIso(today), status: projectId === 'p2' ? 'PARADO' : 'TRABALHADO' }, collaboratorsCount: d.colaboradores.length,
  startDate: d.footer.startDate, expectedEndDate: d.footer.expectedEndDate, laborCost: d.maoDeObra.custo, laborCostBase: d.maoDeObra.custoBase,
  laborHours: d.maoDeObra.horas, stockCost: d.consumo.estoque, manualCost: d.consumo.manual, equipment: d.equipamentos, alerts: d.alerts,
}));
const weekly: Record<string, WeeklyProgressTarget[]> = Object.fromEntries(Object.keys(details).map(id => [id, [10, 15, 15, 20, 10].map((goal, i) => ({
  id: `${id}-target-${i}`, weekStartDate: shift(week, (i - 4) * 7), plannedPctPoints: goal, revision: 1,
  author: { id: 'preview-manager', name: 'Gestor de acompanhamento' }, createdAt: asIso(shift(week, (i - 4) * 7)),
}))]));
const notes: Record<string, ProjectManagementNote[]> = Object.fromEntries(Object.keys(details).map(id => [id, [{
  id: `${id}-note-1`, projectId: id, content: 'Priorizar a frente do circuito hidráulico e acompanhar o consumo de materiais antes da próxima mobilização.',
  author: { id: 'preview-manager', name: 'Gestor de acompanhamento' }, createdAt: asIso(shift(today, -2)),
}]]));

export function installPreviewAdapter() {
  apiClient.defaults.adapter = async config => {
    const path = config.url ?? '';
    const id = path.match(/\/projetos\/(p\d)/)?.[1] ?? path.match(/\/projeto\/(p\d)/)?.[1] ?? 'p1';
    const d = details[id] ?? primary;
    const payload = typeof config.data === 'string' ? JSON.parse(config.data) : config.data ?? {};
    let data: unknown;
    if (path.endsWith('/projetos-cards')) data = cards;
    else if (path.endsWith('/detalhe')) data = d;
    else if (path.endsWith('/avanco')) data = { hasScope: true, progressPct: d.avancoPct, services: d.plannedScope!.services.map(service => ({
      serviceType: service.serviceType, weight: Number(service.weight), executionPct: d.avancoPct, systems: service.systems.map(system => ({
        ...system, plannedQty: Number(system.quantity), realizedQty: Number(system.quantity) * (d.avancoPct ?? 0) / 100, pct: d.avancoPct,
      })),
    })) };
    else if (path.endsWith('/divisoes')) data = { divisions: [], candidates: [] };
    else if (path.endsWith('/planning-context')) data = { missionId: `m-${id}`, missionVersion: 1, planRevision: 2, calendarRevision: 1, projectId: id, needsReplanning: false,
      dates: { mobilizationDate: d.footer.mobilizationDate, executionStartDate: d.footer.startDate, executionEndDate: d.footer.expectedEndDate, returnDate: null },
      collaborators: d.colaboradores.map((collaborator, i) => ({ id: `c-${i}`, name: collaborator.name, jobRole: { id: `r-${i}`, name: collaborator.role, isActive: true } })) };
    else if (path.endsWith('/metas-semanais')) {
      if (config.method === 'put' || config.method === 'delete') {
        const target = { id: `${id}-target-${Date.now()}`, weekStartDate: payload.weekStartDate, plannedPctPoints: payload.plannedPctPoints ?? null, definition: payload.definition,
          revision: payload.expectedRevision + 1, author: { id: 'preview-manager', name: 'Gestor de acompanhamento' }, createdAt: new Date().toISOString(), ...(config.method === 'delete' ? { isDeleted: true } : {}) };
        weekly[id].push(target); data = target;
      } else data = { targets: weekly[id], defaultReferenceDayHours: 8, progressHistory: d.progressHistory, serviceHistory: [] };
    } else if (path.endsWith('/notas-gestao')) {
      if (config.method === 'post') { const note = { id: `${id}-note-${Date.now()}`, projectId: id, content: payload.content, author: { id: 'preview-manager', name: 'Gestor de acompanhamento' }, createdAt: new Date().toISOString() }; notes[id].push(note); data = note; }
      else data = notes[id];
    } else if (path.endsWith('/desvios')) data = [{ id: `dev-${id}`, number: 'DES-2026-001', nature: { name: 'Atraso na liberação de frente' }, eventDate: asIso(shift(today, -2)), impact: 'MEDIO', status: 'EM_ACAO', recurrent: false, occurrences12m: 1, disposition: 'TRATAR', origin: 'Execução em campo', description: 'Frente liberada após o horário planejado.', definedAction: 'Reprogramar a sequência com a operação do cliente.', actionOwner: 'Gestor da missão', actionDeadline: asIso(shift(today, 3)) }];
    else if (path.endsWith('/faturamentos')) data = { invoices: [{ id: 'nf1', type: 'NFSE', number: '1234', series: '1', issuedAt: asIso(shift(today, -4)), amount: 130000, customerName: d.header.clientName, customerCnpj: null, customerDiffers: false, receiptStatus: 'PARTIAL', installmentCount: 2, project: { id, code: d.header.code, name: d.header.clientName } }], total: 130000, count: 1, projectCount: 1, linkedProjectCount: 1, lastSyncedAt: asIso(today), syncStatus: 'READY' };
    else if (path.endsWith('/standby-historico')) data = { project: { id, code: d.header.code, name: d.header.clientName }, entries: Array.from({ length: d.standby.count }, (_, i) => ({ date: shift(today, -i - 2), standbyMinutes: 360, collaboratorCount: 2, reason: 'Aguardando liberação da frente pelo cliente' })) };
    else if (path.endsWith('/correcoes-realizado')) data = { rows: [] };
    else if (path.endsWith('/romaneios')) data = { romaneios: [] };
    else if (path.endsWith('/escopo-previsto')) data = d.plannedScope;
    else if (path.endsWith('/revisoes')) data = { proposalCode: d.header.proposalCode, currentCodBd: 1, proposalPercentage: 100, startDate: d.footer.startDate, mobilizationDate: d.footer.mobilizationDate, laborCollaborators: [], laborCollaboratorIds: [], additionalProposals: [], revisions: [{ codBd: 1, codProp: Number(d.header.code), nRev: 1, clientName: d.header.clientName, plannedDays: 50, workedDays: 36, plannedCost: 100000, salePrice: 150000, expectedProfit: 37500, taxes: 12500, approvedAt: d.footer.startDate }] };
    else if (/\/rdo\/reports$/.test(path)) data = { items: [], pagination: { page: 1, pageSize: 30, total: 0, totalPages: 1 }, groupTotals: [] };
    else if (/\/colaboradores/.test(path) || path.endsWith('/job-roles')) data = [];
    else if (/\/custos-manuais/.test(path) && config.method === 'post') { const cost = { id: `cost-${Date.now()}`, projectId: id, projectCode: d.header.code, description: payload.description, amount: payload.amount, costDate: payload.costDate ?? today, note: payload.note, createdAt: new Date().toISOString(), createdBy: { id: 'preview-manager', name: 'Gestor de acompanhamento' } }; d.manualCosts!.push(cost); data = cost; }
    else if (/\/custos-manuais\//.test(path) && config.method === 'delete') { d.manualCosts = d.manualCosts!.filter(cost => cost.id !== path.split('/').pop()); data = {}; }
    else if (path.endsWith('/nome-card')) { cards = cards.map(card => card.projectId === id ? { ...card, cardName: payload.cardName } : card); data = { projectId: id, cardName: payload.cardName }; }
    else if (path.endsWith('/acompanhamento-status')) { cards = cards.map(card => card.projectId === id ? { ...card, archived: payload.archived ?? card.archived, archivedInAcompanhamento: payload.archived ?? card.archived, reviewed: payload.reviewed ?? card.reviewed, category: payload.archived ? 'ARQUIVADO' : 'ANDAMENTO' } : card); data = {}; }
    else if (config.method !== 'get') data = {};
    else throw new Error(`Consulta ainda não incluída nos dados ilustrativos: ${path}`);
    return { config, data: structuredClone(data), status: 200, statusText: 'OK', headers: {} };
  };
}
