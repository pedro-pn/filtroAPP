import { diameterKey } from './system-progress.js';
import { systemNameKey } from './project-systems.js';

const scopeName = service => service.scopeName?.trim() || null;
const scopeLabel = name => name || 'Sem escopo definido';
const serviceLabels = { LIMPEZA_QUIMICA: 'Limpeza química', TESTE_PRESSAO: 'Teste de pressão', FLUSHING: 'Flushing', FILTRAGEM: 'Filtragem' };
const round1 = value => Math.round(value * 10) / 10;
const measurementKey = row => JSON.stringify([
  row.projectSystemId || '', row.systemType, row.unit || '',
  row.projectSystemId && row.systemType === 'TUBULACAO' ? diameterKey(row.diameter, row.diameterUnit) : ''
]);

// Os relatórios não escolhem um escopo: cada combinação medível deve ter um único dono.
// Uma meta sem bitola engloba todas as bitolas e também conflita com metas específicas.
export function assertDistinctScopeMeasurements(services, normalizeServiceType) {
  const seen = new Map();
  for (const service of services) {
    const name = scopeName(service);
    const type = normalizeServiceType(service.serviceType) ?? service.serviceType;
    for (const row of service.systems ?? []) {
      const equipment = systemNameKey(row.equipment), system = systemNameKey(row.systemName);
      const linked = Boolean(row.projectSystemId || equipment || system);
      const key = JSON.stringify([type, row.systemType, equipment, system]);
      const bitola = linked && row.systemType === 'TUBULACAO' ? diameterKey(row.diameter, row.diameterUnit) : '';
      const previous = seen.get(key) ?? [];
      const conflict = previous.find(item => item.name !== name && (!item.bitola || !bitola || item.bitola === bitola));
      if (conflict) {
        throw new Error(`A medição de ${row.equipment || 'meta global'}${row.systemName ? ` · ${row.systemName}` : ''} (${serviceLabels[type] || type}${bitola ? `, diâmetro ${row.diameter} ${row.diameterUnit || 'pol'}` : ''}) aparece nos escopos “${scopeLabel(conflict.name)}” e “${scopeLabel(name)}”. Agrupe essa medição em um único escopo.`);
      }
      previous.push({ name, bitola });
      seen.set(key, previous);
    }
  }
}

function executionPct(systems) {
  const measurable = systems.filter(row => row.plannedQty > 0);
  if (!measurable.length) return null;
  if (!measurable.some(row => row.projectSystemId)) {
    return round1(measurable.reduce((sum, row) => sum + row.pct, 0) / measurable.length);
  }
  const metrics = new Map();
  for (const row of measurable) {
    const metric = metrics.get(row.systemType) ?? { planned: 0, completed: 0 };
    metric.planned += row.plannedQty;
    metric.completed += row.realizedQty ?? 0;
    metrics.set(row.systemType, metric);
  }
  return round1([...metrics.values()].reduce((sum, metric) => sum + metric.completed / metric.planned * 100, 0) / metrics.size);
}

// Projeta os resultados já calculados nos grupos de exibição. Não refaz a associação dos
// relatórios e não altera serviços, quantitativos ou percentual gerais usados no histórico.
export function withScopeGroups(progress, plannedServices, normalizeServiceType) {
  if (!plannedServices.some(service => scopeName(service))) return progress;
  const groups = new Map();
  for (const service of plannedServices) {
    const name = scopeName(service), type = normalizeServiceType(service.serviceType) ?? service.serviceType;
    if (!groups.has(name)) groups.set(name, new Map());
    const services = groups.get(name);
    if (!services.has(type)) services.set(type, { weight: 0, keys: new Set() });
    const grouped = services.get(type);
    grouped.weight += Number(service.weight ?? 1);
    for (const row of service.systems ?? []) grouped.keys.add(measurementKey(row));
  }
  return { ...progress, scopeGroups: [...groups].map(([name, types]) => ({
    scopeName: name,
    services: [...types].flatMap(([type, group]) => {
      const original = progress.services.find(service => service.serviceType === type);
      if (!original) return [];
      const systems = original.systems.filter(row => group.keys.has(measurementKey(row)));
      return [{ ...original, weight: group.weight, systems, executionPct: systems.length === original.systems.length ? original.executionPct : executionPct(systems) }];
    })
  })) };
}
