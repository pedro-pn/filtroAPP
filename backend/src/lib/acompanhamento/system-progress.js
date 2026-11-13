import { MECHANICAL_MEASURES } from '../../../../shared/modules/mechanical-measurement.js';
import { resolveProjectSystem, systemNameKey } from './project-systems.js';
import { dateInDivision } from './tracking-divisions.js';

const round = (value, places = 2) => Math.round(value * 10 ** places) / 10 ** places;
const METRICS = { ...Object.fromEntries(Object.entries(MECHANICAL_MEASURES).map(([type, config]) => [type, [config.metric, config.unit]])), TUBULACAO: ['tubulacaoM', 'M'], OLEO: ['oleoL', 'L'], SISTEMA: ['sistemasUn', 'UN'], MANGOTE: ['mangotesUn', 'UN'] };

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

function divisionScope(key) {
  try {
    const [kind, scopeName, equipment] = JSON.parse(key);
    return ['SCOPE', 'EQUIPMENT'].includes(kind) ? { kind, scopeName, equipment } : null;
  } catch { return null; }
}

export const hasScopeDivisions = divisions => divisions.some(division => divisionScope(division.key));

function sameScope(attribution, scope) {
  return systemNameKey(attribution.scopeName) === systemNameKey(scope.scopeName)
    && (scope.kind === 'SCOPE' || equipmentKey(attribution.equipment) === equipmentKey(scope.equipment));
}

function divisionAttributionResolver(divisions) {
  const scopes = divisions.flatMap(division => {
    const scope = divisionScope(division.key);
    return scope ? [{ ...scope, division }] : [];
  });
  return measurement => {
    if (measurement.reportType !== 'RDO' || measurement.systemType !== 'TUBULACAO'
      || !Object.hasOwn(measurement, 'scopeName') || !equipmentKey(measurement.equipment) || !measurement.reportDate) return null;
    const scope = scopes.find(scope => sameScope(measurement, scope) && dateInDivision(measurement.reportDate, scope.division));
    return scope ? { scopeName: scope.scopeName, equipment: measurement.equipment } : null;
  };
}

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

function groupPlannedSystems(plannedServices, normalizeServiceType) {
  const grouped = new Map();
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
  return grouped;
}

// O cadastro e a associação de uma medição não mudam entre os pontos da mesma
// curva. Este contexto pertence a um cálculo, nunca a um cache entre requisições.
export function createSystemProgressContext(referencePlannedServices, normalizeServiceType, { trackingDivisions = [] } = {}) {
  const resolveDivision = divisionAttributionResolver(trackingDivisions);
  const registry = [...new Map(referencePlannedServices.flatMap(service => service.systems ?? [])
    .filter(row => row.projectSystem).map(row => [row.projectSystem.id, row.projectSystem])).values()];
  const referenceRows = new Map();
  for (const service of referencePlannedServices) {
    const type = normalizeServiceType(service.serviceType) ?? service.serviceType;
    if (!referenceRows.has(type)) referenceRows.set(type, []);
    referenceRows.get(type).push(...(service.systems ?? []).map(row => ({ ...row, scopeName: service.scopeName?.trim() || null })));
  }
  const resolutionsByType = new Map();
  const templates = new WeakMap();
  return {
    groupsFor(plannedServices) {
      if (!templates.has(plannedServices)) templates.set(plannedServices, groupPlannedSystems(plannedServices, normalizeServiceType));
      return new Map([...templates.get(plannedServices)].map(([type, service]) => [type, {
        ...service, rows: new Map([...service.rows].map(([key, row]) => [key, { ...row }]))
      }]));
    },
    resolve(type, measurement) {
      if (!resolutionsByType.has(type)) resolutionsByType.set(type, new WeakMap());
      const resolutions = resolutionsByType.get(type);
      if (resolutions.has(measurement)) return resolutions.get(measurement);
      const allRows = referenceRows.get(type) ?? [];
      const match = resolveProjectSystem(registry, { ...measurement, serviceType: type });
      // Dentro da janela da divisão, escopo e UG do RDO prevalecem sobre
      // vínculos antigos e sobre bitolas cadastradas em outra obra.
      const division = resolveDivision(measurement);
      const candidates = match ? allRows.filter(row => row.projectSystemId === match.id && row.systemType === measurement.systemType
        && (!division || (systemNameKey(row.scopeName) === systemNameKey(division.scopeName)
          && equipmentKey(row.projectSystem?.equipment) === equipmentKey(division.equipment)))) : [];
      const target = candidates.find(row => rowBitola(row) && rowBitola(row) === measurement.bitola)
        ?? candidates.find(row => !rowBitola(row));
      const result = { match, target, division, attribution: target ? null : division ?? scopeAttribution(allRows, measurement) };
      resolutions.set(measurement, result);
      return result;
    }
  };
}

