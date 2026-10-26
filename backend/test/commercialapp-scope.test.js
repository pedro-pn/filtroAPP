import assert from 'node:assert/strict';
import test from 'node:test';
import { projectScopeFromCommercialApp, syncCommercialAppScope } from '../src/lib/acompanhamento/commercialapp-scope.js';

const snapshot = () => ({
  proposalSnapshot: { technicalServices: [
    { serviceId: 'teste_hidrostatico' }, { serviceId: 'flushing_primario' },
    { serviceId: 'flushing_secundario' }, { serviceId: 'filtragem_oleo_diesel' }
  ] },
  costBreakdown: {
    volumeSystems: [{
      id: 'circuit-1', name: 'Caldeira A', enabled: true,
      pipeSegments: [{ id: 'pipe-1', description: 'Linha de vapor', quantity: 2,
        lengthM: 30, internalDiameterMm: 50.8, diameterUnit: 'in' }],
      manualVolumes: [{ id: 'oil-1', description: 'Tanque', quantity: 1, volumeLiters: 500 }]
    }],
    circuitServices: [
      { systemId: 'circuit-1', itemId: 'pipe-1', itemType: 'pipes', serviceId: 'teste_hidrostatico' },
      { systemId: 'circuit-1', itemId: 'pipe-1', itemType: 'pipes', serviceId: 'flushing_primario' },
      { systemId: 'circuit-1', itemId: 'pipe-1', itemType: 'pipes', serviceId: 'flushing_secundario' },
      { systemId: 'circuit-1', itemId: 'oil-1', itemType: 'oil', serviceId: 'filtragem_oleo_diesel' }
    ]
  }
});

const quantifiedSnapshot = (itemType, serviceId, item = {}) => ({
  proposalSnapshot: { technicalServices: [{ serviceId }] },
  costBreakdown: {
    volumeSystems: [{ id: 'client', name: 'Prensa', enabled: true, cycles: 7,
      [{ pipes: 'pipeSegments', reservoirs: 'reservoirVolumes', equipment: 'equipmentVolumes', oil: 'manualVolumes' }[itemType]]:
        [{ id: 'item', description: 'Serpentina', quantity: 2, lengthM: 10.25,
          weightKg: 125.5, volumeLiters: 40, internalDiameterMm: 50.8, diameterUnit: 'in',
          calculateVolume: false, ...item }]
    }],
    circuitServices: [{ systemId: 'client', itemId: 'item', itemType, serviceId }]
  }
});

test('quantificação explícita da limpeza mecânica preserva m, kg, un e L sem ciclos ou medidas desativadas', async t => {
  for (const itemType of ['pipes', 'reservoirs', 'equipment']) {
    for (const [measurementUnit, systemType, quantity, unit] of [
      ['m', 'MECANICA_M', 20.5, 'M'], ['kg', 'MECANICA_KG', 251, 'KG'],
      ['un', 'MECANICA_UN', 2, 'UN'], ['L', 'MECANICA_L', 80, 'L']
    ]) {
      // O ComercialAPP permite litros em reservatórios e equipamentos, não em tubos.
      if (itemType === 'pipes' && measurementUnit === 'L') continue;
      await t.test(`${itemType}/${measurementUnit}`, () => {
        for (const calculateVolume of [false, true]) {
          const source = quantifiedSnapshot(itemType, 'hidrojateamento', { measurementUnit, calculateVolume });
          const before = structuredClone(source);
          const mapped = projectScopeFromCommercialApp(source);
          assert.deepEqual(mapped.issues, []);
          assert.equal(mapped.services[0].serviceType, 'LIMPEZA_MECANICA');
          assert.deepEqual(mapped.services[0].systems, [{ equipment: 'Prensa', systemName: 'Serpentina',
            description: null, systemType, quantity, unit, diameter: null, diameterUnit: null }]);
          assert.deepEqual(source, before);
        }
      });
    }
  }
});

