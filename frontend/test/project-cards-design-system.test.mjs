import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

const source = path => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8');

test('cards de acompanhamento preservam informações, ações e agrupamentos no DS', async t => {
  const server = await createServer({ configFile: false, root: new URL('..', import.meta.url).pathname,
    server: { middlewareMode: true, hmr: false }, esbuild: { jsx: 'automatic' }, optimizeDeps: { noDiscovery: true }, appType: 'custom' });
  try {
    const { ProjectOverviewCard } = await server.ssrLoadModule('/src/components/projects/ProjectOverviewCard.tsx');
    const { ProjectCardsToolbar } = await server.ssrLoadModule('/src/components/projects/ProjectCardsToolbar.tsx');
    const { ProgressBar } = await server.ssrLoadModule('/src/components/ui/ds/ProgressBar.tsx');
    const card = { projectId: 'p1', code: '4069', name: 'Projeto com nome extenso', clientName: 'Cliente',
      archived: false, reviewed: false, progressPct: 60, progressMethod: 'MANUAL', plannedCost: 1000000, originalPlannedCost: 900000, additionalPlannedCost: 100000,
      realizedCost: 250000, costConsumedPct: 25, workedDays: 5, totalDays: 20, daysConsumedPct: 25,
      workedHours: { normalWorkedHours: 40, overtimeWorkedHours: 10, totalWorkedHours: 50, plannedTotalHours: 200, normalPct: 20, overtimePct: 5, totalPct: 25 },
      lastDay: { status: 'PARADO', date: '2026-09-10T12:00:00Z' }, collaboratorsCount: 5, laborCost: 1200, laborCostBase: 1000, laborHours: 50,
      stockCost: 500, startDate: '2026-09-01T12:00:00Z', expectedEndDate: '2026-09-30T12:00:00Z',
      equipment: [{ name: 'Unidade de filtragem', days: 8 }], alerts: [{ level: 'warn', label: 'Atenção ao cronograma' }] };
    const base = { card, onOpen() {}, onToggleSelect() {} };
    const render = props => renderToStaticMarkup(createElement(ProjectOverviewCard, { ...base, ...props }));
    await t.test('card mostra o resumo até colaboradores em obra', () => {
      const html = render({ canManage: true });
      for (const text of ['4069', 'Projeto com nome extenso', '60%', 'manual', '1.000.000,00', '250.000,00', 'Original', 'Adicional', '50h', '40h', '10h', 'Colaboradores em obra']) assert.ok(html.includes(text), text);
      assert.doesNotMatch(html, /Unidade de filtragem|Equipamentos em obra|Previsão de término|Apropriação da mão de obra/);
      assert.match(html, /fv-card/); assert.doesNotMatch(html, /acp-pcard|role="button"/);
      assert.match(html, /fv-card--surface-action/);
      assert.match(html, /aria-label="Abrir projeto 4069"/);
      assert.doesNotMatch(html, /Detalhes|Abrir detalhes/);
      assert.match(html, /aria-label="Arquivar no acompanhamento: 4069"/);
      assert.match(html, /fv-button__label">Arquivar<\/span>/);
      assert.match(html, /fv-badge--multiline/); assert.doesNotMatch(html, /fv-alert/);
      assert.doesNotMatch(html, /Selecionar missão/);
    });
    await t.test('permissões e seleção usam controles nativos sem ações aninhadas', () => {
      assert.doesNotMatch(render({}), /Arquivar no acompanhamento|Marcar como conferido|Desmesclar|Editar nome/);
      const html = render({ canSelect: true, selected: true });
      assert.match(html, /type="checkbox"/); assert.match(html, /aria-label="Selecionar missão 4069"/);
      assert.match(html, /fv-card--selected/);
      assert.match(html, /aria-label="Alternar seleção da missão 4069" aria-pressed="true"/);
      for (const [button] of html.matchAll(/<button\b[\s\S]*?<\/button>/g)) assert.equal((button.match(/<button\b/g) || []).length, 1);
    });
    await t.test('arquivados distinguem conferência e restauração no acompanhamento', () => {
      const archived = { ...card, archived: true, archivedInAcompanhamento: true };
      const html = render({ card: archived, canManage: true });
      assert.match(html, /Marcar como conferido/); assert.match(html, /Restaurar no acompanhamento/);
      assert.doesNotMatch(render({ card: { ...archived, archivedInAcompanhamento: false }, canManage: true }), /Restaurar no acompanhamento/);
      assert.match(render({ card: { ...archived, reviewed: true }, canManage: true }), /Desmarcar conferência/);
    });
    await t.test('grupos conservam membros e ações, com renomeação inline acessível', () => {
      const group = { ...card, kind: 'GROUP', groupId: 'g1', code: 'Grupo', members: [{ projectId: 'p1', code: '4069', name: 'Missão original', progressPct: 50 }], laborAllocationMode: 'CONSOLIDATE_PRIMARY', primaryLaborProjectId: 'p1' };
      const html = render({ card: group, canManageGroups: true, onStartRename() {} });
      assert.match(html, /Missão original/); assert.match(html, /Desmesclar/);
      assert.doesNotMatch(html, /Missão principal|Repetir jornada em cada missão|<select/);
      assert.match(html, /data-acp-card-rename-title/);
      assert.match(html, /data-acp-group-rename-start/);
      assert.match(html, /class="acp-project__title-edit"[^>]*aria-label="Editar nome do card: Grupo"/);
      assert.doesNotMatch(html, /type="checkbox"/);
      assert.doesNotMatch(render({ card: group }), /<select/);
      assert.doesNotMatch(render({ card: group, canManageGroups: false, onStartRename() {} }), /data-acp-card-rename-title/);
      const renaming = render({ card: group, canManageGroups: true, renaming: true, renameValue: '', renameError: 'Informe um nome.' });
      assert.match(renaming, /maxLength="120"/i); assert.match(renaming, /Informe um nome/);
      assert.match(renaming, /Salvar nome/); assert.match(renaming, /Cancelar edição/);
      assert.doesNotMatch(renaming, /fv-card__surface-action/);
    });
    await t.test('missão individual edita só o nome de exibição, mantendo o código fixo', () => {
      const aliased = { ...card, cardName: 'Apelido local' };
      const html = render({ card: aliased, canManageGroups: true, onStartRename() {} });
      assert.match(html, /<span>4069 — <\/span><button[^>]*data-acp-card-rename-title/);
      assert.match(html, />Apelido local<\/button>/);
      assert.doesNotMatch(html, /Projeto com nome extenso/);
      const renaming = render({ card: aliased, canManageGroups: true, renaming: true, renameValue: 'Apelido local' });
      assert.match(renaming, /acp-project__fixed-code[^>]*>4069 —<\/strong>/);
      assert.match(renaming, /value="Apelido local"/);
      assert.doesNotMatch(renaming, /fv-card__surface-action/);
      assert.doesNotMatch(render({ card: aliased, onStartRename() {} }), /data-acp-card-rename-title/);
    });
    await t.test('toolbar oferece quatro situações e mantém ações de seleção juntas', () => {
      const html = renderToStaticMarkup(createElement(ProjectCardsToolbar, { view: 'conferidas', counts: { andamento: 1, futuros: 2, arquivados: 3, conferidas: 4 }, search: '', onSearch() {}, onView() {}, canManageGroups: true, selectionMode: true, selectedCount: 2, busy: false, onStartSelection() {}, onConfirm() {}, onCancel() {} }));
      for (const label of ['Em andamento', 'Futuros', 'Arquivados', 'Conferidas', 'Confirmar (2)', 'Cancelar']) assert.ok(html.includes(label));
      assert.match(html, /data-acp-cards-seg/); assert.match(html, /aria-pressed="true"/);
      assert.match(html, /fv-search-input/); assert.doesNotMatch(html, /acp-seg-btn|mini-btn/);
      assert.equal((html.match(/fv-button__counter/g) || []).length, 4);
      assert.doesNotMatch(html, /fv-badge/);
    });
    await t.test('barras limitam a geometria, mas preservam o percentual real no texto', () => {
      for (const value of [-5, 140, NaN, null]) {
        const html = renderToStaticMarkup(createElement(ProgressBar, { value, label: 'Avanço', valueLabel: value === null ? '—' : `${value}%` }));
        assert.doesNotMatch(html, /width:(?:-|NaN)/);
        if (value === 140) { assert.match(html, /140%/); assert.match(html, /width:100%/); }
      }
      const segmented = renderToStaticMarkup(createElement(ProgressBar, { value: 135, label: 'Horas', valueLabel: '135%', segments: [{ value: 85 }, { value: 50, tone: 'warning' }] }));
      assert.match(segmented, /135%/); assert.match(segmented, /width:85%/); assert.match(segmented, /width:15%/);
      assert.match(segmented, /aria-hidden="true"/);
    });
  } finally { await server.close(); }
});

test('controller mantém endpoints, invalidações e permissões sem estilizar o detalhe legado', () => {
  const board = source('components/projects/ProjectCardsBoard.tsx');
  assert.match(board, /queryKey: \['project-cards'\]/);
  assert.match(board, /createMissionGroup\(\{ projectIds \}\)/);
  assert.match(board, /Promise\.all\(projectIds\.map\(projectId => setProjectTrackingState\(projectId, payload\)\)\)/);
  assert.match(board, /canManageProjectNotes=\{canManageProjectNotes\}/);
  assert.match(board, /canManage=\{canManageGroups\}/);
  const detail = source('components/projects/ProjectDetailDashboard.tsx');
  assert.match(detail, /updateMissionGroupLaborPolicy\(groupId!/);
  assert.match(detail, /data-acp-labor-policy/);
  assert.match(board, /appearance="design-system"/);
  assert.match(board, /confirmDisabled=\{trackingMutation\.isPending\}/);
  assert.ok(board.indexOf('if (selected)') < board.indexOf('className="fv-ds'));
  assert.doesNotMatch(source('components/projects/ProjectCardsBoard.ds.css'), /#[a-f\d]{3,8}\b|rgba?\(|!important/);
});
