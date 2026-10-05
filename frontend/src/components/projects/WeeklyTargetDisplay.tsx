import { WEEKLY_TARGET_SERVICES, WEEKLY_TARGET_WORKDAYS, weeklyTargetDefinition, weeklyTargetGoalMetric, type WeeklyProgressComparison, type WeeklyProgressTarget } from '../../../../shared/modules/mission-weekly-progress.js';

import { attendanceBalanceLabel, weeklyValueLabel } from './weeklyTargetPresentation';
import { formatDateOnly } from '../../utils/dateOnly';

const format = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });
const issueLabels: Record<string, string> = {
  MISSING_TEAM: 'informe a equipe do serviço', MISSING_TIME: 'confira horários, intervalos e stand-by',
  MISSING_ROLE: 'confira o cargo dos colaboradores', UNCONFIRMED_TEAM: 'confirme a equipe no RDO',
  OVERLAPPING_SERVICES: 'corrija serviços simultâneos para o mesmo colaborador',
  MISSING_RDO_BASE: 'falta RDO com equipe e horários desse serviço', NO_PRODUCTIVE_TIME: 'não há tempo produtivo suficiente'
};

export function WeeklyGoalResults({ row, showBalance = true }: { row: WeeklyProgressComparison; showBalance?: boolean }) {
  if (!row.target) return null;
  if (row.metric === 'COLLABORATORS') return <div className="mission-weekly-goal-results">
    <p className="mission-weekly-progress-hint">Equipe do RDO · A situação diária compara a equipe daquele dia com o mínimo contratado. O saldo acumulado soma as diferenças.</p>
    {showBalance && row.cumulativeAttendance ? <p className="mission-weekly-progress-hint">Saldo acumulado: {attendanceBalanceLabel(row.cumulativeAttendance.differenceValue)}</p> : null}
    {row.dailyAttendance.map(day => <div key={day.date}>
      <strong>{formatDateOnly(day.date)}</strong>
      <span>{day.actualValue == null ? '—' : format.format(day.actualValue)} de {format.format(day.plannedValue)} colaboradores</span>
      <small className={`mission-weekly-status status-${day.status.toLowerCase()}`}>{day.status === 'PLANNED' ? 'Dia futuro' : day.status === 'NO_DATA'
        ? day.attendanceIssues.length ? 'Confirme a equipe no RDO' : 'Sem RDO para este dia' : day.status === 'BELOW' ? 'Fora da meta' : 'Dentro da meta'}</small>
      {day.status !== 'PLANNED' ? <small>Acumulado: {attendanceBalanceLabel(day.cumulativeDifferenceValue)}</small> : null}
    </div>)}
  </div>;
  return <div className="mission-weekly-goal-results">
    <p className="mission-weekly-progress-hint">{row.scenarioName ? `Cenário: ${row.scenarioName}` : 'Nenhum cenário corresponde aos tipos de serviço executados.'}
      {row.metric !== 'PCT_POINTS' ? ` · ${row.activeServiceTypes.length ? row.activeServiceTypes.map(type => WEEKLY_TARGET_SERVICES[type]).join(' + ') : 'Nenhum tipo de serviço registrado na semana'}` : ''}</p>
    {row.goals.map(goal => <div key={goal.serviceType ?? 'GLOBAL'}>
      <strong>{goal.serviceType ? WEEKLY_TARGET_SERVICES[goal.serviceType] : 'Total geral'}</strong>
      <span>{weeklyValueLabel(goal.actualValue, goal.metric)} de {weeklyValueLabel(goal.plannedValue, goal.metric)}</span>
      {row.basis === 'PER_PRODUCTIVE_DAY' ? <small>{weeklyValueLabel(goal.value, goal.metric)}/colaborador produtivo/dia · Base do RDO: {format.format(goal.productiveHours ?? 0)} horas de colaboradores = {format.format(goal.personDays ?? 0)} colaborador-dias
        {goal.actualRate != null ? ` · Realizado: ${weeklyValueLabel(goal.actualRate, goal.metric)}/colaborador produtivo/dia` : ''}</small> : null}
      {goal.productivityIssues.length && row.status !== 'PLANNED' ? <small>Base incompleta no RDO: {goal.productivityIssues.map(issue => issueLabels[issue] ?? issue).join('; ')}.</small> : null}
    </div>)}
  </div>;
}

export function WeeklyTargetConfiguration({ target }: { target: WeeklyProgressTarget }) {
  const definition = weeklyTargetDefinition(target);
  if (definition.metric === 'COLLABORATORS') return <ul><li>
    <strong>Meta diária de colaboradores</strong>
    <small>{weeklyValueLabel(definition.scenarios[0].goals[0].value, 'COLLABORATORS')} · Equipe registrada no RDO</small>
    <small>Dias de trabalho: {[1, 2, 3, 4, 5, 6, 0].filter(day => (definition.workdays ?? [1, 2, 3, 4, 5]).includes(day)).map(day => WEEKLY_TARGET_WORKDAYS[day]).join(', ')}</small>
  </li></ul>;
  return <ul>{definition.scenarios.map((scenario, index) => <li key={index}>
    <strong>{scenario.name}</strong><small>{scenario.condition.kind === 'ALWAYS' ? 'Regra geral' : scenario.condition.kind === 'SERVICE_COUNT'
      ? `${scenario.condition.count} tipo(s) de serviço` : `Somente ${scenario.condition.serviceTypes.map(type => WEEKLY_TARGET_SERVICES[type]).join(' + ')}`}</small>
    {scenario.goals.map(goal => <small key={goal.serviceType ?? 'GLOBAL'}>{goal.serviceType ? WEEKLY_TARGET_SERVICES[goal.serviceType] : 'Total geral'}: {weeklyValueLabel(goal.value, weeklyTargetGoalMetric(definition.metric, goal, scenario.condition))}
      {definition.basis === 'PER_PRODUCTIVE_DAY' ? `/colaborador produtivo/dia · Jornada de referência: ${format.format(definition.referenceDayHours ?? 8)} h · Equipe e tempo calculados pelos RDOs` : ''}</small>)}
  </li>)}</ul>;
}
