/*
 * Avanço físico do projeto (módulo Acompanhamento) — método D-3 "RDO ponderado por serviço".
 *
 * Previsto: escopo vendido (ProjectPlannedService + systems), com um peso por serviço.
 * Realizado: lido dos RDOs (ReportService.extraData), somando por serviço/sistema:
 *   - Tubulação (m): Σ tubes[].c convertendo cm→m
 *   - Óleo (L):      Σ volumeOleo convertendo mL→L
 *
 * avanço_% = Σ(peso_s × execução_s) ÷ Σ(peso_s)
 *   execução_s = média das execuções dos sistemas do serviço; execução_sistema = min(real/prev, 1).
 *
 * Contabilização: só entram serviços **finalizados** (`ReportService.finalized`). Um serviço que dura
 * vários dias aparece em vários RDOs, mas é finalizado uma única vez (as ocorrências em aberto são
 * "em andamento" — ver ongoingServices no front); assim cada atividade conta uma vez, no fechamento.
 */

import prisma from './prisma.js';

// Normaliza o serviceType do RDO (vários formatos: 'limpeza', 'LIMPEZA', 'Limpeza química'...) para
// o código canônico usado no escopo previsto. Retorna null quando não há equivalente no previsto.
export function normalizeRdoServiceType(raw) {
  const key = String(raw ?? '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // remove acentos
    .toLowerCase().replace(/[^a-z]/g, ''); // só letras
  if (!key) return null;
  if (key.startsWith('limpezaquimica') || key === 'limpeza') return 'LIMPEZA_QUIMICA';
  if (key.startsWith('testedepressao') || key === 'pressao') return 'TESTE_PRESSAO';
  if (key.startsWith('flushing')) return 'FLUSHING';
  if (key.startsWith('filtragem') || key.startsWith('unidadedefiltragem')) return 'FILTRAGEM';
  return null; // mecânica, inibição etc. não têm previsto — fora do avanço
}

// Parser numérico tolerante (os campos do RDO vêm como texto: "1.234,56", "1234.56", "50").
function num(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  let text = String(value).trim().replace(/[^\d,.-]/g, '');
  if (!text) return null;
  text = text.replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.');
  const n = Number.parseFloat(text);
  return Number.isFinite(n) ? n : null;
}

// Um serviço só conta no realizado quando finalizado. Espelha serviceFinalized do front
// (utils/ongoingServices.ts): coluna booleana ou o campo textual em extraData.
export function isServiceFinalized(service) {
  if (typeof service?.finalized === 'boolean') return service.finalized;
  const stored = service?.extraData?.['Serviço finalizado?'];
  return typeof stored === 'string' && ['sim', 'true', 'finalizado'].includes(stored.trim().toLowerCase());
}

// Extrai o realizado comparável de um ReportService.extraData: tubulação (m) e óleo (L).
export function realizedFromExtraData(extraData) {
  const data = extraData && typeof extraData === 'object' ? extraData : {};
  let tubulacaoM = 0;
  const tubes = Array.isArray(data.tubes) ? data.tubes : [];
  for (const tube of tubes) {
    const c = num(tube?.c);
    if (c === null) continue;
    tubulacaoM += (tube?.lengthUnit === 'cm') ? c / 100 : c;
  }
  let oleoL = 0;
  const vol = num(data.volumeOleo);
  if (vol !== null) oleoL += (data.volumeOleoUnit === 'mL') ? vol / 1000 : vol;

  return { tubulacaoM, oleoL };
}

// Valor realizado de um sistema (mesma unidade do previsto: TUBULACAO=m, OLEO=L).
function realizedForSystem(systemType, realized) {
  if (systemType === 'TUBULACAO') return realized.tubulacaoM;
  if (systemType === 'OLEO') return realized.oleoL;
  return 0;
}

function round(value, decimals = 1) {
  if (value === null || value === undefined) return null;
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}

// Monta o resultado de avanço de um projeto a partir do previsto e do realizado já agregado.
// realizedByType: Map<serviceTypeCanônico, {tubulacaoM, oleoL}>.
export function buildProgress(plannedServices, realizedByType) {
  const services = plannedServices.map(svc => {
    const realized = realizedByType.get(normalizeRdoServiceType(svc.serviceType) ?? svc.serviceType)
      ?? { tubulacaoM: 0, oleoL: 0 };
    const systems = svc.systems.map(sys => {
      const planned = sys.quantity != null ? Number(sys.quantity) : null;
      const real = realizedForSystem(sys.systemType, realized);
      const pct = planned && planned > 0 ? Math.min(real / planned, 1) * 100 : null;
      return {
        systemType: sys.systemType,
        unit: sys.unit,
        plannedQty: planned,
        realizedQty: round(real, 2),
        pct: round(pct)
      };
    });
    const measurable = systems.filter(s => s.pct !== null);
    const executionPct = measurable.length
      ? measurable.reduce((sum, s) => sum + s.pct, 0) / measurable.length
      : null;
    return {
      serviceType: svc.serviceType,
      weight: Number(svc.weight ?? 1),
      executionPct: round(executionPct),
      systems
    };
  });

  const weighted = services.filter(s => s.executionPct !== null);
  const totalWeight = weighted.reduce((sum, s) => sum + s.weight, 0);
  const progressPct = totalWeight > 0
    ? round(weighted.reduce((sum, s) => sum + s.weight * s.executionPct, 0) / totalWeight)
    : null;

  return {
    hasScope: services.some(s => s.systems.some(sys => sys.plannedQty && sys.plannedQty > 0)),
    progressPct,
    services
  };
}

// Agrega o realizado dos RDOs (por projeto → por serviço canônico) para um conjunto de projetos.
async function aggregateRealized(projectIds) {
  const byProject = new Map(); // projectId -> Map<serviceType, {tubulacaoM, oleoL}>
  if (projectIds.length === 0) return byProject;

  const services = await prisma.reportService.findMany({
    where: { report: { projectId: { in: projectIds }, deletedAt: null } },
    select: { finalized: true, serviceType: true, extraData: true, report: { select: { projectId: true } } }
  });

  for (const svc of services) {
    if (!isServiceFinalized(svc)) continue; // só serviços finalizados entram no avanço
    const canonical = normalizeRdoServiceType(svc.serviceType);
    if (!canonical) continue;
    const projectId = svc.report?.projectId;
    if (!projectId) continue;
    if (!byProject.has(projectId)) byProject.set(projectId, new Map());
    const byType = byProject.get(projectId);
    const acc = byType.get(canonical) ?? { tubulacaoM: 0, oleoL: 0 };
    const r = realizedFromExtraData(svc.extraData);
    acc.tubulacaoM += r.tubulacaoM;
    acc.oleoL += r.oleoL;
    byType.set(canonical, acc);
  }
  return byProject;
}

// Avanço de vários projetos de uma vez (usado no dashboard). Retorna Map<projectId, progress>.
export async function computeProgressForProjects(projectIds) {
  const result = new Map();
  if (!projectIds || projectIds.length === 0) return result;

  const plannedServices = await prisma.projectPlannedService.findMany({
    where: { projectId: { in: projectIds } },
    orderBy: [{ order: 'asc' }],
    include: { systems: { orderBy: [{ order: 'asc' }] } }
  });

  const byProject = new Map();
  for (const svc of plannedServices) {
    if (!byProject.has(svc.projectId)) byProject.set(svc.projectId, []);
    byProject.get(svc.projectId).push(svc);
  }

  const realized = await aggregateRealized([...byProject.keys()]);

  for (const [projectId, services] of byProject) {
    result.set(projectId, buildProgress(services, realized.get(projectId) ?? new Map()));
  }
  return result;
}

// Avanço detalhado de um projeto (endpoint do modal do cronograma).
export async function computeProjectProgress(projectId) {
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true } });
  if (!project) throw new Error('Projeto não encontrado.');
  const map = await computeProgressForProjects([projectId]);
  return map.get(projectId) ?? { hasScope: false, progressPct: null, services: [] };
}
