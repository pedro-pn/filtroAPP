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
  assert.deepEqual(projectWorkflowStageOptions('DEMOBILIZATION'), ['EXECUTION', 'POST_JOB']);
  assert.deepEqual(projectWorkflowStageOptions('POST_JOB'), ['DEMOBILIZATION', 'FINAL_MEASUREMENT']);
  assert.deepEqual(projectWorkflowStageOptions('FINAL_MEASUREMENT'), ['POST_JOB', 'FINISHED']);
  assert.deepEqual(projectWorkflowStageOptions('FINISHED'), ['FINAL_MEASUREMENT']);
  assert.equal(projectWorkflowMilestoneText({ workflow: { milestones: { daysUntilMobilization: 20 } } }), 'Faltam 20 dia(s)');
  assert.equal(projectWorkflowMilestoneText({ workflow: { stage: 'DEMOBILIZATION', demobilizationDate: '2026-09-22', milestones: {} } }), 'Desmobilizada em 22/09/2026');
  assert.equal(projectWorkflowMilestoneText({ workflow: { stage: 'FINISHED', closedAt: '2026-10-01T12:00:00Z', milestones: {} } }), 'Encerrado em 01/10/2026');
});

test('Encerramento integra gate final, auditoria e reabertura justificada', () => {
  const modal = fs.readFileSync(new URL('../src/pages/efetivo/components/ProjectWorkflowModal.tsx', import.meta.url), 'utf8');
  const board = fs.readFileSync(new URL('../src/pages/efetivo/components/ProjectWorkflowBoard.tsx', import.meta.url), 'utf8');
  const novelty = fs.readFileSync(new URL('../src/pages/efetivo/ProjectWorkflowNovelty.tsx', import.meta.url), 'utf8');
  assert.match(modal, /data-project-workflow-closure-gate/);
  assert.match(modal, /Missão encerrada/);
  assert.match(modal, /Motivo da reabertura/);
  assert.match(modal, /Encerrar projeto/);
  assert.match(board, /closureGate\.blockers/);
  assert.match(board, /Informe a justificativa no detalhe/);
  assert.match(board, /Equipe e ciclos/);
  assert.match(novelty, /data-project-kanban-stage="FINISHED"/);
});

test('Documentação e medição integra evidências, valores e 14 controles', () => {
  const modal = fs.readFileSync(new URL('../src/pages/efetivo/components/ProjectWorkflowModal.tsx', import.meta.url), 'utf8');
  const panel = fs.readFileSync(new URL('../src/pages/efetivo/components/ProjectCloseoutPanel.tsx', import.meta.url), 'utf8');
  const board = fs.readFileSync(new URL('../src/pages/efetivo/components/ProjectWorkflowBoard.tsx', import.meta.url), 'utf8');
  const styles = fs.readFileSync(new URL('../src/pages/efetivo/efetivo.css', import.meta.url), 'utf8');
  assert.match(modal, /data-project-workflow-closeout/);
  assert.match(modal, /Iniciar documentação e medição/);
  assert.match(panel, /Evidências documentais/);
  assert.match(panel, /Consolidação da medição/);
  assert.match(panel, /Pendente de aprovação/);
  assert.match(panel, /título\(s\) no Omie/);
  assert.match(board, /Fechamento:/);
  assert.match(styles, /project-closeout-financial/);
});

