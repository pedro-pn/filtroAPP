import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';

async function loadOngoingServices() {
  const server = await createServer({
    configFile: false,
    root: new URL('..', import.meta.url).pathname,
    server: { middlewareMode: true, hmr: false },
    optimizeDeps: { noDiscovery: true },
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

test('finalized filtration does not clear pending filtration with same equipment and system but different oil', async () => {
  const { collectOngoingServices } = await loadOngoingServices();
  const services = collectOngoingServices([
    rdoWithServices([
      {
        id: 'svc-pending',
        serviceType: 'filtragem',
        system: 'Sistema óleo',
        finalized: false,
        extraData: {
          'Equipamento(s)': 'UFG-01',
          Sistema: 'Sistema óleo',
          'Tipo de óleo': 'ISO VG 46',
          'Volume de óleo': '120 L',
          'Serviço finalizado?': 'Não'
        }
      },
      {
        id: 'svc-finalized',
        serviceType: 'filtragem',
        system: 'Sistema óleo',
        finalized: true,
        extraData: {
          __serviceLinkKey: 'project-1||filtragem||ufg-01||sistema óleo',
          'Equipamento(s)': 'UFG-01',
          Sistema: 'Sistema óleo',
          'Tipo de óleo': 'ISO VG 68',
          'Volume de óleo': '300 L',
          'Serviço finalizado?': 'Sim'
        }
      }
    ])
  ], '2026-05-29T12:00:00.000Z');

  assert.equal(services.length, 1);
  assert.equal(services[0].service.id, 'svc-pending');
});

function rdoReport(id, reportDate, services, sequenceNumber = 1) {
  return {
    id,
    projectId: 'project-1',
    reportType: 'RDO',
    sequenceNumber,
    reportDate,
    createdAt: reportDate,
    project: { id: 'project-1', code: '001', name: 'Projeto', isActive: true },
    services
  };
}

test('pending project services keep the latest occurrence of a chain and drop it once finalized', async () => {
  const { collectPendingProjectServices } = await loadOngoingServices();

  const started = {
    id: 'svc-1',
    serviceType: 'limpeza',
    system: 'SYS-01',
    finalized: false,
    extraData: { __serviceLinkKey: 'chain-1', 'Equipamento(s)': 'TQ-01', Sistema: 'SYS-01' }
  };
  const continued = {
    id: 'svc-2',
    serviceType: 'limpeza',
    system: 'SYS-01',
    finalized: false,
    extraData: { __ongoingKey: 'chain-1', __serviceLinkKey: 'chain-1', 'Equipamento(s)': 'TQ-01', Sistema: 'SYS-01' }
  };

  // O RDO mais recente vem primeiro na lista de entrada para provar que a ordenação é interna.
  const pending = collectPendingProjectServices([
    rdoReport('rdo-2', '2026-05-29T12:00:00.000Z', [continued], 2),
    rdoReport('rdo-1', '2026-05-28T12:00:00.000Z', [started], 1)
  ]);

  assert.equal(pending.length, 1);
  assert.equal(pending[0].key, 'chain-1');
  assert.equal(pending[0].service.id, 'svc-2');
  assert.equal(pending[0].report.id, 'rdo-2');
  assert.equal(pending[0].startedReport.id, 'rdo-1');

  const closed = collectPendingProjectServices([
    rdoReport('rdo-1', '2026-05-28T12:00:00.000Z', [started], 1),
    rdoReport('rdo-2', '2026-05-29T12:00:00.000Z', [{ ...continued, finalized: true }], 2)
  ]);

  assert.deepEqual(closed, []);
});

test('later-day pending services are hidden from collaborators and marked for reviewers', async () => {
  const { pendingProjectServicesForDate, isPendingServiceFromLaterDay } = await loadOngoingServices();
  const started = { id: 'svc-2', serviceType: 'limpeza', system: 'SYS-02', finalized: false,
    extraData: { __serviceLinkKey: 'chain-2', Sistema: 'SYS-02' } };
  const continued = { ...started, id: 'svc-3', extraData: { __ongoingKey: 'chain-2', __serviceLinkKey: 'chain-2', Sistema: 'SYS-02' } };
  const history = [
    rdoReport('rdo-3', '2026-05-30T00:00:00.000Z', [continued], 3),
    rdoReport('rdo-2', '2026-05-29T00:00:00.000Z', [started], 2)
  ];

  assert.deepEqual(pendingProjectServicesForDate(history, '2026-05-28', false), []);
  const reviewerItems = pendingProjectServicesForDate(history, '2026-05-28', true);
  assert.equal(reviewerItems.length, 1);
  assert.equal(reviewerItems[0].service.id, 'svc-3');
  assert.equal(reviewerItems[0].startedReport.id, 'rdo-2');
  assert.equal(isPendingServiceFromLaterDay(reviewerItems[0], '2026-05-28'), true);
  assert.equal(isPendingServiceFromLaterDay(reviewerItems[0], '2026-05-29'), false);
  assert.equal(pendingProjectServicesForDate(history, '2026-05-29', false)[0].service.id, 'svc-2');
});

test('reviewing an earlier RDO keeps its pending services even if finalized later', async () => {
  const { pendingProjectServicesForDate, isPendingServiceFromLaterDay } = await loadOngoingServices();
  const started = { id: 'svc-1', serviceType: 'limpeza', system: 'SYS-01', finalized: false,
    extraData: { __serviceLinkKey: 'chain-1', Sistema: 'SYS-01' } };
  const history = [
    rdoReport('rdo-1', '2026-05-28T00:00:00.000Z', [started], 1),
    rdoReport('rdo-3', '2026-05-30T00:00:00.000Z', [{ ...started, id: 'svc-3', finalized: true }], 3)
  ];
  const items = pendingProjectServicesForDate(history, '2026-05-29', true);
  assert.equal(items.length, 1);
  assert.equal(items[0].service.id, 'svc-1');
  assert.equal(isPendingServiceFromLaterDay(items[0], '2026-05-29'), false);
});

test('continued service data carries the ongoing key and clears the day-specific fields', async () => {
  const { buildContinuedServiceData } = await loadOngoingServices();

  const service = {
    id: 'svc-1',
    serviceType: 'filtragem',
    system: 'Sistema óleo',
    material: 'Aço carbono',
    startTime: '08:00',
    endTime: '12:00',
    finalized: false,
    extraData: {
      __serviceLinkKey: 'chain-1',
      'Equipamento(s)': 'UFG-01',
      Sistema: 'Sistema óleo',
      'Tipo de óleo': 'ISO VG 46',
      'Etapas realizadas no dia': ['Etapa anterior'],
      Observações: 'observação do dia anterior',
      'Serviço finalizado?': 'Não',
      __uploads__: [{ label: 'Fotos', files: [{ id: 'file-1', fileName: 'a.jpg' }] }]
    }
  };

  const data = buildContinuedServiceData(service, 'chain-1');

  assert.equal(data.__ongoingKey, 'chain-1');
  assert.equal(data.__serviceLinkKey, 'chain-1');
  assert.equal(data.system, 'Sistema óleo');
  assert.equal(data.material, 'Aço carbono');
  assert.equal(data.equipmentId, 'UFG-01');
  assert.equal(data['Tipo de óleo'], 'ISO VG 46');
  assert.deepEqual(data.etapas, []);
  assert.equal(data.startTime, '');
  assert.equal(data.endTime, '');
  assert.equal(data.notes, '');
  assert.equal(data.finalized, undefined);
  assert.equal(data._prefilled, true);
  assert.equal(data.__uploads__[0].files[0].__previouslyAdded, true);
});

test('form service ongoing keys expose every continuity key of an editor service', async () => {
  const { formServiceOngoingKeys } = await loadOngoingServices();

  assert.deepEqual(formServiceOngoingKeys({ __ongoingKey: 'chain-1', __serviceLinkKey: 'chain-1' }), ['chain-1']);
  assert.deepEqual(formServiceOngoingKeys({}), []);
});
