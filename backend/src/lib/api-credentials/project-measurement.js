import { z } from 'zod';
import { IntegrationApiError } from '../../middleware/api-request-context.js';
import { prepareOperationalQuery, operationalVisibilityWhere } from './operational-service.js';
import { serializeOperationalResource } from './operational-serialization.js';

export function validateProjectMeasurementRequest(params, query, context) {
  const { id } = z.object({ id: z.string().trim().min(1).max(100) }).strict().parse(params);
  z.object({}).strict().parse(query);
  prepareOperationalQuery('efetivo.projects.measurements.list', { projectId: id }, context);
  return id;
}
export async function getProjectMeasurement(client, params, query, context) {
  const id = validateProjectMeasurementRequest(params, query, context);
  const prepared = prepareOperationalQuery('efetivo.projects.measurements.list', { projectId: id }, context);
  const row = await client.project.findFirst({ where: operationalVisibilityWhere(prepared.resource, prepared.query, context), select: prepared.resource.select });
  if (!row) throw new IntegrationApiError(404, 'NOT_FOUND', 'Projeto não encontrado.');
  return serializeOperationalResource(prepared.resource, row, context);
}
