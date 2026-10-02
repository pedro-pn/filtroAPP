import assert from 'node:assert/strict';
import test from 'node:test';
import { buildWeeklyServiceHistory, loadWeeklyServiceHistory } from '../src/lib/acompanhamento/weekly-service-history.js';
import { applyDailyTubeCorrections } from '../src/lib/acompanhamento/realized-corrections.js';

const service = (overrides = {}) => ({ reportDate: '2026-09-28', serviceType: 'limpeza química', finalized: true,
  reportType: 'RDO', extraData: { tubes: [{ c: 1000, lengthUnit: 'cm' }] }, ...overrides });

test('histórico físico converte cm e mL, conta unidades e ignora serviços abertos e relatórios derivados', () => {
  const history = buildWeeklyServiceHistory([
    service(), service({ finalized: false }), service({ reportType: 'LIMPEZA_QUIMICA', specialConditions: { parentRdoId: 'r1' } }),
    service({ serviceType: 'Filtragem', extraData: { volumeOleo: 1000000, volumeOleoUnit: 'mL' } }),
    service({ extraData: { limpezaTubulacao: 'Não', quantidadeSistemas: 2 } }),
    service({ reportDate: new Date('2026-09-29T00:00:00Z'), serviceType: 'Teste de pressão' }),
    service({ serviceType: 'desconhecido' }), service({ reportDate: 'invalid' })
  ]);
  assert.deepEqual(history, [
    { date: '2026-09-28', serviceType: 'LIMPEZA_QUIMICA', quantities: { M: 10, L: 0, UN: 0 } },
    { date: '2026-09-28', serviceType: 'FILTRAGEM', quantities: { M: 0, L: 1000, UN: 0 } },
    { date: '2026-09-28', serviceType: 'LIMPEZA_QUIMICA', quantities: { M: 0, L: 0, UN: 2 } },
    { date: '2026-09-29', serviceType: 'TESTE_PRESSAO', quantities: { M: 10, L: 0, UN: 0 } }
  ]);
});

test('usa medições reconciliadas e a correção do dia sem duplicar a metragem original', () => {
  const source = [service({ extraData: { tubes: [{ c: 80 }], volumeOleo: 30 }, reconciledMeasurements: [
    { systemType: 'TUBULACAO', quantity: 80 }, { systemType: 'OLEO', quantity: 30 }
  ] })];
  const corrected = applyDailyTubeCorrections(source, [{ measureDate: '2026-09-28', serviceType: 'LIMPEZA_QUIMICA', quantityM: 42, revision: 1 }]);
  const history = buildWeeklyServiceHistory(corrected);
  assert.equal(history.reduce((sum, point) => sum + point.quantities.M, 0), 42);
  assert.equal(history.reduce((sum, point) => sum + point.quantities.L, 0), 30);
});

test('carrega apenas projetos da missão ou membros do agrupamento, sem misturar produção', async () => {
  const client = {
    project: { findFirst: async () => ({ id: 'p1' }) },
    acompanhamentoMissionGroup: { findFirst: async () => ({ id: 'g1' }) },
    acompanhamentoMissionGroupMember: { findMany: async ({ where }) => {
      assert.equal(where.groupId, 'g1');
      assert.deepEqual(where.project, { deletedAt: null });
      return [{ projectId: 'p1' }, { projectId: 'p2' }];
    } }
  };
  const productivePoint = { date: '2026-09-28', serviceType: 'LIMPEZA_QUIMICA', quantities: { M: 0, L: 0, UN: 0 }, productivePersonMinutes: 480, productivityIssues: [] };
  const dependencies = { client, loadProductivity: async (ids, passedClient) => {
    assert.deepEqual(ids, ['p1', 'p2']);
    assert.equal(passedClient, client);
    return [productivePoint];
  }, loadServices: async ids => {
    assert.deepEqual(ids, ['p1', 'p2']);
    return new Map([['p1', [service()]], ['p2', [service({ serviceType: 'TESTE_PRESSAO' })]], ['p3', [service()]]]);
  } };
  const group = await loadWeeklyServiceHistory({ groupId: 'g1' }, dependencies);
  assert.equal(group.length, 3);
  assert.deepEqual(group[2], productivePoint);
  const project = await loadWeeklyServiceHistory({ projectId: 'p1' }, { client, loadProductivity: async () => [], loadServices: async ids => {
    assert.deepEqual(ids, ['p1']);
    return new Map([['p1', [service()]], ['p2', [service()]]]);
  } });
  assert.equal(project.length, 1);
});
