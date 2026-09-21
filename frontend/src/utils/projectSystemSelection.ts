import type { ProjectSystem } from '../api/projectSystems';
import { cleaningModePatch, isSystemCleaning } from './cleaningMeasurement';

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
  if (!match || !['limpeza', 'limpeza_quimica'].includes(String(serviceType).toLowerCase()) || match.id === data.__projectSystemId) return patch;
  const modes = new Set(match.measurements?.filter(item => ['limpeza', 'limpeza_quimica'].includes(item.serviceType.toLowerCase())).map(item => item.systemType));
  // Se o cronograma tem as duas modalidades, a escolha explícita do colaborador prevalece.
  if (modes.size === 1 && modes.has('SISTEMA')) Object.assign(patch, cleaningModePatch('Não'));
  else if (modes.size === 1 && modes.has('TUBULACAO') && isSystemCleaning(data)) Object.assign(patch, cleaningModePatch('Sim'));
  return patch;
}