test('unidades explícitas usam apenas medições nativas dos serviços', async t => {
  for (const [itemType, serviceId, measurementUnit, systemType, quantity, unit] of [
    ['pipes', 'limpeza_quimica', 'm', 'TUBULACAO', 20.5, 'M'],
    ['pipes', 'teste_hidrostatico', 'm', 'TUBULACAO', 20.5, 'M'],
    ['pipes', 'flushing_primario', 'm', 'TUBULACAO', 20.5, 'M'],
    ...['pipes', 'reservoirs', 'equipment'].flatMap(itemType => [
      [itemType, 'limpeza_quimica', 'un', 'SISTEMA', 2, 'UN'],
      [itemType, 'teste_hidrostatico', 'un', 'MANGOTE', 2, 'UN']
    ]),
    ...['reservoirs', 'equipment', 'oil'].flatMap(itemType => [
      [itemType, 'filtragem_oleo_diesel', 'L', 'OLEO', 80, 'L'],
      [itemType, 'flushing_primario', 'L', 'OLEO', 80, 'L']
    ])
  ]) {
    await t.test(`${itemType}/${serviceId}/${measurementUnit}`, () => {
      const mapped = projectScopeFromCommercialApp(quantifiedSnapshot(itemType, serviceId, { measurementUnit }));
      assert.deepEqual(mapped.issues, []);
      const row = mapped.services[0].systems[0];
      assert.deepEqual([row.systemType, row.quantity, row.unit], [systemType, quantity, unit]);
      assert.equal(row.diameter, systemType === 'TUBULACAO' ? '2' : null);
      assert.equal(row.diameterUnit, systemType === 'TUBULACAO' ? 'pol' : null);
    });
  }
});

test('combinações sem medição nativa geram pendência sem converter medidas físicas preservadas', async t => {
  for (const [itemType, serviceId, measurementUnit] of [
    ...['pipes', 'reservoirs', 'equipment'].flatMap(itemType =>
      ['limpeza_quimica', 'teste_hidrostatico', 'flushing_primario', 'filtragem_oleo_diesel']
        .map(serviceId => [itemType, serviceId, 'kg'])),
    ['equipment', 'limpeza_quimica', 'm'], ['equipment', 'limpeza_quimica', 'L'],
    ['reservoirs', 'teste_hidrostatico', 'L'], ['pipes', 'filtragem_oleo_diesel', 'm'],
    ['equipment', 'flushing_primario', 'un'], ['reservoirs', 'filtragem_oleo_diesel', 'un'],
    ['pipes', 'hidrojateamento', 'invalida']
  ]) {
    await t.test(`${itemType}/${serviceId}/${measurementUnit}`, () => {
      const mapped = projectScopeFromCommercialApp(quantifiedSnapshot(itemType, serviceId, { measurementUnit }));
      assert.deepEqual(mapped.services, []);
      assert.equal(mapped.issues.length, 1);
      assert.match(mapped.issues[0], /Serpentina.*exige escolha da unidade de acompanhamento/);
    });
  }
});

test('quantitativo escolhido inválido não usa outras medidas e unidades não aceitam frações', () => {
  for (const item of [
    { measurementUnit: 'kg', weightKg: 0 }, { measurementUnit: 'm', lengthM: undefined },
    { measurementUnit: 'L', volumeLiters: 0 }, { measurementUnit: 'un', quantity: 1.5 },
    { measurementUnit: 'un', quantity: 1.001 }
  ]) {
    const mapped = projectScopeFromCommercialApp(quantifiedSnapshot('equipment', 'hidrojateamento', item));
    assert.deepEqual(mapped.services, []);
    assert.equal(mapped.issues.length, 1);
  }
  for (const serviceId of ['limpeza_quimica', 'teste_hidrostatico']) {
    for (const quantity of [1.5, 1.001]) {
      const mapped = projectScopeFromCommercialApp(quantifiedSnapshot('equipment', serviceId, {
        measurementUnit: 'un', quantity
      }));
      assert.deepEqual(mapped.services, []);
      assert.match(mapped.issues[0], /quantidade ou bitola válida/);
    }
  }
});

