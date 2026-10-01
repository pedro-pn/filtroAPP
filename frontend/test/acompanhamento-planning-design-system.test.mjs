import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { createServer } from 'vite';

const source = path => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8');

async function fixture(run) {
  const server = await createServer({ configFile: false, root: new URL('..', import.meta.url).pathname,
    server: { middlewareMode: true, hmr: false }, esbuild: { jsx: 'automatic' },
    optimizeDeps: { noDiscovery: true }, appType: 'custom' });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  try {
    const { ToastContext } = await server.ssrLoadModule('/src/components/ui/ToastContext.ts');
    const render = (Component, props) => renderToStaticMarkup(createElement(QueryClientProvider, { client },
      createElement(ToastContext.Provider, { value: { showToast() {} } },
        createElement(MemoryRouter, { initialEntries: ['/?schedule=p'] }, createElement(Component, props)))));
    await run({ server, client, render });
  } finally { client.clear(); await server.close(); }
}

test('cronograma renderiza campos, avanço e escopo no DS sem mudar o contrato de salvar', async () => fixture(async ({ server, client, render }) => {
  const { ProjectScheduleEditor } = await server.ssrLoadModule('/src/components/projects/ProjectScheduleEditor.tsx');
  const revision = { codBd: 7, nRev: 2, salePrice: 10000, plannedCost: 6000, expectedProfit: 4000,
    plannedDays: 12, workedDays: 10, numOperators: 2, numSupervisors: 1, numPerDay: 2, numPerNight: 0 };
  client.setQueryData(['commercial-revisions', 'p'], { currentCodBd: 7, revisions: [revision],
    approvedAt: '2026-09-01T00:00:00.000Z', startDate: '2026-09-04T00:00:00.000Z',
    mobilizationLeadDays: 5, manualProgressPct: null, offshore: false, laborCollaborators: [] });
  client.setQueryData(['planned-scope', 'p'], { services: [], normalHours: [], overtime: [], hoursPlan: {
    pending: true, thresholdPct: 5, source: 'MANUAL', decision: null, issues: [],
    manual: { normal: 10, overtime: 2, total: 12 },
    commercial: { normal: 20, overtime: 3, total: 23 },
    proposals: [{ codProp: 11, nRev: 2 }], differences: [{ kind: 'total', hours: 11, percent: 91, significant: true }], fingerprint: 'f1'
  } });
  const service = { serviceType: 'LIMPEZA_QUIMICA', weight: 100, executionPct: 20, systems: [{
    projectSystemId: 's1', equipment: 'Ilha Solteira', systemName: 'Linha 1', systemType: 'TUBULACAO',
    unit: 'M', plannedQty: 100, realizedQty: 20, pct: 20, diameter: null, diameterUnit: null
  }] };
  client.setQueryData(['project-progress', 'p'], { hasScope: true, progressPct: 20, services: [service],
    scopeGroups: [{ scopeName: 'Ilha Solteira', services: [service] }] });
  client.setQueryData(['realized-categories', 'p'], []);
  client.setQueryData(['ponto-collaborators-active'], []);
  client.setQueryData(['job-roles'], []);
  const html = render(ProjectScheduleEditor, { projectId: 'p', canManage: true });
  for (const label of ['Prazo e equipe previstos', 'Dias corridos', 'Aprovação da proposta', 'Desmobilização',
    'Avanço físico', 'Serviços previstos', 'Conferir horas manuais e comerciais', 'Usar horas do comercial']) {
    assert.ok(html.includes(label), label);
  }
  assert.match(html, /class="acp-schedule-ds"/);
  assert.match(html, /class="fv-card/);
  assert.match(html, /class="fv-control-shell/);
  assert.match(html, /class="fv-data-table/);
  assert.match(html, /<h3 class="acp-schedule-ds__section-title">Avanço físico \(RDO × previsto\)<\/h3>/);
  assert.match(html, /<details class="acp-progress-ds__group acp-progress-ds__group--collapsible"[^>]*data-acp-progress-group="true">/);
  assert.match(html, /<summary class="acp-progress-ds__group-summary">Escopo: Ilha Solteira<\/summary>/);
  assert.match(html, /<details class="acp-progress-ds__service acp-progress-ds__service--collapsible"[^>]*data-acp-progress-service="true">/);
  assert.match(html, /<summary class="acp-progress-ds__service-head acp-progress-ds__service-summary"><strong>Limpeza química<\/strong>/);
  assert.match(html, /Linha 1/);
  assert.doesNotMatch(html, /Venda|Custo|Margem|Realizado por categoria|R\$/);
  assert.match(html, /acp-schedule-ds__hours-fields/);
  assert.equal((html.match(/class="acp-schedule-ds__hours-block"/g) ?? []).length, 2);
  assert.doesNotMatch(html, /class="det-section"|class="mini-btn/);

  const { ProjectProgressBreakdown } = await server.ssrLoadModule('/src/components/projects/ProjectProgressBreakdown.tsx');
  const reconciliation = render(ProjectProgressBreakdown, { projectId: 'p', appearance: 'design-system' });
  assert.match(reconciliation, /Escopo: Ilha Solteira/);
  assert.doesNotMatch(reconciliation, /data-acp-progress-group|data-acp-progress-service/);

  const readOnly = render(ProjectScheduleEditor, { projectId: 'p', canManage: false });
  assert.doesNotMatch(readOnly, /Adicionar colaborador manualmente|Usar horas do comercial/);
  assert.match(readOnly, /Serviços previstos/);
}));

test('revisões comerciais mantêm ações e seletores acessíveis no Gestor', async () => fixture(async ({ server, client, render }) => {
  const { ProjectRevisionPicker } = await server.ssrLoadModule('/src/components/projects/ProjectRevisionPicker.tsx');
  client.setQueryData(['commercial-revisions', 'p'], { currentCodBd: 7,
    revisions: [{ codBd: 7, nRev: 2, salePrice: 10000 }, { codBd: 8, nRev: 3, salePrice: 11000 }],
    additionalProposals: [{ proposalCode: '11', currentCodBd: 9,
      revisions: [{ codBd: 9, nRev: 1, salePrice: 500 }] }] });
  client.setQueryData(['commercialapp-revisions', 'p'], { items: [], budgetSource: 'ACCESS' });
  const html = render(ProjectRevisionPicker, { projectId: 'p' });
  assert.match(html, /Revisão que vale/);
  assert.match(html, /Revisão da proposta adicional 11/);
  assert.match(html, /project-revision-picker__shell/);
  assert.match(html, /fv-select/);
  assert.match(html, /Aplicar/);
  assert.match(html, /Remover/);
}));

test('as duas entradas usam modal DS e preservam o salvar único do cronograma', () => {
  for (const file of ['components/projects/AcompanhamentoDashboard.tsx', 'components/projects/ProjectDetailDashboard.tsx']) {
    const content = source(file);
    assert.match(content, /appearance="design-system" size="lg"/);
    assert.match(content, /scheduleRef\.current\?\.save\(\)/);
    assert.match(content, /<ProjectScheduleEditor/);
  }
  const editor = source('components/projects/ProjectScheduleEditor.tsx');
  assert.match(editor, /if \(scheduleDirty\)/);
  assert.match(editor, /if \(scopeDirty\) scopeRef\.current\?\.save\(\)/);
  assert.match(editor, /scheduleReturnSearch: location\.search/);
});
