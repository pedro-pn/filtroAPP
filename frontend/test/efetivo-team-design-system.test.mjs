import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createServer } from 'vite';

const read = file => readFileSync(new URL(`../src/pages/efetivo/${file}`, import.meta.url), 'utf8');

test('gestão de equipe mantém ciclos herdados/individuais e respeita somente consulta', async t => {
  // Render the dialog's real contents in SSR; portal/focus behavior is checked in the browser.
  const server = await createServer({ configFile: false, root: new URL('..', import.meta.url).pathname,
    plugins: [{name:'dialog-ssr-wrapper', enforce:'pre', resolveId(id, importer) {
      if (id.endsWith('/ui/Modal') && importer?.includes('/pages/efetivo/')) return '\0dialog-ssr-wrapper';
    }, load(id) {
      if (id === '\0dialog-ssr-wrapper') return `import {createElement} from 'react'; export function Modal(p) { return p.open ? createElement('section',{role:'dialog','aria-label':p.title},p.children,p.footer) : null; }`;
    }}], server: {middlewareMode:true,hmr:false}, esbuild:{jsx:'automatic'}, optimizeDeps:{noDiscovery:true}, appType:'custom' });
  try {
    const {MissionAllocationModal} = await server.ssrLoadModule('/src/pages/efetivo/components/MissionAllocationModal.tsx');
    const {ToastContext} = await server.ssrLoadModule('/src/components/ui/ToastContext.ts');
    const cycles=[{id:'project-cycle',mobilizationDate:'2026-09-01',demobilizationDate:'2026-09-30'}];
    const mission={id:'mission',project:{id:'project',code:'PRJ-001',name:'Inspeção'},mobilizationDate:'2026-09-01',executionEndDate:'2026-09-30',returnDate:null,cycles,
      demands:[{jobRoleId:'role',requiredCount:3,jobRole:{name:'Técnico'}}],
      allocations:[
        {id:'inherited',collaboratorId:'ana',jobRoleId:'role',collaborator:{id:'ana',name:'Ana'},cycles:[],mobilizationDate:null,demobilizationDate:null},
        {id:'individual',collaboratorId:'bruno',jobRoleId:'role',collaborator:{id:'bruno',name:'Bruno'},allowMissionOverlap:true,cycles:[{id:'own',mobilizationDate:'2026-09-05',demobilizationDate:null}]}
      ]};
    for (const mode of ['manager','viewer','empty','closed','embedded-manager','embedded-viewer','embedded-open']) await t.test(mode, () => {
      const embedded = mode.startsWith('embedded-');
      const manager = mode === 'manager' || mode === 'embedded-manager' || mode === 'embedded-open';
      const viewer = mode === 'viewer' || mode === 'embedded-viewer';
      const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
      try {
        const html=renderToStaticMarkup(createElement(QueryClientProvider,{client},createElement(ToastContext.Provider,{value:{showToast(){}}},
          createElement(MissionAllocationModal,{open:mode!=='closed',embedded,canManage:manager,mission:mode==='empty'?{...mission,allocations:[],cycles:[]}:mode==='embedded-open'?{...mission,cycles:cycles.map(cycle=>({...cycle,demobilizationDate:null}))}:mission,onClose(){}}))));
        if(mode==='closed') { assert.equal(html,''); return; }
        assert.ok(html.includes('Ciclos do projeto'));
        assert.ok(html.includes('Equipe e alocações'));
        assert.match(html, /role="group" aria-labelledby="mission-allocated-team-title"/);
        assert.ok(html.includes('Equipe alocada'));
        assert.equal(html.includes('Adicionar colaboradores'),manager);
        if(mode==='empty') { assert.ok(html.includes('Nenhuma pessoa alocada')); return; }
        assert.match(html, /class="efetivo-team-cycle-summary"/);
        assert.match(html, /data-cycle-state="open"/);
        if (mode==='embedded-open') { assert.doesNotMatch(html, /data-cycle-state="closed"/); assert.ok(html.includes('Desmobilização prevista: 30/09/2026')); } else assert.match(html, /data-cycle-state="closed"/);
        assert.ok(html.includes('Segue os ciclos do projeto'));
        assert.ok(html.includes('Ciclos individuais'));
        assert.ok(html.includes('Em aberto'));
        assert.equal(html.includes('Encerrado'), mode!=='embedded-open');
        assert.ok(html.includes('Sobreposição confirmada'));
        for(const label of ['Personalizar ciclos','Novo ciclo individual','Remover Ana da equipe','Remover ciclo']) assert.equal(html.includes(label),manager,label);
        assert.equal(html.includes('Somente consulta'),viewer);
        if(viewer) assert.doesNotMatch(html,/<input|<select/);
        if(embedded && manager) {
          assert.match(html,/class="secondary-button"/);
          assert.match(html,/class="danger-button"[^>]*>Remover da equipe<\/button>/);
          assert.doesNotMatch(html,/class="fv-button/);
        } else assert.doesNotMatch(html,/class="(?:primary-button|secondary-button|danger-button|mini-btn)/);
      } finally {client.clear();}
    });
  } finally {await server.close();}
});

test('seleção e gestão compartilham campos, tema, ações compactas e o contrato de permissão', () => {
  const allocation=read('components/MissionAllocationModal.tsx');
  const selector=read('components/MissionTeamSelector.tsx');
  for(const source of [allocation,selector]) {
    assert.match(source,/<MissionPeriodFields/);
    assert.match(source,/appearance="design-system"/);
    assert.match(source,/fullscreenOnMobile=\{false\}/);
    assert.match(source,/<Alert/);
    assert.doesNotMatch(source,/components\/ui\/Button|className="efetivo-modal-layout"/);
  }
  assert.match(selector,/<Skeleton/);
  assert.match(selector,/Tentar novamente/);
  assert.match(selector,/Confirmar sobreposição/);
  assert.match(selector,/existingConfirmedOverlapIds\.filter/);
  assert.match(read('components/ProjectWorkflowModal.tsx'), /<MissionAllocationModal[^>]*readOnly=\{!editable\}/);
  assert.match(allocation,/enabled: open && canManage/);
  assert.match(allocation,/canManageTeam && teamPickerOpen \? <MissionTeamSelector/);
  assert.match(selector,/open=\{overlapConfirmationIds\.length > 0 \|\| inactiveConfirmationIds\.length > 0\}/);
  assert.match(allocation,/demobilizationDate: draft\.demobilizationDate \|\| null/);
  const fields=read('components/MissionPeriodFields.tsx');
  assert.match(fields,/min=\{value\.mobilizationDate \|\| min\}/);
  assert.match(fields,/max=\{max\}/);
  assert.match(fields,/required=\{!optionalEnd\}/);
  const css=read('EfetivoTeam.ds.css');
  assert.match(css,/\.fv-modal-backdrop\.efetivo-team-availability-backdrop\s*\{\s*z-index: var\(--z-overlay\);/);
  assert.match(css,/efetivo-team-actions\s*\{[^}]*flex-wrap: nowrap;[^}]*overflow: visible;/);
  assert.doesNotMatch(css,/!important|#[0-9a-f]{3,8}\b/i);
});

test('ciclos compactos distinguem formulários da equipe sem criar rolagens internas', () => {
  const css=read('EfetivoTeam.ds.css');
  assert.match(css,/\.efetivo-team-cycle-row\s*\{[^}]*grid-template-columns: minmax\(0, 1fr\) auto;[^}]*align-items: center;/);
  assert.match(css,/\.efetivo-team-cycle-row > \.efetivo-team-cycle-editor\s*\{ grid-column: 1 \/ -1;/);
  assert.match(css,/\.efetivo-team-cycle-editor,\s*\.efetivo-team-allocation-form\s*\{[^}]*border: var\(--border-width\) solid var\(--line-strong\);[^}]*background: var\(--surface-2\);/);
  assert.match(css,/@media \(min-width: 768px\)[\s\S]*\.efetivo-team-new-project-cycle\s*\{ grid-template-columns: minmax\(0, 1fr\) auto;/);
  assert.match(css,/@media \(max-width: 767\.98px\)[\s\S]*\.efetivo-team-cycle-row\s*\{ grid-template-columns: minmax\(0, 1fr\);/);
  assert.doesNotMatch(css,/overflow(?:-x|-y)?:\s*(?:hidden|auto|scroll)/);
});
