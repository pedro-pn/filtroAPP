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
    { systemId: 'circuit-1', itemId: 'pipe-1', itemType: 'pipes', serviceId: 'hidrojateamento' }
  );
  source.proposalSnapshot.technicalServices.push({ serviceId: 'hidrojateamento' });
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
});
