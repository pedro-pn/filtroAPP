import { resolveProjectSystem, systemNameKey } from './project-systems.js';

const round = (value, places = 2) => Math.round(value * 10 ** places) / 10 ** places;
const METRICS = { TUBULACAO: ['tubulacaoM', 'M'], OLEO: ['oleoL', 'L'], SISTEMA: ['sistemasUn', 'UN'], MANGOTE: ['mangotesUn', 'UN'] };

// O total do serviço independe do vínculo de cada medição. Escopo e equipamento
// também recebem os quantitativos identificados sem presumir um sistema específico.
export function summarizeProgressSystems(systems, realized = null) {
  const metrics = new Map();
  for (const row of systems) {
    const metric = metrics.get(row.systemType) ?? { plannedQty: 0, realizedQty: 0 };
    metric.plannedQty += Math.max(0, Number(row.plannedQty) || 0);
    metric.realizedQty += Number(row.realizedQty) || 0;
    metrics.set(row.systemType, metric);
  }
  for (const [type, [field]] of Object.entries(METRICS)) {
    if (realized?.[field] && !metrics.has(type)) metrics.set(type, { plannedQty: 0, realizedQty: 0 });
  }
  return [...metrics].map(([systemType, metric]) => {
    const plannedQty = metric.plannedQty > 0 ? metric.plannedQty : null;
    const realizedQty = realized ? realized[METRICS[systemType]?.[0]] ?? 0 : metric.realizedQty;
    return { systemType, unit: METRICS[systemType]?.[1] ?? null, plannedQty,
      realizedQty: round(realizedQty), pct: plannedQty ? round(realizedQty / plannedQty * 100, 1) : null };
  });
}

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

