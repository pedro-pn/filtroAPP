import type { WeeklyProgressTarget, WeeklyTargetGoalItem, WeeklyTargetInput, WeeklyTargetLogic, WeeklyTargetService } from '../../../../shared/modules/mission-weekly-progress.js';
import { isWeeklyTargetGoalList, weekStartKey, weeklyTargetCountingDays, weeklyTargetCountingPeriod, weeklyTargetDefinition, weeklyTargetGoalMetric, weeklyTargetScenarioSettings } from '../../../../shared/modules/mission-weekly-progress.js';

export type GoalKind = WeeklyTargetService | 'PROGRESS' | 'ATTENDANCE';
export type GoalBasis = 'PER_PRODUCTIVE_DAY' | 'WEEK_TOTAL';
export type GoalDraft = { kind: GoalKind; value: string; unit: 'M' | 'UN' | 'L'; basis: GoalBasis };
export type TargetDraft = {
  weekStartDate: string; countingStartDay: number; countingEndDay: number; repeatWeekly: boolean;
  logic: WeeklyTargetLogic; goals: GoalDraft[]; expectedRevision: number;
  /** A meta salva usava regras por combinação de serviços, que o cadastro novo substitui. */
  replacesLegacyRules: boolean;
};

export const SERVICE_KINDS: WeeklyTargetService[] = ['LIMPEZA_QUIMICA', 'FLUSHING', 'TESTE_PRESSAO', 'FILTRAGEM'];
export const isServiceKind = (kind: GoalKind): kind is WeeklyTargetService => (SERVICE_KINDS as string[]).includes(kind);
export const newGoalDraft = (kind: GoalKind = 'LIMPEZA_QUIMICA', basis: GoalBasis = 'PER_PRODUCTIVE_DAY'): GoalDraft =>
  ({ kind, value: '', unit: kind === 'FILTRAGEM' ? 'L' : 'M', basis: isServiceKind(kind) ? basis : 'WEEK_TOTAL' });
/** Troca o tipo da linha preservando o que ainda faz sentido. */
export const changeGoalKind = (goal: GoalDraft, kind: GoalKind): GoalDraft => ({ ...goal, kind,
  unit: kind === 'FILTRAGEM' ? 'L' : goal.unit === 'L' ? 'M' : goal.unit, basis: isServiceKind(kind) ? goal.basis : 'WEEK_TOTAL' });

// As reuniões semanais acontecem às sextas: a contagem padrão vai de sexta a quinta.
export const DEFAULT_COUNTING = { countingStartDay: 5, countingEndDay: 4 };
const text = (value: number) => String(value).replace('.', ',');

/** Semana (segunda-feira de referência) cujo período de contagem contém a data. */
export function periodWeekFor(date: string, counting: { countingStartDay: number; countingEndDay: number }) {
  const week = weekStartKey(date)!;
  const previous = new Date(new Date(`${week}T00:00:00Z`).getTime() - 7 * 86_400_000).toISOString().slice(0, 10);
  return [week, previous].find(candidate => {
    const { periodStartDate, periodEndDate } = weeklyTargetCountingPeriod(candidate, counting);
    return periodStartDate <= date && date <= periodEndDate;
  }) ?? week;
}

function goalsFromTarget(target: WeeklyProgressTarget): { goals: GoalDraft[]; legacy: boolean } {
  const definition = weeklyTargetDefinition(target);
  if (isWeeklyTargetGoalList(definition)) return { legacy: false, goals: definition.goals.map(goal => goal.kind === 'SERVICE'
    ? { kind: goal.serviceType, value: text(goal.value), unit: goal.metric, basis: goal.basis }
    : { ...newGoalDraft(goal.kind), value: text(goal.value) }) };
  // Metas antigas: aproveita a regra geral (ou a primeira) e avisa se havia outras condições.
  const scenario = definition.scenarios.find(item => item.condition.kind === 'ALWAYS') ?? definition.scenarios[0];
  const settings = weeklyTargetScenarioSettings(definition, scenario);
  let legacy = definition.scenarios.length > 1 || scenario.condition.kind !== 'ALWAYS';
  const goals = scenario.goals.map((goal): GoalDraft => {
    if (settings.metric === 'PCT_POINTS') return { ...newGoalDraft('PROGRESS'), value: text(goal.value) };
    if (settings.metric === 'COLLABORATORS') return { ...newGoalDraft('ATTENDANCE'), value: text(goal.value) };
    const metric = weeklyTargetGoalMetric(settings.metric, goal, scenario.condition);
    const kind = goal.serviceType ?? (scenario.condition.kind === 'SERVICE_SET' && scenario.condition.serviceTypes.length === 1 ? scenario.condition.serviceTypes[0] : null);
    if (!kind) legacy = true;
    return { kind: kind ?? (metric === 'L' ? 'FILTRAGEM' : 'LIMPEZA_QUIMICA'), value: text(goal.value), unit: metric === 'L' ? 'L' : metric === 'UN' ? 'UN' : 'M',
      basis: settings.basis === 'PER_PRODUCTIVE_DAY' ? 'PER_PRODUCTIVE_DAY' : 'WEEK_TOTAL' };
  });
  return { goals, legacy };
}

