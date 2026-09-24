import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createServer } from 'vite';

const read = name => readFileSync(new URL(`../src/pages/efetivo/${name}`, import.meta.url), 'utf8');

test('Missões usa os estados DS e preserva ações por permissão e seleção', async t => {
  const server = await createServer({ configFile: false, root: new URL('..', import.meta.url).pathname,
    server: { middlewareMode: true, hmr: false }, esbuild: { jsx: 'automatic' }, optimizeDeps: { noDiscovery: true }, appType: 'custom' });
  try {
    const { MissionsBoard } = await server.ssrLoadModule('/src/pages/efetivo/components/MissionsBoard.tsx');
    const { ToastContext } = await server.ssrLoadModule('/src/components/ui/ToastContext.ts');
    const mission = { id: 'mission', projectId: 'project', project: { id: 'project', code: 'PRJ-001', name: 'Inspeção industrial', clientName: 'Cliente', location: 'Santos' },
      stage: 'STANDBY', scheduleStatus: 'CONFIRMED', version: 1, headquartersResponsibleUserId: 'leader', headquartersResponsibleName: 'Ana',
      mobilizationDate: '2026-09-09', executionStartDate: '2026-09-10', executionEndDate: '2026-09-12', returnDate: null,
      demands: [{jobRoleId:'role', requiredCount:2, jobRole:{name:'Técnico'}}],
      allocations: [{id:'allocation', collaboratorId:'person', jobRoleId:'role', collaborator:{id:'person',name:'Ana',role:'Técnico'}}] };
    for (const mode of ['manager', 'viewer', 'empty', 'search', 'loading', 'error', 'scenario']) {
      await t.test(mode, () => {
        const client = new QueryClient({ defaultOptions: { queries: { retry: false, retryOnMount: false, staleTime: Infinity } } });
        try {
          const planId = mode === 'scenario' ? 'scenario-id' : undefined;
          const missionsKey = ['efetivo-planning-missions', planId || 'official', 'all'];
          const pendingKey = ['efetivo-planning-missions-pending', planId || 'official'];
          if (mode !== 'loading' && mode !== 'error') {
            client.setQueryData(missionsKey, mode === 'empty' ? [] : [mission]);
            client.setQueryData(pendingKey, mode === 'empty' ? [] : [{...mission.project,id:'pending',name:'Projeto aguardando programação'}]);
          }
          if (mode === 'error') {
            for (const queryKey of [missionsKey,pendingKey]) client.getQueryCache().build(client,{queryKey}).setState({status:'error',fetchStatus:'idle',error:new Error('Falha simulada')});
          }
          const html = renderToStaticMarkup(createElement(QueryClientProvider, {client},
            createElement(ToastContext.Provider, {value:{showToast(){}}}, createElement(MissionsBoard, {
              canManage: mode !== 'viewer', planId, selectedMissionId:'mission', search:mode==='search'?'não existe':'',
              onSearchChange(){},onStatusChange(){},onMissionSelect(){}
            }))));
          assert.ok(html.includes('fv-search'));
          assert.doesNotMatch(html, /class="(?:primary-button|secondary-button|danger-button|mini-btn)/);
          if (mode === 'loading' || mode === 'error') {
            assert.ok(html.includes(mode === 'loading' ? 'fv-skeleton' : 'Tentar novamente'));
            assert.doesNotMatch(html,/data-efetivo-mission-summary/);
          } else if (mode === 'empty' || mode === 'search') {
            assert.ok(html.includes('fv-empty-state'));
          } else {
            assert.ok(html.includes('fv-card--selected'));
            assert.ok(html.includes('fv-metric-card'));
            assert.ok(html.includes('aria-label="Ver detalhes de PRJ-001"'));
            assert.equal(html.includes('Alocar disponíveis'), mode !== 'viewer');
            assert.equal(html.includes('>Editar<'), mode !== 'viewer');
            assert.equal(html.includes('>Remover<'), mode !== 'viewer');
            assert.ok(html.includes('>Equipe<'));
            assert.ok(html.includes('data-efetivo-pending-card'));
            assert.equal(html.includes('Carregando execução observada'), mode !== 'scenario');
          }
        } finally { client.clear(); }
      });
    }
  } finally { await server.close(); }
});

test('programação usa o contrato compacto de formulário DS', () => {
  for (const [file,id] of [['MissionFormModal.tsx','mission-programming-form']]) {
    const source = read(`components/${file}`);
    assert.match(source, /appearance="design-system"/);
    assert.match(source, /fullscreenOnMobile=\{false\}/);
    assert.match(source, /closeOnEscape=\{!saving\}/);
    assert.ok(source.includes(`form="${id}"`));
    assert.ok(source.includes(`id="${id}"`));
    assert.match(source, /<Field/);
    assert.match(source, /<Input size="sm"/);
    assert.doesNotMatch(source, /components\/ui\/Button|className="efetivo-modal-layout"/);
  }
  const form = read('components/MissionFormModal.tsx');
  for (const contract of ['confirmedMissionOverlapCollaboratorIds','allocationPeriods','headquartersResponsibleUserId','returnDate: values.returnDate || null','<MissionTeamSelector']) assert.ok(form.includes(contract));
  const css = read('EfetivoMissions.ds.css');
  assert.match(css, /efetivo-mission-card-actions\s*\{[^}]*flex-wrap: nowrap;[^}]*overflow: visible;/);
});
