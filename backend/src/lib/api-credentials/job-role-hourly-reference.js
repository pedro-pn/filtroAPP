import { z } from 'zod';
import { IntegrationApiError } from '../../middleware/api-request-context.js';
import { configuredJobRoleSalary, validateJobRoleSalaryRequest } from './job-role-salary.js';

const adjustmentSchema = z.number().finite().min(0).max(1);

// Projeção financeira própria: não muda o contrato nem o valor da consulta de salário.
export async function getJobRoleHourlyReference(client, params, query, context) {
  if (!context.scopes?.has('cargos.salarios.read')) {
    throw new IntegrationApiError(403, 'INSUFFICIENT_SCOPE', 'A credencial não possui o escopo necessário.');
  }
  const { id, referenceDate } = validateJobRoleSalaryRequest(params, query);
  const role = await client.jobRole.findUnique({
    where: { id }, select: { id: true, name: true, costProfile: { select: { parameterSets: {
      where: { effectiveDate: { lte: new Date(`${referenceDate}T00:00:00.000Z`) } },
      orderBy: [{ effectiveDate: 'desc' }, { version: 'desc' }],
      select: { params: true, effectiveDate: true, version: true }
    } } } }
  });
  if (!role) throw new IntegrationApiError(404, 'NOT_FOUND', 'Cargo não encontrado.');
  const sets = role.costProfile?.parameterSets || [];
  const current = sets[0];
  // Um salário agendado antes da criação do campo não encerra o reajuste.
  const adjustment = sets.find(set => set.params?.reajusteHhPct != null);
  const parsed = adjustmentSchema.safeParse(adjustment?.params.reajusteHhPct ?? 0);
  if (!parsed.success) throw new IntegrationApiError(422, 'HH_ADJUSTMENT_INVALID', 'Reajuste do HH inválido para a data de referência.');
  const salary = configuredJobRoleSalary(current);
  return {
    jobRoleId: role.id, jobRoleName: role.name, referenceDate,
    salary: salary?.toFixed() ?? null,
    effectiveDate: salary ? current.effectiveDate.toISOString().slice(0, 10) : null,
    version: salary ? current.version : null,
    hhAdjustmentPct: parsed.data,
    hhAdjustmentEffectiveDate: adjustment?.effectiveDate.toISOString().slice(0, 10) ?? null,
    hhAdjustmentVersion: adjustment?.version ?? null
  };
}
