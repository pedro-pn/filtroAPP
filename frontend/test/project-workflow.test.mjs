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
