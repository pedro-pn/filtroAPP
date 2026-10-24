import assert from 'node:assert/strict';
import test from 'node:test';
import { buildWeeklyProductiveHistory, loadWeeklyProductiveHistory } from '../src/lib/acompanhamento/weekly-productive-time.js';

const member = id => ({ collaboratorId: id });
const service = (type = 'Limpeza química', start = '08:00', end = '16:00') => ({ serviceType: type, startTime: start, endTime: end });
const report = (overrides = {}) => ({ reportType: 'RDO', reportDate: '2026-09-28', collaborators: [member('c1'), member('c2')], services: [service()], ...overrides });
const forType = (points, type, date = '2026-09-28') => points.find(point => point.serviceType === type && point.date === date);

test('cada colaborador da equipe do RDO conta 1 no dia, sem depender do horário nem da equipe de cada serviço', () => {
  const history = buildWeeklyProductiveHistory([
    report({ collaborators: [member('c1'), member('c2'), member('c3')], services: [service('Limpeza química', '10:00', '11:00'), service('Teste de pressão', '07:30', '08:30')] }),
    report({ reportDate: '2026-09-29', collaborators: [member('c1')], services: [service('Limpeza química', '07:05', '23:18')] })
  ]);
  assert.equal(forType(history, 'LIMPEZA_QUIMICA').productivePersonDays, 3);
  assert.equal(forType(history, 'TESTE_PRESSAO').productivePersonDays, 3);
  assert.equal(forType(history, 'LIMPEZA_QUIMICA', '2026-09-29').productivePersonDays, 1);
  assert.deepEqual(history.flatMap(point => point.productivityIssues), []);
  assert.ok(history.every(point => point.productivePersonMinutes === undefined));
});

test('mesma pessoa em dois RDOs do dia conta uma vez; turno noturno entra; deslocamento não é serviço', () => {
  const night = { noturno: true, noturnoDetails: { collaboratorIds: ['n1', 'c1'] } };
  const history = buildWeeklyProductiveHistory([
    report({ specialConditions: night }),
    report({ collaborators: [member('c2'), member('c4')], services: [service('Deslocamento'), service('Flushing')] })
  ]);
  assert.deepEqual(history.map(point => [point.serviceType, point.productivePersonDays]), [['FLUSHING', 4], ['LIMPEZA_QUIMICA', 4]]);
  assert.deepEqual(buildWeeklyProductiveHistory([report({ services: [service('Deslocamento')] })]), []);
});

test('equipe vazia ou inferida da planilha de ponto fica pendente; RDOs excluídos e outros relatórios não contam', () => {
  assert.deepEqual(buildWeeklyProductiveHistory([report({ collaborators: [] })])[0].productivityIssues, ['MISSING_TEAM']);
  const unconfirmed = report({ specialConditions: { __manualUpload: { importedByScript: 'import-manual-rdo-pdfs' } } });
  assert.deepEqual(buildWeeklyProductiveHistory([unconfirmed])[0].productivityIssues, ['UNCONFIRMED_TEAM']);
  assert.deepEqual(buildWeeklyProductiveHistory([report({ deletedAt: new Date() }), report({ reportType: 'LIMPEZA_QUIMICA' })]), []);
});

test('loader consulta só os RDOs dos projetos, com equipe e tipos de serviço', async () => {
  const client = {
    report: { findMany: async ({ where, select }) => {
      assert.deepEqual(where, { projectId: { in: ['p1', 'p2'] }, reportType: 'RDO', deletedAt: null });
      assert.deepEqual(Object.keys(select).sort(), ['collaborators', 'reportDate', 'reportType', 'services', 'specialConditions']);
      return [report()];
    } }
  };
  const history = await loadWeeklyProductiveHistory(['p1', 'p2'], client);
  assert.equal(history[0].productivePersonDays, 2);
});
