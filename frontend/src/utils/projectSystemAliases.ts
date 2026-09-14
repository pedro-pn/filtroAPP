import type { PendingSystemMeasurement } from '../api/acompanhamentoComercial';
import type { ProjectSystem, ProjectSystemAlias } from '../api/projectSystems';
import { systemNameKey } from './projectSystemSelection';

export const projectSystemAliasKey = (alias: ProjectSystemAlias) => JSON.stringify([
  systemNameKey(alias.equipment), systemNameKey(alias.system), alias.serviceType
]);

// Uma medição pode continuar pendente por falta de meta/bitola, mesmo com o nome resolvido.
// O cadastro também permite reconhecer aliases cujo destino foi retirado do escopo atual.
export function pendingMeasurementSystem(systems: ProjectSystem[], item: PendingSystemMeasurement) {
  if (item.projectSystemId) return systems.find(system => system.id === item.projectSystemId) ?? item.matchedSystem ?? null;
  const matches = systems.filter(system => (
    systemNameKey(system.equipment) === systemNameKey(item.equipment)
    && systemNameKey(system.name) === systemNameKey(item.system)
  ) || system.aliases?.some(alias => projectSystemAliasKey(alias) === projectSystemAliasKey(item)));
  // Não escolher automaticamente entre associações conflitantes.
  return matches.length === 1 ? matches[0] : null;
}
