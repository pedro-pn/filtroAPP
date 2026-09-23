import { round1, round2, toNumber } from './project-card-groups.js';

export function progressContributionWeight(progress) {
  let total = 0;
  for (const service of progress?.services ?? []) {
    const plannedQty = (service.systems ?? [])
      .reduce((sum, system) => sum + Math.max(0, toNumber(system.plannedQty) ?? 0), 0);
    if (plannedQty <= 0) continue;
    total += Math.max(0, toNumber(service.weight) ?? 1) * plannedQty;
  }
  return total > 0 ? round2(total) : null;
}

export function combineProgressBreakdowns(progresses = []) {
  const scoped = progresses.filter(progress => progress?.hasScope && Array.isArray(progress.services));
  if (scoped.length === 0) return null;

  const byService = new Map();
  for (const progress of scoped) {
    for (const service of progress.services ?? []) {
      const serviceKey = service.serviceType || 'SERVICO';
      const serviceAcc = byService.get(serviceKey) ?? {
        serviceType: serviceKey,
        weight: 0,
        systems: new Map()
      };
      let hasPlannedSystem = false;
      for (const system of service.systems ?? []) {
        const planned = Math.max(0, toNumber(system.plannedQty) ?? 0);
        if (planned > 0) hasPlannedSystem = true;
        const realized = Math.max(0, toNumber(system.realizedQty) ?? 0);
        const systemKey = JSON.stringify([system.projectSystemId ?? '', system.systemType ?? '', system.unit ?? '', system.diameter ?? '', system.diameterUnit ?? '']);
        const systemAcc = serviceAcc.systems.get(systemKey) ?? {
          ...(system.projectSystemId ? { projectSystemId: system.projectSystemId, equipment: system.equipment, systemName: system.systemName, diameter: system.diameter, diameterUnit: system.diameterUnit } : {}),
          systemType: system.systemType,
          unit: system.unit ?? null,
          plannedQty: 0,
          realizedQty: 0
        };
        systemAcc.plannedQty += planned;
        systemAcc.realizedQty += realized;
        serviceAcc.systems.set(systemKey, systemAcc);
      }
      if (hasPlannedSystem) {
        serviceAcc.weight += Math.max(0, toNumber(service.weight) ?? 1);
      }
      byService.set(serviceKey, serviceAcc);
    }
  }

  const services = Array.from(byService.values())
    .map(service => {
      const systems = Array.from(service.systems.values())
        .map(system => {
          const pct = system.plannedQty > 0 ? system.realizedQty / system.plannedQty * 100 : null;
          return {
            ...(system.projectSystemId ? { projectSystemId: system.projectSystemId, equipment: system.equipment, systemName: system.systemName, diameter: system.diameter, diameterUnit: system.diameterUnit } : {}),
            systemType: system.systemType,
            unit: system.unit,
            plannedQty: system.plannedQty > 0 ? round2(system.plannedQty) : null,
            realizedQty: round2(system.realizedQty),
            pct: pct === null ? null : round1(pct)
          };
        });
      const measurable = systems.filter(system => system.pct !== null);
      let executionPct = measurable.length
        ? round1(measurable.reduce((sum, system) => sum + system.pct, 0) / measurable.length)
        : null;
      if (measurable.some(system => system.projectSystemId)) {
        const metrics = new Map();
        for (const system of measurable) {
          const metric = metrics.get(system.systemType) ?? { planned: 0, completed: 0 };
          metric.planned += system.plannedQty;
          metric.completed += system.realizedQty;
          metrics.set(system.systemType, metric);
        }
        executionPct = round1([...metrics.values()].reduce((sum, metric) => sum + metric.completed / metric.planned * 100, 0) / metrics.size);
      }
      return {
        serviceType: service.serviceType,
        weight: service.weight,
        executionPct,
        systems
      };
    })
    .filter(service => service.systems.some(system => system.plannedQty && system.plannedQty > 0))
    .sort((a, b) => String(a.serviceType).localeCompare(String(b.serviceType), 'pt-BR'));

  const weighted = services.filter(service => service.executionPct !== null && service.weight > 0);
  const totalWeight = weighted.reduce((sum, service) => sum + service.weight, 0);
  const progressPct = totalWeight > 0
    ? round1(weighted.reduce((sum, service) => sum + service.weight * service.executionPct, 0) / totalWeight)
    : null;

  return {
    hasScope: services.length > 0,
    progressPct,
    progressMethod: progressPct !== null ? 'GROUP_SCOPE' : null,
    ...(scoped.some(progress => progress.pendingMeasurements) ? { pendingMeasurements: scoped.flatMap(progress => progress.pendingMeasurements ?? []) } : {}),
    ...(scoped.some(progress => progress.scopeGroups) ? { scopeGroups: combineScopeGroups(scoped) } : {}),
    services
  };
}

function combineScopeGroups(progresses) {
  const groups = new Map();
  for (const progress of progresses) {
    for (const group of progress.scopeGroups ?? [{ scopeName: null, services: progress.services }]) {
      if (!groups.has(group.scopeName)) groups.set(group.scopeName, []);
      // Somente a projeção do grupo: não propaga scopeGroups para a agregação recursiva.
      groups.get(group.scopeName).push({ hasScope: true, services: group.services });
    }
  }
  return [...groups].map(([scopeName, items]) => ({ scopeName, services: combineProgressBreakdowns(items)?.services ?? [] }));
}
