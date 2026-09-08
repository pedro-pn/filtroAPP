import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { createServer } from 'vite';

async function loadModule(path) {
  const server = await createServer({
    configFile: false,
    root: new URL('..', import.meta.url).pathname,
    server: { middlewareMode: true },
    optimizeDeps: { noDiscovery: true },
    appType: 'custom'
  });

  try {
    return await server.ssrLoadModule(path);
  } finally {
    await server.close();
  }
}

test('efetivo is registered in the module registry', async () => {
  const { moduleDefinition, moduleRoutePath } = await loadModule('/src/modules/registry.ts');

  assert.equal(moduleDefinition('efetivo')?.title, 'Efetivo Operacional');
  assert.equal(moduleRoutePath('efetivo', 'root'), '/efetivo');
});

test('filtros de produtividade serializam ano e mês de corte sem apagar outros parâmetros', async () => {
  const { setProductivityPeriodParams } = await loadModule('/src/pages/efetivo/utils/productivityPeriods.ts');
  const result = setProductivityPeriodParams(
    new URLSearchParams('section=produtividade&colaborador=col-1'),
    { year: 2025, cutoffMonth: 7 }
  );
  assert.equal(result.get('ano'), '2025');
  assert.equal(result.get('ateMes'), '7');
  assert.equal(result.get('colaborador'), 'col-1');
});

test('mês de corte válido é preservado e valores inválidos voltam ao último mês fechado', async () => {
  const { parseProductivityPeriod } = await loadModule('/src/pages/efetivo/utils/productivityPeriods.ts');
  const now = new Date('2026-08-21T12:00:00-03:00');
  assert.deepEqual(parseProductivityPeriod(new URLSearchParams('ano=2025&ateMes=2'), now), {
    year: 2025,
    cutoffMonth: 2
  });
  assert.deepEqual(parseProductivityPeriod(new URLSearchParams('ano=2025&ateMes=13'), now), {
    year: 2025,
    cutoffMonth: 7
  });
});

test('campanhas do Efetivo são individuais, independentes e expiram dez dias após a implantação', async () => {
  const stored = new Map();
  const originalNow = Date.now;
  globalThis.window = {
    localStorage: {
      getItem: key => stored.get(key) || null,
      setItem: (key, value) => stored.set(key, value)
    }
  };
  const user = {
    id: 'efetivo-manager',
    username: 'efetivo-manager',
    name: 'Gestora do Efetivo',
    email: null,
    role: 'MANAGER',
    accountType: 'INTERNAL',
    moduleRoles: ['efetivo:manager'],
    isActive: true
  };

  try {
    Date.now = () => new Date('2026-08-21T12:00:00-03:00').getTime();
    const navigation = await loadModule('/src/auth/moduleNavigation.ts');
    assert.equal(navigation.EFETIVO_NOVELTY_IMPLEMENTED_AT, '2026-08-21');
    assert.equal(navigation.shouldShowEfetivoHubNovelty(user), true);
    navigation.markEfetivoHubNoveltySeen(user);
    assert.equal(navigation.shouldShowEfetivoHubNovelty(user), false);

    assert.equal(navigation.shouldShowEfetivoControlNovelty(user, 'operational-role'), true);
    assert.equal(navigation.shouldShowEfetivoControlNovelty(user, 'termination-date'), true);
    navigation.markEfetivoControlNoveltySeen(user, 'operational-role');
    assert.equal(navigation.shouldShowEfetivoControlNovelty(user, 'operational-role'), false);
    assert.equal(navigation.shouldShowEfetivoControlNovelty(user, 'termination-date'), true);

    Date.now = () => new Date('2026-09-01T00:00:00-03:00').getTime();
    assert.equal(navigation.shouldShowEfetivoHubNovelty({ ...user, id: 'new-user' }), false);
    assert.equal(navigation.shouldShowEfetivoControlNovelty({ id: 'new-user' }, 'termination-date'), false);
  } finally {
    Date.now = originalNow;
    delete globalThis.window;
  }
});

test('produtividade mostra a situação da competência e a visão geral navega sem recarregar', () => {
  const board = fs.readFileSync(new URL('../src/pages/efetivo/components/ProductivityBoard.tsx', import.meta.url), 'utf8');
  assert.match(board, /<th>Situação<\/th>/);
  assert.match(board, /CONSOLIDADO: 'Consolidado', PODE_MUDAR: 'Pode mudar', SEM_BASE: 'Sem base'/);
  const overview = fs.readFileSync(new URL('../src/pages/efetivo/components/OverviewBoard.tsx', import.meta.url), 'utf8');
  for (const label of ['Ver calendário →', 'Ver missões →', 'Ver colaboradores →', 'Abrir produtividade →']) {
    assert.ok(overview.includes(label), `atalho ausente na visão geral: ${label}`);
  }
  assert.doesNotMatch(overview, /href=\{`\?section=/);
});

test('edição de colaborador usa o seletor padrão do APP para função', () => {
  const modal = fs.readFileSync(new URL('../src/pages/efetivo/components/OperationalCollaboratorModal.tsx', import.meta.url), 'utf8');

  assert.match(modal, /<select id="operational-collaborator-role"/);
  assert.match(modal, /\{\.\.\.register\('jobRoleId'\)\}/);
  assert.doesNotMatch(modal, /SearchCombobox/);
});
