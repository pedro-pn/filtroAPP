export function projectWorkLocations(project) {
  return [...new Set([project?.location, ...(project?.additionalWorkLocations || [])]
    .filter(value => typeof value === 'string')
    .map(value => value.trim())
    .filter(Boolean))];
}

export function reportWorkLocation(project, savedLocation) {
  const locations = projectWorkLocations(project);
  // Com um único local não há escolha no formulário: vale o cadastro atual.
  return locations.length === 1 ? locations[0] : typeof savedLocation === 'string' ? savedLocation.trim() : '';
}

export function projectScopeOptions(project) {
  const scopes = new Map();
  const withProposals = project?.plannedServices?.some(service => service.contributionKey);
  for (const service of project?.plannedServices || []) {
    const name = service.scopeName?.trim() || null;
    const contributionKey = service.contributionKey || null;
    const value = JSON.stringify(withProposals ? [contributionKey, name] : name);
    const proposal = contributionKey ? `Proposta ${contributionKey.split(':').slice(1).join(':')}` : 'Principal / manual';
    if (!scopes.has(value)) scopes.set(value, { value, name,
      label: `${name || 'Sem escopo definido'}${withProposals ? ` · ${proposal}` : ''}`,
      ...(withProposals ? { contributionKey } : {}) });
  }
  return [...scopes.values()];
}

// Rascunhos anteriores guardam só o nome. Aceita esse formato apenas quando a
// seleção continua única; escopos homônimos de propostas diferentes exigem escolha.
export function findProjectScopeOption(options, value) {
  if (typeof value !== 'string' || !value) return undefined;
  const exact = options.find(option => option.value === value);
  if (exact) return exact;
  try {
    const name = JSON.parse(value);
    if (typeof name !== 'string' && name !== null) return undefined;
    const matches = options.filter(option => option.name === name);
    return matches.length === 1 ? matches[0] : undefined;
  } catch { return undefined; }
}
