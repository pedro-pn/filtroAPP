import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { detail } from './fixtures/project-detail.mjs';

const source = path => readFileSync(new URL(`../src/components/projects/${path}`, import.meta.url), 'utf8');

test('detalhe: DS preserva valores, escopo, metas e apropriação', async t => {
  const server = await createServer({ configFile: false, root: new URL('..', import.meta.url).pathname,
    server: { middlewareMode: true, hmr: false }, esbuild: { jsx: 'automatic' }, optimizeDeps: { noDiscovery: true }, appType: 'custom' });
  try {
    const model = await server.ssrLoadModule('/src/components/projects/projectDetailModel.ts');
    const visuals = await server.ssrLoadModule('/src/components/projects/ProjectDetailVisuals.tsx');
    const costs = await server.ssrLoadModule('/src/components/projects/ProjectDetailCosts.tsx');
    const { ProjectDetailPeople } = await server.ssrLoadModule('/src/components/projects/ProjectDetailPeople.tsx');
    const { ProjectDetailOverview } = await server.ssrLoadModule('/src/components/projects/ProjectDetailOverview.tsx');
    const story = await server.ssrLoadModule('/src/components/projects/ProjectDetailStory.tsx');
    const { ProgressHistoryChart } = await server.ssrLoadModule('/src/components/projects/ProjectDetailHistory.tsx');
    const render = (Component, props) => renderToStaticMarkup(createElement(Component, props)).replaceAll('&nbsp;', ' ');
    await t.test('custo soma mão de obra uma vez e mantém original/adicionais, pago e a pagar', () => {
      const html = render(costs.ProjectDetailCosts, { data: detail, children: 'Custos manuais' });
      assert.match(html, /105\.000,00/); assert.match(html, /105%/);
      assert.match(html, /fv-tone--danger/); assert.match(html, /width:100%/);
      for (const value of ['100.000,00', '80.000,00', '20.000,00', '60.000,00', '45.000,00', '15.000,00', '10.000,00', '5.000,00', '30.000,00', '25.000,00']) assert.ok(html.includes(value), value);
      assert.match(html, /fv-bar-list/); assert.match(html, /Composição das propostas/);
      assert.match(html, /PROP-ADICIONAL-4069/);
      const noBudget = render(costs.ProjectDetailCosts, { data: { ...detail, consumo: { ...detail.consumo, previsto: null }, maoDeObra: { ...detail.maoDeObra, custo: null }, maioresGastos: [] } });
      assert.match(noBudget, /75\.000,00/); assert.match(noBudget, /Sem gastos registrados/);
      assert.doesNotMatch(noBudget, /NaN|Infinity/);
    });
    await t.test('impostos continuam usando a base recebida da API sem recalcular tributos', () => {
      const html = render(costs.ProjectDetailTaxes, { data: detail });
      for (const value of ['130.000,00', '150.000,00', '12.500,00', '2.500,00', '7.150,00']) assert.ok(html.includes(value), value);
      assert.match(html, /Faturado Omie \(2 NF\)/);
      assert.equal(render(costs.ProjectDetailTaxes, { data: { ...detail, presumedProfitTaxes: null } }), '');
    });
    await t.test('metas, horas e progresso mantém quantidade exata mesmo acima de 100%', () => {
      const hours = render(visuals.WorkedHoursMetric, { data: detail.workedHours });
      assert.match(hours, /260h \/ 400h · 65%/); assert.match(hours, /width:55%/); assert.match(hours, /width:10%/);
      assert.match(hours, /HE 40h/); assert.match(hours, /4 colab/);
      for (const [status, label] of [['REQUIRED', '12,5 p.p./semana'], ['OVERDUE', 'Prazo vencido'], ['DUE_TODAY', 'Concluir hoje'], ['COMPLETED', 'Meta concluída']]) {
        assert.ok(render(visuals.RequiredWeeklyProgressCard, { target: { ...detail.requiredWeeklyProgress, status } }).includes(label));
      }
      assert.match(render(visuals.PlannedScopeView, { scope: detail.plannedScope }), /Limpeza química/);
      assert.match(render(visuals.PlannedScopeView, {}), /Nenhum escopo cadastrado/);
      assert.match(render(ProgressHistoryChart, { points: detail.progressHistory }), /acp-detail-history-line/);
      assert.match(render(ProgressHistoryChart, { points: detail.progressHistory }), /acp-detail-history-bar/);
      assert.match(render(ProgressHistoryChart, { points: [{ date: 'inválida', progressPct: 30 }] }), /Sem histórico/);
    });
    await t.test('novo resumo usa valores reais, preserva permissões e lida com dados ausentes', () => {
      const props = { data: { ...detail, canViewProjectFinancials: true }, progressPct: detail.avancoPct,
        progressHistory: detail.progressHistory, target: detail.requiredWeeklyProgress, filterLabel: '', teamCount: 2, deviationCount: 3 };
      const html = render(ProjectDetailOverview, props);
      for (const value of ['12,5 p.p./semana', '105% do previsto', '625 m', 'de 1.000 m previstos', '28/09/2026', '3', 'Limpeza química']) assert.ok(html.includes(value), value);
      assert.match(html, /Histórico do avanço/);
      assert.match(html, /Avanço de 01\/09 até 09\/09/);
      assert.match(html, /Gastos e faturamento/);
      const restricted = render(ProjectDetailOverview, { ...props, data: { ...detail, canViewProjectFinancials: false } });
      assert.match(restricted, /105% do previsto/);
      assert.match(restricted, /Gastos do projeto/);
      assert.doesNotMatch(restricted, /notas fiscais e impostos/i);
      const empty = render(ProjectDetailOverview, { ...props, data: { ...detail, alerts: [], footer: { mobilizationDate: null, startDate: null, expectedEndDate: null, projectedEndByPace: null }, consumo: { ...detail.consumo, previsto: null } }, progressHistory: [], target: undefined, progressPct: null, deviationCount: null });
      assert.match(empty, /Sem histórico/);
      assert.match(empty, /Sem meta calculada/);
      assert.doesNotMatch(empty, /NaN|Infinity/);
      const legacyScope = render(ProjectDetailOverview, { ...props, target: undefined, fallbackServices: [{ serviceType: 'FILTRAGEM', weight: 100, executionPct: 40, systems: [{ systemType: 'OLEO', unit: 'L', plannedQty: 5000, realizedQty: 2000, pct: 40 }] }] });
      assert.match(legacyScope, /Filtragem/);
      assert.match(legacyScope, /2\.000 L/);
      assert.match(legacyScope, /de 5\.000 L previstos/);
      const over = render(ProjectDetailOverview, { ...props, target: { ...detail.requiredWeeklyProgress, services: [{ ...detail.requiredWeeklyProgress.services[0], executionPct: 108 }] } });
      assert.match(over, /108%/);
      assert.match(over, /width:100%/);
    });
    await t.test('painéis de prazo, tempo e finanças usam dados da API sem inventar status', () => {
      const timeline = render(story.ProjectTimelineCard, { data: detail });
      assert.match(timeline, /2 dias antes do previsto/);
      assert.match(timeline, /30\/09\/2026/);
      const time = render(story.ProjectTimeSnapshot, { data: detail });
      assert.match(time, /9 \/ 30/);
      assert.match(time, /260h/);
      assert.match(time, /2 dias/);
      const costs = render(story.ProjectFinancialSnapshot, { data: detail });
      assert.match(costs, /R\$\s105\.000,00/);
      assert.match(costs, /R\$\s5\.000,00 acima do previsto/);
      for (const value of ['Compras Omie', 'Estoque', 'Custos manuais', 'Mão de obra']) assert.ok(costs.includes(value), value);
      const billing = render(story.ProjectBillingSnapshot, { data: detail });
      assert.match(billing, /R\$\s130\.000,00/);
      assert.match(billing, /Notas fiscais/);
      const withoutDates = render(story.ProjectTimelineCard, { data: { ...detail, footer: { mobilizationDate: null, startDate: null, expectedEndDate: null, projectedEndByPace: null } } });
      assert.match(withoutDates, /Sem projeção comparável/);
      assert.doesNotMatch(withoutDates, /NaN|Infinity/);
    });
    await t.test('ponto e RDO abrem suas origens; referência RDO não vira custo', () => {
      const html = render(ProjectDetailPeople, { data: detail, isGroup: false, onSelect() {} });
      assert.match(html, /Conferir os dias apropriados de João/);
      assert.match(html, /acp-detail-report-hours-trigger[^]*24h · RDO/);
      assert.match(html, /não entram no custo apropriado/);
      assert.match(html, /já está incluído nas horas e no custo total/);
      assert.match(html, /1\.800,00/); assert.match(html, /400,00 do custo/);
      const group = render(ProjectDetailPeople, { data: detail, isGroup: true, onSelect() {} });
      assert.match(group, /Jornada sem sobreposição/); assert.match(group, /8h em sobreposição/);
      assert.match(render(ProjectDetailPeople, { data: { ...detail, colaboradores: [] }, isGroup: false, onSelect() {} }), /Nenhum colaborador/);
    });
    await t.test('gatilhos DS preservam a fonte POINT/REPORT do diálogo da main', () => {
      const selected = [];
      const tree = ProjectDetailPeople({ data: detail, isGroup: false, onSelect: (collaborator, origin) => selected.push([collaborator.id, origin]) });
      const table = tree.props.children.props.children.find(node => node?.props?.ariaLabel === 'Colaboradores na obra');
      const hours = table.props.columns.find(column => column.key === 'hours').render;
      const point = detail.colaboradores.find(item => item.horasApropriadas > 0);
      const report = detail.colaboradores.find(item => !item.horasApropriadas && item.horas > 0);
      assert.ok(point); assert.ok(report);
      hours(point).props.onClick();
      hours(report).props.onClick();
      assert.deepEqual(selected, [[point.id, 'POINT'], [report.id, 'REPORT']]);
      const main = source('ProjectDetailDashboard.tsx');
      assert.match(main, /setHoursDetail\(\{ collaborator, source \}\)/);
      assert.match(main, /source=\{hoursDetail\?\.source\}/);
    });
    await t.test('formulário monetário preserva formato brasileiro, limites, payload e erros', async () => {
      assert.equal(model.formatBrlCurrencyInput('123456'), 'R$ 1.234,56');
      const input = { description: '  Frete  ', amount: 'R$ 1.234,56', costDate: '', note: '  ' };
      assert.deepEqual(model.manualCostFormValuesToPayload(input), { description: 'Frete', amount: 1234.56, costDate: null, note: null });
      assert.equal(model.manualCostFormSchema.safeParse(input).success, true);
      for (const patch of [{ amount: '0' }, { amount: '' }, { amount: '999999999999' }, { description: '' }, { description: 'x'.repeat(121) }, { note: 'x'.repeat(501) }, { costDate: 'inválida' }]) {
        assert.equal(model.manualCostFormSchema.safeParse({ ...input, ...patch }).success, false);
      }
      const result = await model.manualCostFormResolver({ ...input, amount: '0' });
      assert.equal(result.errors.amount.message, 'Informe um valor maior que zero.');
    });
  } finally { await server.close(); }
});

