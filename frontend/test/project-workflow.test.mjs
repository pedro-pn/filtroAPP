import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  cloneProjectKanbanColumns,
  canDefineInitialProjectTeam,
  canManageProjectTeamCycles,
  moveProjectInColumns,
  projectKanbanStage,
  projectStageInColumns,
  projectWorkflowMilestoneText,
  projectWorkflowStageOptions,
  projectWorkflowsToColumns
} from '../src/utils/projectWorkflow.ts';

test('equipe inicial pertence à preparação e continua disponível até a mobilização; ciclos só em execução', () => {
  assert.equal(canDefineInitialProjectTeam('MOBILIZATION_PLANNING'), false);
  assert.equal(canDefineInitialProjectTeam('PREPARATION'), true);
  // Sem "Pronto para mobilizar": a definição da equipe inicial continua disponível até a Mobilização.
  assert.equal(canDefineInitialProjectTeam('MOBILIZATION'), true);
  assert.equal(canDefineInitialProjectTeam('EXECUTION'), false);
  assert.equal(canManageProjectTeamCycles('MOBILIZATION'), false);
  assert.equal(canManageProjectTeamCycles('EXECUTION'), true);
  assert.equal(canManageProjectTeamCycles('DEMOBILIZATION'), false);
});

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
  // Sem "Pronto para mobilizar": a Preparação vai direto para a Mobilização.
  assert.deepEqual(projectWorkflowStageOptions('PREPARATION'), ['MOBILIZATION_PLANNING', 'MOBILIZATION']);
  assert.deepEqual(projectWorkflowStageOptions('MOBILIZATION'), ['PREPARATION', 'EXECUTION']);
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
  const preparation = fs.readFileSync(new URL('../src/pages/efetivo/components/ProjectWorkflowPreparationPanels.tsx', import.meta.url), 'utf8');
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
  assert.match(board, /Definir equipe inicial/);
  assert.match(board, /Editar equipe inicial/);
  assert.match(board, /MissionFormModal/);
  assert.match(board, /createPlanningMission/);
  assert.match(board, /updatePlanningMission/);
  assert.match(preparation, /primeiro ciclo/);
  assert.match(board, /mission && teamCyclesAvailable/);
  assert.match(board, /canManageProjectTeamCycles\(stage\)/);
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