export function targetToDraft(target: WeeklyProgressTarget | null, weekStartDate: string, expectedRevision: number, previous?: WeeklyProgressTarget | null): TargetDraft {
  const source = target ?? previous ?? null;
  const definition = source ? weeklyTargetDefinition(source) : null;
  const counting = definition?.countingStartDay != null && definition.countingEndDay != null
    ? { countingStartDay: definition.countingStartDay, countingEndDay: definition.countingEndDay } : DEFAULT_COUNTING;
  if (!target) return { weekStartDate, ...counting, repeatWeekly: true, logic: 'ALL', goals: [newGoalDraft()], expectedRevision, replacesLegacyRules: false };
  const { goals, legacy } = goalsFromTarget(target);
  return { weekStartDate, ...counting, repeatWeekly: Boolean(definition?.repeatWeekly ?? target.repeatedFromWeekStartDate),
    logic: definition && isWeeklyTargetGoalList(definition) ? definition.logic : 'ALL', goals: goals.length ? goals : [newGoalDraft()], expectedRevision, replacesLegacyRules: legacy };
}

const parse = (value: string) => Number(value.trim().replace(',', '.'));
const twoDecimals = (value: number) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-5;

export function weeklyTargetDraftToInput(draft: TargetDraft, workdays: number[] = [1, 2, 3, 4, 5]): WeeklyTargetInput {
  if (!draft.weekStartDate) throw new Error('Escolha a semana em que a meta começa a valer.');
  if (![draft.countingStartDay, draft.countingEndDay].every(day => Number.isInteger(day) && day >= 0 && day <= 6)) throw new Error('Escolha os dias de início e fim da contagem.');
  if (!draft.goals.length) throw new Error('Adicione ao menos uma meta.');
  const services = draft.goals.filter(goal => isServiceKind(goal.kind)).map(goal => goal.kind);
  if (new Set(services).size !== services.length) throw new Error('Use uma linha por serviço.');
  for (const kind of ['PROGRESS', 'ATTENDANCE'] as const) if (draft.goals.filter(goal => goal.kind === kind).length > 1) throw new Error('Use só uma meta de avanço e uma de equipe mínima.');
  const goals = draft.goals.map((goal): WeeklyTargetGoalItem => {
    const value = parse(goal.value);
    if (!goal.value.trim() || !Number.isFinite(value) || value <= 0) throw new Error('Informe um valor maior que zero em cada meta.');
    if (!twoDecimals(value) || value > 999999999.99) throw new Error('Use no máximo duas casas decimais.');
    if (goal.kind === 'PROGRESS') {
      if (value > 100) throw new Error('O avanço semanal deve ser de até 100 p.p.');
      return { kind: 'PROGRESS', value };
    }
    if (goal.kind === 'ATTENDANCE') {
      if (!Number.isInteger(value)) throw new Error('Informe um número inteiro de colaboradores.');
      if (!workdays.some(day => weeklyTargetCountingDays(draft).includes(day))) throw new Error('Os dias de trabalho do projeto precisam estar dentro do período de contagem.');
      return { kind: 'ATTENDANCE', value, workdays };
    }
    const metric = goal.kind === 'FILTRAGEM' ? 'L' : goal.unit === 'UN' ? 'UN' : 'M';
    if (metric === 'UN' && goal.basis === 'WEEK_TOTAL' && !Number.isInteger(value)) throw new Error('Metas totais de unidades de sistema devem ser inteiras.');
    return { kind: 'SERVICE', serviceType: goal.kind, metric, basis: goal.basis, value };
  });
  return { weekStartDate: draft.weekStartDate, expectedRevision: draft.expectedRevision, definition: {
    version: 2, logic: goals.length > 1 ? draft.logic : 'ALL', countingStartDay: draft.countingStartDay, countingEndDay: draft.countingEndDay,
    repeatWeekly: draft.repeatWeekly, goals } };
}
