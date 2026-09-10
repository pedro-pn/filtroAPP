import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  cloneProjectKanbanColumns,
  moveProjectInColumns,
  projectKanbanStage,
  projectStageInColumns,
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

test('projeto legado preserva a etapa da missão dentro do Kanban único', () => {
  const project = {
    id: 'p2', code: 'P2', name: 'Legado', clientName: 'Cliente', location: '', workflow: null,
    operationalMission: { stage: 'MOBILIZATION' }, permissions: { canInitialize: true }
  };
  assert.equal(projectKanbanStage(project), 'MOBILIZATION');
  assert.deepEqual(projectWorkflowsToColumns([project]).MOBILIZATION.map(item => item.id), ['p2']);
});

test('movimentação otimista mantém snapshot para restaurar um card bloqueado', () => {
  const project = {
    id: 'p3', code: 'P3', name: 'Gerenciado', clientName: 'Cliente', location: '',
    workflow: { stage: 'MOBILIZATION' }, permissions: { canEdit: true }
  };
  const columns = projectWorkflowsToColumns([project]);
  const snapshot = cloneProjectKanbanColumns(columns);
  const moved = moveProjectInColumns(columns, project.id, 'EXECUTION');
  assert.equal(projectStageInColumns(moved, project.id), 'EXECUTION');
  assert.equal(projectStageInColumns(snapshot, project.id), 'MOBILIZATION');
  assert.notEqual(moved, snapshot);
});

test('ações de etapa não transformam D-30 em coluna', () => {
  assert.deepEqual(projectWorkflowStageOptions('INITIAL_ANALYSIS'), ['WAITING_PLANNING', 'MOBILIZATION_PLANNING']);
  assert.deepEqual(projectWorkflowStageOptions('MOBILIZATION_PLANNING'), ['INITIAL_ANALYSIS', 'WAITING_PLANNING', 'PREPARATION']);
  assert.deepEqual(projectWorkflowStageOptions('PREPARATION'), ['MOBILIZATION_PLANNING', 'READY_TO_MOBILIZE']);
  assert.deepEqual(projectWorkflowStageOptions('READY_TO_MOBILIZE'), ['PREPARATION', 'MOBILIZATION']);
  assert.deepEqual(projectWorkflowStageOptions('MOBILIZATION'), ['READY_TO_MOBILIZE', 'EXECUTION']);
  assert.deepEqual(projectWorkflowStageOptions('EXECUTION'), ['MOBILIZATION', 'DEMOBILIZATION']);
  assert.deepEqual(projectWorkflowStageOptions('DEMOBILIZATION'), ['EXECUTION']);
  assert.equal(projectWorkflowMilestoneText({ workflow: { milestones: { daysUntilMobilization: 20 } } }), 'Faltam 20 dia(s)');
  assert.equal(projectWorkflowMilestoneText({ workflow: { stage: 'DEMOBILIZATION', demobilizationDate: '2026-09-22', milestones: {} } }), 'Desmobilizada em 22/09/2026');
});

test('desmobilização integra coluna, datas e 15 controles ao Kanban único', () => {
  const modal = fs.readFileSync(new URL('../src/pages/efetivo/components/ProjectWorkflowModal.tsx', import.meta.url), 'utf8');
  const board = fs.readFileSync(new URL('../src/pages/efetivo/components/ProjectWorkflowBoard.tsx', import.meta.url), 'utf8');
  assert.match(modal, /data-project-workflow-demobilization/);
  assert.match(modal, /Conclusão de campo/);
  assert.match(modal, /Logística de retorno/);
  assert.match(modal, /Retorno de ativos/);
  assert.match(modal, /Salvar datas efetivas/);
  assert.match(modal, /Iniciar desmobilização/);
  assert.match(board, /Desmobilização:/);
});

