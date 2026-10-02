import assert from 'node:assert/strict';
import test from 'node:test';
import { buildWeeklyProductiveHistory, loadWeeklyProductiveHistory } from '../src/lib/acompanhamento/weekly-productive-time.js';

const member = (id, operational = true) => ({ collaboratorId: id, jobRoleSnapshot: { isOperational: operational } });
const service = (type = 'Limpeza química', crew = ['c1'], start = '08:00', end = '16:00') => ({
  serviceType: type, startTime: start, endTime: end, finalized: false, extraData: { serviceCollaboratorIds: crew }
});
const report = (overrides = {}) => ({ reportType: 'RDO', reportDate: '2026-09-28', arrivalTime: '08:00', departureTime: '16:00',
  lunchBreak: 'sem intervalo', collaborators: [member('c1'), member('c2')], services: [service()], ...overrides });
const forType = (points, type, date = '2026-09-28') => points.find(point => point.serviceType === type && point.date === date);

test('soma equipe variável e dias parciais, só dos colaboradores operacionais de cada serviço, inclusive em andamento', () => {
  const history = buildWeeklyProductiveHistory([
    report({ collaborators: [member('c1'), member('c2'), member('admin', false)],
      services: [service('Limpeza química', ['c1', 'c1', 'admin']), service('Teste de pressão', ['c2'], '08:00', '12:00')] }),
    report({ reportDate: '2026-09-29', services: [service('Limpeza química', ['c1', 'c2'], '08:00', '12:00')] })
  ]);
  assert.equal(forType(history, 'LIMPEZA_QUIMICA').productivePersonMinutes, 480);
  assert.equal(forType(history, 'TESTE_PRESSAO').productivePersonMinutes, 240);
  assert.equal(forType(history, 'LIMPEZA_QUIMICA', '2026-09-29').productivePersonMinutes, 480);
  assert.deepEqual(history.flatMap(point => point.productivityIssues), []);
});

test('desconta intervalos e stand-by, não conta deslocamento ou lacunas e não desconta pausas já fora do serviço', () => {
  const specialConditions = { standby: true, standbyDetails: { total: '01:00' } };
  const whole = buildWeeklyProductiveHistory([report({ departureTime: '18:00', lunchBreak: '01:00', specialConditions,
    services: [service('Limpeza química', ['c1'], '08:00', '18:00'), service('Deslocamento', ['c2'])] })]);
  assert.equal(whole[0].productivePersonMinutes, 480);
  const separated = buildWeeklyProductiveHistory([report({ departureTime: '18:00', lunchBreak: '01:00', specialConditions,
    services: [service('Limpeza química', ['c1'], '08:00', '12:00'), service('Teste de pressão', ['c1'], '14:00', '18:00')] })]);
  assert.deepEqual(separated.map(point => point.productivePersonMinutes), [240, 240]);
  assert.deepEqual(separated.flatMap(point => point.productivityIssues), []);
  const capped = buildWeeklyProductiveHistory([report({ lunchBreak: '01:00', specialConditions,
    services: [service('Limpeza química', ['c1'], '08:00', '12:00'), service('Teste de pressão', ['c1'], '12:00', '16:00')] })]);
  assert.deepEqual(capped.map(point => point.productivePersonMinutes), [180, 180]);
});

test('deduplica intervalos da mesma pessoa e serviço entre RDOs e identifica sobreposição entre tipos', () => {
  const duplicated = buildWeeklyProductiveHistory([report(), report(), report({ services: [service('Limpeza química', ['c1'], '10:00', '12:00')] })]);
  assert.equal(duplicated[0].productivePersonMinutes, 480);
  const conflicted = buildWeeklyProductiveHistory([report(), report({ services: [service('Teste de pressão', ['c1'], '12:00', '16:00')] })]);
  assert.equal(forType(conflicted, 'LIMPEZA_QUIMICA').productivePersonMinutes, 240);
  assert.equal(forType(conflicted, 'TESTE_PRESSAO').productivePersonMinutes, 0);
  assert.deepEqual(conflicted.map(point => point.productivityIssues), [['OVERLAPPING_SERVICES'], ['OVERLAPPING_SERVICES']]);
});

test('turno noturno usa sua própria equipe e distribui horas entre datas, inclusive RDOs duplicados na virada', () => {
  const specialConditions = { noturno: true, noturnoDetails: { inicio: '22:00', termino: '06:00', intervalo: 'sem intervalo', collaboratorIds: ['n1'] } };
  const history = buildWeeklyProductiveHistory([
    report({ specialConditions, services: [service(), service('Filtragem', ['n1'], '22:00', '06:00')] }),
    report({ reportDate: '2026-09-29', arrivalTime: '00:00', departureTime: '06:00', collaborators: [member('n1')], services: [service('Filtragem', ['n1'], '00:00', '06:00')] })
  ], [{ id: 'n1', jobRole: { isOperational: true } }]);
  assert.equal(forType(history, 'LIMPEZA_QUIMICA').productivePersonMinutes, 480);
  assert.equal(forType(history, 'FILTRAGEM').productivePersonMinutes, 120);
  assert.equal(forType(history, 'FILTRAGEM', '2026-09-29').productivePersonMinutes, 360);
  assert.deepEqual(history.flatMap(point => point.productivityIssues), []);
  const early = buildWeeklyProductiveHistory([report({ specialConditions, services: [service('Filtragem', ['n1'], '02:00', '04:00')] })], [{ id: 'n1', jobRole: { isOperational: true } }]);
  assert.equal(forType(early, 'FILTRAGEM', '2026-09-29').productivePersonMinutes, 120);
});

test('dados incompletos não usam equipe geral nem contagens como substitutos; preserva classificação do cargo no RDO', () => {
  assert.deepEqual(buildWeeklyProductiveHistory([report({ daytimeCount: 5, services: [service('Limpeza química', [])] })])[0].productivityIssues, ['MISSING_TEAM']);
  assert.deepEqual(buildWeeklyProductiveHistory([report({ services: [service('Limpeza química', ['fora'])] })])[0].productivityIssues, ['MISSING_ROLE']);
  assert.deepEqual(buildWeeklyProductiveHistory([report({ services: [service('Limpeza química', ['c1'], '', '16:00')] })])[0].productivityIssues, ['MISSING_TIME']);
  const historical = report({ collaborators: [{ ...member('c1', false), collaborator: { jobRole: { isOperational: true } } }] });
  assert.equal(buildWeeklyProductiveHistory([historical])[0].productivePersonMinutes, 0);
  const unconfirmed = report({ specialConditions: { __manualUpload: { importedByScript: 'import-manual-rdo-pdfs' } } });
  assert.deepEqual(buildWeeklyProductiveHistory([unconfirmed])[0].productivityIssues, ['UNCONFIRMED_TEAM']);
  assert.deepEqual(buildWeeklyProductiveHistory([report({ deletedAt: new Date() }), report({ reportType: 'LIMPEZA_QUIMICA' })]), []);
});

test('loader restringe projetos e fontes e consulta somente a equipe noturna necessária', async () => {
  const client = {
    report: { findMany: async ({ where }) => {
      assert.deepEqual(where, { projectId: { in: ['p1', 'p2'] }, reportType: 'RDO', deletedAt: null });
      return [report({ specialConditions: { noturnoDetails: { collaboratorIds: ['n1', 'n1'] } } })];
    } },
    collaborator: { findMany: async ({ where }) => { assert.deepEqual(where, { id: { in: ['n1'] } }); return []; } }
  };
  const history = await loadWeeklyProductiveHistory(['p1', 'p2'], client);
  assert.equal(history[0].productivePersonMinutes, 480);
});
