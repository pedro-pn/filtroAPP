import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

import {
  allocationAuditQuerySchema,
  createPontoMaisIntegrationRouter,
  defaultPontoMaisIntegration,
  currentUnmatchedPontoNames,
  dayProjectOverrideSchema,
  externalEmployeeIgnoreSchema,
  externalEmployeeLinkSchema,
  projectTagIgnoreSchema,
  projectTagLinkSchema,
  resolveUnallocatedSchema,
  syncRunsQuerySchema,
  mapPontoSyncHttpError,
  syncPeriodSchema
} from '../src/routes/resources/acompanhamento-ponto.js';
import { PontoSyncError } from '../src/lib/pontomais/sync.js';

test('lista de nomes pendentes considera somente resumos ainda sem vínculo e remove duplicados', () => {
  assert.deepEqual(currentUnmatchedPontoNames([
    { rawName: ' Pessoa Externa ', normalizedName: 'pessoa externa' },
    { rawName: 'Pessoa Externa Atualizada', normalizedName: 'pessoa externa' },
    { rawName: 'Outro Nome', normalizedName: 'outro nome' },
    { rawName: 'Inválido', normalizedName: '' }
  ]), [
    { rawName: 'Pessoa Externa Atualizada', normalizedName: 'pessoa externa' },
    { rawName: 'Outro Nome', normalizedName: 'outro nome' }
  ]);
});

function testAuthentication(req, res, next) {
  const role = req.headers['x-test-role'];
  if (!role) return res.status(401).json({ error: 'Sessão ausente.' });
  req.auth = {
    user: {
      id: `${role}-1`,
      accountType: 'INTERNAL',
      moduleRoles: [`acompanhamento:${role}`]
    }
  };
  next();
}

async function dispatch(router, path, { method = 'GET', headers = {}, body } = {}) {
  const parsedUrl = new URL(path, 'http://local.test');
  const request = {
    method,
    url: `${parsedUrl.pathname}${parsedUrl.search}`,
    originalUrl: `${parsedUrl.pathname}${parsedUrl.search}`,
    headers: Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value])),
    query: Object.fromEntries(parsedUrl.searchParams),
    body: typeof body === 'string' ? JSON.parse(body) : body
  };
  return new Promise((resolve, reject) => {
    let completed = false;
    const finish = (status, payload) => {
      if (completed) return;
      completed = true;
      resolve({ status, body: payload });
    };
    const response = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(payload) { finish(this.statusCode, payload); return this; },
      send(payload) { finish(this.statusCode, payload); return this; },
      end(payload) { finish(this.statusCode, payload); return this; },
      setHeader() {},
      getHeader() { return undefined; }
    };
    router.handle(request, response, error => {
      if (error) reject(error);
      else finish(404, null);
    });
  });
}

function integrationRouteFixture() {
  const calls = [];
  const services = {
    async runSync(input) {
      calls.push(['sync', input]);
      return {
        runId: 'run-1', status: 'SUCCEEDED', skippedDuplicate: false, importId: 'import-1',
        periodStart: input.startDate, periodEnd: input.endDate,
        employeesRead: 2, workDaysRead: 2, timeCardsRead: 4,
        collaboratorsTotal: 2, collaboratorsMatched: 2, pendingCount: 0
      };
    },
    async getIntegrationStatus() {
      calls.push(['status']);
      return {
        configured: true,
        running: false,
        automation: {
          bootstrapStatus: 'RUNNING', historyStart: '2024-01-01', historyThrough: '2026-07-31',
          nextPeriodStart: '2026-08-01', lastDailySyncDate: null,
          lastAttemptAt: '2026-08-17T12:00:00.000Z', lastSuccessfulAt: '2026-08-17T11:59:00.000Z',
          lastErrorCode: null, lastErrorMessage: null, scheduledTime: '03:00', timeZone: 'America/Sao_Paulo'
        },
        lastSuccessfulRun: null,
        lastFailure: null
      };
    },
    async listSyncRuns(input) { calls.push(['runs', input]); return []; },
    async getPending() {
      calls.push(['pending']);
      return {
        employees: [],
        ambiguousDays: [],
        missingProjects: { projectTags: [], ambiguousDays: [] }
      };
    },
    async listExternalEmployees() {
      calls.push(['employees']);
      return [{
        externalEmployeeId: '101', registrationNumber: '42', externalName: 'Pessoa externa',
        isActive: true, ignored: false
      }];
    },
    async setExternalEmployeeIgnored(input) {
      calls.push(['employee-ignore', input]);
      return {
        externalEmployeeId: input.externalEmployeeId,
        registrationNumber: '42', externalName: 'Pessoa externa', isActive: true, ignored: input.ignored
      };
    },
    async linkExternalEmployee(input) { calls.push(['employee-link', input]); return { ...input, relinked: 1 }; },
    async linkProjectTag(input) { calls.push(['tag-link', input]); return { normalizedTag: 'equipe ilha', projectId: input.projectId }; },
    async setDayProjectOverride(input) { calls.push(['day-override', input]); return input; },
    async setDayProjectOverridesBatch(input) { calls.push(['day-override-batch', input]); return { updated: input.items.length }; }
  };
  const db = {
    project: {
      async findMany() {
        calls.push(['projects']);
        return [
          { id: 'project-active', code: '5745', name: 'Projeto ativo', isActive: true, deletedAt: null },
          { id: 'project-history', code: '5700', name: 'Projeto histórico', isActive: false, deletedAt: new Date('2025-01-01T00:00:00.000Z') }
        ];
      }
    }
  };
  const router = createPontoMaisIntegrationRouter({ authenticate: testAuthentication, services, db });
  return { router, calls };
}

