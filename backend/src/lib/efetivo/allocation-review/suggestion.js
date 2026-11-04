import { createHash } from 'node:crypto';

/*
 * Regra pura da sugestão automática de um dia (feature 037, FR-004/FR-005).
 *
 * Ordem de prioridade:
 *   1. ausência cadastrada;
 *   2. ajuste manual já existente (decisão humana anterior, PontoDayProjectOverride);
 *   3. RDO do dia;
 *   4. etiqueta "em viagem": viagem para o projeto de onde ele vem ou para onde vai — etiqueta de
 *      projeto real, Efetivo do dia ou o projeto dos dias vizinhos. Nunca para a Sede;
 *   5. etiqueta de projeto do ponto (centros de custo da Sede contam como Sede, não projeto);
 *   6. etiqueta de Sede → Sede; planejamento do Efetivo quando houve ponto; ponto sem projeto → Sede;
 *   7. sem ponto: fim de semana/feriado → Folga; Efetivo planejado → projeto (só o planejamento
 *      indica, fica pendente para confirmar); senão → Sem informação.
 *
 * Cada fonte recebe um indicador: confirms | diverges | none.
 */

export const SOURCE_STATE = Object.freeze({ CONFIRMS: 'confirms', DIVERGES: 'diverges', NONE: 'none' });
export const PENDING_REASON = Object.freeze({
  DIVERGENCE: 'DIVERGENCE',
  NO_INFORMATION: 'NO_INFORMATION',
  PLAN_ONLY: 'PLAN_ONLY'
});

const ABSENCE_KIND = {
  FERIAS: 'FERIAS',
  FOLGA: 'FOLGA',
  AFASTAMENTO: 'AFASTAMENTO',
  FADIGA_OFFSHORE: 'AFASTAMENTO',
  ASO: 'AFASTAMENTO',
  TREINAMENTO: 'TREINAMENTO'
};

const IDLE_KINDS = new Set(['FOLGA', 'FERIAS', 'AFASTAMENTO', 'TREINAMENTO']);
const PROJECT_KINDS = new Set(['PROJECT', 'TRAVEL']);

function uniqueSorted(values = []) {
  return [...new Set((values || []).filter(Boolean))].sort();
}

function intersects(left = [], right = []) {
  const set = new Set(left);
  return right.some(item => set.has(item));
}

function totalHours(ponto) {
  if (!ponto) return 0;
  return (Number(ponto.normalHours) || 0) + (Number(ponto.he70Hours) || 0) + (Number(ponto.he100Hours) || 0);
}

export function absenceKind(type) {
  return ABSENCE_KIND[type] || null;
}

export function sameAllocation(left, right) {
  if (!left || !right || left.kind !== right.kind) return false;
  const a = uniqueSorted(left.projectIds);
  const b = uniqueSorted(right.projectIds);
  return a.length === b.length && a.every((item, index) => item === b[index]);
}

/*
 * input = {
 *   isWeekend, isHoliday,
 *   ponto: { normalHours, he70Hours, he100Hours, tags[], tagProjectIds[], travel, sedeTag } | null,
 *     (tagProjectIds já sem os centros de custo da Sede; sedeTag = alguma etiqueta apontava para a Sede)
 *   rdoProjectIds[], efetivoProjectIds[], manualProjectIds[],
 *   neighborProjects: { before: { distance, projectIds[] } | null, after: { distance, projectIds[] } | null },
 *   absence: { type, id } | null
 * }
 */