test('levantamentos sem measurementUnit mantêm as unidades anteriores de reservatórios e equipamentos', () => {
  for (const itemType of ['reservoirs', 'equipment']) {
    for (const [serviceId, systemType, quantity, unit] of [
      ['hidrojateamento', 'MECANICA_UN', 2, 'UN'], ['limpeza_quimica', 'SISTEMA', 2, 'UN'],
      ['filtragem_oleo_diesel', 'OLEO', 80, 'L'], ['flushing_primario', 'OLEO', 80, 'L']
    ]) {
      const mapped = projectScopeFromCommercialApp(quantifiedSnapshot(itemType, serviceId));
      assert.deepEqual(mapped.issues, []);
      const row = mapped.services[0].systems[0];
      assert.deepEqual([row.systemType, row.quantity, row.unit], [systemType, quantity, unit]);
    }
  }
});

test('converte 2 tubos de 30 m e bitola comercial de 2 pol; agrupa serviços iguais do RDO', () => {
  const mapped = projectScopeFromCommercialApp(snapshot());
  assert.deepEqual(mapped.issues, []);
  assert.equal(mapped.services.reduce((sum, service) => sum + service.weight, 0), 100);
  assert.deepEqual(mapped.services.map(service => service.serviceType),
    ['TESTE_PRESSAO', 'FLUSHING', 'FILTRAGEM']);
  const tube = mapped.services[0].systems[0];
  assert.equal(tube.equipment, 'Caldeira A');
  assert.equal(tube.systemName, 'Linha de vapor');
  assert.equal(tube.quantity, 60);
  assert.equal(tube.diameter, '2');
  assert.equal(tube.diameterUnit, 'pol');
  assert.equal(mapped.services[1].systems[0].quantity, 60,
    'flushing primário e secundário no mesmo tubo não duplicam a medição do RDO');
  assert.equal(mapped.services[2].systems[0].quantity, 500);
  assert.equal(mapped.services[2].systems[0].unit, 'L');
});

test('não inventa quantitativos para serviços e unidades incompatíveis', () => {
  const source = snapshot();
  source.costBreakdown.circuitServices.push(
    { systemId: 'circuit-1', itemId: 'oil-1', itemType: 'oil', serviceId: 'teste_hidrostatico' },
    { systemId: 'circuit-1', itemId: 'pipe-1', itemType: 'pipes', serviceId: 'servico_sem_mapeamento' }
  );
  source.proposalSnapshot.technicalServices.push({ serviceId: 'servico_sem_mapeamento' });
  const mapped = projectScopeFromCommercialApp(source);
  assert.equal(mapped.services.length, 3);
  assert.equal(mapped.issues.length, 2);
});

test('respeita a remoção de todos os serviços da proposta final', () => {
  const source = snapshot();
  source.proposalSnapshot.technicalServices = [];
  const mapped = projectScopeFromCommercialApp(source);
  assert.equal(mapped.services.length, 0);
  assert.match(mapped.issues[0], /não consta da proposta final/);
});

test('preserva milímetros em orçamento antigo sem unidade de diâmetro', () => {
  const source = snapshot();
  delete source.costBreakdown.volumeSystems[0].pipeSegments[0].diameterUnit;
  const row = projectScopeFromCommercialApp(source).services[0].systems[0];
  assert.equal(row.diameter, '50.8');
  assert.equal(row.diameterUnit, 'mm');
});

test('edição manual impede que uma nova revisão substitua o escopo', async () => {
  const tx = {
    project: { findUnique: async () => ({ commercialScopeImport: null }) },
    projectPlannedService: { count: async () => 1,
      deleteMany: async () => { throw new Error('escopo manual apagado'); } }
  };
  assert.deepEqual(await syncCommercialAppScope(tx, 'project-1',
    { externalId: 'revision-2', snapshot: snapshot() }),
  { status: 'MANUAL_PRESERVED', issues: [] });
});

test('remoção manual de todas as linhas também impede reimportação', async () => {
  const tx = {
    project: { findUnique: async () => ({ commercialScopeImport: { status: 'MANUAL_OVERRIDE' } }) },
    projectPlannedService: { count: async () => 0,
      deleteMany: async () => { throw new Error('escopo recriado'); } }
  };
  assert.equal((await syncCommercialAppScope(tx, 'project-1',
    { externalId: 'revision-2', snapshot: snapshot() })).status, 'MANUAL_PRESERVED');
});

