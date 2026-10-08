import { collaboratorRoleAtDate } from '../collaborators/job-role-history.js';
import { computeMonthlyCost } from './cost-engine.js';

// Referências por modalidade, independentes do rateio e das horas realizadas.
export function buildCollaboratorHourlyRates({ collaborator, referenceDate, roleParams, annualCosts = {} }) {
  const role = collaboratorRoleAtDate(collaborator, referenceDate)?.roleName ?? null;
  const params = role ? roleParams.paramsFor(role, referenceDate) : null;
  const available = Boolean(params && Number(params.salarioBase) > 0);
  const values = { normal: null, he70: null, he100: null, offshore: null, viagem: null };
  let monthlyHours = null;
  let workingDays = null;

  if (available) {
    monthlyHours = Number(params.cargaHoraria) || 220;
    workingDays = Number(params.diasUteis) || 22;
    const homeInputs = { diasCasa: workingDays };
    const normal = computeMonthlyCost(params, homeInputs);
    const annualMonthly = exams => (
      ((Number(annualCosts.epiAnnualCost) || 0) + (Number(exams) || 0)) / 12
    );
    const standardAnnualMonthly = annualMonthly(annualCosts.examsTrainingAnnualCost);
    values.normal = (normal.totalMensal + standardAnnualMonthly) / monthlyHours;
    // Custo de uma hora extra adicional: inclui DSR, encargos e provisões.
    // Benefícios e custos anuais já pertencem ao custo normal e não se repetem.
    values.he70 = computeMonthlyCost(params, { ...homeInputs, he70Horas: 1 }).totalMensal - normal.totalMensal;
    values.he100 = computeMonthlyCost(params, { ...homeInputs, he100Horas: 1 }).totalMensal - normal.totalMensal;
    values.offshore = (computeMonthlyCost(params, { offshoreDays: workingDays }).totalMensal
      + annualMonthly(annualCosts.offshoreExamsTrainingAnnualCost)) / monthlyHours;
    values.viagem = (computeMonthlyCost(params, { diasFora: workingDays }).totalMensal
      + standardAnnualMonthly) / monthlyHours;
  }

  return {
    collaboratorId: collaborator.id,
    name: collaborator.name,
    role,
    referenceDate,
    available,
    monthlyHours,
    workingDays,
    scenarios: Object.entries(values).map(([scenario, hourlyCost]) => ({ scenario, hourlyCost }))
  };
}
