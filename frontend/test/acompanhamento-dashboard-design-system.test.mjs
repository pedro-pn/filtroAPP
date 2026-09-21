import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createServer } from 'vite';

const source = path => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8');

test('acompanhamento: navegação, recortes, valores e estados DS sem mudar contratos', async t => {
  const server = await createServer({ configFile: false, root: new URL('..', import.meta.url).pathname,
    server: { middlewareMode: true, hmr: false }, esbuild: { jsx: 'automatic' }, optimizeDeps: { noDiscovery: true }, appType: 'custom' });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  client.setQueryData(['realized-categories', 'all'], [{ categoria: 'Hospedagem', categoriaCodigo: 'cat1', total: 900, count: 2 }]);
  try {
    const { parseSection, sectionSearchParams } = await server.ssrLoadModule('/src/pages/acompanhamento/navigation.ts');
    const model = await server.ssrLoadModule('/src/components/projects/acompanhamentoDashboardModel.ts');
    const { AcompanhamentoDashboardView } = await server.ssrLoadModule('/src/components/projects/AcompanhamentoDashboardView.tsx');
    const { BarList } = await server.ssrLoadModule('/src/components/ui/ds/BarList.tsx');
    const { RealizedCategoryBreakdown } = await server.ssrLoadModule('/src/components/projects/RealizedCategoryBreakdown.tsx');
    const render = element => renderToStaticMarkup(createElement(QueryClientProvider, { client }, element));
    const rows = [
      { projectId: 'p1', code: '4069', name: 'Missão extensa', clientName: 'Cliente A', clientCnpj: '12345678000199', proposalCode: 'PROP1', salePrice: 1500, originalSalePrice: 1000, additionalSalePrice: 500, plannedTotalCost: 900, realizedPaid: 120, realizedCost: 300, expectedMargin: 40, serviceModality: 'INLOCO', archived: false, progressPct: 60, rdoCount: 3, plannedDays: 8, workedDays: 5 },
      { projectId: 'p2', code: '4070', name: 'Projeto sede', clientName: 'Cliente B', proposalCode: 'PROP2', salePrice: '500', plannedTotalCost: null, realizedPaid: null, expectedMargin: null, serviceModality: 'POP_SEDE', archived: true, rdoCount: 0 },
      { kind: 'GROUP', groupId: 'g1', code: 'Grupo', clientName: 'Cliente C', proposalCode: 'PROP3', salePrice: 800, plannedTotalCost: 300, progressPct: 25, members: [{ projectId: 'm1', code: '4071', name: 'Membro distinto', clientName: 'Cliente interno', clientCnpj: '98765432000111' }], rdoCount: 2 }
    ];
    const values = { search: '', modality: 'todas', status: 'todos', category: '', metricKey: 'custo' };
    const base = { data: rows, loading: false, error: false, updating: false, onRetry() {}, values, onChange() {}, categories: [], categoriesLoading: false, categoriesError: false, onRetryCategories() {}, onOpen() {} };
    await t.test('query params preservam deep links e removem somente o estado da área anterior', () => {
      const current = new URLSearchParams('section=projetos&project=p1&group=g1&cards=all&cost=simulador&keep=yes');
      assert.equal(parseSection('invalid', 'projetos'), 'projetos');
      assert.equal(parseSection(null), 'dashboard');
      for (const section of ['dashboard', 'projetos', 'sede', 'custo']) {
        assert.equal(parseSection(section), section);
        const next = sectionSearchParams(current, section);
        assert.equal(next.get('keep'), 'yes');
        assert.equal(next.get('section'), section === 'dashboard' ? null : section);
        assert.equal(next.has('project'), section === 'projetos');
        assert.equal(next.has('group'), section === 'projetos');
        assert.equal(next.has('cards'), section === 'projetos');
        assert.equal(next.has('cost'), section === 'custo');
      }
      assert.equal(current.get('cost'), 'simulador', 'não muta o estado original');
    });
    await t.test('filtros continuam buscando membros, CNPJ, proposta, situação e modalidade', () => {
      const filter = patch => model.filterDashboardRows(rows, { ...values, ...patch });
      assert.deepEqual(filter({ search: '  MEMBRO DISTINTO  ' }), [rows[2]]);
      assert.deepEqual(filter({ search: '98765432000111' }), [rows[2]]);
      assert.deepEqual(filter({ search: 'prop1' }), [rows[0]]);
      assert.deepEqual(filter({ status: 'arquivados', modality: 'POP_SEDE' }), [rows[1]]);
      assert.equal(filter({ search: 'ausente' }).length, 0);
      assert.equal(model.METRICS.length, 20);
      assert.equal(model.METRICS.find(m => m.key === 'realizadoPago').get(rows[0]), 120);
      assert.equal(model.METRICS.find(m => m.key === 'realizadoTotal').get(rows[0]), 300);
      assert.equal(model.toNum('não numérico'), null);
      assert.equal(model.toNum('0'), 0);
    });
    for (const state of ['ready', 'loading', 'error', 'empty', 'filtered', 'cached-error', 'category-error']) {
      await t.test(state, () => {
        const props = { ...base };
        if (state === 'loading') { props.loading = true; props.data = undefined; }
        if (state === 'error') { props.error = true; props.data = undefined; }
        if (state === 'empty') props.data = [];
        if (state === 'filtered') props.values = { ...values, category: 'cat-empty', search: 'não existe' };
        if (state === 'cached-error') props.error = true;
        if (state === 'category-error') props.categoriesError = true;
        const html = render(createElement(AcompanhamentoDashboardView, props));
        assert.match(html, /fv-ds acp-overview/);
        assert.match(html, /aria-label="Buscar missão, cliente ou proposta"/);
        if (state === 'loading') { assert.match(html, /fv-skeleton/); assert.doesNotMatch(html, /fv-metric-card/); }
        else if (state === 'error') { assert.match(html, /Não foi possível carregar/); assert.doesNotMatch(html, /Nenhum projeto|fv-metric-card/); }
        else if (state === 'empty') assert.match(html, /Nenhum projeto com proposta comercial/);
        else if (state === 'filtered') { assert.match(html, /Nenhum projeto encontrado/); assert.match(html, /Limpar filtros/); }
        else {
          assert.equal((html.match(/class="fv-metric-card /g) || []).length, 4);
          assert.match(html, /R\$\s*2\.800,00/);
          assert.match(html, /Visão global/);
          assert.match(html, /Não acompanha os filtros acima/);
          assert.match(html, /aria-label="Abrir cronograma de 4069"/);
          assert.doesNotMatch(html, /Abrir cronograma de Grupo/);
          assert.match(html, /Original:/); assert.match(html, /Adicional:/);
          assert.match(html, /Realizado pago/);
          if (state === 'cached-error') assert.match(html, /Os valores podem estar desatualizados/);
          if (state === 'category-error') assert.match(html, /Não foi possível atualizar as categorias/);
        }
      });
    }
    await t.test('barras acessíveis e aparência de categorias isolada dos consumidores legados', () => {
      const html = renderToStaticMarkup(createElement(BarList, { 'aria-label': 'Comparativo', items: [-1, 150, NaN, 50].map((percentage, i) => ({ id: String(i), label: `Projeto ${i}`, valueLabel: `R$ ${i}`, percentage })) }));
      assert.match(html, /<ol[^>]*aria-label="Comparativo"/);
      assert.equal((html.match(/aria-hidden="true"/g) || []).length, 4);
      assert.match(html, /width:100%/); assert.match(html, /width:50%/);
      assert.equal((html.match(/width:0%/g) || []).length, 2);
      assert.doesNotMatch(html, /progressbar|NaN|width:-/);
      assert.match(render(createElement(RealizedCategoryBreakdown)), /acp-bars-cat/);
      assert.doesNotMatch(render(createElement(RealizedCategoryBreakdown, { appearance: 'design-system' })), /acp-bars-cat/);
    });
  } finally { client.clear(); await server.close(); }
});

test('acompanhamento: permissões, query keys, editor e tokens permanecem delimitados', () => {
  const page = source('pages/acompanhamento/AcompanhamentoPage.tsx');
  const controller = source('components/projects/AcompanhamentoDashboard.tsx');
  assert.match(page, /enabled: isManager/);
  assert.match(page, /canManage=\{hasAcompanhamentoAccess\}/);
  assert.match(page, /canManageGroups=\{isManager\}/);
  assert.match(page, /if \(!isManager && section === 'custo'\) setSection\('dashboard'\)/);
  assert.match(controller, /queryKey: \['commercial-dashboard', category\]/);
  assert.match(controller, /getCommercialDashboard\(category \|\| undefined\)/);
  assert.match(controller, /queryKey: \['realized-categories', 'all'\]/);
  assert.match(controller, /acompanhamentoRefreshQueryOptions/);
  assert.match(controller, /<ProjectScheduleEditor[\s\S]*?canManage=\{canManage\}/);
  assert.match(controller, /scheduleRef\.current\?\.save\(\)/);
  assert.doesNotMatch(page, /equip-nav|topbar-chip/);
  assert.doesNotMatch(page, /AcompanhamentoNavigation|acp-section-navigation/);
  const shell = source('pages/acompanhamento/AcompanhamentoAppShell.tsx');
  assert.match(shell, /subNavigation:/);
  assert.match(shell, /ACOMPANHAMENTO_SECTIONS\.filter/);
  assert.doesNotMatch(source('components/AcompanhamentoTutorial.tsx'), /data-acp-mobile-nav|data-acp-nav/);
  for (const file of ['components/projects/AcompanhamentoDashboard.ds.css', 'pages/acompanhamento/AcompanhamentoPage.ds.css', 'components/ui/ds/BarList.css']) {
    assert.doesNotMatch(source(file), /#[\da-f]{3,8}\b|rgba?\(|!important|--weight-/i);
  }
});