test('detalhe: estados e fronteira DS incluem cronograma e preservam diálogos de apoio', () => {
  const main = source('ProjectDetailDashboard.tsx');
  assert.match(main, /className="fv-ds acp-detail"/);
  assert.match(main, /Os dados exibidos podem estar desatualizados/);
  for (const state of ['planningContextError', 'scopeError', 'qualityDeviationQueries', 'projectNotesLoadError']) assert.ok(main.includes(state));
  assert.match(main, /acompanhamentoRefreshQueryOptions/);
  assert.match(main, /if \(!canManageManualCosts \|\| isGroup \|\| createManualCostMutation.isPending\) return/);
  assert.match(main, /if \(!canManageProjectNotes \|\| isGroup \|\| !content \|\| createProjectNoteMutation.isPending\) return/);
  assert.match(main, /<\/div>\s*\{\/\* Diálogos de apoio compartilhados/);
  const migrated = main.slice(0, main.indexOf('{/* Diálogos de apoio compartilhados'));
  assert.doesNotMatch(migrated, /mini-btn|page-card|className="badge|<input\b|<textarea\b/);
  assert.match(main, /<ProjectReportsDialog/);
  assert.match(main, /<ProjectDetailOverview/);
  assert.match(main, /<ProjectTimelineCard/);
  assert.match(main, /acp-detail-deep-dive--costs/);
  assert.match(main, /scheduleRef.current\?\.save\(\)/);
  assert.match(main, /appearance="design-system" size="lg"/);
  assert.doesNotMatch(source('ProjectDetailDashboard.ds.css'), /#[\da-f]{3,8}\b|rgba?\(|!important|--control-height-md/i);
});
