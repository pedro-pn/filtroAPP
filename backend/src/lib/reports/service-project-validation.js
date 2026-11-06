import { assertMechanicalMeasurements } from './mechanical-measurement.js';
import { assertReportProjectSystems } from '../acompanhamento/project-systems.js';
import { assertCleaningMeasurement } from './cleaning-measurement.js';
import { assertPressureHoseMeasurement } from './pressure-hose-measurement.js';
import { assertSystemTypeWhenVisible } from './system-type-validation.js';

export async function assertReportServicesProject(client, project, services) {
  if (project?.serviceCategory === 'RENTAL') throw Object.assign(new Error('Projetos de locação são acompanhados por dias e não recebem relatórios.'), { statusCode: 400 });
  const hasInhibition = (services || []).some(service => service.serviceType === 'inibicao');
  if (hasInhibition && !project?.inhibitionServiceEnabled) {
    throw Object.assign(new Error('Serviço de inibição não está habilitado para este projeto.'), { statusCode: 400 });
  }
  for (const [index, service] of (services || []).entries()) {
    const data = service.extraData || {};
    const equipment = data.equipmentId ?? data['Equipamento(s)'] ?? data['Embarcação'];
    const system = service.system ?? data.system ?? data.Sistema;
    if (typeof equipment !== 'string' || !equipment.trim()) {
      const label = service.serviceType === 'inibicao' ? 'a embarcação' : 'o equipamento do cliente';
      throw Object.assign(new Error(`Informe ${label} do serviço ${index + 1}.`), { statusCode: 400 });
    }
    if (typeof system !== 'string' || !system.trim()) {
      throw Object.assign(new Error(`Informe o sistema do serviço ${index + 1}.`), { statusCode: 400 });
    }
    assertCleaningMeasurement(service);
    assertPressureHoseMeasurement(service);
    assertSystemTypeWhenVisible(service);
  }
  await assertMechanicalMeasurements(client, project.id, services);
  await assertReportProjectSystems(client, project.id, services);
}
