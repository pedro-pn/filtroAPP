import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createServer } from 'vite';

let server,
  OperationsPage,
  HubPage,
  AuthContext,
  ThemeContext,
  presentation,
  navigation,
  hubModulesForUser;
before(async () => {
  server = await createServer({
    configFile: false,
    root: new URL('..', import.meta.url).pathname,
    server: { middlewareMode: true, hmr: false },
    esbuild: { jsx: 'automatic' },
    optimizeDeps: { noDiscovery: true },
    appType: 'custom'
  });
  ({ OperationsPage } = await server.ssrLoadModule(
    '/src/pages/OperationsPage.tsx'
  ));
  ({ HubPage } = await server.ssrLoadModule('/src/pages/HubPage.tsx'));
  ({ AuthContext } = await server.ssrLoadModule('/src/auth/AuthContext.ts'));
  ({ ThemeContext } = await server.ssrLoadModule('/src/theme/ThemeContext.ts'));
  presentation = await server.ssrLoadModule(
    '/src/pages/operationalStatusPresentation.ts'
  );
  navigation = await server.ssrLoadModule('/src/layout/navigationModel.ts');
  ({ hubModulesForUser } = await server.ssrLoadModule(
    '/src/pages/hubModules.ts'
  ));
});
after(async () => {
  await server?.close();
});

const admin = {
  id: 'admin-test',
  username: 'admin-test',
  name: 'Administrador',
  email: null,
  accountType: 'ADMIN',
  role: 'MANAGER',
  moduleRoles: [],
  reportEmissionPermissions: [],
  isActive: true
};
const integrationRun = {
  id: 'omie-test',
  integration: 'OMIE',
  scope: 'Projetos',
  status: 'ERROR',
  recordsRead: 12,
  recordsWritten: 3,
  error: 'Falha ao sincronizar projetos',
  summary: null,
  triggeredBy: 'Agendamento',
  startedAt: '2026-10-01T12:00:00Z',
  finishedAt: '2026-10-01T12:04:00Z'
};
function statusFixture() {
  return {
    ok: false,
    generatedAt: '2026-10-01T14:35:00Z',
    problems: [
      {
        message: 'Job recorrente falhou na última execução.',
        job: 'pontomais-sync'
      }
    ],
    backup: {
      configured: true,
      status: 'FAILURE',
      ageMs: 3600000,
      maxAgeMs: 86400000,
      finishedAt: '2026-10-01T13:00:00Z',
      runDir: '/backups/ultimo',
      message: 'Cópia interrompida'
    },
    restore: {
      configured: true,
      status: 'STALE',
      ageMs: 259200000,
      maxAgeMs: 172800000
    },
    omie: {
      configured: true,
      enabled: false,
      status: 'ERROR',
      latestRun: integrationRun,
      scopes: [{ scope: 'Projetos', latestRun: integrationRun }]
    },
    commercialImport: {
      configured: true,
      status: 'PARTIAL',
      latestImport: {
        id: 'import-test',
        fileName: 'propostas.xlsx',
        source: 'UPLOAD',
        status: 'PARTIAL',
        rowsRead: 38,
        created: 2,
        updated: 4,
        skipped: 32,
        error: null,
        summary: { skippedDuplicate: true },
        createdAt: null
      }
    },
    jobs: {
      recurring: [
        {
          name: 'pontomais-sync',
          latestRun: {
            status: 'FAILED',
            error: 'PontoMais indisponível',
            startedAt: '2026-10-01T12:00:00Z',
            finishedAt: null,
            durationMs: null
          }
        },
        { name: 'signature-reminders', latestRun: null }
      ],
      activeLocks: [{}],
      dataRetention: { latestRun: null },
      reportApprovalPostProcessing: { counts: {}, latestFailed: null }
    },
    errorTracking: { enabled: false, provider: 'Nenhum provedor configurado' },
    alerting: { enabled: true, webhookConfigured: false, intervalMs: 300000 }
  };
}

function renderPage(
  Page,
  { status, user = admin, path = '/operacoes', props = {} } = {}
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } }
  });
  if (status) client.setQueryData(['operations', 'status'], status);
  const noop = async () => {};
  try {
    return renderToStaticMarkup(
      createElement(
        QueryClientProvider,
        { client },
        createElement(
          AuthContext.Provider,
          {
            value: {
              user,
              token: 'test',
              isBootstrapping: false,
              isAuthenticated: true,
              login: noop,
              logout: noop,
              refreshUser: noop,
              replaceUser() {}
            }
          },
          createElement(
            ThemeContext.Provider,
            {
              value: { theme: 'light', resolvedTheme: 'light', setTheme() {} }
            },
            createElement(
              MemoryRouter,
              { initialEntries: [path] },
              createElement(Page, props)
            )
          )
        )
      )
    );
  } finally {
    client.clear();
  }
}

