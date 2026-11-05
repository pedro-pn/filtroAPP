import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createServer } from 'vite';
import { corporateToday, weekStartKey } from '../../shared/modules/mission-weekly-progress.js';

test('metas de projetos mesclados mantêm origem, medições, histórico e permissões', async t => {
  const server = await createServer({ configFile: false, root: new URL('..', import.meta.url).pathname,
    server: { middlewareMode: true, hmr: false }, esbuild: { jsx: 'automatic' },
    optimizeDeps: { noDiscovery: true }, appType: 'custom' });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  try {
    const { ProjectWeeklyTargets } = await server.ssrLoadModule('/src/components/projects/ProjectWeeklyTargets.tsx');
    const { weeklyTargetsQueryKey } = await server.ssrLoadModule('/src/components/projects/useWeeklyTargets.ts');
    const owner = { area: 'acompanhamento', groupId: 'group' };
    const projectOwner = projectId => ({ area: 'acompanhamento', projectId });
    const members = [
      { projectId: 'p5812', code: '5812', name: 'Ventura', clientName: 'Cliente' },
      { projectId: 'p5815', code: '5815', name: 'SS Victória', clientName: 'Cliente' },
      { projectId: 'hidden', code: '9999', name: 'Projeto oculto', visible: false }
    ];
    const week = weekStartKey(corporateToday());
    const shift = days => new Date(new Date(`${week}T00:00:00Z`).getTime() + days * 86400000).toISOString().slice(0, 10);
    const target = (id, value, days = -7, repeatWeekly = true) => ({
      id, weekStartDate: shift(days), revision: 1, plannedPctPoints: null,
      author: { name: `Responsável ${id}` }, createdAt: `${shift(days)}T12:00:00Z`,
      definition: { version: 2, logic: 'ALL', repeatWeekly,
        goals: [{ kind: 'SERVICE', serviceType: 'LIMPEZA_QUIMICA', metric: 'UN', basis: 'WEEK_TOTAL', value }] }
    });
    const history = quantity => [-7, 0].map(days => ({ date: shift(days), serviceType: 'LIMPEZA_QUIMICA', quantities: { UN: quantity, M: 0, L: 0 } }));
    const projectData = (id, value, quantity) => ({ targets: [target(id, value)], serviceHistory: history(quantity),
      progressHistory: [{ date: shift(-8), progressPct: 10 }, { date: shift(-7), progressPct: 15 }, { date: week, progressPct: 20 }] });
    const data5812 = projectData('efetivo-5812', 30, 25);
    const data5815 = projectData('efetivo-5815', 20, 7);
    const groupData = { targets: [target('group-old', 10, -14, false)], serviceHistory: history(999) };
    client.setQueryData(weeklyTargetsQueryKey(owner, false), groupData);
    client.setQueryData(weeklyTargetsQueryKey(projectOwner('p5812'), true), data5812);
    client.setQueryData(weeklyTargetsQueryKey(projectOwner('p5815'), true), data5815);
    const render = (view, extra = {}) => renderToStaticMarkup(createElement(QueryClientProvider, { client },
      createElement(ProjectWeeklyTargets, { owner, members, progressHistory: [{ date: week, progressPct: 99 }], view, ...extra })));

    await t.test('resumo identifica cada projeto e não perde as metas do Efetivo quando o grupo não tem meta atual', () => {
      const html = render('summary');
      for (const label of ['Agrupamento', 'Projeto 5812 · Ventura', 'Projeto 5815 · SS Victória', 'Semana fechada']) assert.ok(html.includes(label), label);
      assert.equal((html.match(/Meta não atingida/g) ?? []).length, 2);
      assert.doesNotMatch(html, /Projeto oculto|9999|Carregando/);
      // O resumo fica dentro de um botão: nenhum elemento de bloco ou botão aninhado.
      assert.doesNotMatch(html, /<(div|section|button|h[1-6])\b/);
    });
    await t.test('detalhe usa somente o realizado do projeto e preserva metas diferentes sem somá-las', () => {
      const html = render('spotlight');
      assert.match(html, /Projeto 5812 · Ventura · Meta da semana/);
      assert.match(html, /Projeto 5815 · SS Victória · Meta da semana/);
      assert.match(html, /<strong>25<\/strong><span>de 30 un<\/span>/);
      assert.match(html, /<strong>7<\/strong><span>de 20 un<\/span>/);
      assert.doesNotMatch(html, /de 50 un|<strong>999<\/strong>|Projeto oculto|Editar meta|Definir meta/);
    });
    await t.test('histórico mantém a meta antiga do grupo e a autoria de cada projeto', () => {
      const html = render('history');
      for (const label of ['Agrupamento · Metas da semana', 'Responsável group-old', 'Responsável efetivo-5812', 'Responsável efetivo-5815']) assert.ok(html.includes(label), label);
      assert.doesNotMatch(html, /Projeto oculto|>Editar<|>Excluir<|Definir meta/);
      const manager = render('history', { canManage: true });
      assert.equal((manager.match(/>Definir meta<\/span>/g) ?? []).length, 3);
      assert.match(manager, />Editar</);
      assert.match(manager, />Excluir</);
    });
    await t.test('meta própria do agrupamento continua aparecendo junto com as individuais', () => {
      client.setQueryData(weeklyTargetsQueryKey(owner, false), { ...groupData, targets: [target('group-current', 60)] });
      const html = render('spotlight', { canManage: true });
      assert.match(html, /Agrupamento · Meta da semana/);
      assert.match(html, /de 60 un/);
      assert.match(html, /de 30 un/);
      assert.match(html, /de 20 un/);
      assert.equal((html.match(/>Editar meta<\/span>/g) ?? []).length, 3);
    });
    await t.test('avanço percentual também usa o histórico individual, não o agregado do grupo', () => {
      client.setQueryData(weeklyTargetsQueryKey(owner, false), groupData);
      client.setQueryData(weeklyTargetsQueryKey(projectOwner('p5815'), true), { ...data5815,
        targets: [{ ...target('percentual', 10), definition: undefined, plannedPctPoints: 10 }] });
      const html = render('spotlight', { members: [members[1]] });
      assert.match(html, /<strong>5<\/strong><span>de 10 p\.p\.<\/span>/);
      assert.doesNotMatch(html, /99<\/strong>/);
    });
    await t.test('projeto individual mantém o mesmo componente e a consulta sem histórico extra', () => {
      client.setQueryData(weeklyTargetsQueryKey(projectOwner('p5812'), false), data5812);
      const html = render('spotlight', { owner: projectOwner('p5812'), members: [] });
      assert.match(html, /Meta da semana/);
      assert.match(html, /de 30 un/);
      assert.doesNotMatch(html, /Agrupamento|Projeto 5812|project-weekly-targets/);
    });
  } finally { client.clear(); await server.close(); }
});
