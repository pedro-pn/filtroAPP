import type { ReportSummary } from '../../types/domain';
import { normalizeServiceType } from '../../utils/reportServicePayload';

type ReportServiceSummary = NonNullable<ReportSummary['services']>[number];

function stringifyServiceKeyValue(value: unknown): string {
  if (Array.isArray(value)) return value.map(stringifyServiceKeyValue).filter(Boolean).join('|');
  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => {
        const text = stringifyServiceKeyValue(item);
        return text ? `${key}:${text}` : '';
      })
      .filter(Boolean)
      .join('|');
  }
  return String(value || '');
}

function serviceKeyPart(value: unknown): string {
  return stringifyServiceKeyValue(value)
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/\s+/g, ' ');
}

function firstServiceKeyPart(extra: Record<string, unknown>, names: string[]): string {
  for (const name of names) {
    const part = serviceKeyPart(extra[name]);
    if (part) return part;
  }
  return '';
}

export function serviceDisambiguatorParts(service: ReportServiceSummary) {
  const extra = service.extraData || {};
  const type = normalizeServiceType(service.serviceType || '');
  const material = serviceKeyPart(service.material) || firstServiceKeyPart(extra, ['Material da tubulação', 'Material da tubulacao', 'Material do equipamento']);
  const parts = material ? [`material:${material}`] : [];

  if (type === 'filtragem' || type === 'flushing') {
    const oilType = firstServiceKeyPart(extra, ['Tipo de óleo', 'Tipo de oleo', 'tipoOleo']);
    const oilVolume = firstServiceKeyPart(extra, ['Volume de óleo', 'Volume de oleo', 'volumeOleo']);
    if (oilType) parts.push(`oleo:${oilType}`);
    if (oilVolume) parts.push(`volume:${oilVolume}`);
    if (type === 'flushing') {
      const flushingTubing = firstServiceKeyPart(extra, ['Flushing em tubulação?', 'Flushing em tubulacao?', 'flushingTubulacao']);
      const flushingType = firstServiceKeyPart(extra, ['Tipo de flushing', 'tipoFlushing']);
      if (flushingTubing) parts.push(`tubulacao:${flushingTubing}`);
      if (flushingType) parts.push(`flushing:${flushingType}`);
    }
  }

  if (type === 'pressao') {
    const testedEquipment = firstServiceKeyPart(extra, ['Equipamento testado', 'equipamentoTestado']);
    const testedEquipmentOther = firstServiceKeyPart(extra, ['Outro equipamento testado', 'equipamentoTestadoOutro']);
    const workPressure = firstServiceKeyPart(extra, ['Pressão de trabalho', 'Pressao de trabalho', 'pressaoTrabalho']);
    const testPressure = firstServiceKeyPart(extra, ['Pressão de teste', 'Pressao de teste', 'pressaoTeste']);
    const testFluid = firstServiceKeyPart(extra, ['Fluido de teste', 'fluidoTeste']);
    const testOil = firstServiceKeyPart(extra, ['Qual óleo?', 'Qual oleo?', 'qualOleo']);
    if (testedEquipment) parts.push(`equipamento-testado:${testedEquipment}`);
    if (testedEquipmentOther) parts.push(`equipamento-testado-outro:${testedEquipmentOther}`);
    if (workPressure) parts.push(`ptrabalho:${workPressure}`);
    if (testPressure) parts.push(`pteste:${testPressure}`);
    if (testFluid) parts.push(`fluido:${testFluid}`);
    if (testOil) parts.push(`oleo:${testOil}`);
  }

  if (type === 'limpeza') {
    const tubing = firstServiceKeyPart(extra, ['Limpeza de tubulação?', 'Limpeza de tubulacao?', 'limpezaTubulacao']);
    const method = firstServiceKeyPart(extra, ['Método de limpeza', 'Metodo de limpeza', 'metodos']);
    const location = firstServiceKeyPart(extra, ['Local de limpeza', 'local']);
    const inspection = firstServiceKeyPart(extra, ['Tipo de inspeção', 'Tipo de inspecao', 'tipoInspecao']);
    if (tubing) parts.push(`tubulacao:${tubing}`);
    if (method) parts.push(`metodo:${method}`);
    if (location) parts.push(`local:${location}`);
    if (inspection) parts.push(`inspecao:${inspection}`);
  }
  return parts;
}

export function parseDurationToMinutes(value: string) {
  const parts = String(value || '').split(':').map(part => Number(part));
  if (parts.some(part => Number.isNaN(part))) return 0;
  return (parts[0] || 0) * 60 + (parts[1] || 0);
}

export function workedMinutes(start: string, end: string, breakValue: string) {
  const startMinutes = parseDurationToMinutes(start);
  const endMinutes = parseDurationToMinutes(end);
  if (!start || !end) return 0;
  const total = endMinutes >= startMinutes ? endMinutes - startMinutes : endMinutes + 24 * 60 - startMinutes;
  return Math.max(0, total - parseDurationToMinutes(breakValue));
}

export function formatMinutes(total: number) {
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}
