import { Prisma } from '@prisma/client';
import { z } from 'zod';

import { IntegrationApiError } from '../../middleware/api-request-context.js';

const paramsSchema = z.object({ id: z.string().trim().min(1).max(100) }).strict();
const querySchema = z.object({ referenceDate: z.iso.date() }).strict();

export function validateJobRoleSalaryRequest(params, query) {
  return { ...paramsSchema.parse(params), ...querySchema.parse(query) };
}

export async function getJobRoleSalary(client, params, query, context) {
  if (!context.scopes?.has('cargos.salarios.read')) {
    throw new IntegrationApiError(403, 'INSUFFICIENT_SCOPE', 'A credencial não possui o escopo necessário.');
  }
  const { id, referenceDate } = validateJobRoleSalaryRequest(params, query);
  const role = await client.jobRole.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      costProfile: { select: {
        parameterSets: {
          where: { effectiveDate: { lte: new Date(`${referenceDate}T00:00:00.000Z`) } },
          orderBy: [{ effectiveDate: 'desc' }, { version: 'desc' }],
          take: 1,
          select: { params: true, effectiveDate: true, version: true }
        }
      } }
    }
  });
  if (!role) throw new IntegrationApiError(404, 'NOT_FOUND', 'Cargo não encontrado.');

  const set = role.costProfile?.parameterSets[0];
  const rawSalary = set?.params?.salarioBase;
  let salary;
  if ((typeof rawSalary === 'number' || typeof rawSalary === 'string') && String(rawSalary).trim()) {
    try { salary = new Prisma.Decimal(rawSalary); } catch { /* parâmetro legado inválido */ }
  }
  if (!salary?.isFinite() || salary.isNegative()) {
    throw new IntegrationApiError(404, 'SALARY_NOT_FOUND', 'Salário do cargo não configurado para a data de referência.');
  }

  // O JSON de parâmetros é interno; publique somente o salário do cargo e sua vigência.
  return {
    jobRoleId: role.id,
    jobRoleName: role.name,
    salary: salary.toFixed(),
    effectiveDate: set.effectiveDate.toISOString().slice(0, 10),
    version: set.version
  };
}
