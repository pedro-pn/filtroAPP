import { collaboratorRoleAtDate } from '../collaborators/job-role-history.js';
import { computeMonthlyCost } from './cost-engine.js';

// Estimativa para a jornada dos relatórios sem apropriação do ponto. Usa o HH do
// motor na modalidade da obra, sem criar marcações nem alterar a folha mensal.
export function estimateReportLaborCostByDate({
  collaborator, roleParams, project = {}, annualCosts = {}, workedMinutesByDate = new Map()
}) {
  const costs = new Map();
  for (const [date, minutes] of workedMinutesByDate) {
    if (!(minutes > 0)) continue;
    const role = collaboratorRoleAtDate(collaborator, date)?.roleName;
    const params = roleParams.paramsFor(role, date);
    if (!params || !(Number(params.salarioBase) > 0)) {
      costs.set(date, null);
      continue;
    }
    const days = Number(params.diasUteis) || 22;
    const home = project.laborSleepModeByCollaborator?.[collaborator.id] === 'HOME';
    const inputs = project.offshore ? { offshoreDays: days }
      : home ? { diasCasa: days } : { diasFora: days };
    const monthly = computeMonthlyCost(params, inputs).totalMensal;
    const exams = project.offshore
      ? annualCosts.offshoreExamsTrainingAnnualCost : annualCosts.examsTrainingAnnualCost;
    const annualMonthly = ((Number(annualCosts.epiAnnualCost) || 0) + (Number(exams) || 0)) / 12;
    const hourly = (monthly + annualMonthly) / (Number(params.cargaHoraria) || 220);
    costs.set(date, hourly * minutes / 60);
  }
  return costs;
}

export function summarizeReportLaborCost(days) {
  const workedDays = days.filter(day => day.horas > 0);
  if (!workedDays.length || workedDays.some(day => day.custoEstimado == null)) {
    return { custoEstimadoRdo: null, custoHoraEstimadoRdo: null };
  }
  const cost = workedDays.reduce((sum, day) => sum + day.custoEstimado, 0);
  const hours = workedDays.reduce((sum, day) => sum + day.horas, 0);
  return {
    custoEstimadoRdo: Math.round((cost + Number.EPSILON) * 100) / 100,
    custoHoraEstimadoRdo: cost / hours
  };
}
