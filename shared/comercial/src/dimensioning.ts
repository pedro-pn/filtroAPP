import {
  TECHNICAL_SERVICE_CATALOG,
  type TechnicalServiceId,
} from './technical-services.js';

export const DIMENSIONING_TYPES = [
  { id: 'pipes', collection: 'pipeSegments', title: 'Tubulações' },
  { id: 'reservoirs', collection: 'reservoirVolumes', title: 'Reservatórios' },
  { id: 'oil', collection: 'manualVolumes', title: 'Volume de óleo' },
  {
    id: 'equipment',
    collection: 'equipmentVolumes',
    title: 'Equipamentos avulsos',
  },
] as const;
export type DimensioningType = (typeof DIMENSIONING_TYPES)[number]['id'];
export type DimensioningCollection =
  (typeof DIMENSIONING_TYPES)[number]['collection'];

/** Mesmos fluidos contemplados pelos serviços de filtragem/desidratação do catálogo. */
export const OIL_TYPES = [
  'Óleo lubrificante',
  'Óleo hidráulico',
  'Óleo térmico',
  'Óleo diesel',
  'Óleo de têmpera',
] as const;
export const SYSTEM_MATERIALS = [
  { value: 'carbon_steel', label: 'Aço carbono' },
  { value: 'stainless_steel', label: 'Aço inox' },
  { value: 'other', label: 'Outro' },
] as const;

export type DimensioningFields = {
  serviceIds?: string[];
  material?: 'carbon_steel' | 'stainless_steel' | 'other';
  oilType?: string;
  oilBrandViscosity?: string;
};

const PIPE_SERVICES: TechnicalServiceId[] = [
  'limpeza_quimica',
  'teste_hidrostatico',
  'flushing_primario',
  'flushing_secundario',
  'flushing_agua',
  'hidrojateamento',
  'boroscopia',
  'passagem_pig',
];
const RESERVOIR_SERVICES: TechnicalServiceId[] = [
  'limpeza_quimica',
  'teste_hidrostatico',
  'hidrojateamento',
  'boroscopia',
  'limpeza_reservatorio',
];

export function servicesForDimensioning(type: DimensioningType) {
  return TECHNICAL_SERVICE_CATALOG.filter((service) => {
    if (type === 'equipment') return true;
    if (type === 'pipes') return PIPE_SERVICES.includes(service.id);
    if (type === 'reservoirs') return RESERVOIR_SERVICES.includes(service.id);
    return (
      service.id.startsWith('filtragem_') ||
      service.id.startsWith('desidratacao_')
    );
  });
}

export function dimensioningServiceAllowed(
  type: DimensioningType,
  serviceId: string,
) {
  return servicesForDimensioning(type).some(
    (service) => service.id === serviceId,
  );
}

type Item = DimensioningFields & {
  id: string;
  description: string;
  included?: boolean;
};
type System = Partial<Record<DimensioningCollection, Item[]>>;

export function dimensioningItems(system: System) {
  return DIMENSIONING_TYPES.flatMap((type) =>
    (system[type.collection] || []).map((item, index) => ({
      type: type.id,
      collection: type.collection,
      item,
      index,
    })),
  );
}