export function suggestDay(input = {}) {
  const ponto = input.ponto && (totalHours(input.ponto) > 0 || (input.ponto.tags || []).length > 0) ? input.ponto : null;
  const worked = totalHours(ponto) > 0;
  const rdoProjectIds = uniqueSorted(input.rdoProjectIds);
  const efetivoProjectIds = uniqueSorted(input.efetivoProjectIds);
  const manualProjectIds = uniqueSorted(input.manualProjectIds);
  const tagProjectIds = uniqueSorted(ponto?.tagProjectIds);
  const travel = Boolean(ponto?.travel);
  const sedeTag = Boolean(ponto?.sedeTag);
  const restDay = Boolean(input.isWeekend || input.isHoliday);
  const absence = input.absence?.type ? input.absence : null;
  const reasons = [];
  let suggestion;
  let planOnly = false;
  let travelNeedsReview = false;

  if (absence && absenceKind(absence.type)) {
    suggestion = { kind: absenceKind(absence.type), projectIds: [] };
  } else if (manualProjectIds.length) {
    suggestion = { kind: 'PROJECT', projectIds: manualProjectIds };
  } else if (rdoProjectIds.length) {
    suggestion = { kind: 'PROJECT', projectIds: rdoProjectIds };
  } else if (travel) {
    const trip = travelDestination({ tagProjectIds, efetivoProjectIds, neighbors: input.neighborProjects });
    if (trip.projectId) {
      suggestion = { kind: 'TRAVEL', projectIds: [trip.projectId] };
      if (trip.ambiguous) {
        travelNeedsReview = true;
        reasons.push('Viagem entre dois projetos diferentes: confirme para qual projeto vai o custo.');
      }
    } else {
      suggestion = { kind: 'NONE', projectIds: [] };
      reasons.push('O ponto indica viagem, mas não há projeto de origem ou destino nos dias próximos.');
    }
  } else if (tagProjectIds.length) {
    suggestion = { kind: 'PROJECT', projectIds: tagProjectIds };
  } else if (worked && sedeTag) {
    suggestion = { kind: 'SEDE', projectIds: [] };
  } else if (worked && efetivoProjectIds.length) {
    suggestion = { kind: 'PROJECT', projectIds: efetivoProjectIds };
  } else if (worked) {
    suggestion = { kind: 'SEDE', projectIds: [] };
  } else if (restDay) {
    suggestion = { kind: 'FOLGA', projectIds: [] };
  } else if (efetivoProjectIds.length) {
    suggestion = { kind: 'PROJECT', projectIds: efetivoProjectIds };
    planOnly = true;
    reasons.push('Só o planejamento do Efetivo indica onde ele esteve: não há ponto nem RDO no dia.');
  } else {
    suggestion = { kind: 'NONE', projectIds: [] };
    reasons.push('Dia útil sem ponto, sem RDO e sem ausência cadastrada.');
  }

  const sugProjects = suggestion.projectIds;
  const sugIsProject = PROJECT_KINDS.has(suggestion.kind);

  // Ponto
  let pontoState = SOURCE_STATE.NONE;
  if (ponto) {
    if (tagProjectIds.length) {
      pontoState = sugIsProject && intersects(sugProjects, tagProjectIds) ? SOURCE_STATE.CONFIRMS : SOURCE_STATE.DIVERGES;
    } else if (travel) {
      pontoState = suggestion.kind === 'TRAVEL' || (sugIsProject && !rdoProjectIds.length) ? SOURCE_STATE.CONFIRMS : SOURCE_STATE.DIVERGES;
    } else if (sedeTag) {
      pontoState = suggestion.kind === 'SEDE' ? SOURCE_STATE.CONFIRMS : SOURCE_STATE.DIVERGES;
    } else if (worked) {
      pontoState = IDLE_KINDS.has(suggestion.kind) ? SOURCE_STATE.DIVERGES : SOURCE_STATE.CONFIRMS;
    }
  } else if (IDLE_KINDS.has(suggestion.kind)) {
    pontoState = SOURCE_STATE.CONFIRMS;
  }
  if (pontoState === SOURCE_STATE.DIVERGES) {
    reasons.push(tagProjectIds.length
      ? 'A etiqueta do ponto aponta para outro projeto.'
      : sedeTag ? 'A etiqueta do ponto indica Sede.' : 'Há ponto batido num dia de ausência ou folga.');
  }

  // RDO
  let rdoState = SOURCE_STATE.NONE;
  if (rdoProjectIds.length) {
    rdoState = sugIsProject && rdoProjectIds.every(id => sugProjects.includes(id)) ? SOURCE_STATE.CONFIRMS : SOURCE_STATE.DIVERGES;
    if (rdoState === SOURCE_STATE.DIVERGES) reasons.push('O colaborador consta em RDO de outro projeto.');
  }

  // Efetivo: só é avaliado quando há evidência de trabalho no dia ou quando é a própria sugestão.
  let efetivoState = SOURCE_STATE.NONE;
  if (efetivoProjectIds.length && (worked || rdoProjectIds.length || planOnly || suggestion.kind === 'TRAVEL')) {
    // Em viagem, o Efetivo do dia só diverge se apontar para um projeto diferente do destino.
    efetivoState = sugIsProject && intersects(sugProjects, efetivoProjectIds) ? SOURCE_STATE.CONFIRMS : SOURCE_STATE.DIVERGES;
    if (efetivoState === SOURCE_STATE.DIVERGES) reasons.push('O planejamento do Efetivo previa outra alocação.');
  }

  const divergence = suggestion.kind !== 'NONE'
    && [pontoState, rdoState, efetivoState].includes(SOURCE_STATE.DIVERGES);
  let pendingReason = null;
  if (suggestion.kind === 'NONE') pendingReason = PENDING_REASON.NO_INFORMATION;
  else if (divergence || travelNeedsReview) pendingReason = PENDING_REASON.DIVERGENCE;
  else if (planOnly) pendingReason = PENDING_REASON.PLAN_ONLY;

  return {
    suggestion,
    sources: {
      ponto: { state: pontoState },
      rdo: { state: rdoState },
      efetivo: { state: efetivoState }
    },
    pending: pendingReason !== null,
    pendingReason,
    reasons: [...new Set(reasons)]
  };
}