test('revisão sem quantitativos não apaga escopo automático anterior', async () => {
  const state = { metadata: { externalId: 'revision-1', fingerprint: 'old', issues: [] } };
  const tx = {
    project: {
      findUnique: async () => ({ commercialScopeImport: state.metadata }),
      update: async ({ data }) => { state.metadata = data.commercialScopeImport; }
    },
    projectPlannedService: {
      count: async () => 1,
      deleteMany: async () => { throw new Error('escopo anterior apagado'); }
    }
  };
  const result = await syncCommercialAppScope(tx, 'project-1',
    { externalId: 'revision-2', snapshot: { costBreakdown: null } });
  assert.equal(result.status, 'NEEDS_REVIEW');
  assert.equal(state.metadata.externalId, 'revision-1');
  assert.equal(state.metadata.pendingExternalId, 'revision-2');
});

test('primeira seleção e nova revisão importam serviços; repetição é idempotente', async () => {
  const state = { metadata: null, services: [], systems: new Map() };
  const tx = {
    project: {
      findUnique: async () => ({ commercialScopeImport: state.metadata }),
      update: async ({ data }) => { state.metadata = data.commercialScopeImport; }
    },
    projectPlannedService: {
      count: async () => state.services.length,
      deleteMany: async () => { state.services = []; },
      create: async ({ data }) => { state.services.push(data); }
    },
    projectServiceSystem: {
      upsert: async ({ where, create }) => {
        const key = JSON.stringify(where.projectId_equipmentKey_nameKey);
        if (!state.systems.has(key)) state.systems.set(key, { id: `system-${state.systems.size + 1}`, ...create });
        return state.systems.get(key);
      }
    }
  };
  const first = { externalId: 'revision-1', snapshot: snapshot() };
  assert.equal((await syncCommercialAppScope(tx, 'project-1', first)).status, 'IMPORTED');
  assert.equal(state.services.length, 3);
  assert.equal((await syncCommercialAppScope(tx, 'project-1', first)).status, 'UNCHANGED');
  const next = snapshot();
  next.costBreakdown.volumeSystems[0].pipeSegments[0].lengthM = 40;
  assert.equal((await syncCommercialAppScope(tx, 'project-1',
    { externalId: 'revision-2', snapshot: next })).status, 'IMPORTED');
  assert.equal(state.services[0].systems.create[0].quantity, 80);

  const quantified = { externalId: 'revision-3', snapshot: quantifiedSnapshot('equipment', 'hidrojateamento', { measurementUnit: 'kg' }) };
  assert.equal((await syncCommercialAppScope(tx, 'project-1', quantified)).status, 'IMPORTED');
  assert.deepEqual(state.services[0].systems.create.map(row => [row.systemType, row.quantity, row.unit]),
    [['MECANICA_KG', 251, 'KG']]);
  assert.equal((await syncCommercialAppScope(tx, 'project-1', quantified)).status, 'UNCHANGED');

  const before = structuredClone(state.services);
  const unsupported = { externalId: 'revision-4', snapshot: quantifiedSnapshot('equipment', 'limpeza_quimica', { measurementUnit: 'kg' }) };
  assert.equal((await syncCommercialAppScope(tx, 'project-1', unsupported)).status, 'NEEDS_REVIEW');
  assert.deepEqual(state.services, before);
  assert.equal(state.metadata.pendingExternalId, 'revision-4');
});

