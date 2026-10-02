export function projectWorkLocations(project) {
  return [...new Set([project?.location, ...(project?.additionalWorkLocations || [])]
    .filter(value => typeof value === 'string')
    .map(value => value.trim())
    .filter(Boolean))];
}

export function projectScopeOptions(project) {
  const scopes = new Map();
  for (const service of project?.plannedServices || []) {
    const name = service.scopeName?.trim() || null;
    const value = JSON.stringify(name);
    if (!scopes.has(value)) scopes.set(value, { value, name, label: name || 'Sem escopo definido' });
  }
  return [...scopes.values()];
}
