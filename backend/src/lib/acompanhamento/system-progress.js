import { resolveProjectSystem } from './project-systems.js';

const round = (value, places = 2) => Math.round(value * 10 ** places) / 10 ** places;

// Pol e mm permanecem distintos: diâmetro nominal em polegadas não equivale ao diâmetro
// externo de um tubo em mm. Só normalizamos representações dentro da mesma unidade.
export function diameterKey(value, unit = 'pol') {
  const text = String(value ?? '').trim().replace(/(?:pol(?:egadas?)?|mm|["'″′”“’]{1,2})$/i, '').trim().replace(',', '.');
  if (!text) return '';
  const fraction = /^(?:(\d+)\s+)?(\d+)\/(\d+)$/.exec(text);
  const number = fraction && Number(fraction[3]) > 0
    ? Number(fraction[1] || 0) + Number(fraction[2]) / Number(fraction[3]) : Number(text);
  return `${unit === 'mm' ? 'mm' : 'pol'}:${Number.isFinite(number) && number > 0 ? round(number, 8) : text}`;
}

export function buildSystemProgress(plannedServices, realizedByType, normalizeServiceType) {
  const registry = [...new Map(plannedServices.flatMap(service => service.systems ?? [])
    .filter(row => row.projectSystem).map(row => [row.projectSystem.id, row.projectSystem])).values()];
  const grouped = new Map(), pending = new Map();
  for (const service of plannedServices) {
    const type = normalizeServiceType(service.serviceType) ?? service.serviceType;
    if (!grouped.has(type)) grouped.set(type, { serviceType: type, weight: 0, rows: new Map() });
    const entry = grouped.get(type);
    entry.weight += Number(service.weight ?? 1);
    for (const row of service.systems ?? []) {
      const id = row.projectSystemId || '', linked = Boolean(id);
      // Escopo legado mantém a agregação anterior. Bitola só delimita escopos por sistema.
      const bitola = linked && row.systemType === 'TUBULACAO' ? diameterKey(row.diameter, row.diameterUnit) : '';
      const key = JSON.stringify([id, row.systemType, row.unit, bitola]);
      if (!entry.rows.has(key)) entry.rows.set(key, {
        projectSystemId: id || null, equipment: row.projectSystem?.equipment ?? null,
        systemName: row.projectSystem?.name ?? null,
        systemType: row.systemType, unit: row.unit, diameter: bitola ? row.diameter : null,
        diameterUnit: bitola ? row.diameterUnit || 'pol' : null,
        plannedQty: null, realizedQty: 0, bitola
      });
      const bucket = entry.rows.get(key);
      if (row.quantity != null && Number.isFinite(Number(row.quantity))) bucket.plannedQty = (bucket.plannedQty ?? 0) + Number(row.quantity);
    }
  }
  const addPending = (type, measurement, match) => {
    const key = JSON.stringify([type, measurement.equipment, measurement.system, measurement.systemType, measurement.bitola, measurement.projectSystemId || null, match?.id || null]);
    if (!pending.has(key)) pending.set(key, {
      serviceType: type, equipment: measurement.equipment || 'Não informado', system: measurement.system || 'Não informado',
      projectSystemId: measurement.projectSystemId || null,
      matchedSystem: match ? { id: match.id, equipment: match.equipment, name: match.name } : null,
      systemType: measurement.systemType, unit: { TUBULACAO: 'M', OLEO: 'L', SISTEMA: 'UN' }[measurement.systemType],
      diameter: measurement.diameter || null, diameterUnit: measurement.diameterUnit || null, quantity: 0
    });
    pending.get(key).quantity += measurement.quantity;
  };
  const services = [...grouped.values()].map(service => {
    const rows = [...service.rows.values()];
    const realized = realizedByType.get(service.serviceType) ?? {};
    const legacyMetrics = new Set(rows.filter(row => !row.projectSystemId).map(row => row.systemType));
    for (const row of rows.filter(row => !row.projectSystemId)) {
      row.realizedQty = realized[{ TUBULACAO: 'tubulacaoM', OLEO: 'oleoL', SISTEMA: 'sistemasUn' }[row.systemType]] ?? 0;
    }
    for (const measurement of realized.measurements ?? []) {
      if (legacyMetrics.has(measurement.systemType)) continue;
      const match = resolveProjectSystem(registry, { ...measurement, serviceType: service.serviceType });
      const candidates = match ? rows.filter(row => row.projectSystemId === match.id && row.systemType === measurement.systemType) : [];
      const bucket = candidates.find(row => row.bitola && row.bitola === measurement.bitola)
        ?? candidates.find(row => !row.bitola);
      if (bucket) bucket.realizedQty += measurement.quantity;
      else addPending(service.serviceType, measurement, match);
    }
    const metrics = new Map();
    const systems = rows.map(({ bitola: _bitola, ...row }) => {
      const measurable = row.plannedQty != null && row.plannedQty > 0;
      if (measurable) {
        const metric = metrics.get(row.systemType) ?? { planned: 0, completed: 0 };
        metric.planned += row.plannedQty;
        metric.completed += row.realizedQty;
        metrics.set(row.systemType, metric);
      }
      return { ...row, realizedQty: round(row.realizedQty), pct: measurable ? round(row.realizedQty / row.plannedQty * 100, 1) : null };
    });
    const pcts = [...metrics.values()].map(metric => metric.completed / metric.planned * 100);
    return { serviceType: service.serviceType, weight: service.weight, systems, executionPct: pcts.length ? round(pcts.reduce((sum, pct) => sum + pct, 0) / pcts.length, 1) : null };
  });
  const weighted = services.filter(service => service.executionPct !== null);
  const totalWeight = weighted.reduce((sum, service) => sum + service.weight, 0);
  return {
    hasScope: weighted.length > 0,
    progressPct: totalWeight > 0 ? round(weighted.reduce((sum, service) => sum + service.weight * service.executionPct, 0) / totalWeight, 1) : null,
    services, pendingMeasurements: [...pending.values()].map(item => ({ ...item, quantity: round(item.quantity) }))
  };
}
