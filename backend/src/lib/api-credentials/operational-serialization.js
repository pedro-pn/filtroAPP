import { enrichRdoServices, projectRdoReport, projectRdoService } from './rdo-projection.js';
import { projectOperationalProject, projectResponsible } from './project-projection.js';
import { enrichEfetivoProjectStatuses } from './efetivo-project-status.js';

import { projectMeasurement, projectRomaneio, projectUnloading, enrichProjectPending } from './delivery-b-projection.js';

// Projeções de execução ficam fora do catálogo consumido pelo frontend.
const projections = {
  'efetivo.projects.measurements.list': { serialize: projectMeasurement },
  'operational.ProjectPending.list': { enrichRows: enrichProjectPending },
  Romaneio: { serialize: projectRomaneio },
  LogisticsUnloading: { serialize: projectUnloading },
  'operational.Project.list': { serialize: projectOperationalProject },
  'operational.ProjectResponsible.list': { serialize: projectResponsible },
  'efetivo.projects.status.list': { serialize: row => row.summary || {}, enrichRows: enrichEfetivoProjectStatuses },
  Report: { serialize: projectRdoReport },
  ReportService: { serialize: projectRdoService, enrichRows: enrichRdoServices }
};

export async function enrichOperationalRows(client, resource, rows, context) {
  const enrichRows = (projections[resource.operationId] || projections[resource.model])?.enrichRows;
  return enrichRows ? enrichRows(client, rows, context) : rows;
}

// Uma segunda allowlist na saída impede vazamento mesmo se o adapter retornar campos extras.
export function serializeOperationalResource(resource, row, context = { scopes: new Set() }) {
  const serialize = (projections[resource.operationId] || projections[resource.model])?.serialize;
  const projected = serialize ? serialize(row, context) : row;
  return Object.fromEntries(Object.entries({ ...resource.fields, ...(resource.conditionalScope && context.scopes.has(resource.conditionalScope) ? resource.conditionalFields : {}) }).map(([field, type]) => {
    const value = projected[field];
    return [field, value == null ? null : type.startsWith('datetime') ? new Date(value).toISOString()
      : type.startsWith('decimal') ? String(value) : value];
  }));
}
