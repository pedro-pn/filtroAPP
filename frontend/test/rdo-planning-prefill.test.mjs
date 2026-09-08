import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  addRdoMissionSuggestions,
  rdoWorkforceJustificationSchema,
  resolveRdoCollaboratorPrefill,
  resolveRdoMissionSuggestion
} from '../src/utils/rdoPlanningPrefill.ts';

test('seleção tocada prevalece sobre missão e último RDO', () => {
  assert.deepEqual(resolveRdoCollaboratorPrefill({
    currentCollaboratorIds: [], touched: true,
    lastReportStatus: 'FOUND',
    lastReportCollaboratorIds: ['r1']
  }), { collaboratorIds: [], source: 'TOUCHED' });
});

test('último RDO prevalece e missão oficial não substitui a equipe', () => {
  assert.deepEqual(resolveRdoCollaboratorPrefill({
    currentCollaboratorIds: [], touched: false,
    lastReportStatus: 'FOUND',
    lastReportCollaboratorIds: ['r1']
  }), { collaboratorIds: ['r1'], source: 'LAST_REPORT' });
});

test('primeiro RDO começa vazio mesmo quando existe equipe no efetivo', () => {
  assert.deepEqual(resolveRdoCollaboratorPrefill({
    currentCollaboratorIds: [], touched: false,
    lastReportStatus: 'EMPTY',
    lastReportCollaboratorIds: []
  }), { collaboratorIds: [], source: 'EMPTY' });
});

test('missão não preenche enquanto a consulta do último RDO está pendente', () => {
  assert.deepEqual(resolveRdoCollaboratorPrefill({
    currentCollaboratorIds: [], touched: false,
    lastReportStatus: 'PENDING',
    lastReportCollaboratorIds: []
  }), { collaboratorIds: [], source: 'WAITING' });
});

test('efetivo sugere somente colaboradores ausentes na equipe do último RDO', () => {
  assert.deepEqual(resolveRdoMissionSuggestion({
    currentCollaboratorIds: ['r1', 'm1'],
    missionCollaboratorIds: ['m1', 'm2', 'm2']
  }), ['m2']);
  assert.deepEqual(resolveRdoMissionSuggestion({
    currentCollaboratorIds: ['m2', 'm1'],
    missionCollaboratorIds: ['m1', 'm2']
  }), []);
});

test('efetivo é apenas sugestão também no primeiro RDO', () => {
  assert.deepEqual(resolveRdoMissionSuggestion({
    currentCollaboratorIds: [],
    missionCollaboratorIds: ['m1']
  }), ['m1']);
});

test('sugestão já fica visível enquanto a consulta do último RDO está pendente', () => {
  assert.deepEqual(resolveRdoMissionSuggestion({
    currentCollaboratorIds: [],
    missionCollaboratorIds: ['m1']
  }), ['m1']);
});

test('aceitar a sugestão acrescenta colaboradores sem substituir a equipe atual', () => {
  assert.deepEqual(
    addRdoMissionSuggestions(['r1', 'r2'], ['r2', 'm1']),
    ['r1', 'r2', 'm1']
  );
});

test('RDO anterior sem equipe ainda impede substituição automática pela missão', () => {
  assert.deepEqual(resolveRdoCollaboratorPrefill({
    currentCollaboratorIds: [], touched: false,
    lastReportStatus: 'FOUND',
    lastReportCollaboratorIds: []
  }), { collaboratorIds: [], source: 'EMPTY' });
  assert.deepEqual(resolveRdoMissionSuggestion({
    currentCollaboratorIds: [],
    missionCollaboratorIds: ['m1']
  }), ['m1']);
});

test('justificativa é obrigatória somente quando o preflight detecta afastamento', () => {
  assert.equal(rdoWorkforceJustificationSchema.safeParse({
    requiresJustification: true,
    workforceJustification: ''
  }).success, false);
  assert.equal(rdoWorkforceJustificationSchema.safeParse({
    requiresJustification: false,
    workforceJustification: ''
  }).success, true);
});

test('equipe anterior usa prefill mínimo sem aguardar o histórico completo', () => {
  const api = fs.readFileSync(new URL('../src/api/reports.ts', import.meta.url), 'utf8');
  const planningHook = fs.readFileSync(new URL('../src/hooks/useReportWorkforcePlanning.ts', import.meta.url), 'utf8');
  const prefillHook = fs.readFileSync(new URL('../src/hooks/useReportWorkforcePrefill.ts', import.meta.url), 'utf8');
  const notices = fs.readFileSync(new URL('../src/components/reports/ReportWorkforceNotices.tsx', import.meta.url), 'utf8');
  const page = fs.readFileSync(new URL('../src/pages/collaborator/NewReportPage.tsx', import.meta.url), 'utf8');

  assert.match(api, /reports\/collaborator-prefill/);
  assert.match(planningHook, /getReportCollaboratorPrefill\(projectId!, reportDate\)/);
  assert.match(page, /listReports\(\{ projectId: projectId!, summary: true \}\)/);
  assert.match(page, /useReportWorkforcePrefill/);
  assert.match(prefillHook, /lastReportPrefillStatus === 'FOUND'/);
  assert.match(notices, /Adicionar sugeridos/);
  assert.match(notices, /Manter equipe atual/);
  assert.match(notices, /disabled=\{!canApplyMissionSuggestion\}/);
  assert.match(notices, /<ul className="rdo-mission-team-suggestion-list"/);
  assert.match(notices, /<strong>\{collaborator\.name\}<\/strong>/);
});