test('status operacional traduz falhas de arquivos, erros de integração e situações parciais', () => {
  for (const [status, label, tone] of [
    ['FAILURE', 'Falhou', 'danger'],
    ['ERROR', 'Erro', 'danger'],
    ['STALE', 'Atrasado', 'warning'],
    ['PARTIAL', 'Parcial', 'warning'],
    ['MISSING', 'Status ausente', 'warning'],
    ['INVALID', 'Status inválido', 'danger'],
    ['RUNNING', 'Em andamento', 'info'],
    ['NOT_CONFIGURED', 'Não configurado', 'neutral'],
    ['SUCCESS', 'Concluído', 'success']
  ]) {
    assert.equal(presentation.operationalStatusLabel(status), label);
    assert.equal(presentation.operationalStatusTone(status), tone);
  }
  assert.equal(
    presentation.operationalStatusLabel('FUTURE_STATUS'),
    'FUTURE_STATUS'
  );
  assert.equal(presentation.operationalStatusTone('FUTURE_STATUS'), 'neutral');
});

test('tempos ausentes não aparecem como zero e prazos de backup usam dias', () => {
  for (const value of [null, undefined, NaN, Infinity, -1])
    assert.equal(presentation.operationalDuration(value), '—');
  assert.equal(presentation.operationalDuration(0), '< 1 min');
  assert.equal(presentation.operationalDuration(900000), '15 min');
  assert.equal(presentation.operationalDuration(5400000), '1h 30min');
  assert.equal(presentation.operationalDuration(86400000), '1d');
  assert.equal(presentation.operationalDuration(604800000), '7d');
  for (const value of [null, undefined, 'invalid'])
    assert.equal(presentation.operationalDateTime(value), '—');
});

test('painel preserva diagnósticos de backup, sincronizações, escopos e rotinas reais', () => {
  const html = renderPage(OperationsPage, { status: statusFixture() });
  for (const text of [
    'Cópia interrompida',
    '/backups/ultimo',
    'Falha ao sincronizar projetos',
    'Sincronização PontoMais',
    'PontoMais indisponível',
    'Lembretes de assinaturas',
    'Sem execução',
    'Arquivo recebido novamente sem reprocessar propostas.',
    '38 / 6',
    '1 bloqueio ativo',
    'Atualização automática a cada minuto'
  ])
    assert.ok(html.includes(text), text);
  for (const status of [
    'FAILURE',
    'STALE',
    'ERROR',
    'PARTIAL',
    'FAILED',
    'SEM_EXECUCAO'
  ]) {
    assert.ok(html.includes(`data-status="${status}"`), status);
  }
  assert.match(html, /aria-label="Sincronizações Omie por escopo"/);
  assert.match(html, /aria-label="Status das rotinas recorrentes"/);
  assert.match(
    html,
    /<a(?=[^>]*href="\/operacoes")(?=[^>]*aria-current="page")[^>]*>/
  );
});

test('painel sem execuções mostra configurações ausentes e mantém a prévia isolada', () => {
  const status = statusFixture();
  status.backup = status.restore = {
    configured: false,
    status: 'NOT_CONFIGURED'
  };
  status.omie = {
    configured: false,
    enabled: false,
    status: 'NOT_CONFIGURED',
    latestRun: null,
    scopes: []
  };
  status.commercialImport = {
    configured: false,
    status: 'SEM_RECEBIMENTO',
    latestImport: null
  };
  status.jobs.recurring = [];
  const html = renderPage(OperationsPage, { status });
  for (const text of [
    'Não configurado',
    'Sem recebimento',
    'Credenciais Omie não configuradas.',
    'Token de recebimento não configurado.',
    'Nenhuma rotina recorrente disponível.'
  ])
    assert.ok(html.includes(text), text);
  const preview = renderPage(OperationsPage, {
    props: { preview: true },
    path: '/visualizar/operacoes'
  });
  assert.ok(preview.includes('Demonstração visual com dados fictícios.'));
  assert.doesNotMatch(preview, /href="\/admin\/accounts"/);
});

test('sincronizações tem entrada própria fora da gestão de contas e aparece somente para admins', () => {
  const model = navigation.createNavigationModel({
    modules: hubModulesForUser(admin),
    pathname: '/operacoes'
  });
  assert.equal(
    navigation
      .navigationItems(model)
      .find((item) => item.id === 'sincronizacoes').active,
    true
  );
  assert.equal(
    navigation.navigationItems(model).find((item) => item.id === 'admin')
      .active,
    false
  );
  assert.equal(
    navigation.navigationItems(model).find((item) => item.id === 'admin')
      .children,
    undefined
  );
  const adminHub = renderPage(HubPage, { path: '/modulos' });
  assert.match(adminHub, /data-hub-module-id="sincronizacoes"/);
  const internalHub = renderPage(HubPage, {
    path: '/modulos',
    user: { ...admin, accountType: 'INTERNAL' }
  });
  assert.doesNotMatch(internalHub, /Sincronizações|href="\/operacoes"/);
});
