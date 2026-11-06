import assert from 'node:assert/strict';
import test from 'node:test';
import { assertReportServicesProject } from '../src/lib/reports/service-project-validation.js';

const project = { id: 'project-1', inhibitionServiceEnabled: true };
const client = { projectPlannedService: { findMany: async () => [] } };
const serviceTypes = ['limpeza', 'pressao', 'filtragem', 'flushing', 'mecanica', 'inibicao'];

for (const serviceType of serviceTypes) {
  test(`${serviceType}: equipamento e sistema são obrigatórios antes de salvar`, async () => {
    const service = { serviceType, equipmentId: null, system: 'Sistema', finalized: false, extraData: { equipmentId: 'EQ-1' } };
    await assert.doesNotReject(() => assertReportServicesProject(client, project, [service]));
    for (const value of [undefined, null, '', '   ', 1, [], {}]) {
      await assert.rejects(() => assertReportServicesProject(client, project, [{
        ...service, extraData: { equipmentId: value }
      }]), error => error.statusCode === 400 && /equipamento do cliente|embarcação/.test(error.message));
      await assert.rejects(() => assertReportServicesProject(client, project, [{
        ...service, system: value
      }]), error => error.statusCode === 400 && /sistema/.test(error.message));
    }
  });
}

test('valida todos os serviços e aceita identificação persistida com rótulos legados', async () => {
  const legacy = { serviceType: 'flushing', extraData: { 'Equipamento(s)': 'EQ-1', Sistema: 'Sistema' } };
  await assert.doesNotReject(() => assertReportServicesProject(client, project, [legacy]));
  await assert.doesNotReject(() => assertReportServicesProject(client, project, []));
  await assert.rejects(() => assertReportServicesProject(client, project, [legacy, {
    serviceType: 'flushing', system: 'Sistema', extraData: { equipmentId: '  ', 'Equipamento(s)': 'Valor antigo' }
  }]), /equipamento do cliente do serviço 2/);
  await assert.rejects(() => assertReportServicesProject(client, project, [{
    ...legacy, system: '   '
  }]), /sistema do serviço 1/);
});
