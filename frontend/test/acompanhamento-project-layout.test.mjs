import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { createServer } from 'vite';
import { corporateToday, weekStartKey } from '../../shared/modules/mission-weekly-progress.js';
import { detail } from './fixtures/project-detail.mjs';

test('dashboard integrado preserva indicadores, consultas e permissões', async () => {
  const server = await createServer({ configFile: false, root: new URL('..', import.meta.url).pathname,
    server: { middlewareMode: true, hmr: false }, esbuild: { jsx: 'automatic' },
    optimizeDeps: { noDiscovery: true }, appType: 'custom' });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  try {
    const { AuthContext } = await server.ssrLoadModule('/src/auth/AuthContext.ts');
    const { ToastContext } = await server.ssrLoadModule('/src/components/ui/ToastContext.ts');
    const { ProjectDetailDashboard } = await server.ssrLoadModule('/src/components/projects/ProjectDetailDashboard.tsx');
    const { ProjectOverviewMetrics } = await server.ssrLoadModule('/src/components/projects/ProjectOverviewMetrics.tsx');
    const { MissionWeeklyProgressPanel } = await server.ssrLoadModule('/src/components/projects/MissionWeeklyProgressPanel.tsx');
    const { WeeklyTargetSpotlight, WeeklyTargetSummaryLine } = await server.ssrLoadModule('/src/components/projects/WeeklyTargetSpotlight.tsx');
    const { ProjectInvoicesSection } = await server.ssrLoadModule('/src/components/projects/ProjectInvoicesSection.tsx');
    const auth = { user: { id: 'u', moduleRoles: ['rdo:manager'] }, isAuthenticated: true };
    const render = (Component, props) => renderToStaticMarkup(createElement(QueryClientProvider, { client },
      createElement(AuthContext.Provider, { value: auth }, createElement(ToastContext.Provider, { value: { showToast() {} } },
        createElement(MemoryRouter, {}, createElement(Component, props)))))).replaceAll('&nbsp;', ' ');
    const setDetail = canViewProjectFinancials => client.setQueryData(['project-detail', 'p'], { ...detail, canViewProjectFinancials });
    client.setQueryData(['project-management-notes', 'p'], []);
    client.setQueryData(['tracking-divisions', 'p'], { divisions: [], candidates: [] });
    client.setQueryData(['qualidade', 'project-deviations', 'p'], []);
    setDetail(true);
    const manager = render(ProjectDetailDashboard, { projectId: 'p', canManage: true, canManageManualCosts: true, canManageProjectNotes: true });
    // Resumo de reunião: selo de saúde, quatro indicadores, leitura e atenção; o detalhe abre sob demanda.
    for (const value of ['Saúde do projeto', 'Atenção', 'Nota 0,90 de 2', 'Gastos', 'Avanço do escopo', 'Relatórios assinados', 'Prazo',
      '105.000,00', '62,5', 'Último RDO', 'Meta semanal', 'Leitura para a reunião', 'Pontos de atenção', '5.000,00 acima do previsto',
      '3 RDOs aguardando assinatura', 'Prazo previsto próximo do encerramento', 'Consultar escopo', 'Editar cronograma']) {
      assert.ok(manager.includes(value), value);
    }
    assert.equal((manager.match(/data-acp-meeting-kpi=/g) ?? []).length, 4);
    assert.match(manager, /aria-expanded="false" aria-controls="acp-meeting-detail-cost"/);
    assert.doesNotMatch(manager, /data-acp-meeting-detail=|Consumo de gastos|Histórico do avanço|Ver relatórios|Adicionar custo|Meta da semana/);
    assert.ok(manager.indexOf('data-acp-meeting-kpi') < manager.indexOf('Leitura para a reunião'));
    // Painel do projeto em abas; sem aba escolhida, nada operacional é renderizado.
    assert.deepEqual([...manager.matchAll(/data-acp-detail-tab="([a-z]+)"/g)].map(match => match[1]), ['team', 'financial', 'quality', 'resources', 'daily']);
    assert.match(manager, /Escolha uma aba para abrir/);
    assert.doesNotMatch(manager, /Colaboradores na obra|Avanço diário do escopo|Equipamentos na obra/);
    assert.ok(manager.indexOf('Leitura para a reunião') < manager.indexOf('data-acp-detail-tabs'));
    assert.doesNotMatch(manager, /Meta semanal de avanço/);
    assert.doesNotMatch(manager, /Leitura rápida|Prazos com contexto|O projeto em um olhar/);
    setDetail(false);
    const viewer = render(ProjectDetailDashboard, { projectId: 'p' });
    assert.match(viewer, /data-acp-meeting-kpi="cost"/);
    assert.doesNotMatch(viewer, /data-acp-detail-tab="financial"/);

    // Preferência por usuário: a última aba abre direto.
    const storage = new Map();
    globalThis.window = { localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) } };
    try {
      setDetail(true);
      const key = 'filtrovali:acompanhamento-project-tab:v1:u';
      storage.set(key, 'daily');
      const daily = render(ProjectDetailDashboard, { projectId: 'p', canManage: true, progressHistoryNoveltyUser: { id: 'u' } });
      assert.match(daily, /aria-selected="true"[^>]*data-acp-detail-tab="daily"/);
      assert.match(daily, /Avanço diário do escopo/);
      assert.doesNotMatch(daily, /Trabalho|Apresentação · cópia/);
      storage.set(key, 'inválida');
      assert.match(render(ProjectDetailDashboard, { projectId: 'p', progressHistoryNoveltyUser: { id: 'u' } }), /Escolha uma aba para abrir/);
    } finally { delete globalThis.window; }
    assert.doesNotMatch(viewer, /Gastos e retorno|Faturamentos realizados|Impostos do projeto|Adicionar custo|Editar cronograma|Definir meta/);

    const invoice = (id, issuedAt, amount) => ({ id, number: id, type: 'NFSE', issuedAt, amount,
      customerName: 'Cliente de teste', receiptStatus: 'OPEN', installmentCount: 1,
      project: { code: '005719', name: 'Missão de teste' } });
    client.setQueryData(['project-invoices', 'project', 'p'], {
      lastSyncedAt: '2026-09-30T12:00:00Z', syncStatus: 'CURRENT', projectCount: 1, linkedProjectCount: 1,
      invoices: [invoice('antes-do-escopo', '2026-09-04', 9999),
        ...Array.from({ length: 12 }, (_, index) => invoice(`nota-${index + 1}`, '2026-09-15', 100))]
    });
    const invoices = render(ProjectInvoicesSection, { projectId: 'p', division: {
      startDate: '2026-09-10', mobilizationDate: '2026-09-01', endDate: '2026-09-30'
    } });
    assert.match(invoices, /fv-data-table__mobile/);
    assert.match(invoices, /Ordenar Histórico de faturamentos por coluna/);
    assert.match(invoices, /Alternar ordem de Histórico de faturamentos/);
    for (const label of ['Documento', 'Emissão', 'Tomador / cliente', 'Valor bruto', 'Recebimento']) {
      assert.ok(invoices.includes(label), label);
    }
    assert.match(invoices, /12 documentos/);
    assert.match(invoices, /1\.200,00/);
    assert.match(invoices, /Páginas de faturamentos/);
    assert.doesNotMatch(invoices, /antes-do-escopo|NFS-e nota-11|NFS-e nota-12/);

    const card = render(ProjectOverviewMetrics, { card: {
      workedHours: detail.workedHours, progressPct: 62.5, costConsumedPct: 105,
      plannedCost: 100000, realizedCost: 105000, workedDays: 7, totalDays: 20,
      elapsedDays: 9, businessDays: 7, stoppedDays: 1, collaboratorsCount: 2, stockCost: 10000
    } });
    for (const value of ['Dias corridos', 'Dias parados', 'Dias úteis', 'HH trabalhados', '260h', '62,5%', '105%']) assert.ok(card.includes(value), value);
    assert.match(card, /hidden=""/);

    const week = weekStartKey(corporateToday());
    const shift = days => new Date(new Date(`${week}T00:00:00Z`).getTime() + days * 86400000).toISOString().slice(0, 10);
    const targets = [-28, -21, -14, -7, 0, 7].map((days, index) => ({
      id: String(index), weekStartDate: shift(days), plannedPctPoints: 10, revision: 1,
      author: { name: 'Gestora' }, createdAt: `${shift(days)}T12:00:00Z`, ...(days === -7 ? { isDeleted: true } : {})
    }));
    client.setQueryData(['mission-weekly-targets', '/acompanhamento/comercial/projetos/p/metas-semanais', false], { targets });
    const progressHistory = [-28, -21, -14, -7, 0].map((days, index) => ({ date: shift(days), progressPct: [10, 15, 25, 40, 60][index] }));
    const compact = render(MissionWeeklyProgressPanel, { owner: { area: 'acompanhamento', projectId: 'p' }, progressHistory, compact: true });
    assert.match(compact, /2 de 3 semanas com meta atingida/);
    assert.match(compact, /Meta não atingida/);
    assert.match(compact, /Período futuro/);
    assert.match(compact, /Semana: ordenar em ordem crescente/);
    assert.match(compact, /Avanço previsto: ordenar em ordem crescente/);
    assert.match(compact, /Avanço realizado: ordenar em ordem crescente/);
    assert.match(compact, /Diferença: ordenar em ordem crescente/);
    assert.doesNotMatch(compact, /Meta registrada|>Ação<|>Editar<|>Excluir</);
    const legacy = render(MissionWeeklyProgressPanel, { owner: { area: 'acompanhamento', projectId: 'p' }, progressHistory, canManage: true });
    assert.match(legacy, /Meta registrada/);
    assert.match(legacy, /Gestora/);
    assert.match(legacy, /Definir meta/);
    assert.match(legacy, /Meta registrada: ordenar em ordem crescente/);
    assert.doesNotMatch(legacy, /Ação: ordenar/);
    assert.doesNotMatch(legacy, /semanas com meta atingida|Detalhes e edição das metas/);

    // Card do topo: abre na semana fechada, alterna para a atual e mostra o placar.
    const spotlightOwner = { area: 'acompanhamento', projectId: 'p' };
    const spotlight = render(WeeklyTargetSpotlight, { owner: spotlightOwner, progressHistory, canManage: true, onOpenHistory() {} });
    for (const value of ['Meta da semana', 'Fechada', 'Atual', 'Editar meta', 'Histórico', 'Últimas semanas', 'Meta não atingida', '2 de 3 atingidas']) {
      assert.ok(spotlight.includes(value), value);
    }
    assert.match(spotlight, /aria-pressed="true"[^>]*>Fechada/);
    const viewerSpotlight = render(WeeklyTargetSpotlight, { owner: spotlightOwner, progressHistory, onOpenHistory() {} });
    assert.doesNotMatch(viewerSpotlight, /Editar meta|Definir meta/);
    client.setQueryData(['mission-weekly-targets', '/acompanhamento/comercial/projetos/p/metas-semanais', false], { targets: [] });
    assert.equal(render(WeeklyTargetSpotlight, { owner: spotlightOwner, progressHistory, onOpenHistory() {} }), '');
    assert.match(render(WeeklyTargetSpotlight, { owner: spotlightOwner, progressHistory, canManage: true, onOpenHistory() {} }), /Nenhuma meta cadastrada[\s\S]*Definir meta/);
    client.setQueryData(['mission-weekly-targets', '/acompanhamento/comercial/projetos/p/metas-semanais', false], { targets });

    // Resumo do card de avanço: meta por colaborador/dia mostra um bloco por dia com RDO da semana fechada.
    const perDayOwner = { area: 'acompanhamento', projectId: 'per-day' };
    const closedDays = [-7, -6, -5].map(shift);
    client.setQueryData(['mission-weekly-targets', '/acompanhamento/comercial/projetos/per-day/metas-semanais', false], {
      targets: [{ id: 'pd', weekStartDate: shift(-7), plannedPctPoints: null, revision: 1, author: { name: 'Gestora' }, createdAt: `${shift(-7)}T12:00:00Z`,
        definition: { version: 2, logic: 'ALL', repeatWeekly: true,
          goals: [{ kind: 'SERVICE', serviceType: 'LIMPEZA_QUIMICA', metric: 'M', basis: 'PER_PRODUCTIVE_DAY', value: 20 }] } }],
      serviceHistory: closedDays.flatMap((date, index) => [
        { date, serviceType: 'LIMPEZA_QUIMICA', quantities: { M: [70, 50, 60][index], L: 0, UN: 0 } },
        { date, serviceType: 'LIMPEZA_QUIMICA', quantities: { M: 0, L: 0, UN: 0 }, productivityIssues: [], productivePersonDays: 3 }
      ]),
      attendanceHistory: []
    });
    const perDay = render(WeeklyTargetSummaryLine, { owner: perDayOwner, progressHistory: [] });
    assert.match(perDay, /Semana fechada/);
    assert.match(perDay, /Por dia/);
    assert.equal((perDay.match(/class="is-hit"/g) ?? []).length, 2);
    assert.equal((perDay.match(/class="is-miss"/g) ?? []).length, 1);
    assert.match(perDay, /2 de 3 dias/);
    assert.match(perDay, new RegExp(`${closedDays[1].slice(8, 10)}/${closedDays[1].slice(5, 7)}: 50 m de 60 m`));

    const attendanceTargets = [-7, 0].map((days, index) => ({
      id: `attendance-${index}`, weekStartDate: shift(days), revision: 1,
      author: { name: 'Gestora' }, createdAt: `${shift(days)}T12:00:00Z`,
      definition: { metric: 'COLLABORATORS', basis: 'PER_WORKDAY', workdays: [1],
        scenarios: [{ name: 'Equipe mínima', condition: { kind: 'ALWAYS' }, goals: [{ value: 6 }] }] }
    }));
    client.setQueryData(['mission-weekly-targets', '/acompanhamento/comercial/projetos/p/metas-semanais', false], {
      targets: attendanceTargets,
      attendanceHistory: [-7, 0].map((days, index) => ({ date: shift(days),
        collaboratorIds: Array.from({ length: index ? 4 : 8 }, (_, person) => `person-${person}`) }))
    });
    for (const compact of [true, false]) {
      const attendance = render(MissionWeeklyProgressPanel, { owner: { area: 'acompanhamento', projectId: 'p' }, progressHistory, compact });
      for (const value of ['Metas da semana', 'Previsto por dia', 'Menor efetivo diário', 'Presença acumulada', 'Presença por dia', 'Superávit de 2 presenças', 'Saldo zero']) {
        assert.ok(attendance.includes(value), value);
      }
      assert.doesNotMatch(attendance, /Definir meta|>Editar<|>Excluir</);
      if (compact) assert.match(attendance, /1 de 1 semanas com meta atingida/);
    }
  } finally { client.clear(); await server.close(); }
});
