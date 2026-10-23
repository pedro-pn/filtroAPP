import { mechanicalMeasurement, MECHANICAL_MEASURES } from '../../../../shared/modules/mechanical-measurement.js';
import { normalizeRdoServiceType } from '../acompanhamento/service-types.js';
import { systemNameKey } from '../acompanhamento/project-systems.js';

export async function assertMechanicalMeasurements(client, projectId, services = []) {
  const mechanical = services.filter(service => normalizeRdoServiceType(service.serviceType) === 'LIMPEZA_MECANICA');
  if (!mechanical.length) return;
  const planned = await client.projectPlannedService.findMany({ where: { projectId },
    include: { systems: { include: { projectSystem: true } } } });
  const rows = planned.filter(service => normalizeRdoServiceType(service.serviceType) === 'LIMPEZA_MECANICA')
    .flatMap(service => service.systems ?? []);
  for (const service of mechanical) {
    const data = service.extraData ?? {};
    const matching = rows.filter(row => data.__projectSystemId
      ? row.projectSystemId === data.__projectSystemId
      : row.projectSystem && systemNameKey(row.projectSystem.equipment) === systemNameKey(data.equipmentId || data['Equipamento(s)'])
        && systemNameKey(row.projectSystem.name) === systemNameKey(service.system ?? data.system));
    const hasInput = data.unidadeMecanica || data.quantidadeMecanica || data['Unidade da limpeza mecânica'] || data['Quantidade da limpeza mecânica'];
    // Relatórios anteriores sem quantitativo continuam editáveis.
    if (!matching.length && !hasInput) continue;
    const measurement = mechanicalMeasurement(data);
    if (!measurement || (matching.length && !matching.some(row => row.systemType === measurement.systemType && MECHANICAL_MEASURES[row.systemType]))) {
      throw Object.assign(new Error('Informe a quantidade da limpeza mecânica na unidade cadastrada para o equipamento/sistema.'), { statusCode: 400 });
    }
  }
}