const rowBitola = row => row.projectSystemId && row.systemType === 'TUBULACAO' ? diameterKey(row.diameter, row.diameterUnit) : '';
const rowKey = row => JSON.stringify([row.projectSystemId || '', row.systemType, row.unit, rowBitola(row)]);
const equipmentKey = name => {
  const key = systemNameKey(name);
  const ug = /^(?:ug|unidade geradora)\s*[-:#]?\s*0*(\d+)$/.exec(key);
  return ug ? `ug:${Number(ug[1])}` : key;
};

function scopeAttribution(rows, measurement) {
  const equipment = equipmentKey(measurement.equipment);
  if (!equipment) return null;
  const candidates = rows.filter(row => row.systemType === measurement.systemType && Number(row.quantity) > 0
    && equipmentKey(row.projectSystem?.equipment) === equipment
    && (!Object.hasOwn(measurement, 'scopeName') || systemNameKey(row.scopeName) === systemNameKey(measurement.scopeName)));
  const groups = new Map(candidates.map(row => [JSON.stringify([systemNameKey(row.scopeName), equipment]), {
    scopeName: row.scopeName, equipment: row.projectSystem.equipment
  }]));
  return groups.size === 1 ? [...groups.values()][0] : null;
}

export function buildSystemProgress(plannedServices, realizedByType, normalizeServiceType, {
  includeUnmatched = true, referencePlannedServices = plannedServices
} = {}) {
  const registry = [...new Map(referencePlannedServices.flatMap(service => service.systems ?? [])
    .filter(row => row.projectSystem).map(row => [row.projectSystem.id, row.projectSystem])).values()];
  const referenceRows = new Map();
  for (const service of referencePlannedServices) {
    const type = normalizeServiceType(service.serviceType) ?? service.serviceType;
    if (!referenceRows.has(type)) referenceRows.set(type, []);
    referenceRows.get(type).push(...(service.systems ?? []).map(row => ({ ...row, scopeName: service.scopeName?.trim() || null })));
  }
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
      const key = rowKey(row);
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
  const addPending = (type, measurement, match, attributedScope) => {
    const key = JSON.stringify([type, measurement.equipment, measurement.system, measurement.systemType, measurement.bitola, measurement.projectSystemId || null, match?.id || null, measurement.scopeName, attributedScope]);
    if (!pending.has(key)) pending.set(key, {
      serviceType: type, equipment: measurement.equipment || 'Não informado', system: measurement.system || 'Não informado',
      projectSystemId: measurement.projectSystemId || null,
      ...(attributedScope ? { attributedScope } : {}),
      matchedSystem: match ? { id: match.id, equipment: match.equipment, name: match.name } : null,
      systemType: measurement.systemType, unit: { TUBULACAO: 'M', OLEO: 'L', SISTEMA: 'UN', MANGOTE: 'UN' }[measurement.systemType],
      diameter: measurement.diameter || null, diameterUnit: measurement.diameterUnit || null, quantity: 0
    });
    pending.get(key).quantity += measurement.quantity;
  };
  const services = [...grouped.values()].map(service => {
    const rows = [...service.rows.values()];
    const allRows = referenceRows.get(service.serviceType) ?? [];
    const attributed = [];
    const realized = realizedByType.get(service.serviceType) ?? {};
    const legacyMetrics = new Set(rows.filter(row => !row.projectSystemId).map(row => row.systemType));
    for (const row of rows.filter(row => !row.projectSystemId)) {
      row.realizedQty = realized[{ TUBULACAO: 'tubulacaoM', OLEO: 'oleoL', SISTEMA: 'sistemasUn', MANGOTE: 'mangotesUn' }[row.systemType]] ?? 0;
    }
    for (const measurement of realized.measurements ?? []) {
      if (legacyMetrics.has(measurement.systemType)) continue;
      const match = resolveProjectSystem(registry, { ...measurement, serviceType: service.serviceType });
      const candidates = match ? allRows.filter(row => row.projectSystemId === match.id && row.systemType === measurement.systemType) : [];
      const target = candidates.find(row => rowBitola(row) && rowBitola(row) === measurement.bitola)
        ?? candidates.find(row => !rowBitola(row));
      if (target) {
        const bucket = service.rows.get(rowKey(target));
        if (bucket) bucket.realizedQty += measurement.quantity;
        continue;
      }
      const attribution = scopeAttribution(allRows, measurement);
      const belongsHere = attribution && plannedServices.some(planned =>
        (normalizeServiceType(planned.serviceType) ?? planned.serviceType) === service.serviceType
        && systemNameKey(planned.scopeName) === systemNameKey(attribution.scopeName)
        && planned.systems?.some(row => row.systemType === measurement.systemType
          && equipmentKey(row.projectSystem?.equipment) === equipmentKey(attribution.equipment)));
      if (attribution && !belongsHere) continue;
      if (belongsHere) attributed.push({ systemType: measurement.systemType, realizedQty: measurement.quantity });
      addPending(service.serviceType, measurement, match, attribution);
    }
    const systems = rows.map(({ bitola: _bitola, ...row }) => {
      const measurable = row.plannedQty != null && row.plannedQty > 0;
      return { ...row, realizedQty: round(row.realizedQty), pct: measurable ? round(row.realizedQty / row.plannedQty * 100, 1) : null };
    });
    const totals = summarizeProgressSystems([...rows, ...attributed], includeUnmatched ? realized : null);
    const pcts = totals.filter(metric => metric.plannedQty > 0).map(metric => metric.realizedQty / metric.plannedQty * 100);
    return { serviceType: service.serviceType, weight: service.weight, systems, totals,
      executionPct: pcts.length ? round(pcts.reduce((sum, pct) => sum + pct, 0) / pcts.length, 1) : null };
  });
  const weighted = services.filter(service => service.executionPct !== null);
  const totalWeight = weighted.reduce((sum, service) => sum + service.weight, 0);
  return {
    hasScope: weighted.length > 0,
    progressPct: totalWeight > 0 ? round(weighted.reduce((sum, service) => sum + service.weight * service.executionPct, 0) / totalWeight, 1) : null,
    services, pendingMeasurements: [...pending.values()].map(item => ({ ...item, quantity: round(item.quantity) }))
  };
}
