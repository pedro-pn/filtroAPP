import { historicalError } from '../reports/historical-services.js';

// Deliberadamente conservador: não equipara UG 1/UG 01, RV/regulador, nem nomes compostos.
// Essas correspondências só passam a valer após confirmação explícita de um alias.
export const systemNameKey = value => String(value ?? '').normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '').trim().toLowerCase().replace(/\s+/g, ' ');

export function resolveProjectSystem(systems, { projectSystemId, equipment, system, serviceType } = {}) {
  if (projectSystemId) return systems.find(item => item.id === projectSystemId) ?? null;
  const equipmentKey = systemNameKey(equipment), nameKey = systemNameKey(system);
  if (!equipmentKey || !nameKey) return null;
  const matches = systems.filter(item => (
    systemNameKey(item.equipment) === equipmentKey && systemNameKey(item.name) === nameKey
  ) || (Array.isArray(item.aliases) && item.aliases.some(alias =>
    systemNameKey(alias.equipment) === equipmentKey && systemNameKey(alias.system) === nameKey
    && alias.serviceType === serviceType
  )));
  return matches.length === 1 ? matches[0] : null;
}

export async function resolvePlannedSystem(client, projectId, row) {
  const equipment = String(row.equipment ?? '').trim(), name = String(row.systemName ?? '').trim();
  if (!equipment && !name && !row.projectSystemId) return null; // escopos anteriores continuam globais
  if (!equipment || !name) throw historicalError('Preencha equipamento/UG e sistema juntos.');
  const equipmentKey = systemNameKey(equipment), nameKey = systemNameKey(name);
  if (row.projectSystemId) {
    const existing = await client.projectServiceSystem.findFirst({ where: { id: row.projectSystemId, projectId } });
    if (!existing || existing.equipmentKey !== equipmentKey || existing.nameKey !== nameKey) {
      throw historicalError('O sistema selecionado não corresponde ao projeto ou aos nomes informados. Selecione novamente.');
    }
    return existing.id;
  }
  const item = await client.projectServiceSystem.upsert({
    where: { projectId_equipmentKey_nameKey: { projectId, equipmentKey, nameKey } },
    create: { projectId, equipment, name, equipmentKey, nameKey }, update: {}
  });
  return item.id;
}

export async function assertReportProjectSystems(client, projectId, services = []) {
  const linked = services.filter(service => service.extraData?.__projectSystemId);
  if (!linked.length) return;
  const systems = await client.projectServiceSystem.findMany({ where: { projectId } });
  for (const service of linked) {
    const data = service.extraData;
    const match = systems.find(item => item.id === data.__projectSystemId);
    if (!match || systemNameKey(match.equipment) !== systemNameKey(data.equipmentId || data['Equipamento(s)'])
      || systemNameKey(match.name) !== systemNameKey(service.system ?? data.system)) {
      throw historicalError('Equipamento/sistema não corresponde à sugestão selecionada neste projeto. Selecione novamente ou digite livremente.');
    }
  }
}

export async function saveSystemAlias(client, { projectId, id, equipment, system, serviceType, revision, remove = false }) {
  return client.$transaction(async tx => {
    const systems = await tx.projectServiceSystem.findMany({ where: { projectId } });
    const target = systems.find(item => item.id === id);
    if (!target) throw historicalError('Sistema não encontrado neste projeto.', 404);
    const alias = { equipment: equipment.trim(), system: system.trim(), serviceType };
    const same = item => systemNameKey(item.equipment) === systemNameKey(alias.equipment)
      && systemNameKey(item.system) === systemNameKey(alias.system) && item.serviceType === serviceType;
    const owner = resolveProjectSystem(systems, alias);
    if (!remove && ((owner && owner.id !== id) || systems.some(item => item.id !== id && (
      item.aliases?.some(same) || (systemNameKey(item.equipment) === systemNameKey(alias.equipment) && systemNameKey(item.name) === systemNameKey(alias.system))
    )))) {
      throw historicalError('Este nome já corresponde a outro sistema. Remova a associação anterior antes de alterá-la.', 409);
    }
    const aliases = (Array.isArray(target.aliases) ? target.aliases : []).filter(item => !same(item));
    if (!remove) aliases.push(alias);
    const result = await tx.projectServiceSystem.updateMany({ where: { id, projectId, revision }, data: { aliases, revision: { increment: 1 } } });
    if (result.count !== 1) throw historicalError('O cadastro mudou. Atualize a lista antes de salvar.', 409);
    return tx.projectServiceSystem.findUnique({ where: { id } });
  }, { isolationLevel: 'Serializable' });
}