/*
 * Destino de um dia "em viagem": etiqueta de projeto real do próprio dia, Efetivo do dia (missão
 * única) ou o projeto do dia vizinho mais próximo com evidência (antes = voltando, depois = indo).
 * Empate entre vizinhos com projetos diferentes: usa o de depois (ida) e pede confirmação.
 */
export function travelDestination({ tagProjectIds = [], efetivoProjectIds = [], neighbors = null } = {}) {
  if (tagProjectIds.length === 1) return { projectId: tagProjectIds[0], ambiguous: false };
  if (efetivoProjectIds.length === 1) return { projectId: efetivoProjectIds[0], ambiguous: false };
  const before = neighbors?.before?.projectIds?.length === 1 ? neighbors.before : null;
  const after = neighbors?.after?.projectIds?.length === 1 ? neighbors.after : null;
  if (before && after) {
    if (before.projectIds[0] === after.projectIds[0]) return { projectId: before.projectIds[0], ambiguous: false };
    if (before.distance < after.distance) return { projectId: before.projectIds[0], ambiguous: false };
    if (after.distance < before.distance) return { projectId: after.projectIds[0], ambiguous: false };
    return { projectId: after.projectIds[0], ambiguous: true };
  }
  if (after) return { projectId: after.projectIds[0], ambiguous: false };
  if (before) return { projectId: before.projectIds[0], ambiguous: false };
  return { projectId: null, ambiguous: false };
}

// Hash curto das fontes do dia: muda quando ponto, RDO, Efetivo, ajuste manual ou ausência mudam.
export function sourceFingerprint(input = {}) {
  const payload = JSON.stringify({
    t: uniqueSorted(input.ponto?.tags),
    tp: uniqueSorted(input.ponto?.tagProjectIds),
    tv: Boolean(input.ponto?.travel),
    sd: Boolean(input.ponto?.sedeTag),
    h: Math.round(totalHours(input.ponto) * 100) / 100,
    r: uniqueSorted(input.rdoProjectIds),
    e: uniqueSorted(input.efetivoProjectIds),
    m: uniqueSorted(input.manualProjectIds),
    a: input.absence?.type || null
  });
  return createHash('sha1').update(payload).digest('hex').slice(0, 16);
}