test('schema aceita datas estritas e no máximo 31 dias inclusivos', () => {
  assert.deepEqual(syncPeriodSchema.parse({ startDate: '2026-08-01', endDate: '2026-08-31' }), {
    startDate: '2026-08-01',
    endDate: '2026-08-31'
  });
  assert.throws(() => syncPeriodSchema.parse({ startDate: '2026-02-30', endDate: '2026-03-01' }));
  assert.throws(() => syncPeriodSchema.parse({ startDate: '2026-08-10', endDate: '2026-08-01' }));
  assert.throws(() => syncPeriodSchema.parse({ startDate: '2026-08-01', endDate: '2026-09-01' }));
});

test('erros de sincronização viram contrato HTTP sanitizado', () => {
  assert.deepEqual(mapPontoSyncHttpError(new PontoSyncError('interno', { code: 'SYNC_IN_PROGRESS' })), {
    status: 409,
    body: { error: 'Já existe uma sincronização do Ponto Mais em andamento.', code: 'SYNC_IN_PROGRESS' }
  });
  const unavailable = mapPontoSyncHttpError(new Error('token e corpo privado'));
  assert.equal(unavailable.status, 503);
  assert.equal(unavailable.body.code, 'PONTOMAIS_UNAVAILABLE');
  assert.doesNotMatch(unavailable.body.error, /token|privado/);
});

test('contratos de auditoria e vínculo rejeitam campos ausentes ou excedentes', () => {
  assert.deepEqual(syncRunsQuerySchema.parse({ limit: '200' }), { limit: 200 });
  assert.throws(() => syncRunsQuerySchema.parse({ limit: '201' }));
  assert.deepEqual(externalEmployeeLinkSchema.parse({
    externalEmployeeId: 'external-1',
    collaboratorId: 'collaborator-1'
  }), {
    externalEmployeeId: 'external-1',
    collaboratorId: 'collaborator-1'
  });
  assert.deepEqual(projectTagLinkSchema.parse({ rawTag: 'Equipe Ilha', projectId: 'project-1' }), {
    rawTag: 'Equipe Ilha',
    projectId: 'project-1'
  });
  assert.deepEqual(externalEmployeeIgnoreSchema.parse({ externalEmployeeId: 'external-1', ignored: true }), {
    externalEmployeeId: 'external-1', ignored: true
  });
  assert.deepEqual(dayProjectOverrideSchema.parse({
    externalEmployeeId: 'external-1', date: '2026-08-01', projectId: 'project-1'
  }), { externalEmployeeId: 'external-1', date: '2026-08-01', projectId: 'project-1' });
  assert.throws(() => dayProjectOverrideSchema.parse({
    externalEmployeeId: 'external-1', date: '2026-02-30', projectId: 'project-1'
  }));
  assert.throws(() => externalEmployeeLinkSchema.parse({ externalEmployeeId: '', collaboratorId: 'collaborator-1' }));
  assert.throws(() => projectTagLinkSchema.parse({ rawTag: 'Equipe Ilha', projectId: '' }));
  assert.throws(() => projectTagLinkSchema.parse({ rawTag: 'Equipe Ilha', projectId: 'project-1', token: 'forbidden' }));
  assert.throws(() => externalEmployeeIgnoreSchema.parse({ externalEmployeeId: 'external-1', ignored: 'true' }));
});

