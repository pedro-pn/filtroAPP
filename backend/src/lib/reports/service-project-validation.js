import { assertReportProjectSystems } from '../acompanhamento/project-systems.js';
import { assertCleaningMeasurement } from './cleaning-measurement.js';

export async function assertReportServicesProject(client, project, services) {
  const hasInhibition = (services || []).some(service => service.serviceType === 'inibicao');
  if (hasInhibition && !project?.inhibitionServiceEnabled) {
    throw Object.assign(new Error('Serviço de inibição não está habilitado para este projeto.'), { statusCode: 400 });
  }
  for (const service of services || []) assertCleaningMeasurement(service);
  await assertReportProjectSystems(client, project.id, services);
}
