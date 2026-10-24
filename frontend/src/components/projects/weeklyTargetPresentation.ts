import { WEEKLY_TARGET_SERVICES, WEEKLY_TARGET_WORKDAYS, weeklyTargetUnit, type WeeklyProgressComparison, type WeeklyTargetGoalItem, type WeeklyTargetMetric } from '../../../../shared/modules/mission-weekly-progress.js';

const numberFormat = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });
export const weeklyValueLabel = (value: number | null, metric: WeeklyTargetMetric, signed = false) => value == null ? '—'
  : `${signed && value > 0 ? '+' : ''}${numberFormat.format(value)} ${weeklyTargetUnit(metric)}`;

export const attendanceBalanceLabel = (value: number | null) => value == null ? 'Saldo pendente de RDO'
  : value > 0 ? `Superávit de ${numberFormat.format(value)} presenças`
    : value < 0 ? `Déficit de ${numberFormat.format(-value)} presenças` : 'Saldo zero';

export const WEEKLY_STATUS_LABEL: Record<WeeklyProgressComparison['status'], string> = {
  ON_TARGET: 'Dentro da meta', ABOVE: 'Acima da meta', BELOW: 'Abaixo da meta', PARTIAL: 'Meta parcial',
  NO_TARGET: 'Sem meta definida', NO_DATA: 'Sem dados suficientes', NO_RULE: 'Sem cenário aplicável', PLANNED: 'Período futuro'
};

type GoalLike = { kind?: WeeklyTargetGoalItem['kind']; serviceType?: string | null; metric?: WeeklyTargetMetric };
export const weeklyGoalLabel = (goal: GoalLike) => goal.kind === 'PROGRESS' || (!goal.kind && goal.metric === 'PCT_POINTS') ? 'Avanço do projeto'
  : goal.kind === 'ATTENDANCE' || (!goal.kind && goal.metric === 'COLLABORATORS') ? 'Equipe mínima no dia'
    : goal.serviceType ? WEEKLY_TARGET_SERVICES[goal.serviceType as keyof typeof WEEKLY_TARGET_SERVICES] ?? goal.serviceType
      : goal.kind === 'SERVICE' ? 'Qualquer serviço' : 'Total geral';

const SERVICE_PHRASE: Record<string, string> = { LIMPEZA_QUIMICA: 'de limpeza química', FLUSHING: 'de flushing', TESTE_PRESSAO: 'de teste de pressão', FILTRAGEM: 'de óleo filtrado' };
const amount = (value: number | null | undefined) => value != null && Number.isFinite(value) && value > 0 ? numberFormat.format(value) : '…';

const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];
export function workdaysLabel(workdays: number[]) {
  const positions = WEEK_ORDER.map((day, index) => workdays.includes(day) ? index : -1).filter(index => index >= 0);
  const short = (index: number) => WEEKLY_TARGET_WORKDAYS[WEEK_ORDER[index]].slice(0, 3).toLowerCase();
  const contiguous = positions.every((position, index) => index === 0 || position === positions[index - 1] + 1);
  return positions.length > 2 && contiguous ? `${short(positions[0])} a ${short(positions.at(-1)!)}` : positions.map(short).join(', ');
}

type SentenceGoal = { kind: WeeklyTargetGoalItem['kind']; value: number | null; serviceType?: string | null; metric?: string; basis?: string; workdays?: number[] };
/** Frase que descreve a meta, usada no cadastro para conferência e na consulta das regras. */
export function weeklyGoalSentence(goal: SentenceGoal) {
  if (goal.kind === 'PROGRESS') return `O avanço do projeto deve subir ${amount(goal.value)} pontos percentuais na semana (ex.: de 30% para 40% = 10).`;
  if (goal.kind === 'ATTENDANCE') {
    const days = goal.workdays?.length ? workdaysLabel(goal.workdays) : 'seg a sex';
    return `Pelo menos ${amount(goal.value)} colaboradores no RDO em cada dia de trabalho do projeto (${days}).`;
  }
  const service = goal.serviceType;
  const metric = goal.metric ?? 'M';
  const unit = service === 'FILTRAGEM' || metric === 'L' ? 'L' : metric === 'UN' ? (goal.value === 1 ? 'unidade' : 'unidades') : 'm';
  const what = `${amount(goal.value)} ${unit} ${service ? SERVICE_PHRASE[service] : 'somando todos os serviços'}`.trim();
  return goal.basis === 'PER_PRODUCTIVE_DAY'
    ? `Cada colaborador deve fazer ${what} por dia trabalhado. Cada pessoa da equipe do RDO conta 1 por dia com RDO${service ? ' deste serviço' : ''}.`
    : `A equipe deve fazer ${what} na semana.`;
}