test('rotas HTTP exigem sessão e restringem sincronização, auditoria e vínculos ao gestor', async () => {
  const { router, calls } = integrationRouteFixture();
  const unauthenticated = await dispatch(router, '/integration-status');
  assert.equal(unauthenticated.status, 401);

  const viewerStatus = await dispatch(router, '/integration-status', { headers: { 'x-test-role': 'viewer' } });
  assert.equal(viewerStatus.status, 200);
  assert.equal(viewerStatus.body.automation.bootstrapStatus, 'RUNNING');
  assert.equal(viewerStatus.body.automation.nextPeriodStart, '2026-08-01');

  const managerOnlyRequests = [
    ['/sync', { method: 'POST', body: { startDate: '2026-08-01', endDate: '2026-08-02' } }],
    ['/sync-runs', {}],
    ['/pending', {}],
    ['/external-employees', {}],
    ['/external-employees/ignore', { method: 'POST', body: { externalEmployeeId: '101', ignored: true } }],
    ['/external-employees/link', { method: 'POST', body: { externalEmployeeId: '101', collaboratorId: 'collaborator-1' } }],
    ['/project-tags/link', { method: 'POST', body: { rawTag: 'Equipe Ilha', projectId: 'project-active' } }],
    ['/day-project-overrides', { method: 'POST', body: { externalEmployeeId: '101', date: '2026-08-01', projectId: 'project-active' } }],
    ['/day-project-overrides/batch', { method: 'POST', body: { items: [{ externalEmployeeId: '101', date: '2026-08-01', projectIds: ['project-active'] }] } }],
    ['/reconciliation-projects', {}]
  ];
  for (const [path, options] of managerOnlyRequests) {
    const response = await dispatch(router, path, {
      ...options,
      headers: { 'content-type': 'application/json', 'x-test-role': 'viewer' }
    });
    assert.equal(response.status, 403, path);
  }
  assert.deepEqual(calls, [['status']]);
});

test('gestor executa contratos HTTP e recebe catálogo seguro com projetos históricos', async () => {
  const { router, calls } = integrationRouteFixture();
  const request = (path, options = {}) => dispatch(router, path, {
      ...options,
      headers: { 'content-type': 'application/json', 'x-test-role': 'manager' }
    });

  assert.equal((await request('/integration-status')).status, 200);
  assert.equal((await request('/sync-runs?limit=5')).status, 200);
  assert.equal((await request('/pending')).status, 200);
  const employees = await request('/external-employees');
  assert.equal(employees.status, 200);
  assert.equal(employees.body[0].externalEmployeeId, '101');
  assert.equal((await request('/sync', {
    method: 'POST',
    body: { startDate: '2026-08-01', endDate: '2026-08-02' }
  })).status, 201);
  assert.equal((await request('/external-employees/link', {
    method: 'POST',
    body: { externalEmployeeId: '101', collaboratorId: 'collaborator-1' }
  })).status, 200);
  assert.equal((await request('/external-employees/ignore', {
    method: 'POST',
    body: { externalEmployeeId: '101', ignored: true }
  })).status, 200);
  assert.equal((await request('/project-tags/link', {
    method: 'POST',
    body: { rawTag: 'Equipe Ilha', projectId: 'project-active' }
  })).status, 200);
  assert.equal((await request('/day-project-overrides', {
    method: 'POST',
    body: { externalEmployeeId: '101', date: '2026-08-01', projectId: 'project-active' }
  })).status, 200);
  assert.equal((await request('/day-project-overrides/batch', {
    method: 'POST',
    body: { items: [{ externalEmployeeId: '101', date: '2026-08-01', projectIds: ['project-active', 'project-history'] }] }
  })).status, 200);

  const projectResponse = await request('/reconciliation-projects');
  assert.equal(projectResponse.status, 200);
  assert.deepEqual(projectResponse.body, [
    { id: 'project-active', code: '5745', name: 'Projeto ativo', isActive: true, historical: false },
    { id: 'project-history', code: '5700', name: 'Projeto histórico', isActive: false, historical: true }
  ]);

  assert.ok(calls.some(([name, input]) => name === 'sync'
    && input.requestedByUserId === 'manager-1'
    && input.trigger === 'MANUAL'));
  assert.ok(calls.some(([name]) => name === 'projects'));
  assert.ok(calls.some(([name, input]) => name === 'employee-link' && input.createdByUserId === 'manager-1'));
  assert.ok(calls.some(([name, input]) => name === 'employee-ignore'
    && input.ignoredByUserId === 'manager-1'
    && input.ignored === true));
  assert.ok(calls.some(([name, input]) => name === 'tag-link' && input.createdByUserId === 'manager-1'));
  assert.ok(calls.some(([name, input]) => name === 'day-override'
    && input.createdByUserId === 'manager-1'
    && input.date === '2026-08-01'));
});

