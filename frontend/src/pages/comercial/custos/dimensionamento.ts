import {
  DIMENSIONING_TYPES,
  dimensioningServiceAllowed,
  type DimensioningType
} from '../../../../../shared/comercial/dist/dimensioning.js';

type RecordItem = Record<string, unknown>;
const records = (value: unknown): RecordItem[] =>
  Array.isArray(value) ? value : [];
const id = (prefix: string) =>
  `${prefix}-${
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  }`;

export function novoSistemaDimensionado(type: DimensioningType): RecordItem {
  return {
    id: id(type),
    description: '',
    quantity: 1,
    serviceIds: [],
    ...(type === 'oil'
      ? { oilType: '', oilBrandViscosity: '', volumeLiters: 0 }
      : {
          material: 'carbon_steel',
          ...(type === 'pipes'
            ? {
                lengthM: 0,
                lengthUnit: 'm',
                internalDiameterMm: 0,
                diameterUnit: 'in',
                fillPercent: 100
              }
            : { volumeLiters: 0, included: true })
        })
  };
}

export function novoCircuito(): RecordItem {
  return {
    id: id('circuito'),
    name: '',
    material: 'other',
    servicesByItem: true,
    pipeSegments: [],
    hoseSegments: [],
    equipmentVolumes: [],
    reservoirVolumes: [],
    manualVolumes: [],
    cycles: 1,
    enabled: true
  };
}

/** Reabre rascunhos anteriores sem esconder volumes em uma seção removida. */
export function atualizarDimensionamento(draft: RecordItem): RecordItem {
  const systems = records(draft.volumeSystems);
  if (!systems.some((system) => system.servicesByItem !== true)) return draft;
  return {
    ...draft,
    volumeSystems: systems.map((system) => {
      if (system.servicesByItem === true) return system;
      const services = records(draft.circuitServices)
        .filter((service) => service.systemId === system.id)
        .map((service) => String(service.serviceId));
      const result = { ...system, servicesByItem: true, hoseSegments: [] };
      for (const type of DIMENSIONING_TYPES) {
        const items: RecordItem[] =
          type.id === 'pipes'
            ? [
                ...records(system.pipeSegments),
                ...records(system.hoseSegments).map((item) => ({
                  ...item,
                  id: `legacy-hose-${item.id}`,
                  diameterUnit: 'mm'
                }))
              ]
            : records(system[type.collection]);
        Object.assign(result, {
          [type.collection]: items.map((item) => ({
            ...item,
            ...(type.id === 'oil'
              ? {
                  quantity: 1,
                  volumeLiters:
                    Number(item.volumeLiters || 0) * Number(item.quantity ?? 1)
                }
              : { material: item.material || system.material || 'other' }),
            serviceIds:
              item.serviceIds ||
              services.filter((service) =>
                dimensioningServiceAllowed(type.id, service)
              )
          }))
        });
      }
      return result;
    })
  };
}