test('Evolução apresenta um único Kanban e persiste o projeto na URL', () => {
  const page = fs.readFileSync(new URL('../src/pages/efetivo/EfetivoPage.tsx', import.meta.url), 'utf8');
  const board = fs.readFileSync(new URL('../src/pages/efetivo/components/ProjectWorkflowBoard.tsx', import.meta.url), 'utf8');
  const modal = fs.readFileSync(new URL('../src/pages/efetivo/components/ProjectWorkflowModal.tsx', import.meta.url), 'utf8');
  const navigation = fs.readFileSync(new URL('../src/utils/planningNavigation.ts', import.meta.url), 'utf8');
  assert.match(page, /ProjectWorkflowBoard/);
  assert.doesNotMatch(page, /MissionKanban/);
  assert.doesNotMatch(page, /project-workflow-view-switch/);
  assert.match(board, /movePlanningMission/);
  assert.match(board, /data-project-kanban-card/);
  assert.match(board, /onDragStart/);
  assert.match(board, /createPointerDragGhost/);
  assert.match(board, /Movimentação bloqueada:/);
  assert.match(board, /Ver líder e equipe/);
  assert.match(board, /Equipe e ciclos/);
  assert.match(board, /MissionAllocationModal/);
  assert.match(board, /Programar equipe/);
  assert.match(board, /MissionFormModal/);
  assert.match(board, /createPlanningMission/);
  assert.doesNotMatch(board, /section=missoes/);
  assert.match(board, /projectWorkflowErrorIssues/);
  const dragStart = board.slice(board.indexOf('function onCardDragStart'), board.indexOf('function onCardDragEnd'));
  const touchStart = board.slice(board.indexOf('function startTouchDrag'), board.indexOf('function onPointerStart'));
  const drop = board.slice(board.indexOf('function dropProject'), board.indexOf('function startTouchDrag'));
  assert.doesNotMatch(dragStart, /onProjectSelect/);
  assert.doesNotMatch(touchStart, /onProjectSelect/);
  assert.match(drop, /sourceStage !== stage/);
  assert.match(drop, /onProjectSelect\(project\.id\)/);
  assert.match(board, /suppressCardClickUntilRef/);
  assert.match(modal, /Compatibilidade do projeto antigo/);
  assert.match(modal, /Atualizar etapa antiga/);
  assert.match(modal, /onOpenTeamProgramming/);
  assert.doesNotMatch(modal, /section=missoes/);
  assert.match(navigation, /projeto/);
  assert.match(navigation, /evolucao: \['projeto', 'busca', 'pagina', 'faseProjeto'\]/);
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

test('preparação D-15 e gate de mobilização aparecem no quadro e no detalhe', () => {
  const modal = fs.readFileSync(new URL('../src/pages/efetivo/components/ProjectWorkflowModal.tsx', import.meta.url), 'utf8');
  const board = fs.readFileSync(new URL('../src/pages/efetivo/components/ProjectWorkflowBoard.tsx', import.meta.url), 'utf8');
  const administration = fs.readFileSync(new URL('../src/pages/efetivo/components/AdministrationBoard.tsx', import.meta.url), 'utf8');
  const styles = fs.readFileSync(new URL('../src/pages/efetivo/efetivo.css', import.meta.url), 'utf8');
  const registry = fs.readFileSync(new URL('../../shared/modules/registry.json', import.meta.url), 'utf8');
  assert.match(modal, /data-project-workflow-d15/);
  assert.match(modal, /data-project-workflow-gate/);
  assert.match(modal, /Autorizar mobilização/);
  assert.match(modal, /Revalidar autorização/);
  assert.match(board, /Risco de mobilização/);
  assert.match(board, /Mobilização autorizada/);
  assert.match(administration, /EFETIVO_QSMS/);
  assert.match(styles, /repeat\(11, minmax\(230px, 1fr\)\)/);
  assert.match(styles, /project-workflow-gate-table/);
  assert.match(registry, /efetivo:qsms/);
});

test('gate informa as três operações protegidas pela autorização', () => {
  const modal = fs.readFileSync(new URL('../src/pages/efetivo/components/ProjectWorkflowModal.tsx', import.meta.url), 'utf8');
  const novelty = fs.readFileSync(new URL('../src/pages/efetivo/ProjectWorkflowNovelty.tsx', import.meta.url), 'utf8');
  for (const source of [modal, novelty]) {
    assert.match(source, /equipe no Efetivo/);
    assert.match(source, /romaneios de saída/);
    assert.match(source, /retiradas do Estoque/);
  }
});

test('etapa Em execução mostra painel operacional e desvios integrados', () => {
  const modal = fs.readFileSync(new URL('../src/pages/efetivo/components/ProjectWorkflowModal.tsx', import.meta.url), 'utf8');
  const dashboard = fs.readFileSync(new URL('../src/pages/efetivo/components/ProjectExecutionDashboard.tsx', import.meta.url), 'utf8');
  const board = fs.readFileSync(new URL('../src/pages/efetivo/components/ProjectWorkflowBoard.tsx', import.meta.url), 'utf8');
  const styles = fs.readFileSync(new URL('../src/pages/efetivo/efetivo.css', import.meta.url), 'utf8');
  assert.match(modal, /ProjectExecutionDashboard/);
  assert.match(modal, /Iniciar execução/);
  assert.match(modal, /Iniciar mobilização/);
  assert.match(modal, /Voltar para mobilização/);
  assert.match(dashboard, /Dashboard de execução/);
  assert.match(dashboard, /Registrar desvio/);
  assert.match(dashboard, /Relatórios técnicos/);
  assert.match(dashboard, /RLR permanece manual/);
  assert.match(board, /data-project-workflow-execution/);
  assert.match(styles, /project-execution-deviation-form/);
  assert.match(styles, /project-execution-report-grid/);
});