test('a fiação padrão do router cobre toda função de integração que as rotas chamam', () => {
  // Os demais testes injetam um services próprio, então o mapa real nunca era exercitado: dava para
  // adicionar uma função ao serviço, esquecer a entrada aqui e só descobrir com 500 em produção.
  const source = readFileSync(new URL('../src/routes/resources/acompanhamento-ponto.js', import.meta.url), 'utf8');
  const used = [...source.matchAll(/integration\.([A-Za-z0-9_]+)\(/g)].map(match => match[1]);

  assert.ok(used.length > 0, 'nenhuma chamada a integration.* encontrada');
  for (const name of new Set(used)) {
    assert.equal(
      typeof defaultPontoMaisIntegration[name],
      'function',
      `rota chama integration.${name}() mas a fiação padrão não tem essa função`
    );
  }
});

// === Schemas das rotas de auditoria e de ignorar etiqueta ===

test('ignorar etiqueta aceita texto livre e assume ignorado quando o campo não vem', () => {
  assert.deepEqual(projectTagIgnoreSchema.parse({ rawTag: '  Missão 9999  ' }), {
    rawTag: 'Missão 9999',
    ignored: true
  });
  assert.deepEqual(projectTagIgnoreSchema.parse({ rawTag: 'Missão 9999', ignored: false }), {
    rawTag: 'Missão 9999',
    ignored: false
  });
  assert.throws(() => projectTagIgnoreSchema.parse({ rawTag: '   ' }));
  assert.throws(() => projectTagIgnoreSchema.parse({}));
});

test('filtro da auditoria recusa data malformada e só aceita o marcador textual do checkbox', () => {
  assert.deepEqual(allocationAuditQuerySchema.parse({ collaboratorId: 'c-1', de: '2026-06-01' }), {
    collaboratorId: 'c-1',
    de: '2026-06-01'
  });
  assert.deepEqual(
    allocationAuditQuerySchema.parse({ projectId: 'p-1', somenteNaoAlocados: 'true' }).somenteNaoAlocados,
    'true'
  );
  assert.throws(() => allocationAuditQuerySchema.parse({ de: '01/06/2026' }));
  assert.throws(() => allocationAuditQuerySchema.parse({ ate: '2026-6-1' }));
  assert.throws(() => allocationAuditQuerySchema.parse({ somenteNaoAlocados: 'sim' }));
  // Sem filtro nenhum é válido: a rota devolve todo mundo dentro do corte.
  assert.deepEqual(allocationAuditQuerySchema.parse({}), {});
});

test('resolução em lote exige ao menos um dia e respeita o teto de 200 por requisição', () => {
  const item = { collaboratorId: 'c-1', date: '2026-08-17', projectIds: ['p-1'] };
  assert.equal(resolveUnallocatedSchema.parse({ items: [item] }).items.length, 1);
  assert.equal(resolveUnallocatedSchema.parse({ items: Array(200).fill(item) }).items.length, 200);

  assert.throws(() => resolveUnallocatedSchema.parse({ items: [] }));
  assert.throws(() => resolveUnallocatedSchema.parse({ items: Array(201).fill(item) }));
  assert.throws(() => resolveUnallocatedSchema.parse({ items: [{ ...item, projectIds: [] }] }));
  assert.throws(() => resolveUnallocatedSchema.parse({ items: [{ ...item, date: '17/08/2026' }] }));
  assert.throws(() => resolveUnallocatedSchema.parse({ items: [{ ...item, collaboratorId: '' }] }));
});
