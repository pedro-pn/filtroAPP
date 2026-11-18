import { z } from 'zod';
import { IntegrationApiError } from '../../middleware/api-request-context.js';
import { configuredJobRoleSalary, validateJobRoleSalaryRequest } from './job-role-salary.js';
import { salaryReferenceAt } from '../acompanhamento/salary-reference.js';

const adjustmentSchema = z.number().finite().min(0).max(1);

// Projeção financeira própria: não muda o contrato nem o valor da consulta de salário.
export async function getJobRoleHourlyReference(client, params, query, context) {
  if (!context.scopes?.has('cargos.salarios.read')) {
    throw new IntegrationApiError(403, 'INSUFFICIENT_SCOPE', 'A credencial não possui o escopo necessário.');
  }
  const { id, referenceDate } = validateJobRoleSalaryRequest(params, query);
  const role = await client.jobRole.findUnique({
    where: { id }, select: { id: true, name: true, costProfile: { select: { parameterSets: {
      orderBy: [{ effectiveDate: 'desc' }, { version: 'desc' }],
      select: { params: true, effectiveDate: true, version: true }
    } } } }
  });
  if (!role) throw new IntegrationApiError(404, 'NOT_FOUND', 'Cargo não encontrado.');
  const sets = role.costProfile?.parameterSets || [];
  const { set: current, ...reference } = salaryReferenceAt(sets, referenceDate);
  // Um salário agendado antes da criação do campo não encerra o reajuste.
  const adjustment = sets.find(set => set.effectiveDate <= new Date(`${referenceDate}T00:00:00Z`) && set.params?.reajusteHhPct != null);
  const parsed = adjustmentSchema.safeParse(adjustment?.params.reajusteHhPct ?? 0);
  if (!parsed.success) throw new IntegrationApiError(422, 'HH_ADJUSTMENT_INVALID', 'Reajuste do HH inválido para a data de referência.');
  const salary = reference.salaryStatus === 'CANCELLED' ? null : configuredJobRoleSalary(current);
  return {
    jobRoleId: role.id, jobRoleName: role.name, referenceDate,
    salary: salary?.toFixed() ?? null,
    effectiveDate: salary ? current.effectiveDate.toISOString().slice(0, 10) : null,
    version: salary ? current.version : null,
    ...reference, salaryStatus: salary ? 'CURRENT' : reference.salaryStatus === 'CANCELLED' ? 'CANCELLED' : 'UNAVAILABLE',
    hhAdjustmentPct: parsed.data,
    hhAdjustmentEffectiveDate: adjustment?.effectiveDate.toISOString().slice(0, 10) ?? null,
    hhAdjustmentVersion: adjustment?.version ?? null
  };
}