test('desmobilização integra coluna, datas e 15 controles ao Kanban único', () => {
  const modal = fs.readFileSync(new URL('../src/pages/efetivo/components/ProjectWorkflowModal.tsx', import.meta.url), 'utf8');
  const board = fs.readFileSync(new URL('../src/pages/efetivo/components/ProjectWorkflowBoard.tsx', import.meta.url), 'utf8');
  assert.match(modal, /data-project-workflow-demobilization/);
  assert.match(modal, /Conclusão de campo/);
  assert.match(modal, /Logística de retorno/);
  assert.match(modal, /Retorno de ativos/);
  assert.match(modal, /Mobilização no cronograma/);
  assert.match(modal, /project\.mobilizationDate \|\| mission\?\.mobilizationDate/);
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
  assert.doesNotMatch(drop, /onProjectSelect\(project\.id\)/);
  assert.match(board, /onError: async \(error: Error, variables\) => \{\s+setColumns\(variables\.snapshot\);\s+onProjectSelect\(variables\.project\.id\)/);
  assert.match(board, /suppressCardClickUntilRef/);
  assert.match(board, /managedMove\.isPending \? managedMove\.variables\?\.project\.id : undefined/);
  assert.match(dragStart, /const startedFromInteractiveControl = interactiveMouseRef\.current;\s+interactiveMouseRef\.current = false;/);
  assert.match(modal, /Compatibilidade do projeto antigo/);
  assert.match(modal, /Atualizar etapa antiga/);
  assert.match(modal, /onOpenTeamProgramming/);
  assert.doesNotMatch(modal, /section=missoes/);
  assert.match(navigation, /projeto/);
  assert.match(navigation, /evolucao: \['projeto', 'busca', 'pagina', 'faseProjeto'\]/);
});

test('detalhe mostra prontidão comercial e mantém ações de avanço no rodapé', () => {
  const modal = fs.readFileSync(new URL('../src/pages/efetivo/components/ProjectWorkflowModal.tsx', import.meta.url), 'utf8');
  const intake = fs.readFileSync(new URL('../src/pages/efetivo/components/ProjectWorkflowIntakePanels.tsx', import.meta.url), 'utf8');
  const board = fs.readFileSync(new URL('../src/pages/efetivo/components/ProjectWorkflowBoard.tsx', import.meta.url), 'utf8');
  const registry = fs.readFileSync(new URL('../../shared/modules/registry.json', import.meta.url), 'utf8');
  assert.match(intake, /data-project-workflow-commercial/);
  assert.match(modal, /project-workflow-modal-footer/);
  assert.match(modal, /Assumir e iniciar análise/);
  assert.match(intake, /Sincronizado pelo CRM/);
  assert.match(intake, /Nenhum item desta área gera pendência ou bloqueia/);
  assert.doesNotMatch(intake, /Salvar fato comercial/);
  assert.match(board, /Sinais comerciais:/);
  assert.match(registry, /efetivo:commercial/);
});

test('documentação antecipada, D-30 e papéis de área aparecem nas superfícies da gestão', () => {
  const modal = fs.readFileSync(new URL('../src/pages/efetivo/components/ProjectWorkflowModal.tsx', import.meta.url), 'utf8');
  const intake = fs.readFileSync(new URL('../src/pages/efetivo/components/ProjectWorkflowIntakePanels.tsx', import.meta.url), 'utf8');
  const board = fs.readFileSync(new URL('../src/pages/efetivo/components/ProjectWorkflowBoard.tsx', import.meta.url), 'utf8');
  const administration = fs.readFileSync(new URL('../src/pages/efetivo/components/AdministrationBoard.tsx', import.meta.url), 'utf8');
  const styles = fs.readFileSync(new URL('../src/pages/efetivo/efetivo.css', import.meta.url), 'utf8');
  const sharedSchema = fs.readFileSync(new URL('../../shared/schemas/project-workflow.js', import.meta.url), 'utf8');
  const registry = fs.readFileSync(new URL('../../shared/modules/registry.json', import.meta.url), 'utf8');
  assert.match(intake, /Documentação antecipada/);
  assert.match(intake, /Data da solicitação/);
  assert.match(intake, /Data da confirmação/);
  assert.match(intake, /Histórico/);
  assert.match(intake, /É necessário \{category\.label\.toLocaleLowerCase\('pt-BR'\)\} para o projeto\?/);
  assert.match(intake, /documentation_requirement_update/);
  assert.match(sharedSchema, /Documentos e cadastros adicionais/);
  assert.match(sharedSchema, /Exames adicionais/);
  assert.match(sharedSchema, /Treinamentos adicionais/);
  assert.match(sharedSchema, /Certificações adicionais/);
  assert.match(modal, /Salvamento automático/);
  assert.doesNotMatch(modal, />Salvar</);
  assert.match(modal, /data-project-workflow-d30/);
  assert.match(modal, /Aguardando D-30/);
  assert.doesNotMatch(modal, /item\.stage === \(workflow\.stage === 'HANDOVER'/);
  assert.match(board, /Documentação:/);
  assert.match(board, /Prazos atingidos:/);
  assert.match(administration, /EFETIVO_ADMINISTRATIVE/);
  assert.match(styles, /project-workflow-planning-grid/);
  assert.match(styles, /\.project-workflow-documentation-fields \{[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(styles, /\.project-workflow-documentation-fields select \{[^}]*max-width: 100%[^}]*min-width: 0[^}]*width: 100%/);
  assert.match(registry, /efetivo:operations/);
  assert.match(registry, /efetivo:assets/);
  assert.match(registry, /efetivo:supplies/);
  assert.match(registry, /efetivo:administrative/);
});

test('análise inicial usa datas do CRM, contato estruturado e pendência sem campo Área', () => {
  const modal = fs.readFileSync(new URL('../src/pages/efetivo/components/ProjectWorkflowModal.tsx', import.meta.url), 'utf8');
  const intake = fs.readFileSync(new URL('../src/pages/efetivo/components/ProjectWorkflowIntakePanels.tsx', import.meta.url), 'utf8');
  const styles = fs.readFileSync(new URL('../src/pages/efetivo/efetivo.css', import.meta.url), 'utf8');
  const schema = fs.readFileSync(new URL('../../shared/schemas/project-workflow.js', import.meta.url), 'utf8');
  assert.match(intake, /Mobilização estimada/);
  assert.match(intake, /Início estimado/);
  assert.match(intake, /analysis_contact/);
  assert.match(intake, /Nome do contato/);
  assert.match(intake, /Data do contato/);
  assert.match(intake, /workflow\.analysisClientContactMade \?\? false/);
  assert.match(intake, /Enquanto estiver em “Não”, permanece pendente/);
  assert.doesNotMatch(schema, /ANALYSIS_TECHNICAL_PROPOSAL|ANALYSIS_COMMERCIAL_PROPOSAL|ANALYSIS_SCOPE|ANALYSIS_ASSUMPTIONS|ANALYSIS_DATES|ANALYSIS_CLIENT_CONTACT/);
  assert.doesNotMatch(modal, /issue-area-|errors\.area|register\('area'\)/);
  assert.match(styles, /\.project-workflow-check-item \{[^}]*grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(styles, /\.project-workflow-check-controls \{[^}]*grid-template-columns: minmax\(130px, \.6fr\) minmax\(0, 1fr\)/);
});

test('D-30 define cargos e equipamentos com avisos de disponibilidade', () => {
  const modal = fs.readFileSync(new URL('../src/pages/efetivo/components/ProjectWorkflowModal.tsx', import.meta.url), 'utf8');
  const planning = fs.readFileSync(new URL('../src/pages/efetivo/components/ProjectWorkflowResourcePlanning.tsx', import.meta.url), 'utf8');
  const schema = fs.readFileSync(new URL('../../shared/schemas/project-workflow.js', import.meta.url), 'utf8');
  const styles = fs.readFileSync(new URL('../src/pages/efetivo/efetivo.css', import.meta.url), 'utf8');
  assert.match(modal, /ProjectWorkflowTeamPlanningCard/);
  assert.match(modal, /ProjectWorkflowEquipmentPlanningCard/);
  assert.match(planning, /A equipe necessária para esta obra já foi definida/);
  assert.match(planning, /Necessidade de contratação/);
  assert.match(planning, /Confirmar equipe/);
  assert.match(planning, /Os equipamentos necessários para esta obra já foram definidos/);
  assert.match(planning, /Categorias e equipamentos necessários/);
  assert.match(planning, /toggleEquipment/);
  assert.match(planning, /equipmentIds/);
  assert.match(planning, /aria-expanded=\{categoryExpanded\}/);
  assert.match(planning, /project-workflow-equipment-category-toggle/);
  assert.doesNotMatch(planning, /checked=\{categorySelected\}/);
  assert.match(planning, /field-group project-workflow-resource-quantity/);
  const categoryToggle = planning.slice(planning.indexOf('const toggleCategory'), planning.indexOf('const toggleEquipment'));
  assert.match(categoryToggle, /setExpandedCategoryIds/);
  assert.doesNotMatch(categoryToggle, /setSelections/);
  assert.match(planning, /Calibração válida/);
  assert.match(planning, /Manutenção em dia/);
  assert.match(planning, /Confirmar equipamentos/);
  assert.match(schema, /action: z\.literal\('team_plan'\)/);
  assert.match(schema, /action: z\.literal\('equipment_plan'\)/);
  assert.doesNotMatch(schema, /D30_TEAM_QUANTITY_CONFIRMED|D30_EQUIPMENT_LIST_DEFINED/);
  assert.match(styles, /project-workflow-resource-add/);
  assert.match(styles, /project-workflow-equipment-summary/);
  assert.match(styles, /project-workflow-equipment-option\.is-selected/);
});

test('escolhas Sim e Não têm seleção acessível e cores semânticas', () => {
  const choice = fs.readFileSync(new URL('../src/pages/efetivo/components/ProjectWorkflowBooleanChoice.tsx', import.meta.url), 'utf8');
  const styles = fs.readFileSync(new URL('../src/pages/efetivo/efetivo.css', import.meta.url), 'utf8');
  assert.match(choice, /aria-pressed=\{value === true\}/);
  assert.match(choice, /aria-pressed=\{value === false\}/);
  assert.match(choice, /is-yes/);
  assert.match(choice, /is-no/);
  assert.match(styles, /project-workflow-choice-button\.is-selected\.is-yes[^}]*background: var\(--g\)/);
  assert.match(styles, /project-workflow-choice-button\.is-selected\.is-no[^}]*background: var\(--rd\)/);
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
  assert.match(styles, /repeat\(12, minmax\(230px, 1fr\)\)/);
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

test('Pós-job e categorias recolhíveis reduzem o volume do detalhe', () => {
  const modal = fs.readFileSync(new URL('../src/pages/efetivo/components/ProjectWorkflowModal.tsx', import.meta.url), 'utf8');
  const intake = fs.readFileSync(new URL('../src/pages/efetivo/components/ProjectWorkflowIntakePanels.tsx', import.meta.url), 'utf8');
  const category = fs.readFileSync(new URL('../src/pages/efetivo/components/ProjectWorkflowCategory.tsx', import.meta.url), 'utf8');
  const panel = fs.readFileSync(new URL('../src/pages/efetivo/components/ProjectPostJobPanel.tsx', import.meta.url), 'utf8');
  const board = fs.readFileSync(new URL('../src/pages/efetivo/components/ProjectWorkflowBoard.tsx', import.meta.url), 'utf8');
  const styles = fs.readFileSync(new URL('../src/pages/efetivo/efetivo.css', import.meta.url), 'utf8');
  assert.match(category, /<details/);
  assert.match(category, /useState\(!complete\)/);
  assert.match(intake, /Liberação comercial e contratual/);
  assert.match(intake, /Documentação antecipada/);
  assert.match(modal, /data-project-workflow-post-job/);
  assert.match(panel, /Lições aprendidas/);
  assert.match(panel, /Histórico relacionado/);
  assert.match(panel, /Registro em Qualidade/);
  assert.match(board, /Pós-job:/);
  assert.match(styles, /project-workflow-category/);
});
