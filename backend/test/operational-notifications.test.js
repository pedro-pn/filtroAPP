import assert from 'node:assert/strict';
import test from 'node:test';

import { notificationAccessWhere, publicNotification } from '../src/lib/notifications/center.js';
import { refreshOperationalNotifications } from '../src/lib/notifications/operational.js';

function fixture() {
  const events = new Map();
  const state = {
    pontoRun: { id: 'ponto-1', status: 'FAILED', errorMessage: 'Não foi possível consultar o PontoMais.' },
    status: {
      generatedAt: '2026-10-22T12:00:00Z',
      problems: [
        { message: 'Backup falhou na última execução.', backup: { status: 'FAILURE', startedAt: '2026-10-22T02:00:00Z', finishedAt: '2026-10-22T02:01:00Z', ageMs: 1000 } },
        { message: 'Sincronização Omie falhou na última execução.', job: 'omie-sync', scope: 'projects' },
        { message: 'Sincronização Omie falhou na última execução.', job: 'omie-sync', scope: 'purchases' },
        { message: 'Recebimento do banco comercial ficou parcial na última execução.', job: 'commercial-access-import' },
        { message: 'Job recorrente falhou na última execução.', job: 'pontomais-sync' },
        { message: 'Job recorrente falhou na última execução.', job: 'signature-reminders' }
      ],
      omie: { scopes: ['projects', 'purchases'].map(scope => ({ scope, latestRun: { id: `omie-${scope}`, status: 'ERROR' } })) },
      commercialImport: { latestImport: { id: 'commercial-1', status: 'PARTIAL' } },
      jobs: { recurring: [] }
    }
  };
  const client = {
    pontoSyncRun: { findFirst: async () => state.pontoRun },
    notificationEvent: { upsert: async ({ where, create }) => {
      if (!events.has(where.dedupeKey)) events.set(where.dedupeKey, {
        id: `event-${events.size}`, createdAt: new Date(), project: null, reads: [], ...structuredClone(create)
      });
      return events.get(where.dedupeKey);
    } }
  };
  return { state, events, refresh: () => refreshOperationalNotifications({ client, statusProvider: async () => state.status }) };
}

test('falhas de sincronização e backup geram eventos sem projeto, com chave estável e novos incidentes independentes', async () => {
  const { state, events, refresh } = fixture();
  const criticalIds = await refresh();
  assert.equal(events.size, 5, 'PontoMais não duplica o aviso do agendador; lembretes não são sincronizações');
  assert.equal(criticalIds.length, 1);
  assert.equal([...events.values()].filter(event => event.kind === 'SYNC_FAILED').length, 4);
  for (const event of events.values()) {
    const item = publicNotification(event, { accountType: 'ADMIN' });
    assert.equal(item.href, '/operacoes');
    assert.ok(item.title);
    assert.ok(item.description);
  }
  const first = [...events.values()][0];
  first.reads.push({ readAt: new Date() });
  state.status.generatedAt = '2026-10-22T13:00:00Z';
  state.status.problems[0].backup.ageMs = 3600000;
  assert.deepEqual(await refresh(), criticalIds);
  assert.equal(events.size, 5, 'consultas e idade do backup não repetem eventos');
  assert.equal(first.reads.length, 1, 'a atualização preserva a leitura');
  state.status.problems[0].backup.startedAt = '2026-10-23T02:00:00Z';
  const next = await refresh();
  assert.notEqual(next[0], criticalIds[0], 'nova falha de backup volta a exigir atenção');
  assert.equal(events.size, 6);
});

test('recuperação retira o popup ativo e preserva o histórico; saúde sem problemas não gera aviso', async () => {
  const { state, events, refresh } = fixture();
  await refresh();
  state.status.problems = [];
  state.pontoRun = { id: 'ponto-2', status: 'SUCCEEDED' };
  assert.deepEqual(await refresh(), []);
  assert.equal(events.size, 5);
});

test('somente administradores ativos têm escopo para listar, contar e ler falhas operacionais', async () => {
  for (const accountType of ['ADMIN', 'INTERNAL', 'CLIENT']) {
    for (const isActive of [true, false]) {
      const where = await notificationAccessWhere({ user: { id: 'u', accountType, isActive, role: 'COLLABORATOR', moduleRoles: [] } });
      const operational = where.OR?.find(scope => scope.kind?.in?.includes('BACKUP_FAILED'));
      assert.equal(Boolean(operational), accountType === 'ADMIN' && isActive);
    }
  }
});

test('projetos aguardando revisão abrem o formulário de revisão e só seguem para Efetivo após liberação', async () => {
  const user = { id: 'manager', role: 'MANAGER', accountType: 'ADMIN', isActive: true, moduleRoles: ['rdo:manager'] };
  const event = {
    id: 'created', kind: 'PROJECT_RECEIVED', projectId: 'project/a', data: {}, reads: [], createdAt: new Date(),
    project: { code: '5800', name: 'Teste', registrationPending: true, managerOnly: false }
  };
  for (const kind of ['PROJECT_CREATED', 'PROJECT_RECEIVED', 'PROJECT_READY']) {
    event.kind = kind;
    assert.equal(publicNotification(event, user).href, '/rdo/gestor?tab=projetos&revisar=project%2Fa');
    event.project.registrationPending = false;
    assert.equal(publicNotification(event, user).href, '/efetivo?section=evolucao&projeto=project%2Fa');
    event.project.registrationPending = true;
  }
  const reviewer = await notificationAccessWhere({ user });
  assert.ok(reviewer.OR.some(scope => scope.kind?.in?.includes('PROJECT_RECEIVED') && scope.project.registrationPending === undefined));
  for (const moduleRoles of [['efetivo:viewer'], ['rdo:coordinator']]) {
    const where = await notificationAccessWhere({ user: { ...user, role: 'COORDINATOR', accountType: 'INTERNAL', moduleRoles } });
    const scopes = where.OR.filter(scope => scope.kind?.in?.includes('PROJECT_RECEIVED'));
    assert.ok(scopes.length);
    assert.ok(scopes.every(scope => scope.project.registrationPending === false), 'sem revisão, não leva contas sem permissão de revisão ao Efetivo');
  }
});
