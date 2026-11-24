import { MECHANICAL_MEASURES } from '../../../shared/modules/mechanical-measurement.js';
import type { ProjectSystem } from '../api/projectSystems';
import { cleaningModePatch, flushingMode, flushingModePatch, isSystemCleaning } from './cleaningMeasurement';
import { isPressureHoseUnits, pressureHoseModePatch } from './pressureHoseMeasurement';

export const systemNameKey = (value: unknown) => String(value ?? '').normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '').trim().toLowerCase().replace(/\s+/g, ' ');

// Mesma chave de escopo do backend (avanco.js): nome normalizado; sem nome = "Sem escopo definido".
export const NO_SCOPE_KEY = '__sem-escopo__';
export const scopeKeyOf = (scopeName: string | null | undefined) => systemNameKey(scopeName) || NO_SCOPE_KEY;

export function projectSystemSuggestionOptions(registry: ProjectSystem[], field: 'equipmentId' | 'system',
  equipment: unknown, editingScope?: ProjectSystem[]) {
  // No relatório, apenas identidades com metas atuais. No editor, as linhas atuais
  // do formulário substituem o escopo salvo (inclusive após remover uma linha).
  const currentSystems = editingScope ?? registry.filter(item => item.measurements?.length);
  return [...new Set(currentSystems
    .filter(item => field === 'equipmentId' || systemNameKey(item.equipment) === systemNameKey(equipment))
    .map(item => field === 'equipmentId' ? item.equipment : item.name))];
}

export function projectSystemSelectionPatch(systems: ProjectSystem[], data: Record<string, unknown>,
  field: 'equipmentId' | 'system', value: string, serviceType?: string) {
  const next = { ...data, [field]: value };
  const match = systems.find(item => systemNameKey(item.equipment) === systemNameKey(next.equipmentId) && systemNameKey(item.name) === systemNameKey(next.system));
  const patch: Record<string, unknown> = { [field]: value, __projectSystemId: match?.id || null };
  const type = String(serviceType).toLowerCase();
  if (['mecanica', 'limpeza_mecanica'].includes(type)) {
    const units = [...new Set(match?.measurements?.filter(item => ['mecanica', 'limpeza_mecanica'].includes(item.serviceType.toLowerCase()))
      .map(item => MECHANICAL_MEASURES[item.systemType]?.unit).filter(Boolean))];
    if (match?.id !== data.__projectSystemId || units.length === 1 && units[0] !== data.unidadeMecanica) {
      Object.assign(patch, { unidadeMecanica: units.length === 1 ? units[0] : '', quantidadeMecanica: '' });
    }
    return patch;
  }
  if (!match || match.id === data.__projectSystemId) return patch;
  const mode = scopedMeasurementMode(match, type);
  if (['pressao', 'teste_pressao'].includes(type)) {
    if (mode === 'MANGOTE') Object.assign(patch, pressureHoseModePatch(true));
    else if (mode === 'TUBULACAO' && isPressureHoseUnits(data)) Object.assign(patch, pressureHoseModePatch(false));
    return patch;
  }
  if (type === 'flushing') {
    if (mode === 'TUBULACAO' && flushingMode(data) === 'Não') Object.assign(patch, flushingModePatch('Sim'));
    return patch;
  }
  if (!['limpeza', 'limpeza_quimica'].includes(type)) return patch;
  // Se o cronograma tem as duas modalidades, a escolha explícita do colaborador prevalece.
  if (mode === 'SISTEMA') Object.assign(patch, cleaningModePatch('Não'));
  else if (mode === 'TUBULACAO' && isSystemCleaning(data)) Object.assign(patch, cleaningModePatch('Sim'));
  return patch;
}

export type ScopedMeasurementMode = 'TUBULACAO' | 'SISTEMA' | 'MANGOTE';

const SCOPE_SERVICE_TYPES: Record<string, string[]> = {
  limpeza: ['limpeza', 'limpeza_quimica'], limpeza_quimica: ['limpeza', 'limpeza_quimica'],
  pressao: ['pressao', 'teste_pressao'], teste_pressao: ['pressao', 'teste_pressao'],
  flushing: ['flushing']
};

// Sistema do escopo vinculado ao serviço: pelo vínculo salvo ou, sem ele, pelo nome.
export function selectedProjectSystem(systems: ProjectSystem[], data: Record<string, unknown>) {
  if (data.__projectSystemId) return systems.find(item => item.id === data.__projectSystemId);
  return systems.find(item => systemNameKey(item.equipment) === systemNameKey(data.equipmentId)
    && systemNameKey(item.name) === systemNameKey(data.system));
}

// Modalidade de medição que o escopo define sem ambiguidade para o serviço; null = colaborador escolhe.
export function scopedMeasurementMode(system: ProjectSystem | undefined, serviceType: string): ScopedMeasurementMode | null {
  const accepted = SCOPE_SERVICE_TYPES[String(serviceType).toLowerCase()];
  if (!system || !accepted) return null;
  const modes = new Set(system.measurements?.filter(item => accepted.includes(item.serviceType.toLowerCase())).map(item => item.systemType));
  // No flushing o óleo (L) acompanha a tubulação; só a tubulação define a modalidade.
  if (accepted.includes('flushing')) return modes.has('TUBULACAO') ? 'TUBULACAO' : null;
  const [only] = modes;
  return modes.size === 1 && (only === 'TUBULACAO' || only === 'SISTEMA' || only === 'MANGOTE') ? only : null;
}
