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
    for (const value of ['105.000,00', '260h', 'Dias úteis', 'Dias parados', 'Último RDO', 'Consultar escopo', 'Ver relatórios', 'Editar cronograma', 'Adicionar custo']) {
      assert.ok(manager.includes(value), value);
    }
    assert.ok(manager.indexOf('Histórico do avanço') < manager.indexOf('Composição do avanço'));
    assert.ok(manager.indexOf('Composição do avanço') < manager.indexOf('Colaboradores na obra'));
    assert.ok(manager.indexOf('Colaboradores na obra') < manager.indexOf('Meta semanal de avanço'));
    assert.doesNotMatch(manager, /Leitura rápida|Prazos com contexto|O projeto em um olhar/);
    setDetail(false);
    const viewer = render(ProjectDetailDashboard, { projectId: 'p' });
    assert.match(viewer, /Consumo de gastos/);
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
    assert.match(compact, /Semana futura/);
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