test('recupera o título versionado real da 4666 R1 e inclui desidratação sem duplicar litros', () => {
  const source = snapshot();
  source.scope = [{ id: 'escopo-levantamento-legacy-services-v1-filtragem_oleo_diesel', title: 'Filtragem de óleo diesel' }];
  source.proposalSnapshot.technicalServices[3].serviceVersion = { versionId: 'legacy-services-v1-filtragem_oleo_diesel' };
  assert.equal(projectScopeFromCommercialApp(source).services[2].scopeName, 'Filtragem de óleo diesel');
  source.proposalSnapshot.technicalServices.push({ serviceId: 'desidratacao_oleo_diesel', title: 'Desidratação de óleo diesel' });
  source.costBreakdown.circuitServices.push({ systemId: 'circuit-1', itemId: 'oil-1', itemType: 'oil', serviceId: 'desidratacao_oleo_diesel' });
  const mapped = projectScopeFromCommercialApp(source);
  assert.deepEqual(mapped.issues, []);
  const filtration = mapped.services.find(service => service.serviceType === 'FILTRAGEM');
  assert.equal(filtration.scopeName, 'Filtragem de óleo diesel + Desidratação de óleo diesel');
  assert.equal(filtration.systems[0].quantity, 500);
});

test('PIG e hidrojateamento usam metros; reservatório usa unidades e boroscopia fica fora das metas sem gerar pendência', () => {
  const source = snapshot();
  source.proposalSnapshot.technicalServices = ['passagem_pig', 'hidrojateamento', 'limpeza_reservatorio', 'boroscopia'].map(serviceId => ({ serviceId }));
  source.costBreakdown.volumeSystems[0].reservoirVolumes = [{ id: 'tank', description: 'Reservatório A', quantity: 2, volumeLiters: 1000 }];
  source.costBreakdown.circuitServices = [
    ...['passagem_pig', 'hidrojateamento', 'boroscopia'].map(serviceId => ({ systemId: 'circuit-1', itemType: 'pipes', itemId: 'pipe-1', serviceId })),
    { systemId: 'circuit-1', itemType: 'reservoirs', itemId: 'tank', serviceId: 'limpeza_reservatorio' }
  ];
  const mapped = projectScopeFromCommercialApp(source);
  assert.equal(mapped.services[0].serviceType, 'LIMPEZA_MECANICA');
  assert.deepEqual(mapped.services[0].systems.map(row => [row.systemType, row.quantity, row.unit]), [
    ['MECANICA_M', 60, 'M'], ['MECANICA_UN', 2, 'UN']
  ]);
  assert.deepEqual(mapped.issues, []);
});

test('locação preserva os dias de cada equipamento; venda não cria escopo operacional', () => {
  const source = { proposalSnapshot: { estimateNature: 'equipment_rental', modelo: 'locacao_equipamentos' },
    costBreakdown: { equipmentRentals: [{ id: 'unit-1', description: 'Unidade de filtragem', days: 30, quantity: 2, included: true }] } };
  const mapped = projectScopeFromCommercialApp(source);
  assert.equal(mapped.services[0].serviceType, 'LOCACAO');
  assert.equal(mapped.services[0].systems[0].quantity, 30);
  assert.equal(mapped.services[0].systems[0].unit, 'DIA');
  source.proposalSnapshot.estimateNature = 'equipment_sale';
  assert.deepEqual(projectScopeFromCommercialApp(source), { services: [], issues: [] });
});

test('adicional de locação não transforma um projeto operacional inteiro em locação', async () => {
  let created;
  const tx = {
    project: { findUnique: async () => ({ commercialScopeImport: null, serviceCategory: 'SERVICE' }),
      update: async () => { throw new Error('Categoria do projeto principal alterada pelo adicional'); } },
    projectAdditionalProposal: { findUnique: async () => ({ active: true, commercialAppProposalId: 'rental-add', scopeImport: null }), update: async () => {} },
    projectPlannedService: { count: async () => 0, deleteMany: async () => {}, create: async ({ data }) => { created = data; } },
    projectServiceSystem: { upsert: async () => ({ id: 'system-1' }) }
  };
  const result = await syncCommercialAppScope(tx, 'project-1', { proposalKind: 'ADDITIONAL', externalId: 'rental-add', proposalCode: '4901',
    snapshot: { proposalSnapshot: { estimateNature: 'equipment_rental' }, costBreakdown: { equipmentRentals: [
      { id: 'rental-1', description: 'Unidade de filtragem', days: 30, quantity: 1 }
    ] } } });
  assert.equal(result.status, 'IMPORTED');
  assert.equal(created.serviceType, 'LOCACAO');
  assert.equal(created.contributionKey, 'COMERCIAL_APP:4901');
});
