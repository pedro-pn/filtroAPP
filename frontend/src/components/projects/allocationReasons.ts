// Rótulos dos motivos de decisão da alocação diária do ponto (backend: buildDailyProjectWeights).
const ALLOCATION_REASON_LABELS: Record<string, string> = {
  MANUAL_OVERRIDE: 'Seleção manual',
  MANUAL_SHARED_OVERRIDE: 'Seleção manual compartilhada',
  SINGLE_TAG: 'Etiqueta do Ponto Mais',
  SINGLE_CONFIRMED_TAG: 'Etiqueta confirmada pelo RDO',
  MULTIPLE_CONFIRMED_TAGS: 'Rateio entre RDOs confirmados',
  SINGLE_RDO_OVERRIDES_TAG: 'RDO prevaleceu sobre a etiqueta',
  SINGLE_RDO_FALLBACK: 'RDO do dia',
  MERGED_GROUP_SINGLE_RDO_FALLBACK: 'Único RDO do agrupamento',
  CONSOLIDATE_PRIMARY: 'Consolidado no projeto principal',
  SHARED_EXECUTION_ACCOUNTING: 'Execução compartilhada',
  SHARED_EXECUTION_ANALYTICAL: 'Execução compartilhada',
  MOBILIZATION_FUTURE_RDO: 'Mobilização com RDO posterior',
  MOBILIZATION_CONSOLIDATE_PRIMARY: 'Mobilização consolidada no principal',
  MOBILIZATION_SHARED_ACCOUNTING: 'Mobilização compartilhada',
  MOBILIZATION_SHARED_ANALYTICAL: 'Mobilização compartilhada',
  TAG_RDO_CONFLICT: 'Conflito entre etiqueta e RDO',
  UNCONFIRMED_MULTIPLE_TAGS: 'Várias etiquetas sem confirmação de RDO',
  AMBIGUOUS_WITHOUT_TAGS: 'Vários RDOs e nenhuma etiqueta',
  MOBILIZATION_RDO_AMBIGUOUS: 'Mobilização com vários candidatos',
  EFFECTIVE_PROJECT_TAG_TRAVEL: 'Viagem confirmada pelo Efetivo e pela etiqueta',
  EFFECTIVE_ALLOCATION_TRAVEL: 'Viagem confirmada pelo Efetivo',
  EFFECTIVE_ALLOCATION_AMBIGUOUS: 'Mais de uma alocação no Efetivo',
  EFFECTIVE_TAG_CONFLICT: 'Etiqueta diverge do Efetivo',
  EFFECTIVE_PERIOD_MISMATCH: 'Dia fora do período individual do Efetivo',
  RDO_PERIOD_MISMATCH: 'RDO histórico sem período compatível',
  SCHEDULE_PROJECT_TAG_TRAVEL: 'Viagem legada confirmada pela etiqueta e pelo RDO',
  SCHEDULE_TRAVEL_TAG: 'Viagem legada confirmada pelo RDO',
  SCHEDULE_WINDOW: 'Janela legada do projeto',
  SCHEDULE_WINDOW_AMBIGUOUS: 'Janelas legadas conflitantes',
  NO_PROJECT_EVIDENCE: 'Sem RDO ou Efetivo que confirme a marcação',
  NO_RDO_EVIDENCE: 'Sem evidência de projeto',
  NO_POINT_HOURS: 'Sem horas no ponto'
};

export function allocationReasonLabel(reason: string): string {
  return ALLOCATION_REASON_LABELS[reason] ?? reason;
}

export function fmtHours(value: number): string {
  return `${value.toFixed(2).replace('.', ',')} h`;
}

export function fmtDayDate(dateKey: string): string {
  const [y, m, d] = dateKey.slice(0, 10).split('-');
  return d && m && y ? `${d}/${m}` : dateKey;
}
