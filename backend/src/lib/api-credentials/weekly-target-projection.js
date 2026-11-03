import { isWeeklyTargetGoalList, WEEKLY_TARGET_SERVICES, weeklyTargetGoalKind, weeklyTargetUnit } from '../../../../shared/modules/mission-weekly-progress.js';
import { WEEKLY_STATUS_LABEL, weeklyGoalSentence, weeklyScenarioGoalDescription } from '../../../../shared/modules/weekly-target-presentation.js';

// Apenas traduz o comparativo do painel. Nunca publica target, equipe ou notas.
export function projectWeeklyTarget(comparison) {
  if (!comparison || comparison.status === 'NO_TARGET') return null;
  return {
    situacao: comparison.status, rotuloSituacao: WEEKLY_STATUS_LABEL[comparison.status], emAndamento: comparison.inProgress,
    periodoInicio: comparison.periodStartDate, periodoFim: comparison.periodEndDate,
    regra: comparison.logic, cenario: comparison.scenarioName, atingimentoPct: comparison.achievementPct,
    itens: comparison.goals.map(goal => {
      const tipo = weeklyTargetGoalKind(goal), basis = goal.basis ?? comparison.basis;
      const displayGoal = { ...goal, kind: tipo, basis };
      return {
        tipo, servico: goal.serviceType ?? null, rotuloServico: goal.serviceType ? WEEKLY_TARGET_SERVICES[goal.serviceType] ?? goal.serviceType : null,
        unidade: goal.metric, rotuloUnidade: weeklyTargetUnit(goal.metric), base: basis, valorCadastrado: goal.value,
        planejado: goal.plannedValue, realizado: goal.actualValue, diferenca: goal.differenceValue,
        // Cenários antigos não possuem outcome por linha; traduzimos os valores
        // já calculados, com o mesmo significado dos resultados das listas.
        resultado: goal.outcome ?? (comparison.status === 'PLANNED' ? 'PLANNED'
          : goal.actualValue == null || goal.plannedValue == null ? 'NO_DATA' : goal.differenceValue < 0 ? 'BELOW' : 'MET'),
        pendenciasBase: [...goal.productivityIssues],
        descricao: isWeeklyTargetGoalList(comparison.target.definition) ? weeklyGoalSentence(displayGoal) : weeklyScenarioGoalDescription(displayGoal)
      };
    }),
    colaboradoresPorDia: comparison.dailyAttendance.map(day => ({ data: day.date, planejado: day.plannedValue, presentes: day.actualValue }))
  };
}