export function buildSystemProgress(plannedServices, realizedByType, normalizeServiceType, {
  includeUnmatched = true, referencePlannedServices = plannedServices, systemContext, trackingDivisions = [], divisionKey
} = {}) {
  const context = systemContext ?? createSystemProgressContext(referencePlannedServices, normalizeServiceType, { trackingDivisions });
  const grouped = context.groupsFor(plannedServices), pending = new Map();
  const selection = divisionScope(divisionKey);
  const includesDivision = attribution => selection ? sameScope(attribution, selection)
    : referencePlannedServices === plannedServices || plannedServices.some(planned =>
      systemNameKey(planned.scopeName) === systemNameKey(attribution.scopeName)
      && planned.systems?.some(row => equipmentKey(row.projectSystem?.equipment) === equipmentKey(attribution.equipment)));
  // Uma medição identificada na divisão continua visível mesmo sem meta
  // cadastrada para o serviço. Não inventa quantidade prevista nem peso.
  for (const [type, realized] of realizedByType) {
    if (!grouped.has(type) && realized.measurements?.some(measurement => {
      const { division } = context.resolve(type, measurement);
      return division && includesDivision(division);
    })) grouped.set(type, { serviceType: type, weight: 0, rows: new Map() });
  }
  const addPending = (type, measurement, match, attributedScope) => {
    const key = JSON.stringify([type, measurement.equipment, measurement.system, measurement.systemType, measurement.bitola, measurement.projectSystemId || null, match?.id || null, measurement.scopeName, attributedScope]);
    if (!pending.has(key)) pending.set(key, {
      serviceType: type, equipment: measurement.equipment || 'Não informado', system: measurement.system || 'Não informado',
      projectSystemId: measurement.projectSystemId || null,
      ...(attributedScope ? { attributedScope } : {}),
      matchedSystem: match ? { id: match.id, equipment: match.equipment, name: match.name } : null,
      systemType: measurement.systemType, unit: METRICS[measurement.systemType]?.[1],
      diameter: measurement.diameter || null, diameterUnit: measurement.diameterUnit || null, quantity: 0
    });
    pending.get(key).quantity += measurement.quantity;
  };
  const services = [...grouped.values()].map(service => {
    const rows = [...service.rows.values()];
    const attributed = [];
    const realized = realizedByType.get(service.serviceType) ?? {};
    const legacyMetrics = new Set(rows.filter(row => !row.projectSystemId).map(row => row.systemType));
    for (const row of rows.filter(row => !row.projectSystemId)) {
      const measurements = (realized.measurements ?? []).filter(measurement => measurement.systemType === row.systemType);
      row.realizedQty = measurements.some(measurement => context.resolve(service.serviceType, measurement).division)
        ? measurements.reduce((sum, measurement) => {
          const { division } = context.resolve(service.serviceType, measurement);
          return sum + (!division || includesDivision(division) ? measurement.quantity : 0);
        }, 0)
        : realized[METRICS[row.systemType]?.[0]] ?? 0;
    }
    for (const measurement of realized.measurements ?? []) {
      if (legacyMetrics.has(measurement.systemType)) continue;
      const { match, target, attribution, division } = context.resolve(service.serviceType, measurement);
      if (target) {
        const bucket = service.rows.get(rowKey(target));
        if (bucket) bucket.realizedQty += measurement.quantity;
        continue;
      }
      const belongsHere = attribution && (division ? includesDivision(division) : plannedServices.some(planned =>
        (normalizeServiceType(planned.serviceType) ?? planned.serviceType) === service.serviceType
        && systemNameKey(planned.scopeName) === systemNameKey(attribution.scopeName)
        && planned.systems?.some(row => row.systemType === measurement.systemType
          && equipmentKey(row.projectSystem?.equipment) === equipmentKey(attribution.equipment))));
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
