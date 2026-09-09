import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  projectWorkflowMilestoneText,
  projectWorkflowStageOptions,
  projectWorkflowsToColumns
} from '../src/utils/projectWorkflow.ts';

test('projetos sem gestão entram visualmente no Handover', () => {
  const project = { id: 'p1', code: 'P1', name: 'Projeto', clientName: 'Cliente', location: '', workflow: null, permissions: { canInitialize: true } };
  const columns = projectWorkflowsToColumns([project]);
  assert.deepEqual(columns.HANDOVER.map(item => item.id), ['p1']);
  assert.equal(columns.INITIAL_ANALYSIS.length, 0);
});

test('ações de etapa não transformam D-30 em coluna', () => {
  assert.deepEqual(projectWorkflowStageOptions('INITIAL_ANALYSIS'), ['WAITING_PLANNING', 'MOBILIZATION_PLANNING']);
  assert.equal(projectWorkflowMilestoneText({ workflow: { milestones: { daysUntilMobilization: 20 } } }), 'Faltam 20 dia(s)');
});

test('integração mantém Kanban operacional como visão separada e persiste projeto na URL', () => {
  const page = fs.readFileSync(new URL('../src/pages/efetivo/EfetivoPage.tsx', import.meta.url), 'utf8');
  const navigation = fs.readFileSync(new URL('../src/utils/planningNavigation.ts', import.meta.url), 'utf8');
  assert.match(page, /ProjectWorkflowBoard/);
  assert.match(page, /MissionKanban/);
  assert.match(navigation, /projeto/);
  assert.match(navigation, /visao/);
});

test('detalhe mostra prontidão comercial e mantém ações de avanço no rodapé', () => {
  const modal = fs.readFileSync(new URL('../src/pages/efetivo/components/ProjectWorkflowModal.tsx', import.meta.url), 'utf8');
  const board = fs.readFileSync(new URL('../src/pages/efetivo/components/ProjectWorkflowBoard.tsx', import.meta.url), 'utf8');
  const registry = fs.readFileSync(new URL('../../shared/modules/registry.json', import.meta.url), 'utf8');
  assert.match(modal, /data-project-workflow-commercial/);
  assert.match(modal, /project-workflow-modal-footer/);
  assert.match(modal, /Assumir e iniciar análise/);
  assert.match(modal, /Sincronizado pelo CRM/);
  assert.match(board, /Comercial:/);
  assert.match(registry, /efetivo:commercial/);
});

test('documentação antecipada, D-30 e papéis de área aparecem nas superfícies da gestão', () => {
  const modal = fs.readFileSync(new URL('../src/pages/efetivo/components/ProjectWorkflowModal.tsx', import.meta.url), 'utf8');
  const board = fs.readFileSync(new URL('../src/pages/efetivo/components/ProjectWorkflowBoard.tsx', import.meta.url), 'utf8');
  const administration = fs.readFileSync(new URL('../src/pages/efetivo/components/AdministrationBoard.tsx', import.meta.url), 'utf8');
  const styles = fs.readFileSync(new URL('../src/pages/efetivo/efetivo.css', import.meta.url), 'utf8');
  const registry = fs.readFileSync(new URL('../../shared/modules/registry.json', import.meta.url), 'utf8');
  assert.match(modal, /Documentação antecipada/);
  assert.match(modal, /data-project-workflow-d30/);
  assert.match(modal, /Aguardando D-30/);
  assert.doesNotMatch(modal, /item\.stage === \(workflow\.stage === 'HANDOVER'/);
  assert.match(board, /Documentação:/);
  assert.match(board, /Prazos atingidos:/);
  assert.match(administration, /EFETIVO_ADMINISTRATIVE/);
  assert.match(styles, /project-workflow-planning-grid/);
  assert.match(registry, /efetivo:operations/);
  assert.match(registry, /efetivo:assets/);
  assert.match(registry, /efetivo:supplies/);
  assert.match(registry, /efetivo:administrative/);
});
