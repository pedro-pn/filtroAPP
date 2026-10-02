import { projectScopeOptions, projectWorkLocations } from '../../../../shared/modules/rdo-project-context.js';

export function assertRdoProjectContext(project, data, existingReport) {
  if (data.reportType !== 'RDO') return;
  const scopes = projectScopeOptions(project);
  for (const [index, service] of (data.services || []).entries()) {
    const scopeKey = service.extraData?.__scopeKey;
    const scope = scopes.find(option => option.value === scopeKey);
    if (scopes.length > 1 && !scope) {
      throw Object.assign(new Error(`Selecione um escopo do projeto para o serviço ${index + 1}.`), { statusCode: 400 });
    }
    if (scope) service.extraData.__scopeName = scope.name;
    else if (service.extraData && typeof service.extraData === 'object') {
      delete service.extraData.__scopeKey;
      delete service.extraData.__scopeName;
    }
  }
  const locations = projectWorkLocations(project);
  const location = data.specialConditions?.workLocation;
  // O local salvo no RDO continua válido se o cadastro do projeto mudar depois.
  const historicalLocation = Boolean(location) && existingReport?.projectId === project.id
    && existingReport?.specialConditions?.workLocation === location;
  if (!historicalLocation && ((locations.length > 1 && !location) || (location && !locations.includes(location)))) {
    throw Object.assign(new Error('Selecione um local da obra cadastrado no projeto.'), { statusCode: 400 });
  }
  data.specialConditions = { ...data.specialConditions, workLocation: location || locations[0] || '' };
}