test('Preparação acompanha equipe nominal e liberações do cliente com salvamento automático', () => {
  const modal = fs.readFileSync(new URL('../src/pages/efetivo/components/ProjectWorkflowModal.tsx', import.meta.url), 'utf8');
  const panel = fs.readFileSync(new URL('../src/pages/efetivo/components/ProjectWorkflowPreparationPanels.tsx', import.meta.url), 'utf8');
  const schema = fs.readFileSync(new URL('../../shared/schemas/project-workflow.js', import.meta.url), 'utf8');
  assert.match(modal, /ProjectWorkflowDefinitiveTeam/);
  assert.match(modal, /ProjectWorkflowClientReleasesPanel/);
  assert.match(modal, /ProjectWorkflowEquipmentPreparation/);
  assert.match(modal, /ProjectWorkflowMaterialsPreparation/);
  assert.match(modal, /ProjectWorkflowPreJobPanel/);
  assert.match(modal, /ProjectWorkflowTravelPanel/);
  assert.match(modal, /ProjectWorkflowQsmsPanel/);
  assert.match(panel, /Aguardando definição da equipe/);
  assert.match(schema, /Colaborador informado/);
  assert.match(schema, /EXAMS_RELEASED/);
  assert.match(schema, /TRAININGS_RELEASED/);
  assert.match(panel, /futura integração externa/);
  assert.match(panel, /Confirmação do atendimento/);
  assert.doesNotMatch(panel, /Data da solicitação|Data da conclusão/);
  assert.match(panel, /Solicitado\{values\.requestedAt/);
  assert.match(panel, /Concluído\{values\.completedAt/);
  assert.match(panel, /completedAt: completed \? values\.completedAt \|\| todayDateOnly\(\) : ''/);
  assert.doesNotMatch(panel, /Solicitado para quem|requestedTo/);
  assert.match(panel, /disabled=\{disabled \|\| !values\.requested\}/);
  assert.match(panel, /<DateInput/);
  assert.match(panel, /Na sede e disponível na data necessária/);
  assert.match(panel, /Manutenção em dia/);
  assert.match(panel, /if \(!maintenance\.required\) return null/);
  assert.match(panel, /Certificados e calibração válidos/);
  assert.match(schema, /Material separado/);
  assert.match(panel, /Disponível em estoque/);
  assert.match(panel, /preparation_item_check/);
  assert.match(panel, /Agendado\{workflow\.preJob\.scheduledDate/);
  assert.match(panel, /Realizado\{workflow\.preJob\.completedDate/);
  assert.match(panel, /Hospedagem solicitada/);
  assert.match(panel, /Hospedagem confirmada/);
  assert.match(panel, /Transporte da equipe definido/);
  assert.match(panel, /Frete/);
  assert.match(panel, /TransportVehicleSelector/);
  assert.match(panel, /Foi verificado\?/);
  assert.match(panel, /O que foi verificado\?/);
  assert.match(panel, /action: 'qsms'/);
  assert.doesNotMatch(schema, /checklist\('D15_PRE_JOB_/);
  assert.doesNotMatch(schema, /checklist\('D15_TRAVEL_/);
  assert.doesNotMatch(schema, /checklist\('D15_QSMS_/);
  assert.doesNotMatch(schema, /D15_CLIENT_TEAM_RELEASED/);
  assert.doesNotMatch(schema, /D15_TEAM_DEFINITIVE_CONFIRMED/);
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

test('diálogo de planejamento separa as etapas em abas com resumo fixo e flags explicativas', () => {
  const modal = fs.readFileSync(new URL('../src/pages/efetivo/components/ProjectWorkflowModal.tsx', import.meta.url), 'utf8');
  const styles = fs.readFileSync(new URL('../src/pages/efetivo/efetivo.css', import.meta.url), 'utf8');
  assert.match(modal, /project-workflow-fixed-top/);
  assert.match(modal, /role="tablist" aria-label="Etapas do planejamento"/);
  assert.match(modal, /visibleStages\.map\(stage =>/);
  assert.match(modal, /role="tabpanel"/);
  assert.match(modal, /project-workflow-stage-flag/);
  assert.match(modal, /workflowStagePendingItems/);
  assert.match(modal, /Documentação antecipada.*documentationReadiness/);
  assert.match(modal, /<PortalTip/);
  assert.match(modal, /balloonClassName="project-workflow-stage-tip-balloon"/);
  assert.match(modal, /preferredPlacement="below"/);
  assert.match(modal, /preferredPlacement="below"[\s\S]*interactive/);
  assert.match(modal, /flag\.items\.map/);
  assert.match(modal, /aria-label=\{flag\.tooltip\}/);
  assert.match(modal, /Esta etapa ainda não foi iniciada/);
  assert.match(modal, /Ir para a etapa atual/);
  assert.match(styles, /\.project-workflow-fixed-top \{/);
  assert.match(styles, /\.project-workflow-stage-tabs-scroll \{[^}]*overflow-x: auto/);
  assert.match(styles, /\.project-workflow-modal-body \{[^}]*flex: 1 1 auto[^}]*min-height: 0/);
  assert.match(styles, /\.project-workflow-stage-tip li \+ li \{[^}]*border-top/);
  assert.match(styles, /\.project-workflow-stage-tip-balloon \{[^}]*overflow-y: auto/);
  assert.match(styles, /\.project-workflow-category-content \{[^}]*background:/);
  assert.match(styles, /\.project-workflow-check-item \{[^}]*border-left:/);
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
  assert.doesNotMatch(intake, /Data da solicitação|Data da confirmação/);
  assert.match(intake, /Solicitado\{item\.requestedAt \? ` em \$\{displayDateOnly\(item\.requestedAt\)\}` : ''\}/);
  assert.match(intake, /disabled=\{saving \|\| !canEdit \|\| item\.status === 'PENDING'\}/);
  assert.match(intake, /Data do contato: \{contactDate/);
  assert.match(intake, /Histórico/);
  assert.match(intake, /\{category\.description\}/);
  assert.match(intake, /documentation_requirement_update/);
  assert.match(sharedSchema, /Documentos técnicos/);
  assert.match(sharedSchema, /Exames adicionais/);
  assert.match(sharedSchema, /Documentos de segurança/);
  assert.match(sharedSchema, /Documentos de qualidade/);
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
  assert.match(styles, /\.project-workflow-documentation-types \{[^}]*align-items: start/);
  assert.match(styles, /\.project-workflow-documentation-fields \{[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(styles, /\.project-workflow-documentation-fields select \{[^}]*max-width: 100%[^}]*min-width: 0[^}]*width: 100%/);
  assert.match(registry, /efetivo:operations/);
  assert.match(registry, /efetivo:assets/);
  assert.match(registry, /efetivo:supplies/);
  assert.match(registry, /efetivo:administrative/);
});

test('análise inicial mostra as datas comerciais estimadas, contato estruturado e pendência sem campo Área', () => {
  const modal = fs.readFileSync(new URL('../src/pages/efetivo/components/ProjectWorkflowModal.tsx', import.meta.url), 'utf8');
  const intake = fs.readFileSync(new URL('../src/pages/efetivo/components/ProjectWorkflowIntakePanels.tsx', import.meta.url), 'utf8');
  const styles = fs.readFileSync(new URL('../src/pages/efetivo/efetivo.css', import.meta.url), 'utf8');
  const schema = fs.readFileSync(new URL('../../shared/schemas/project-workflow.js', import.meta.url), 'utf8');
  assert.match(intake, /Mobilização estimada/);
  assert.match(intake, /Início estimado/);
  assert.match(intake, /analysis_contact/);
  assert.match(intake, /Nome do contato/);
  assert.match(intake, /Telefone do contato/);
  assert.match(intake, /PHONE_COUNTRIES/);
  assert.match(intake, /phoneCountryFlag/);
  assert.match(intake, /project-workflow-country-trigger/);
  assert.match(intake, /handleCountryKeyDown/);
  assert.match(intake, /closeOnOutsidePointer/);
  assert.match(intake, /Data do contato/);
  assert.match(intake, /workflow\.analysisClientContactMade \?\? false/);
  assert.match(intake, /Enquanto estiver em “Não”, permanece pendente/);
  assert.match(intake, /Classificação final da análise/);
  assert.match(intake, /analysis_criticality/);
  assert.match(intake, /não há limite máximo/);
  assert.match(modal, /ProjectWorkflowCriticalityDecision/);
  assert.doesNotMatch(schema, /ANALYSIS_TECHNICAL_PROPOSAL|ANALYSIS_COMMERCIAL_PROPOSAL|ANALYSIS_SCOPE|ANALYSIS_ASSUMPTIONS|ANALYSIS_DATES|ANALYSIS_CLIENT_CONTACT/);
  assert.doesNotMatch(modal, /issue-area-|errors\.area|register\('area'\)/);
  assert.match(styles, /\.project-workflow-check-item \{[^}]*grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(styles, /\.project-workflow-check-controls \{[^}]*grid-template-columns: auto minmax\(0, 1fr\)/);
});

test('Análise inicial: checagem da proposta (itens críticos) vem antes do contato com o cliente', () => {
  const modal = fs.readFileSync(new URL('../src/pages/efetivo/components/ProjectWorkflowModal.tsx', import.meta.url), 'utf8');
  const analysisBranch = modal.slice(modal.indexOf("activeStage === 'INITIAL_ANALYSIS'"), modal.indexOf("activeStage === 'WAITING_PLANNING'"));
  const criticalIndex = analysisBranch.indexOf('renderCriticalItems()');
  const contactIndex = analysisBranch.indexOf('ProjectWorkflowInitialAnalysisData');
  assert.ok(criticalIndex >= 0 && contactIndex >= 0);
  assert.ok(criticalIndex < contactIndex, 'Itens críticos deve renderizar antes de Datas e contato inicial');
  // WAITING_PLANNING não duplica os itens críticos (já mostrados na Análise inicial acima)
  assert.match(modal, /renderAnalysisMonitoring\(false\)/);
});

test('D-30 define cargos e equipamentos com avisos de disponibilidade', () => {
  const modal = fs.readFileSync(new URL('../src/pages/efetivo/components/ProjectWorkflowModal.tsx', import.meta.url), 'utf8');
  const planning = fs.readFileSync(new URL('../src/pages/efetivo/components/ProjectWorkflowResourcePlanning.tsx', import.meta.url), 'utf8');
  const schema = fs.readFileSync(new URL('../../shared/schemas/project-workflow.js', import.meta.url), 'utf8');
  const styles = fs.readFileSync(new URL('../src/pages/efetivo/efetivo.css', import.meta.url), 'utf8');
  assert.match(modal, /ProjectWorkflowTeamPlanningCard/);
  assert.match(modal, /ProjectWorkflowEquipmentPlanningCard/);
  assert.match(planning, /Esta obra vai precisar de equipe própria/);
  assert.match(planning, /Necessidade de contratação/);
  assert.match(planning, /Confirmar equipe/);
  assert.match(planning, /Esta obra vai precisar de equipamentos/);
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

test('D-30 usa o Estoque nos insumos e salva a logística preliminar automaticamente', () => {
  const modal = fs.readFileSync(new URL('../src/pages/efetivo/components/ProjectWorkflowModal.tsx', import.meta.url), 'utf8');
  const planning = fs.readFileSync(new URL('../src/pages/efetivo/components/ProjectWorkflowSupplyLogisticsPlanning.tsx', import.meta.url), 'utf8');
  const schema = fs.readFileSync(new URL('../../shared/schemas/project-workflow.js', import.meta.url), 'utf8');
  const styles = fs.readFileSync(new URL('../src/pages/efetivo/efetivo.css', import.meta.url), 'utf8');
  assert.match(modal, /ProjectWorkflowSupplyPlanningCard/);
  assert.match(modal, /ProjectWorkflowLogisticsPlanningCard/);
  assert.match(planning, /Itens disponíveis no Estoque/);
  assert.match(planning, /Produtos químicos/);
  assert.match(planning, /Filtros/);
  assert.match(planning, /Pedido realizado/);
  assert.match(planning, /Compra concluída/);
  assert.match(planning, /Será necessário veículo/);
  assert.match(planning, /Será necessário frete/);
  assert.match(planning, /Será necessária hospedagem/);
  assert.match(planning, /A hospedagem já foi solicitada/);
  assert.doesNotMatch(planning, /Data do pedido|Data da compra|Data da solicitação|Data da conclusão/);
  assert.match(planning, /Hospedagem concluída/);
  assert.match(planning, /todayDateOnly\(\)/);
  assert.match(planning, /onBlur=\{\(\) => save\(draft\)\}/);
  assert.match(schema, /action: z\.literal\('supply_plan'\)/);
  assert.match(schema, /action: z\.literal\('logistics_plan'\)/);
  assert.doesNotMatch(schema, /D30_MATERIALS_LIST_DEFINED|D30_LOGISTICS_VEHICLE_DEFINED/);
  assert.match(styles, /project-workflow-supply-draft/);
  assert.match(styles, /project-workflow-logistics-fields/);
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

test('Pós-job e categorias recolhíveis reduzem o volume do detalhe', () => {
  const modal = fs.readFileSync(new URL('../src/pages/efetivo/components/ProjectWorkflowModal.tsx', import.meta.url), 'utf8');
  const intake = fs.readFileSync(new URL('../src/pages/efetivo/components/ProjectWorkflowIntakePanels.tsx', import.meta.url), 'utf8');
  const category = fs.readFileSync(new URL('../src/pages/efetivo/components/ProjectWorkflowCategory.tsx', import.meta.url), 'utf8');
  const preparation = fs.readFileSync(new URL('../src/pages/efetivo/components/ProjectWorkflowPreparationPanels.tsx', import.meta.url), 'utf8');
  const panel = fs.readFileSync(new URL('../src/pages/efetivo/components/ProjectPostJobPanel.tsx', import.meta.url), 'utf8');
  const board = fs.readFileSync(new URL('../src/pages/efetivo/components/ProjectWorkflowBoard.tsx', import.meta.url), 'utf8');
  const styles = fs.readFileSync(new URL('../src/pages/efetivo/efetivo.css', import.meta.url), 'utf8');
  assert.match(category, /<details/);
  assert.match(category, /useState\(initiallyOpen \?\? !complete\)/);
  assert.match(preparation, /initiallyOpen/);
  assert.match(styles, /project-workflow-definitive-team \{ grid-column: 1 \/ -1/);
  assert.match(intake, /Liberação comercial e contratual/);
  assert.match(intake, /Documentação antecipada/);
  assert.match(modal, /data-project-workflow-post-job/);
  assert.match(panel, /Lições aprendidas/);
  assert.match(panel, /Histórico relacionado/);
  assert.match(panel, /Registro em Qualidade/);
  assert.match(board, /Pós-job:/);
  assert.match(styles, /project-workflow-category/);
});

test('campos de data com salvamento automático só confirmam datas completas e o handover segue o padrão dos cards', () => {
  const dateInput = fs.readFileSync(new URL('../src/components/ui/DateInput.tsx', import.meta.url), 'utf8');
  const modal = fs.readFileSync(new URL('../src/pages/efetivo/components/ProjectWorkflowModal.tsx', import.meta.url), 'utf8');
  const efetivoPage = fs.readFileSync(new URL('../src/pages/efetivo/EfetivoPage.tsx', import.meta.url), 'utf8');
  const preparation = fs.readFileSync(new URL('../src/pages/efetivo/components/ProjectWorkflowPreparationPanels.tsx', import.meta.url), 'utf8');
  assert.match(dateInput, /isCommittableDate/);
  assert.match(dateInput, /validity\.badInput/);
  assert.match(dateInput, /onCommit/);
  assert.match(efetivoPage, /<DateInput id="efetivo-position-date"/);
  assert.match(preparation, /Agendado\{workflow\.preJob\.scheduledDate/);
  assert.match(preparation, /<DateInput id="workflow-freight-departure-date"/);
  const settings = modal.slice(modal.indexOf('function WorkflowSettingsForm('), modal.indexOf('function DemobilizationDatesForm('));
  assert.match(settings, /<ProjectWorkflowCategory[\s\S]*title="Responsáveis e cronograma"/);
  assert.match(settings, /Gestor de Contrato/);
  assert.doesNotMatch(modal, /Planejador/);
});

test('incompatibilidades de recursos aparecem no planejamento e na preparação, fora da análise inicial', () => {
  const modal = fs.readFileSync(new URL('../src/pages/efetivo/components/ProjectWorkflowModal.tsx', import.meta.url), 'utf8');
  const resources = fs.readFileSync(new URL('../src/pages/efetivo/components/ProjectWorkflowResourcePlanning.tsx', import.meta.url), 'utf8');
  const conflictUtil = fs.readFileSync(new URL('../src/utils/projectWorkflowResourceConflicts.ts', import.meta.url), 'utf8');
  assert.match(conflictUtil, /RESOURCE_TEAM_CONFLICT/);
  assert.match(conflictUtil, /RESOURCE_EQUIPMENT_CONFLICT/);
  assert.match(resources, /data-project-workflow-resource-conflicts/);
  assert.match(resources, /Sem mobilização operacional prevista, a disponibilidade considera/);
  assert.match(modal, /analysisIssues = workflow\.issues\.filter\(item => !isResourceConflictIssue\(item\)\)/);
  const planning = modal.slice(modal.indexOf("activeStage === 'MOBILIZATION_PLANNING'"), modal.indexOf("activeStage === 'PREPARATION'"));
  assert.match(planning, /ProjectWorkflowResourceConflicts/);
  const preparation = modal.slice(modal.indexOf('const renderPreparation = () =>'), modal.indexOf('const renderPostJob = () =>'));
  assert.match(preparation, /ProjectWorkflowResourceConflicts/);
});

test('Sede pula as etapas de mobilização nas opções de etapa e conta o prazo pelo início da execução', () => {
  assert.deepEqual(projectWorkflowStageOptions('PREPARATION', true), ['MOBILIZATION_PLANNING', 'EXECUTION']);
  assert.deepEqual(projectWorkflowStageOptions('EXECUTION', true), ['PREPARATION', 'POST_JOB']);
  assert.deepEqual(projectWorkflowStageOptions('POST_JOB', true), ['EXECUTION', 'FINAL_MEASUREMENT']);
  // sem resposta ou em campo, nada muda
  assert.deepEqual(projectWorkflowStageOptions('PREPARATION', false), ['MOBILIZATION_PLANNING', 'MOBILIZATION']);
  assert.deepEqual(projectWorkflowStageOptions('EXECUTION'), ['MOBILIZATION', 'DEMOBILIZATION']);
  const sede = days => ({ workflow: { executedAtHeadquarters: true, milestones: { daysUntilMobilization: days } } });
  assert.equal(projectWorkflowMilestoneText(sede(20)), 'Faltam 20 dia(s) para iniciar a execução');
  assert.equal(projectWorkflowMilestoneText(sede(0)), 'Início da execução previsto para hoje');
  assert.equal(projectWorkflowMilestoneText(sede(-3)), 'Início da execução atrasado há 3 dia(s)');
  assert.equal(projectWorkflowMilestoneText(sede(null)), 'Início da execução ainda não informado');
});

test('cadastro no cliente: "Sim" só pré-preenche o e-mail, "Solicitar cadastro" que envia para o que estiver no campo, e "Concluído" usa botão (não checkbox)', () => {
  const modal = fs.readFileSync(new URL('../src/pages/efetivo/components/ProjectWorkflowModal.tsx', import.meta.url), 'utf8');
  const schema = fs.readFileSync(new URL('../../shared/schemas/project-workflow.js', import.meta.url), 'utf8');
  const styles = fs.readFileSync(new URL('../src/pages/efetivo/efetivo.css', import.meta.url), 'utf8');
  assert.match(modal, /function ClientRegistrationCriticalItem/);
  assert.match(modal, /item\.key === 'CLIENT_REGISTRATION'/);
  assert.match(modal, /workflow\.clientReleases\.customerRegistration/);
  // botão explícito que envia para o que estiver no campo (padrão pré-preenchido ou digitado na hora)
  assert.match(modal, />Solicitar cadastro</);
  assert.match(modal, /notificationEmail: trimmedEmail/);
  assert.match(modal, /Usar este e-mail como padrão para os próximos projetos\?/);
  assert.match(modal, /sendRequest\(true\)/);
  assert.match(modal, /sendRequest\(false\)/);
  assert.match(modal, /\{ makeDefaultEmail \}/);
  assert.doesNotMatch(modal, /Para quem foi solicitado/);
  assert.match(schema, /notificationEmail: z\.string\(\)\.trim\(\)\.email/);
  assert.match(schema, /makeDefaultEmail: z\.boolean\(\)\.optional\(\)/);
  assert.match(styles, /project-workflow-client-registration-fields/);
  // solicitado sem e-mail configurado não falha silenciosamente: avisa na tela
  assert.match(modal, /release\.requested && !release\.email/);
  assert.match(modal, /Nenhum e-mail de aviso configurado/);
  // "Concluído" é um Button com preenchimento sólido quando ativo (mesmo padrão do botão "Fazer correção"), não um checkbox com moldura
  const registrationComponent = modal.slice(modal.indexOf('function ClientRegistrationCriticalItem'), modal.indexOf('function IssueEditor'));
  assert.match(registrationComponent, /project-workflow-registration-complete-button\$\{release\.completed \? ' is-active' : ''\}/);
  assert.doesNotMatch(registrationComponent, /type="checkbox"/);
  // antes de clicar não mostra o ícone de check nem usa cor de destaque (evita parecer já concluído)
  assert.match(registrationComponent, /\{release\.completed \? <ProjectWorkflowIcon name="check" \/> : null\}/);
  assert.match(styles, /project-workflow-registration-complete-button \{ background: var\(--pw-surface/);
  assert.match(styles, /project-workflow-registration-complete-button\.is-active/);
});

test('transporte da equipe e frete usam o mesmo seletor de veículo (Nosso/Locação/Frete + tipo + quantidade)', () => {
  const panel = fs.readFileSync(new URL('../src/pages/efetivo/components/ProjectWorkflowPreparationPanels.tsx', import.meta.url), 'utf8');
  const schema = fs.readFileSync(new URL('../../shared/schemas/project-workflow.js', import.meta.url), 'utf8');
  assert.match(panel, /function TransportVehicleSelector/);
  // as duas seções (equipe e frete) reaproveitam o mesmo componente, sem se fundir numa só
  const teamSection = panel.slice(panel.indexOf('Transporte da equipe definido'), panel.indexOf("<article className=\"project-workflow-client-release\">\n          <header><strong>Frete"));
  assert.match(teamSection, /idPrefix="workflow-team-transport"/);
  const freightSection = panel.slice(panel.indexOf('<header><strong>Frete'));
  assert.match(freightSection, /idPrefix="workflow-freight"/);
  assert.match(panel, /Quantos vão/);
  assert.doesNotMatch(panel, /teamTransportDescription|freightType/);
  assert.match(schema, /PROJECT_WORKFLOW_TRANSPORT_MODES = \['OWN', 'RENTAL', 'THIRD_PARTY'\]/);
  assert.match(schema, /CARRETA.*TRUCK.*MUNCK.*TOCO/s);
  assert.match(schema, /PICKUP.*HR.*VW10180.*PASSENGER/s);
});

test('administração ganha a aba de e-mails de aviso por finalidade', () => {
  const page = fs.readFileSync(new URL('../src/pages/efetivo/EfetivoPage.tsx', import.meta.url), 'utf8');
  const board = fs.readFileSync(new URL('../src/pages/efetivo/components/AdministrationBoard.tsx', import.meta.url), 'utf8');
  const api = fs.readFileSync(new URL('../src/api/efetivoPlanning.ts', import.meta.url), 'utf8');
  const purposes = fs.readFileSync(new URL('../../shared/schemas/notification-email-settings.js', import.meta.url), 'utf8');
  assert.match(page, /'regras', 'feriados', 'notificacoes', 'atividade'/);
  assert.match(board, /tab === 'notificacoes'/);
  assert.match(board, /listNotificationEmailSettings/);
  assert.match(board, /updateNotificationEmailSetting/);
  assert.match(api, /admin\/notification-emails/);
  assert.match(purposes, /PROJECT_WORKFLOW_CLIENT_REGISTRATION/);
});

test('datas comerciais estimadas ficam editáveis (sem CRM) na Análise inicial e são confirmadas ou corrigidas no D-15', () => {
  const intake = fs.readFileSync(new URL('../src/pages/efetivo/components/ProjectWorkflowIntakePanels.tsx', import.meta.url), 'utf8');
  const preparation = fs.readFileSync(new URL('../src/pages/efetivo/components/ProjectWorkflowPreparationPanels.tsx', import.meta.url), 'utf8');
  const api = fs.readFileSync(new URL('../src/api/projectWorkflow.ts', import.meta.url), 'utf8');
  const schema = fs.readFileSync(new URL('../../shared/schemas/project-workflow.js', import.meta.url), 'utf8');
  const styles = fs.readFileSync(new URL('../src/pages/efetivo/efetivo.css', import.meta.url), 'utf8');
  // destravadas: DateInput editável chamando commercial_dates, não mais <input readOnly>
  assert.doesNotMatch(intake, /readOnly aria-readonly="true"/);
  assert.match(intake, /<DateInput id="analysis-commercial-mobilization-date"/);
  assert.match(intake, /<DateInput id="analysis-commercial-start-date"/);
  assert.match(intake, /action: 'commercial_dates', version: workflow\.version, expectedMobilizationDate/);
  assert.match(intake, /action: 'commercial_dates', version: workflow\.version, expectedStartDate/);
  // D-15: confirmação com "Sim, continua igual" / "Não, mudou", não o padrão de botão único da confirmação de atendimento
  assert.match(preparation, /function CommercialScheduleConfirmationItem/);
  assert.match(preparation, /yesLabel="Sim, continua igual"/);
  assert.match(preparation, /noLabel="Não, mudou"/);
  assert.match(preparation, /action: 'commercial_schedule_confirm'/);
  assert.match(preparation, /scheduleConfirmation\.mobilization\.relevant/);
  assert.match(preparation, /scheduleConfirmation\.start\.relevant/);
  assert.match(styles, /project-workflow-commercial-schedule-choice/);
  // tipos e schema
  assert.match(api, /action: 'commercial_dates'/);
  assert.match(api, /action: 'commercial_schedule_confirm'/);
  assert.match(schema, /action: z\.literal\('commercial_dates'\)/);
  assert.match(schema, /action: z\.literal\('commercial_schedule_confirm'\)/);
  assert.match(schema, /field: z\.enum\(\['MOBILIZATION', 'START'\]\)/);
});

test('checklist de verificação do contato com o cliente: 16 perguntas em diálogo separado, obrigatórias, sem repetir os itens críticos', () => {
  const intake = fs.readFileSync(new URL('../src/pages/efetivo/components/ProjectWorkflowIntakePanels.tsx', import.meta.url), 'utf8');
  const api = fs.readFileSync(new URL('../src/api/projectWorkflow.ts', import.meta.url), 'utf8');
  const schema = fs.readFileSync(new URL('../../shared/schemas/project-workflow.js', import.meta.url), 'utf8');
  const styles = fs.readFileSync(new URL('../src/pages/efetivo/efetivo.css', import.meta.url), 'utf8');
  // diálogo separado (não polui a tela principal), portalizado como as demais caixas de diálogo do módulo
  assert.match(intake, /function ClientContactChecklistDialog/);
  assert.match(intake, /createPortal\(dialog, document\.body\)/);
  assert.match(intake, /Checklist de verificação \(\{checklistAnsweredCount\}\/\{workflow\.clientContactChecklist\.length\}\)/);
  // cada pergunta exige Sim/Não; a observação só aparece depois de respondida e é sempre opcional
  assert.match(intake, /function ClientContactChecklistRow/);
  assert.match(intake, /action: 'client_contact_check'/);
  assert.match(intake, /item\.answer !== null \? \(/);
  assert.match(intake, /Observação \(opcional\)/);
  // não repete os itens já cobertos pelos itens críticos (cadastro no cliente, equipamento especial etc.)
  const checklistBlock = schema.slice(schema.indexOf('PROJECT_WORKFLOW_CLIENT_CONTACT_CHECKLIST = ['), schema.indexOf('PROJECT_WORKFLOW_DOCUMENTATION_TYPES'));
  const keyMatches = [...checklistBlock.matchAll(/key: '([A-Z_0-9]+)'/g)].map(match => match[1]);
  assert.equal(keyMatches.length, 16);
  for (const key of ['CLIENT_REQUIREMENTS', 'CLIENT_REGISTRATION', 'SPECIAL_EQUIPMENT', 'LONG_LEAD_MATERIAL', 'MORE_THAN_TEN_FILTERS', 'SPECIFIC_HIRING']) {
    assert.equal(keyMatches.includes(key), false);
  }
  // amostra de perguntas formalizadas
  assert.match(checklistBlock, /UNLOADING_CRANE_TRUCK', label: '[^']*Munck/);
  assert.match(checklistBlock, /LODGING_CONDITIONS_CONFIRMED', label: '[^']*alojamento/);
  // tipos e schema
  assert.match(api, /ProjectWorkflowClientContactChecklistItem/);
  assert.match(api, /action: 'client_contact_check'/);
  assert.match(schema, /action: z\.literal\('client_contact_check'\)/);
  assert.match(schema, /key: z\.enum\(PROJECT_WORKFLOW_CLIENT_CONTACT_CHECKLIST\.map\(item => item\.key\)\)/);
  assert.match(styles, /project-workflow-checklist-dialog/);
});
