import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';

async function loadOngoingServices() {
  const server = await createServer({
    configFile: false,
    root: new URL('..', import.meta.url).pathname,
    server: { middlewareMode: true },
    appType: 'custom'
  });

  try {
    return await server.ssrLoadModule('/src/utils/ongoingServices.ts');
  } finally {
    await server.close();
  }
}

function rdoWithServices(services) {
  return {
    id: 'rdo-1',
    projectId: 'project-1',
    reportType: 'RDO',
    reportDate: '2026-05-28T12:00:00.000Z',
    createdAt: '2026-05-28T12:00:00.000Z',
    project: { id: 'project-1', code: '001', name: 'Projeto', isActive: true },
    services
  };
}

test('ongoing inhibition services with same system but different steps remain separate', async () => {
  const { collectOngoingServices } = await loadOngoingServices();
  const services = collectOngoingServices([
    rdoWithServices([
      {
        id: 'svc-1',
        serviceType: 'inibicao',
        system: 'SYS-01',
        finalized: false,
        extraData: {
          'ID da embarcação': '51632',
          Sistema: 'SYS-01',
          Steps: 'Parte A',
          'Serviço finalizado?': 'Não'
        }
      },
      {
        id: 'svc-2',
        serviceType: 'inibicao',
        system: 'SYS-01',
        finalized: false,
        extraData: {
          'ID da embarcação': '51632',
          Sistema: 'SYS-01',
          Steps: 'Parte B',
          'Serviço finalizado?': 'Não'
        }
      }
    ])
  ], '2026-05-29T12:00:00.000Z');

  assert.equal(services.length, 2);
  assert.deepEqual(services.map(item => item.service.id).sort(), ['svc-1', 'svc-2']);
});
