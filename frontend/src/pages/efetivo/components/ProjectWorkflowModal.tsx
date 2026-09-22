import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import {
  PROJECT_WORKFLOW_HEADQUARTERS_EDITABLE_STAGES,
  makeProjectWorkflowSchemas,
  projectWorkflowVisibleStages
} from '../../../../../shared/schemas/project-workflow.js';
import type {
  ProjectWorkflowChecklist,
  ProjectWorkflowChecklistStatus,
  ProjectWorkflowDetail,
  ProjectWorkflowIssue,
  ProjectWorkflowPatch,
  ProjectWorkflow,
  ProjectWorkflowStage,
  ProjectOperationalMissionSummary
} from '../../../api/projectWorkflow';
import { Button } from '../../../components/ui/Button';
import { Modal } from '../../../components/ui/Modal';
import { PortalTip } from '../../../components/ui/PortalTip';
import { displayDateOnly, todayDateOnly } from '../../../utils/calendarGrid';
import {
  canManageProjectTeamCycles,
  WORKFLOW_STAGES,
  WORKFLOW_STAGE_LABELS
} from '../../../utils/projectWorkflow';
import { ProjectExecutionDashboard } from './ProjectExecutionDashboard';
import { ProjectCloseoutPanel } from './ProjectCloseoutPanel';
import { ProjectPostJobPanel } from './ProjectPostJobPanel';
import { ProjectWorkflowCategory } from './ProjectWorkflowCategory';
import { ProjectWorkflowStageRail } from './ProjectWorkflowStageRail';
import { ProjectWorkflowIcon } from './ProjectWorkflowIcon';
import { initialsOf } from '../../../utils/projectWorkflowPresentation';
import { useStageSectionRegistry } from '../../../utils/projectWorkflowStageSections';
import {
  ProjectWorkflowClientReleasesPanel,
  ProjectWorkflowDefinitiveTeam,
  ProjectWorkflowEquipmentPreparation,
  ProjectWorkflowMaterialsPreparation,
  ProjectWorkflowPreJobPanel,
  ProjectWorkflowQsmsPanel,
  ProjectWorkflowTravelPanel
} from './ProjectWorkflowPreparationPanels';
import { ProjectWorkflowBooleanChoice } from './ProjectWorkflowBooleanChoice';
import {
  ProjectWorkflowEquipmentPlanningCard,
  ProjectWorkflowResourceConflicts,
  ProjectWorkflowTeamPlanningCard
} from './ProjectWorkflowResourcePlanning';
import { isResourceConflictIssue } from '../../../utils/projectWorkflowResourceConflicts';
import {
  ProjectWorkflowLogisticsPlanningCard,
  ProjectWorkflowSupplyPlanningCard
} from './ProjectWorkflowSupplyLogisticsPlanning';
import { ProjectDocumentsCategory } from './ProjectDocumentsCategory';
import {
  ProjectWorkflowCommercialSignals,
  ProjectWorkflowCriticalityDecision,
  ProjectWorkflowDocumentationTracking,
  ProjectWorkflowHandoverSignals,
  ProjectWorkflowInitialAnalysisData
} from './ProjectWorkflowIntakePanels';
import {
  listProjectDocuments,
  projectDocumentsQueryKey
} from '../../../api/projectDocuments';

const sharedSchemas = makeProjectWorkflowSchemas(z);
type StartValues = { leaderUserId: string; plannerUserId: string; plannedMobilizationDate?: string };
type WorkflowUserOption = { id: string; name: string; email: string | null };
const checklistSchema = z.object({
  status: z.enum(['PENDING', 'DONE', 'NOT_APPLICABLE']),
  note: z.string().trim().max(1000, 'A observação deve ter no máximo 1000 caracteres.')
}).refine(value => value.status !== 'NOT_APPLICABLE' || Boolean(value.note), {
  path: ['note'],
  message: 'Justifique por que este item não se aplica.'
});
type ChecklistValues = z.infer<typeof checklistSchema>;
const reopenSchema = z.object({
  reason: z.string().trim().min(3, 'Informe uma justificativa com ao menos 3 caracteres.').max(1000, 'A justificativa deve ter no máximo 1000 caracteres.')
});
type ReopenValues = z.infer<typeof reopenSchema>;
const issueSchema = z.object({
  description: z.string().trim().min(1, 'Informe a pendência.').max(500),
  requiredLeadTimeDays: z.string().regex(/^\d+$/, 'Informe o prazo em dias.').refine(value => Number(value) >= 1 && Number(value) <= 3650, 'Informe um prazo entre 1 e 3650 dias.'),
  dueDate: z.string().min(1, 'Informe a data limite.'),
  criticality: z.enum(['HIGH', 'MEDIUM', 'LOW']),
  status: z.enum(['OPEN', 'IN_PROGRESS', 'RESOLVED'])
});
type IssueValues = z.infer<typeof issueSchema>;
type LegacyMissionValues = { stage: ProjectOperationalMissionSummary['stage']; returnDate: string };

const WORKFLOW_STAGE_DESCRIPTIONS: Record<ProjectWorkflowStage, string> = {
  HANDOVER: 'Responsáveis, informações comerciais e dados recebidos para iniciar a gestão.',
  INITIAL_ANALYSIS: 'Entendimento da obra, documentação antecipada, pendências e criticidade.',
  WAITING_PLANNING: 'Acompanhamento dos itens antecipados enquanto o marco D-30 não chega.',
  MOBILIZATION_PLANNING: 'Previsões de equipe, equipamentos, suprimentos e logística.',
  PREPARATION: 'Confirmações definitivas das frentes responsáveis antes da mobilização.',
  MOBILIZATION: 'Acompanhamento da liberação e do início da mobilização operacional.',
  EXECUTION: 'Avanço da obra, RDOs, relatórios técnicos, desvios e ciclos da equipe.',
  DEMOBILIZATION: 'Conclusão de campo, retorno da equipe e devolução dos ativos.',
  POST_JOB: 'Feedbacks, aprendizados e fechamento técnico da obra.',
  FINAL_MEASUREMENT: 'Documentação final, medição, valores e gate de encerramento.',
  FINISHED: 'Consulta do fechamento e reabertura justificada quando necessária.'
};

type WorkflowStageFlag = {
  tone: 'complete' | 'current' | 'pending' | 'waiting';
  label: string;
  tooltip: string;
  items: string[];
};

function workflowStageFlag(workflow: ProjectWorkflow, stage: ProjectWorkflowStage, stageIssues: string[]): WorkflowStageFlag {
  const stageIndex = WORKFLOW_STAGES.indexOf(stage);
  const currentIndex = WORKFLOW_STAGES.indexOf(workflow.stage);
  if (stageIndex > currentIndex) return { tone: 'waiting', label: 'Aguardando', tooltip: `${WORKFLOW_STAGE_LABELS[stage]}: aguardando a conclusão das etapas anteriores.`, items: ['Aguardando a conclusão das etapas anteriores.'] };
  if (workflow.stage === 'FINISHED') return { tone: 'complete', label: 'Concluída', tooltip: `${WORKFLOW_STAGE_LABELS[stage]}: projeto encerrado.`, items: ['Projeto encerrado.'] };
  if (stageIssues.length) {
    const visibleIssues = stageIssues.slice(0, 4).join(' • ');
    const remaining = stageIssues.length > 4 ? ` • e mais ${stageIssues.length - 4}` : '';
    const items = stageIssues.length > 8 ? [...stageIssues.slice(0, 8), `E mais ${stageIssues.length - 8} pendência(s).`] : stageIssues;
    return {
      tone: 'pending',
      label: `${stageIssues.length} pendência${stageIssues.length === 1 ? '' : 's'}`,
      tooltip: `${WORKFLOW_STAGE_LABELS[stage]}: ${visibleIssues}${remaining}`,
      items
    };
  }
  if (stageIndex < currentIndex) return { tone: 'complete', label: 'Concluída', tooltip: `${WORKFLOW_STAGE_LABELS[stage]}: etapa concluída sem pendências registradas.`, items: ['Etapa concluída sem pendências registradas.'] };
  return { tone: 'current', label: 'Em dia', tooltip: `${WORKFLOW_STAGE_LABELS[stage]}: etapa atual sem pendências para avançar.`, items: ['Nenhuma pendência para avançar.'] };
}

function workflowStagePendingItems(workflow: ProjectWorkflow, stage: ProjectWorkflowStage, currentIssues: string[]) {
  if (stage === workflow.stage) return currentIssues;
  if (WORKFLOW_STAGES.indexOf(stage) > WORKFLOW_STAGES.indexOf(workflow.stage)) return [];
  const readinessIssue = (label: string, completed: number, total: number) => {
    const pending = total - completed;
    return pending > 0 ? [`${label}: ${pending} ${pending === 1 ? 'item pendente' : 'itens pendentes'}`] : [];
  };
  if (stage === 'HANDOVER') return workflow.handoverGate.issues;
  if (stage === 'INITIAL_ANALYSIS' || stage === 'WAITING_PLANNING') {
    return [
      ...readinessIssue('Documentação antecipada', workflow.documentationReadiness.completed, workflow.documentationReadiness.total),
      ...readinessIssue('Itens críticos', workflow.criticalAnswers.filter(item => item.answer !== null).length, workflow.criticalAnswers.length),
      ...(workflow.issues.some(item => item.status !== 'RESOLVED') ? [`Pendências abertas: ${workflow.issues.filter(item => item.status !== 'RESOLVED').length}`] : []),
      ...(workflow.isCritical == null ? ['Classificação de criticidade não informada'] : []),
      ...(workflow.executedAtHeadquarters == null ? ['Sede ou campo não informado'] : [])
    ];
  }
  if (stage === 'MOBILIZATION_PLANNING') return readinessIssue('Planejamento D-30', workflow.planningReadiness.completed, workflow.planningReadiness.total);
  if (stage === 'PREPARATION') return readinessIssue('Preparação', workflow.preparationReadiness.completed, workflow.preparationReadiness.total);
  if (stage === 'MOBILIZATION' || stage === 'EXECUTION') return workflow.mobilizationGate.blockers.map(item => `${item.label}: ${item.reason}`);
  if (stage === 'DEMOBILIZATION') return [
    ...readinessIssue('Desmobilização', workflow.demobilizationReadiness.completed, workflow.demobilizationReadiness.total),
    ...(!workflow.fieldCompletionDate ? ['Data de conclusão de campo não informada'] : []),
    ...(!workflow.demobilizationDate ? ['Data de desmobilização não informada'] : [])
  ];
  if (stage === 'POST_JOB') return readinessIssue('Pós-job', workflow.postJobReadiness.completed, workflow.postJobReadiness.total);
  if (stage === 'FINAL_MEASUREMENT') return workflow.closureGate.blockers.map(item => `${item.label}: ${item.reason}`);
  return [];
}

function stageTabId(stage: ProjectWorkflowStage) {
  return `project-workflow-tab-${stage.toLowerCase().replaceAll('_', '-')}`;
}

function stagePanelId(stage: ProjectWorkflowStage) {
  return `project-workflow-panel-${stage.toLowerCase().replaceAll('_', '-')}`;
}

const LEGACY_MISSION_STAGE_LABELS: Record<ProjectOperationalMissionSummary['stage'], string> = {
  STANDBY: 'Stand by',
  MOBILIZATION: 'Mobilização',
  EXECUTION: 'Execução',
  FINAL_MEASUREMENT: 'Medição final',
  FINISHED: 'Finalizada'
};

function LegacyMissionStageForm({ mission, saving, canManage, onMove }: {
  mission: ProjectOperationalMissionSummary;
  saving: boolean;
  canManage: boolean;
  onMove: (stage: ProjectOperationalMissionSummary['stage'], returnDate?: string | null) => void;
}) {
  const { register, handleSubmit, reset, watch, formState: { isDirty } } = useForm<LegacyMissionValues>({
    defaultValues: { stage: mission.stage, returnDate: mission.returnDate || '' }
  });
  useEffect(() => reset({ stage: mission.stage, returnDate: mission.returnDate || '' }), [mission, reset]);
  const stage = watch('stage');
  return (
    <form className="project-workflow-section" onSubmit={handleSubmit(values => onMove(
      values.stage,
      values.stage === 'FINISHED' ? values.returnDate || undefined : undefined
    ))}>
      <header><div><h4>Compatibilidade do projeto antigo</h4><p>A etapa operacional continua disponível aqui até o handover desta obra ser iniciado.</p></div><span>{mission.participantCount} participante(s)</span></header>
      <div className="project-workflow-form-grid compact">
        <div className="field-group"><label htmlFor="legacy-mission-stage">Etapa atual</label><select id="legacy-mission-stage" disabled={saving || !canManage} {...register('stage')}>{Object.entries(LEGACY_MISSION_STAGE_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></div>
        {stage === 'FINISHED' ? <div className="field-group"><label htmlFor="legacy-mission-return-date">Data de desmobilização</label><input id="legacy-mission-return-date" type="date" disabled={saving || !canManage} {...register('returnDate')} /><small>Opcional; quando informada, atualiza o cronograma do projeto.</small></div> : null}
      </div>
      {canManage ? <div className="project-workflow-inline-actions"><Button type="submit" variant="secondary" disabled={saving || !isDirty}>Atualizar etapa antiga</Button></div> : null}
    </form>
  );
}

// Rótulo curto do estado da seção: o índice da etapa já carrega a contagem completa.
function sectionStatusLabel(completed: number, total: number) {
  if (!total) return 'Sem itens';
  if (completed >= total) return 'Concluído';
  return `${total - completed} pendente${total - completed === 1 ? '' : 's'}`;
}

type StageReadiness = { completed: number; total: number; percentage: number };

// documentationReadiness não traz percentual pronto; a etapa o calcula para a barra do cabeçalho.
function documentationStageReadiness(workflow: ProjectWorkflow): StageReadiness {
  const { completed, total } = workflow.documentationReadiness;
  return { completed, total, percentage: total ? Math.round((completed / total) * 100) : 0 };
}

// Marco e prontidão que a etapa mostra no próprio cabeçalho, no lugar da antiga categoria externa.
function stageHeadingReadiness(workflow: ProjectWorkflow, stage: ProjectWorkflowStage): { marker: string | null; readiness: StageReadiness | null } {
  if (stage === 'MOBILIZATION_PLANNING') return { marker: 'D-30', readiness: workflow.planningReadiness };
  if (stage === 'PREPARATION' || stage === 'MOBILIZATION') return { marker: `D-${workflow.preparationLeadTimeDays}`, readiness: workflow.preparationReadiness };
  if (stage === 'WAITING_PLANNING') return { marker: 'D-30', readiness: documentationStageReadiness(workflow) };
  if (stage === 'INITIAL_ANALYSIS') return { marker: null, readiness: workflow.analysisReadiness };
  if (stage === 'DEMOBILIZATION') return { marker: null, readiness: workflow.demobilizationReadiness };
  if (stage === 'POST_JOB') return { marker: null, readiness: workflow.postJobReadiness };
  if (stage === 'FINAL_MEASUREMENT') return { marker: null, readiness: workflow.closureGate };
  return { marker: null, readiness: null };
}

function fieldClass(error?: unknown) {
  return `field-group ${error ? 'field-invalid' : ''}`;
}

function StartWorkflowForm({ detail, leaders, saving, onStart }: {
  detail: ProjectWorkflowDetail;
  leaders: WorkflowUserOption[];
  saving: boolean;
  onStart: (values: StartValues) => void;
}) {
  const { register, handleSubmit, formState: { errors } } = useForm<StartValues>({
    resolver: zodResolver(sharedSchemas.start),
    defaultValues: { leaderUserId: '', plannerUserId: '', plannedMobilizationDate: undefined }
  });
  const hasFormValidationError = Boolean((errors as Record<string, unknown>)['']);
  return (
    <form className="project-workflow-form" noValidate onSubmit={handleSubmit(onStart)}>
      <p>Inicie o handover sem precisar definir a equipe de campo.</p>
      <div className="project-workflow-form-grid">
        <div className={fieldClass(errors.leaderUserId)}>
          <label htmlFor="workflow-start-leader">Líder de Projetos *</label>
          <select id="workflow-start-leader" disabled={saving} aria-invalid={Boolean(errors.leaderUserId)} {...register('leaderUserId')}>
            <option value="">Selecione</option>
            {leaders.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}
          </select>
          {errors.leaderUserId ? <span className="field-error">{errors.leaderUserId.message}</span> : null}
        </div>
        <div className={fieldClass(errors.plannerUserId)}>
          <label htmlFor="workflow-start-planner">Gestor de Contrato *</label>
          <select id="workflow-start-planner" disabled={saving} aria-invalid={Boolean(errors.plannerUserId)} {...register('plannerUserId')}>
            <option value="">Selecione</option>
            {leaders.map(item => <option value={item.id} key={item.id}>{item.name}{item.email ? ` · ${item.email}` : ' · sem e-mail cadastrado'}</option>)}
          </select>
          {errors.plannerUserId ? <span className="field-error">{errors.plannerUserId.message}</span> : null}
        </div>
        <div className={fieldClass(errors.plannedMobilizationDate)}>
          <label htmlFor="workflow-start-date">Mobilização operacional prevista</label>
          <input id="workflow-start-date" type="date" disabled={saving} aria-invalid={Boolean(errors.plannedMobilizationDate)} {...register('plannedMobilizationDate', { setValueAs: value => value || undefined })} />
          <span className="field-hint">Opcional. Quando informada, ativa os marcos D-90, D-30 e de preparação.</span>
          {errors.plannedMobilizationDate ? <span className="field-error">{errors.plannedMobilizationDate.message}</span> : null}
        </div>
      </div>
      {hasFormValidationError ? <p className="inline-error" role="alert">Os dados do formulário mudaram desde que a página foi carregada. Atualize a página e tente novamente.</p> : null}
      <div className="project-workflow-inline-actions"><Button type="submit" disabled={saving || !detail.permissions.canInitialize}>{saving ? 'Iniciando…' : 'Iniciar handover'}</Button></div>
    </form>
  );
}

const HEADQUARTERS_CHANGES = [
  'Sem mobilização estimada, desmobilização, nem as etapas Pronto para mobilizar e Mobilização.',
  'Sem exames, treinamentos e liberações do cliente (cadastro, documentação e integração); permanece só a confirmação do atendimento.',
  'Sem hospedagem. Equipamentos, materiais e insumos, logística e QSMS ficam opcionais.',
  'Os marcos D-x contam a partir do início da execução previsto.'
];

function WorkflowLocationField({ workflow, saving, onPatch }: {
  workflow: ProjectWorkflow;
  saving: boolean;
  onPatch: (payload: ProjectWorkflowPatch) => void;
}) {
  const value = workflow.executedAtHeadquarters ?? null;
  const suggestion = workflow.headquartersSuggestion ?? null;
  // A resposta muda o fluxo: só pode mudar até o fim do Planejamento D-30 (o servidor também valida).
  const locked = !(PROJECT_WORKFLOW_HEADQUARTERS_EDITABLE_STAGES as readonly string[]).includes(workflow.stage);
  const select = (next: boolean) => {
    if (next !== value) onPatch({ action: 'analysis_location', version: workflow.version, executedAtHeadquarters: next });
  };
  return (
    <div className="project-workflow-analysis-contact project-workflow-analysis-criticality" data-project-workflow-location>
      <header>
        <div>
          <strong>Este projeto será executado na Sede?</strong>
          <p>{locked ? 'A resposta só pode ser alterada até o fim do Planejamento da mobilização.' : 'Em “Não”, o projeto segue o fluxo completo de campo. Essa resposta ajusta as etapas e as exigências do restante do fluxo.'}</p>
        </div>
        <ProjectWorkflowBooleanChoice value={value} label="Este projeto será executado na Sede?" disabled={saving || locked || !workflow.permissions.canEdit} onSelect={select} />
      </header>
      {value == null && suggestion != null ? <div className="project-workflow-analysis-criticality-fields">
        <small>A proposta comercial indica {suggestion ? 'execução na Sede (Pop/Sede)' : 'execução em campo (In loco)'}.</small>
        <Button type="button" variant="secondary" disabled={saving || locked || !workflow.permissions.canEdit} onClick={() => select(suggestion)}>Usar sugestão: {suggestion ? 'Sede' : 'Em campo'}</Button>
      </div> : null}
      {value === true ? <ul className="project-workflow-category-note">{HEADQUARTERS_CHANGES.map(item => <li key={item}>{item}</li>)}</ul> : null}
    </div>
  );
}

function WorkflowSettingsForm({ detail, leaders, saving, onPatch }: {
  detail: ProjectWorkflowDetail;
  leaders: WorkflowUserOption[];
  saving: boolean;
  onPatch: (payload: ProjectWorkflowPatch) => void;
}) {
  const workflow = detail.workflow!;
  const headquarters = workflow.executedAtHeadquarters === true;
  const schema = z.object({
    leaderUserId: z.string().min(1, 'Selecione o líder.'),
    plannerUserId: z.string().min(1, 'Selecione o gestor de contrato.'),
    plannedMobilizationDate: z.string()
  });
  type Values = z.infer<typeof schema>;
  const { register, handleSubmit, reset, formState: { errors, isDirty } } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { leaderUserId: workflow.leaderUserId, plannerUserId: workflow.plannerUserId || '', plannedMobilizationDate: workflow.plannedMobilizationDate || '' }
  });
  useEffect(() => reset({ leaderUserId: workflow.leaderUserId, plannerUserId: workflow.plannerUserId || '', plannedMobilizationDate: workflow.plannedMobilizationDate || '' }), [reset, workflow.leaderUserId, workflow.plannerUserId, workflow.plannedMobilizationDate]);
  return (
    <ProjectWorkflowCategory
      title="Responsáveis e cronograma"
      description="Defina o Líder de Projetos, o Gestor de Contrato, se o projeto é na Sede e a mobilização operacional prevista."
      area="Handover"
      status={workflow.executedAtHeadquarters == null ? 'Sede ou campo pendente' : workflow.plannerUserId ? 'Responsáveis definidos' : 'Gestor de Contrato pendente'}
      complete={Boolean(workflow.leaderUserId && workflow.plannerUserId) && workflow.executedAtHeadquarters != null}
      data-project-workflow-settings
    >
      <WorkflowLocationField workflow={workflow} saving={saving} onPatch={onPatch} />
      <form className="project-workflow-form" noValidate onSubmit={handleSubmit(values => onPatch({ action: 'settings', version: workflow.version, ...values, plannedMobilizationDate: values.plannedMobilizationDate || null }))}>
        <div className="project-workflow-form-grid">
          <div className={fieldClass(errors.leaderUserId)}>
            <label htmlFor="workflow-leader">Líder de Projetos *</label>
            <select id="workflow-leader" disabled={saving || !workflow.permissions.canChangeLeader} aria-invalid={Boolean(errors.leaderUserId)} {...register('leaderUserId')}>
              {leaders.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}
            </select>
            {errors.leaderUserId ? <span className="field-error">{errors.leaderUserId.message}</span> : null}
            {!workflow.permissions.canChangeLeader ? <span className="field-hint">Somente o gestor pode trocar o líder.</span> : null}
          </div>
          <div className={fieldClass(errors.plannerUserId)}>
            <label htmlFor="workflow-planner">Gestor de Contrato *</label>
            <select id="workflow-planner" disabled={saving || !workflow.permissions.canChangePlanner} aria-invalid={Boolean(errors.plannerUserId)} {...register('plannerUserId')}>
              <option value="">Selecione</option>
              {leaders.map(item => <option value={item.id} key={item.id}>{item.name}{item.email ? ` · ${item.email}` : ' · sem e-mail cadastrado'}</option>)}
            </select>
            {errors.plannerUserId ? <span className="field-error">{errors.plannerUserId.message}</span> : null}
            {!workflow.permissions.canChangePlanner ? <span className="field-hint">Somente o gestor do Efetivo pode trocar o Gestor de Contrato.</span> : null}
          </div>
          {headquarters ? null : <div className={fieldClass(errors.plannedMobilizationDate)}>
            <label htmlFor="workflow-date">Mobilização operacional prevista</label>
            <input id="workflow-date" type="date" disabled={saving || !workflow.permissions.canEdit} aria-invalid={Boolean(errors.plannedMobilizationDate)} {...register('plannedMobilizationDate')} />
            <span className="field-hint">Opcional e independente da previsão comercial recebida do CRM.</span>
            {errors.plannedMobilizationDate ? <span className="field-error">{errors.plannedMobilizationDate.message}</span> : null}
          </div>}
        </div>
        {workflow.permissions.canEdit ? <div className="project-workflow-inline-actions"><Button type="submit" variant="secondary" disabled={saving || !isDirty}>Salvar responsáveis e data</Button></div> : null}
      </form>
    </ProjectWorkflowCategory>
  );
}

function DemobilizationDatesForm({ workflow, project, mission, saving, onPatch }: {
  workflow: ProjectWorkflow;
  project: ProjectWorkflowDetail['project'];
  mission: ProjectOperationalMissionSummary | null | undefined;
  saving: boolean;
  onPatch: (payload: ProjectWorkflowPatch) => void;
}) {
  const schema = z.object({
    mobilizationDate: z.string().min(1, 'Informe a mobilização no cronograma.'),
    fieldCompletionDate: z.string(),
    returnDate: z.string()
  }).refine(value => !value.returnDate || value.mobilizationDate <= value.returnDate, {
    path: ['returnDate'],
    message: 'A desmobilização não pode ser anterior à mobilização.'
  }).refine(value => !value.fieldCompletionDate || !value.returnDate || value.fieldCompletionDate <= value.returnDate, {
    path: ['returnDate'],
    message: 'A desmobilização não pode ser anterior à conclusão de campo.'
  }).refine(value => !value.returnDate || !mission?.executionEndDate || value.returnDate >= mission.executionEndDate.slice(0, 10), {
    path: ['returnDate'],
    message: 'A desmobilização não pode ser anterior ao fim previsto da execução.'
  });
  type Values = z.infer<typeof schema>;
  const { register, handleSubmit, reset, formState: { errors, isDirty } } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      mobilizationDate: project.mobilizationDate || mission?.mobilizationDate || '',
      fieldCompletionDate: workflow.fieldCompletionDate || '',
      returnDate: workflow.demobilizationDate || mission?.returnDate || ''
    }
  });
  useEffect(() => reset({
    mobilizationDate: project.mobilizationDate || mission?.mobilizationDate || '',
    fieldCompletionDate: workflow.fieldCompletionDate || '',
    returnDate: workflow.demobilizationDate || mission?.returnDate || ''
  }), [mission?.mobilizationDate, mission?.returnDate, project.mobilizationDate, reset, workflow.demobilizationDate, workflow.fieldCompletionDate]);
  return (
    <form className="project-workflow-form" data-project-workflow-demobilization-dates noValidate onSubmit={handleSubmit(values => onPatch({
      action: 'demobilization',
      version: workflow.version,
      mobilizationDate: values.mobilizationDate,
      fieldCompletionDate: values.fieldCompletionDate || null,
      returnDate: values.returnDate || null
    }))}>
      <h4>Datas efetivas</h4>
      <div className="project-workflow-form-grid">
        <div className={fieldClass(errors.mobilizationDate)}>
          <label htmlFor="workflow-mobilization-date">Mobilização no cronograma *</label>
          <input id="workflow-mobilization-date" type="date" disabled={saving || !workflow.permissions.canEdit} aria-invalid={Boolean(errors.mobilizationDate)} {...register('mobilizationDate')} />
          <span className="field-hint">Usa inicialmente a data da programação oficial e mantém o cronograma do projeto sincronizado.</span>
          {errors.mobilizationDate ? <span className="field-error">{errors.mobilizationDate.message}</span> : null}
        </div>
        <div className={fieldClass(errors.fieldCompletionDate)}>
          <label htmlFor="workflow-field-completion-date">Conclusão do campo</label>
          <input id="workflow-field-completion-date" type="date" disabled={saving || !workflow.permissions.canEdit} aria-invalid={Boolean(errors.fieldCompletionDate)} {...register('fieldCompletionDate')} />
          <span className="field-hint">Quando o escopo de campo foi concluído.</span>
          {errors.fieldCompletionDate ? <span className="field-error">{errors.fieldCompletionDate.message}</span> : null}
        </div>
        <div className={fieldClass(errors.returnDate)}>
          <label htmlFor="workflow-return-date">Desmobilização efetiva</label>
          <input id="workflow-return-date" type="date" min={mission?.executionEndDate?.slice(0, 10)} disabled={saving || !workflow.permissions.canEdit} aria-invalid={Boolean(errors.returnDate)} {...register('returnDate')} />
          <span className="field-hint">Atualiza o retorno da missão e o cronograma do projeto.</span>
          {errors.returnDate ? <span className="field-error">{errors.returnDate.message}</span> : null}
        </div>
      </div>
      {workflow.permissions.canEdit ? <div className="project-workflow-inline-actions"><Button type="submit" variant="secondary" disabled={saving || !isDirty}>Salvar datas efetivas</Button></div> : null}
    </form>
  );
}

const CHECKLIST_STATES: Array<[ProjectWorkflowChecklistStatus, string]> = [
  ['PENDING', 'Pendente'],
  ['DONE', 'Concluído'],
  ['NOT_APPLICABLE', 'Não se aplica']
];

function ChecklistEditor({ item, version, saving, canEdit, onPatch }: {
  item: ProjectWorkflowChecklist;
  version: number;
  saving: boolean;
  canEdit: boolean;
  onPatch: (payload: ProjectWorkflowPatch) => void;
}) {
  const { register, handleSubmit, reset, watch, formState: { errors, isDirty } } = useForm<ChecklistValues>({
    resolver: zodResolver(checklistSchema),
    defaultValues: { status: item.status, note: item.note || '' }
  });
  useEffect(() => reset({ status: item.status, note: item.note || '' }), [item.note, item.status, reset]);
  const save = handleSubmit(values => onPatch({
      action: 'checklist', version, key: item.key, status: values.status as ProjectWorkflowChecklistStatus, note: values.note || null
    }));
  const statusField = register('status', { onChange: () => { queueMicrotask(() => void save()); } });
  const noteField = register('note');
  const status = watch('status');
  const note = watch('note');
  const notApplicable = status === 'NOT_APPLICABLE';
  const stateClass = status === 'DONE' ? 'is-done' : notApplicable ? 'is-not-applicable' : 'is-pending';
  return (
    <form className={`project-workflow-check-item ${stateClass}`} noValidate onSubmit={event => { event.preventDefault(); void save(); }}>
      <span>{item.label}</span>
      <div className="project-workflow-check-controls">
        <div className={`project-workflow-check-states${errors.status ? ' has-error' : ''}`} role="radiogroup" aria-label={`Situação de ${item.label}`}>
          {CHECKLIST_STATES.map(([value, label]) => (
            <label className={status === value ? 'is-selected' : undefined} key={value}>
              <input type="radio" value={value} disabled={saving || !canEdit} {...statusField} />
              <span>{label}</span>
            </label>
          ))}
        </div>
        <div className={fieldClass(errors.note)}>
          <label className={notApplicable ? 'project-workflow-check-note-label' : 'sr-only'} htmlFor={`workflow-note-${item.key}`}>{notApplicable ? 'Justificativa obrigatória' : 'Observação'}</label>
          <input
            id={`workflow-note-${item.key}`}
            className={notApplicable && !note?.trim() ? 'is-required-empty' : undefined}
            placeholder={notApplicable ? 'Por que este item não se aplica?' : 'Observação ou evidência'}
            disabled={saving || !canEdit}
            aria-required={notApplicable}
            aria-invalid={Boolean(errors.note)}
            {...noteField}
            onBlur={event => { noteField.onBlur(event); if (isDirty) void save(); }}
          />
          {errors.note ? <span className="field-error">{errors.note.message}</span> : null}
        </div>
        {canEdit ? <small className="project-workflow-autosave-label">Salvamento automático</small> : null}
      </div>
    </form>
  );
}

function WorkflowChecklistSection({ title, description, status, area, items, version, saving, onPatch, className = '' }: {
  title: string;
  description?: string;
  status?: ReactNode;
  area?: string;
  items: ProjectWorkflowChecklist[];
  version: number;
  saving: boolean;
  onPatch: (payload: ProjectWorkflowPatch) => void;
  className?: string;
}) {
  const completed = items.filter(item => item.status !== 'PENDING').length;
  const complete = items.length > 0 && completed === items.length;
  return (
    <ProjectWorkflowCategory title={title} description={description} area={area} progress={{ completed, total: items.length }} status={status ?? sectionStatusLabel(completed, items.length)} complete={complete} className={className}>
      {items.map(item => <ChecklistEditor item={item} version={version} saving={saving} canEdit={item.canEdit} onPatch={onPatch} key={item.key} />)}
    </ProjectWorkflowCategory>
  );
}

function MobilizationGate({ workflow }: { workflow: ProjectWorkflow }) {
  const authorization = workflow.mobilizationAuthorization;
  // Sem "Pronto para mobilizar": não há mais autorização manual, para ninguém — o gate liberado já dá acesso
  // a equipe no Efetivo, romaneios de saída e retiradas do Estoque, reavaliado a cada consulta.
  const headquarters = workflow.executedAtHeadquarters === true;
  const statusLabel = workflow.mobilizationGate.ready
    ? (headquarters ? 'Liberado para iniciar a execução' : 'Liberado para mobilizar')
    : `${workflow.mobilizationGate.blockers.length} bloqueio(s)`;
  return (
    <ProjectWorkflowCategory
      title={headquarters ? 'Gate de execução' : 'Gate de mobilização'}
      description={headquarters ? 'As frentes obrigatórias e o pré-job precisam estar liberados para iniciar a execução na Sede.' : 'As frentes obrigatórias e o pré-job precisam estar liberados para mobilizar ou seguir em execução.'}
      area="Liberação"
      group="Liberação"
      progress={{
        completed: workflow.mobilizationGate.fronts.filter(front => front.status === 'READY').length + (workflow.mobilizationGate.preJob.status === 'READY' ? 1 : 0),
        total: workflow.mobilizationGate.fronts.length + 1
      }}
      status={statusLabel}
      tone={workflow.mobilizationGate.ready ? 'ok' : 'crit'}
      complete={authorization.authorized}
      className={`project-workflow-gate-panel is-${authorization.status.toLowerCase()}`}
      data-project-workflow-gate
    >
      <p className="project-workflow-category-note">{headquarters ? 'Projeto executado na Sede: não há mobilização em campo. Equipamentos, materiais, logística e QSMS são opcionais.' : 'Em projetos com gestão iniciada, o gate liberado dá acesso a equipe no Efetivo, romaneios de saída e retiradas do Estoque.'}</p>
      <div className="project-workflow-gate-table" role="table" aria-label="Prontidão para mobilização">
        <div className="project-workflow-gate-table-head" role="row"><span role="columnheader">Frente</span><span role="columnheader">Situação</span><span role="columnheader">Progresso</span></div>
        {workflow.mobilizationGate.fronts.map(front => <div className="project-workflow-gate-row" role="row" key={front.key}><strong role="cell">{front.label}</strong><span role="cell" className={front.status === 'READY' ? 'is-ready' : 'is-blocked'}>{front.status === 'READY' ? '🟢 Liberada' : '🔴 Pendente'}{front.optional ? ' · opcional' : ''}</span><span role="cell">{front.completed}/{front.total}</span></div>)}
      </div>
      <div className={`project-workflow-pre-job-status is-${workflow.mobilizationGate.preJob.status.toLowerCase()}`}><strong>Pré-job</strong><span>{workflow.mobilizationGate.preJob.status === 'READY' ? '🟢 Realizado' : `🔴 ${workflow.mobilizationGate.preJob.completed}/${workflow.mobilizationGate.preJob.total}`}</span></div>
      {workflow.mobilizationGate.blockers.length ? <details><summary>{workflow.mobilizationGate.blockers.length} bloqueio(s) para {headquarters ? 'iniciar a execução' : 'mobilizar'}</summary><ul>{workflow.mobilizationGate.blockers.slice(0, 12).map((item, index) => <li key={`${item.front}-${item.key}-${index}`}>{item.label}: {item.reason}</li>)}</ul>{workflow.mobilizationGate.blockers.length > 12 ? <p>Existem mais {workflow.mobilizationGate.blockers.length - 12} bloqueio(s).</p> : null}</details> : null}
    </ProjectWorkflowCategory>
  );
}

function transitionLabel(current: ProjectWorkflow['stage'], target: ProjectWorkflow['stage'], preparationLeadTimeDays = 15) {
  if (current === 'FINISHED' && target === 'FINAL_MEASUREMENT') return 'Reabrir em documentação e medição';
  if (current === 'EXECUTION' && target === 'MOBILIZATION') return 'Voltar para mobilização';
  if (current === 'DEMOBILIZATION' && target === 'EXECUTION') return 'Voltar para execução';
  if (current === 'POST_JOB' && target === 'EXECUTION') return 'Voltar para execução';
  if (current === 'EXECUTION' && target === 'PREPARATION') return 'Voltar para preparação';
  if (current === 'POST_JOB' && target === 'DEMOBILIZATION') return 'Voltar para desmobilização';
  if (current === 'FINAL_MEASUREMENT' && target === 'POST_JOB') return 'Voltar para pós-job';
  if (target === 'FINAL_MEASUREMENT') return 'Iniciar documentação e medição';
  if (target === 'FINISHED') return 'Encerrar projeto';
  if (target === 'POST_JOB') return 'Iniciar pós-job';
  if (target === 'DEMOBILIZATION') return 'Iniciar desmobilização';
  if (target === 'MOBILIZATION') return 'Iniciar mobilização';
  if (target === 'EXECUTION') return 'Iniciar execução';
  if (target === 'PREPARATION') return ['MOBILIZATION', 'EXECUTION'].includes(current) ? 'Voltar para preparação' : `Iniciar preparação D-${preparationLeadTimeDays}`;
  if (target === 'MOBILIZATION_PLANNING') return current === 'PREPARATION' ? 'Voltar ao planejamento' : 'Iniciar planejamento';
  if (target === 'WAITING_PLANNING') return 'Aguardar planejamento';
  return 'Voltar para análise';
}

function ReopenProjectForm({ workflow, saving, onPatch }: {
  workflow: ProjectWorkflow;
  saving: boolean;
  onPatch: (payload: ProjectWorkflowPatch) => void;
}) {
  const { register, handleSubmit, formState: { errors, isDirty } } = useForm<ReopenValues>({
    resolver: zodResolver(reopenSchema),
    defaultValues: { reason: '' }
  });
  return (
    <ProjectWorkflowCategory
      title="Reabrir projeto"
      description="A obra voltará para Documentação / medição e a justificativa ficará registrada no histórico."
      area="Encerramento"
      status="Justificativa obrigatória"
      className="project-workflow-reopen"
      data-project-workflow-reopen
    >
      <form noValidate onSubmit={handleSubmit(values => onPatch({
        action: 'stage', version: workflow.version, stage: 'FINAL_MEASUREMENT', reason: values.reason
      }))}>
        <div className={fieldClass(errors.reason)}>
          <label htmlFor="project-workflow-reopen-reason">Motivo da reabertura *</label>
          <textarea id="project-workflow-reopen-reason" rows={3} disabled={saving} aria-invalid={Boolean(errors.reason)} {...register('reason')} />
          {errors.reason ? <span className="field-error">{errors.reason.message}</span> : null}
        </div>
        <div className="project-workflow-inline-actions"><Button type="submit" disabled={saving || !isDirty}>Reabrir projeto</Button></div>
      </form>
    </ProjectWorkflowCategory>
  );
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// "Sim" só pré-preenche o e-mail avisado com o padrão cadastrado na Administração (sem solicitar nem avisar
// sozinho); quem dispara a solicitação e o aviso é o botão "Solicitar cadastro", sempre para o e-mail que
// estiver no campo naquele momento — o padrão pré-preenchido ou outro digitado na hora. Editar o e-mail depois
// de já solicitado reenvia o aviso do mesmo jeito. "Concluído" só existe depois de solicitado.
function ClientRegistrationCriticalItem({ workflow, item, saving, onPatch }: {
  workflow: ProjectWorkflow;
  item: ProjectWorkflow['criticalAnswers'][number];
  saving: boolean;
  onPatch: (payload: ProjectWorkflowPatch) => void;
}) {
  const release = workflow.clientReleases.customerRegistration;
  const [email, setEmail] = useState(release.email || '');
  const [confirmingDefault, setConfirmingDefault] = useState(false);
  useEffect(() => { setEmail(release.email || ''); setConfirmingDefault(false); }, [release.email]);
  const disabled = saving || !workflow.permissions.canEdit;
  const releaseDisabled = saving || !release.canEdit;
  const trimmedEmail = email.trim();
  const emailInvalid = trimmedEmail !== '' && !EMAIL_PATTERN.test(trimmedEmail);
  const emailChanged = trimmedEmail !== (release.email || '') && trimmedEmail !== '' && !emailInvalid;

  const patchRelease = (fields: Partial<{ requested: boolean; requestedAt: string | null; completed: boolean; completedAt: string | null; notificationEmail: string; makeDefaultEmail: boolean }>) => {
    onPatch({
      action: 'client_release',
      version: workflow.version,
      key: 'CUSTOMER_REGISTRATION',
      requested: release.requested,
      requestedAt: release.requestedAt,
      completed: release.completed,
      completedAt: release.completedAt,
      ...fields
    });
  };
  const sendRequest = (makeDefaultEmail?: boolean) => {
    patchRelease({
      requested: true,
      requestedAt: release.requestedAt || todayDateOnly(),
      notificationEmail: trimmedEmail,
      ...(makeDefaultEmail !== undefined ? { makeDefaultEmail } : {})
    });
    setConfirmingDefault(false);
  };
  const handleSendClick = () => { if (emailChanged) setConfirmingDefault(true); else sendRequest(); };
  const toggleCompleted = () => {
    const completed = !release.completed;
    patchRelease({ completed, completedAt: completed ? release.completedAt || todayDateOnly() : null });
  };

  return (
    <article className="project-workflow-critical project-workflow-critical-registration">
      <span>{item.label}</span>
      <ProjectWorkflowBooleanChoice value={item.answer} label={item.label} disabled={disabled} onSelect={answer => { if (item.answer !== answer) onPatch({ action: 'critical', version: workflow.version, key: item.key, answer }); }} />
      {item.answer ? (
        <div className="project-workflow-client-registration-fields">
          {release.requested ? <p className="project-workflow-category-note">Solicitado{release.requestedAt ? ` em ${displayDateOnly(release.requestedAt)}` : ''}.</p> : null}
          <div className={`field-group ${emailInvalid ? 'field-invalid' : ''}`}>
            <label htmlFor="client-registration-email">E-mail avisado</label>
            <input id="client-registration-email" type="email" value={email} disabled={releaseDisabled} aria-invalid={emailInvalid} placeholder="nome@filtrovali.com.br" onChange={event => { setEmail(event.target.value); setConfirmingDefault(false); }} />
            {emailInvalid ? <span className="field-error">Informe um e-mail válido.</span> : null}
          </div>
          {release.requested && !release.email ? <p className="project-workflow-category-note is-warning">Nenhum e-mail de aviso configurado: ninguém foi notificado. Informe um e-mail acima.</p> : null}
          {confirmingDefault ? (
            <div className="project-workflow-client-registration-confirm">
              <span>Usar este e-mail como padrão para os próximos projetos?</span>
              <Button type="button" variant="mini" disabled={releaseDisabled} onClick={() => sendRequest(true)}>Sim, usar como padrão</Button>
              <Button type="button" variant="mini" disabled={releaseDisabled} onClick={() => sendRequest(false)}>Não, só este projeto</Button>
            </div>
          ) : (
            <div className="project-workflow-registration-actions">
              {!release.requested
                ? <Button type="button" variant="secondary" disabled={releaseDisabled || !trimmedEmail || emailInvalid} onClick={handleSendClick}>Solicitar cadastro</Button>
                : emailChanged
                  ? <Button type="button" variant="mini" disabled={releaseDisabled} onClick={handleSendClick}>Salvar e-mail</Button>
                  : null}
              {release.requested ? (
                <Button
                  type="button"
                  variant="secondary"
                  className={`project-workflow-registration-complete-button${release.completed ? ' is-active' : ''}`}
                  disabled={releaseDisabled}
                  onClick={toggleCompleted}
                >
                  {release.completed ? <ProjectWorkflowIcon name="check" /> : null}
                  {release.completed ? `Concluído em ${displayDateOnly(release.completedAt)}` : 'Marcar como concluído'}
                </Button>
              ) : null}
            </div>
          )}
        </div>
      ) : null}
    </article>
  );
}

function IssueEditor({ issue, version, saving, canEdit, onPatch }: {
  issue: ProjectWorkflowIssue;
  version: number;
  saving: boolean;
  canEdit: boolean;
  onPatch: (payload: ProjectWorkflowPatch) => void;
}) {
  const { register, handleSubmit, reset, formState: { errors, isDirty } } = useForm<IssueValues>({
    resolver: zodResolver(issueSchema),
    defaultValues: { description: issue.description, requiredLeadTimeDays: issue.requiredLeadTimeDays ? String(issue.requiredLeadTimeDays) : '', dueDate: issue.dueDate || '', criticality: issue.criticality, status: issue.status }
  });
  useEffect(() => reset({ description: issue.description, requiredLeadTimeDays: issue.requiredLeadTimeDays ? String(issue.requiredLeadTimeDays) : '', dueDate: issue.dueDate || '', criticality: issue.criticality, status: issue.status }), [issue, reset]);
  return (
    <form className={`project-workflow-issue ${issue.overdue ? 'is-overdue' : ''}`} noValidate onSubmit={handleSubmit(values => onPatch({ action: 'issue', version, issueId: issue.id, ...values, ownerName: null, requiredLeadTimeDays: Number(values.requiredLeadTimeDays) }))}>
      <div className={fieldClass(errors.description)}><label htmlFor={`issue-description-${issue.id}`}>Pendência *</label><input id={`issue-description-${issue.id}`} disabled={saving || !canEdit} aria-invalid={Boolean(errors.description)} {...register('description')} />{errors.description ? <span className="field-error">{errors.description.message}</span> : null}</div>
      <div className="project-workflow-form-grid compact">
        <div className={fieldClass(errors.requiredLeadTimeDays)}><label htmlFor={`issue-lead-time-${issue.id}`}>Prazo necessário (dias) *</label><input id={`issue-lead-time-${issue.id}`} type="number" min="1" max="3650" disabled={saving || !canEdit} aria-invalid={Boolean(errors.requiredLeadTimeDays)} {...register('requiredLeadTimeDays')} />{errors.requiredLeadTimeDays ? <span className="field-error">{errors.requiredLeadTimeDays.message}</span> : null}</div>
        <div className={fieldClass(errors.dueDate)}><label htmlFor={`issue-date-${issue.id}`}>Data limite *</label><input id={`issue-date-${issue.id}`} type="date" disabled={saving || !canEdit} aria-invalid={Boolean(errors.dueDate)} {...register('dueDate')} />{errors.dueDate ? <span className="field-error">{errors.dueDate.message}</span> : null}</div>
        <div className="field-group"><label htmlFor={`issue-criticality-${issue.id}`}>Criticidade</label><select id={`issue-criticality-${issue.id}`} disabled={saving || !canEdit} {...register('criticality')}><option value="HIGH">Alta</option><option value="MEDIUM">Média</option><option value="LOW">Baixa</option></select></div>
        <div className="field-group"><label htmlFor={`issue-status-${issue.id}`}>Situação</label><select id={`issue-status-${issue.id}`} disabled={saving || !canEdit} {...register('status')}><option value="OPEN">Aberta</option><option value="IN_PROGRESS">Em andamento</option><option value="RESOLVED">Resolvida</option></select></div>
      </div>
      {issue.overdue ? <strong className="project-workflow-overdue">Prazo vencido</strong> : null}
      {canEdit ? <div className="project-workflow-inline-actions"><Button type="submit" variant="mini" disabled={saving || !isDirty}>Salvar pendência</Button></div> : null}
    </form>
  );
}

const STAGE_SECTION_GROUPS: Record<ProjectWorkflowStage, string> = {
  HANDOVER: 'Handover',
  INITIAL_ANALYSIS: 'Análise',
  WAITING_PLANNING: 'Acompanhamento',
  MOBILIZATION_PLANNING: 'Frentes do D-30',
  PREPARATION: 'Frentes de preparação',
  MOBILIZATION: 'Frentes de preparação',
  EXECUTION: 'Execução',
  DEMOBILIZATION: 'Desmobilização',
  POST_JOB: 'Pós-job',
  FINAL_MEASUREMENT: 'Documentação e medição',
  FINISHED: 'Encerramento'
};

const READINESS_RING_RADIUS = 21;
const READINESS_RING_LENGTH = 2 * Math.PI * READINESS_RING_RADIUS;

function WorkflowStagePanel({ detail, leaders, workflow, activeStage, saving, correctionMode, documents, onPatch, onOpenTeamProgramming, onShowBlockers }: {
  detail: ProjectWorkflowDetail;
  leaders: WorkflowUserOption[];
  workflow: ProjectWorkflow;
  activeStage: ProjectWorkflowStage;
  saving: boolean;
  correctionMode: boolean;
  documents: Awaited<ReturnType<typeof listProjectDocuments>>['documents'];
  onPatch: (payload: ProjectWorkflowPatch) => void;
  onOpenTeamProgramming: () => void;
  onShowBlockers: () => void;
}) {
  const activeStageIndex = WORKFLOW_STAGES.indexOf(activeStage);
  const currentStageIndex = WORKFLOW_STAGES.indexOf(workflow.stage);
  const isFutureStage = activeStageIndex > currentStageIndex;
  const isCurrentStage = activeStage === workflow.stage;
  const stageSaving = saving || (!isCurrentStage && !correctionMode);
  const stagePatch = (payload: ProjectWorkflowPatch) => onPatch(correctionMode ? { ...payload, correctionStage: activeStage } : payload);
  const initialTeam = detail.project.operationalMission || null;
  const mainRef = useRef<HTMLDivElement>(null);
  const { sections, Provider: StageSectionProvider } = useStageSectionRegistry();
  const { marker, readiness } = stageHeadingReadiness(workflow, activeStage);
  const demobilizationSections = [
    ['DEMOBILIZATION_FIELD', 'Conclusão de campo', 'Operações'],
    ['DEMOBILIZATION_LOGISTICS', 'Logística de retorno', 'Logística'],
    ['DEMOBILIZATION_ASSETS', 'Retorno de ativos', 'Ativos']
  ] as const;
  const postJobSections = [
    ['POST_JOB_FEEDBACK', 'Reunião e feedbacks', 'Operações'],
    ['POST_JOB_LEARNING', 'Aprendizados e melhorias', 'Qualidade']
  ] as const;
  const closeoutSections = [
    ['CLOSEOUT_DOCUMENTATION', 'Documentação', 'Administrativo'],
    ['CLOSEOUT_MEASUREMENT', 'Medição', 'Comercial']
  ] as const;
  const finalCloseoutChecklists = workflow.checklists.filter(item => item.section === 'FINAL_CLOSEOUT');
  // Pendências de recursos (mudança de data) aparecem nas etapas de planejamento e preparação, não na análise.
  const analysisIssues = workflow.issues.filter(item => !isResourceConflictIssue(item));
  const openIssues = analysisIssues.filter(item => item.status !== 'RESOLVED');
  const answeredCriticals = workflow.criticalAnswers.filter(item => item.answer !== null).length;

  const renderCriticalItems = () => (
    <ProjectWorkflowCategory
      title="Itens críticos"
      description="Respostas que definem se a obra entra no fluxo crítico."
      area="Análise"
      progress={{ completed: answeredCriticals, total: workflow.criticalAnswers.length }}
      status={sectionStatusLabel(answeredCriticals, workflow.criticalAnswers.length)}
      complete={workflow.criticalAnswers.every(item => item.answer !== null)}
    >
      {workflow.criticalAnswers.map(item => item.key === 'CLIENT_REGISTRATION'
        ? <ClientRegistrationCriticalItem workflow={workflow} item={item} saving={stageSaving} onPatch={stagePatch} key={item.key} />
        : <article className="project-workflow-critical" key={item.key}><span>{item.label}</span><ProjectWorkflowBooleanChoice value={item.answer} label={item.label} disabled={stageSaving || !workflow.permissions.canEdit} onSelect={answer => { if (item.answer !== answer) stagePatch({ action: 'critical', version: workflow.version, key: item.key, answer }); }} /></article>)}
    </ProjectWorkflowCategory>
  );
  const renderAnalysisMonitoring = () => (
    <>
      <ProjectWorkflowDocumentationTracking workflow={workflow} saving={stageSaving} onPatch={stagePatch} />
      {renderCriticalItems()}
      {analysisIssues.length ? <ProjectWorkflowCategory
        title="Pendências"
        description="Itens levantados na análise que precisam ser resolvidos antes da mobilização."
        area="Análise"
        progress={{ completed: analysisIssues.length - openIssues.length, total: analysisIssues.length }}
        status={openIssues.length ? `${openIssues.length} aberta${openIssues.length === 1 ? '' : 's'}` : 'Concluído'}
        tone={openIssues.length ? 'crit' : 'ok'}
        complete={!openIssues.length}
      >{analysisIssues.map(issue => <IssueEditor issue={issue} version={workflow.version} saving={stageSaving} canEdit={workflow.permissions.canEdit} onPatch={stagePatch} key={issue.id} />)}</ProjectWorkflowCategory> : null}
    </>
  );
  const renderPreparation = () => (
    <>
      <ProjectWorkflowResourceConflicts workflow={workflow} saving={stageSaving} onPatch={stagePatch} />
      <ProjectWorkflowDefinitiveTeam workflow={workflow} saving={stageSaving} onPatch={stagePatch} onOpenTeamProgramming={onOpenTeamProgramming} />
      <ProjectWorkflowClientReleasesPanel workflow={workflow} saving={stageSaving} onPatch={stagePatch} />
      <ProjectWorkflowEquipmentPreparation workflow={workflow} saving={stageSaving} onPatch={stagePatch} />
      <ProjectWorkflowMaterialsPreparation workflow={workflow} saving={stageSaving} onPatch={stagePatch} />
      <ProjectWorkflowPreJobPanel workflow={workflow} saving={stageSaving} onPatch={stagePatch} />
      <ProjectWorkflowTravelPanel workflow={workflow} saving={stageSaving} onPatch={stagePatch} />
      <ProjectWorkflowQsmsPanel workflow={workflow} saving={stageSaving} onPatch={stagePatch} />
      <MobilizationGate workflow={workflow} />
    </>
  );
  const renderPostJob = () => (
    <>
      <ProjectWorkflowCategory
        title="Pós-job / fechamento técnico"
        description="Registre a experiência da obra e alimente a base histórica da Filtrovali."
        area="Operações"
        progress={workflow.postJobReadiness}
        status={sectionStatusLabel(workflow.postJobReadiness.completed, workflow.postJobReadiness.total)}
        complete={workflow.postJobReadiness.percentage === 100}
      >
        <ProjectPostJobPanel workflow={workflow} saving={stageSaving} onPatch={stagePatch} />
      </ProjectWorkflowCategory>
      <div className="project-workflow-planning-grid">{postJobSections.map(([section, title, area]) => <WorkflowChecklistSection title={title} area={area} items={workflow.checklists.filter(item => item.section === section)} version={workflow.version} saving={stageSaving} onPatch={stagePatch} key={section} />)}</div>
    </>
  );
  const renderCloseout = () => (
    <>
      <ProjectWorkflowCategory
        title="Documentação / medição"
        description="Consolide os documentos técnicos, a medição e os valores de fechamento da obra."
        area="Administrativo"
        progress={workflow.closeoutReadiness}
        status={sectionStatusLabel(workflow.closeoutReadiness.completed, workflow.closeoutReadiness.total)}
        complete={workflow.closeoutReadiness.percentage === 100}
      >
        <ProjectCloseoutPanel workflow={workflow} saving={stageSaving} onPatch={stagePatch} />
      </ProjectWorkflowCategory>
      <div className="project-workflow-planning-grid">{closeoutSections.map(([section, title, area]) => <WorkflowChecklistSection title={title} area={area} items={workflow.checklists.filter(item => item.section === section)} version={workflow.version} saving={stageSaving} onPatch={stagePatch} key={section} />)}</div>
      <ProjectWorkflowCategory
        title="Gate de encerramento"
        description="Valida escopo, documentos, medição, pós-job, ativos e pendências antes de encerrar."
        area="Encerramento"
        group="Liberação"
        status={workflow.closureGate.ready ? 'Pronto para encerrar' : `${workflow.closureGate.blockers.length} bloqueio(s)`}
        tone={workflow.closureGate.ready ? 'ok' : 'crit'}
        complete={workflow.closureGate.ready}
        className={`project-workflow-closure-gate ${workflow.closureGate.ready ? 'is-ready' : 'is-blocked'}`}
        data-project-workflow-closure-gate
      >
        <WorkflowChecklistSection title="Checklist final de encerramento" area="Encerramento" items={finalCloseoutChecklists} version={workflow.version} saving={stageSaving} onPatch={stagePatch} />
        {workflow.closureGate.blockers.length ? <details open><summary>Motivos do bloqueio</summary><ul>{workflow.closureGate.blockers.map(item => <li key={item.key}><strong>{item.label}:</strong> {item.reason}</li>)}</ul></details> : <p className="project-workflow-category-note">Todos os requisitos foram concluídos. O Líder ou gestor pode encerrar o projeto.</p>}
      </ProjectWorkflowCategory>
    </>
  );

  let stageContent: ReactNode;
  if (isFutureStage) {
    stageContent = <section className="project-workflow-stage-empty"><ProjectWorkflowIcon name="lock" /><strong>Esta etapa ainda não foi iniciada.</strong><p>Conclua a etapa atual para liberar os controles de {WORKFLOW_STAGE_LABELS[activeStage].toLocaleLowerCase('pt-BR')}.</p></section>;
  } else if (activeStage === 'HANDOVER') {
    stageContent = <><WorkflowSettingsForm detail={detail} leaders={leaders} saving={stageSaving} onPatch={stagePatch} /><ProjectWorkflowCommercialSignals workflow={workflow} /><ProjectDocumentsCategory projectId={workflow.projectId} users={leaders} /><ProjectWorkflowHandoverSignals detail={detail} documents={documents} /></>;
  } else if (activeStage === 'INITIAL_ANALYSIS') {
    stageContent = <><ProjectWorkflowInitialAnalysisData workflow={workflow} saving={stageSaving} onPatch={stagePatch} /><WorkflowChecklistSection title="Entendimento da análise inicial" area="Análise" items={workflow.checklists.filter(item => item.section === 'INITIAL_ANALYSIS')} version={workflow.version} saving={stageSaving} onPatch={stagePatch} />{renderAnalysisMonitoring()}<ProjectWorkflowCriticalityDecision workflow={workflow} saving={stageSaving} onPatch={stagePatch} /></>;
  } else if (activeStage === 'WAITING_PLANNING') {
    stageContent = <>{renderAnalysisMonitoring()}</>;
  } else if (activeStage === 'MOBILIZATION_PLANNING') {
    stageContent = <><ProjectWorkflowResourceConflicts workflow={workflow} saving={stageSaving} onPatch={stagePatch} /><ProjectWorkflowTeamPlanningCard workflow={workflow} saving={stageSaving} onPatch={stagePatch} /><ProjectWorkflowEquipmentPlanningCard workflow={workflow} saving={stageSaving} onPatch={stagePatch} /><ProjectWorkflowSupplyPlanningCard workflow={workflow} saving={stageSaving} onPatch={stagePatch} /><ProjectWorkflowLogisticsPlanningCard workflow={workflow} saving={stageSaving} onPatch={stagePatch} /></>;
  } else if (activeStage === 'PREPARATION' || activeStage === 'MOBILIZATION') {
    // Sem "Pronto para mobilizar": a Mobilização mostra as mesmas frentes da Preparação até o projeto avançar.
    stageContent = renderPreparation();
  } else if (activeStage === 'EXECUTION') {
    stageContent = <><MobilizationGate workflow={workflow} /><ProjectWorkflowCategory title="Dashboard de execução" description="Avanço, RDOs, relatórios técnicos e desvios da obra." area="Execução" status={isCurrentStage ? 'Acompanhamento ativo' : 'Etapa concluída'}><ProjectExecutionDashboard projectId={workflow.projectId} readOnly={!isCurrentStage} /></ProjectWorkflowCategory>{isCurrentStage && canManageProjectTeamCycles(workflow.stage) && initialTeam ? <Button type="button" variant="mini" className="project-workflow-planning-link" onClick={onOpenTeamProgramming}>Equipe e ciclos</Button> : null}</>;
  } else if (activeStage === 'DEMOBILIZATION') {
    stageContent = <><ProjectWorkflowCategory
      title="Datas da desmobilização"
      description="Conclusão do campo, retorno da equipe e entrega dos ativos."
      area="Operações"
      status={workflow.fieldCompletionDate && workflow.demobilizationDate ? 'Concluído' : 'Datas pendentes'}
      complete={Boolean(workflow.fieldCompletionDate && workflow.demobilizationDate)}
    ><DemobilizationDatesForm workflow={workflow} project={detail.project} mission={detail.project.operationalMission} saving={stageSaving} onPatch={stagePatch} /></ProjectWorkflowCategory><div className="project-workflow-planning-grid">{demobilizationSections.map(([section, title, area]) => <WorkflowChecklistSection title={title} area={area} items={workflow.checklists.filter(item => item.section === section)} version={workflow.version} saving={stageSaving} onPatch={stagePatch} key={section} />)}</div></>;
  } else if (activeStage === 'POST_JOB') {
    stageContent = renderPostJob();
  } else if (activeStage === 'FINAL_MEASUREMENT') {
    stageContent = renderCloseout();
  } else {
    stageContent = <>{renderPostJob()}{renderCloseout()}{workflow.permissions.canReopen ? <ReopenProjectForm workflow={workflow} saving={saving} onPatch={stagePatch} /> : null}</>;
  }

  const gateBlockers = ['PREPARATION', 'MOBILIZATION', 'EXECUTION'].includes(activeStage)
    ? workflow.mobilizationGate.blockers
    : activeStage === 'FINAL_MEASUREMENT' ? workflow.closureGate.blockers : [];
  const railGate = isCurrentStage && workflow.stage !== 'FINISHED' && gateBlockers.length
    ? {
        title: `${gateBlockers.length} bloqueio${gateBlockers.length === 1 ? '' : 's'} para ${activeStage === 'FINAL_MEASUREMENT' ? 'encerrar' : 'mobilizar'}`,
        items: [...new Set(gateBlockers.map(item => item.label))].slice(0, 6)
      }
    : null;
  const readinessTone = readiness ? readiness.percentage === 100 ? 'is-ok' : readiness.completed > 0 ? 'is-warn' : 'is-idle' : '';
  const deadlineAlert = isCurrentStage && workflow.stage !== 'FINISHED'
    ? workflow.mobilizationGate.deadlineStatus === 'RISK'
      ? { tone: 'is-crit', title: 'Risco de mobilização.', text: `D-1 atingido com ${workflow.mobilizationGate.blockers.length} bloqueio(s).` }
      : workflow.mobilizationGate.deadlineStatus === 'ATTENTION'
        ? { tone: 'is-warn', title: 'D-7 atingido.', text: `${workflow.mobilizationGate.blockers.length} bloqueio(s) ainda precisam ser resolvidos.` }
        : workflow.milestones.dueMilestones.length
          ? { tone: 'is-warn', title: 'Atenção aos prazos.', text: `${workflow.milestones.dueMilestones.map(key => key.replace('D', 'D-')).join(' · ')} já atingido(s); execute agora as verificações pendentes.` }
          : null
    : null;

  return (
    <section className="project-workflow-stage-panel" id={stagePanelId(activeStage)} role="tabpanel" aria-labelledby={stageTabId(activeStage)} tabIndex={0}>
      <StageSectionProvider>
        <ProjectWorkflowStageRail sections={sections} scrollRef={mainRef} blockers={railGate} defaultGroup={STAGE_SECTION_GROUPS[activeStage]} />
        <div className="project-workflow-stage-main" ref={mainRef}>
          <header
            className="project-workflow-stage-heading"
            data-project-workflow-d30={activeStage === 'MOBILIZATION_PLANNING' || undefined}
            data-project-workflow-d15={activeStage === 'PREPARATION' || activeStage === 'MOBILIZATION' || undefined}
            data-project-workflow-demobilization={activeStage === 'DEMOBILIZATION' || undefined}
            data-project-workflow-post-job={activeStage === 'POST_JOB' || undefined}
            data-project-workflow-closeout={activeStage === 'FINAL_MEASUREMENT' || undefined}
          >
            <div>
              <span>{isCurrentStage ? 'Etapa atual' : isFutureStage ? 'Próxima etapa · ainda não iniciada' : 'Etapa anterior · consulta'} · {activeStageIndex + 1} de {WORKFLOW_STAGES.length}</span>
              <h4>{WORKFLOW_STAGE_LABELS[activeStage]}{marker ? <em className="project-workflow-stage-marker">{marker}</em> : null}</h4>
              <p>{WORKFLOW_STAGE_DESCRIPTIONS[activeStage]}</p>
            </div>
            {readiness && !isFutureStage ? <div className={`project-workflow-stage-readiness ${readinessTone}`}>
              <span className="project-workflow-stage-readiness-ring">
                <svg viewBox="0 0 52 52" aria-hidden="true">
                  <circle className="is-track" cx="26" cy="26" r={READINESS_RING_RADIUS} />
                  <circle className="is-value" cx="26" cy="26" r={READINESS_RING_RADIUS} strokeDasharray={READINESS_RING_LENGTH} strokeDashoffset={READINESS_RING_LENGTH * (1 - readiness.percentage / 100)} />
                </svg>
                <b>{readiness.percentage}%</b>
              </span>
              <span><strong>{readiness.completed} de {readiness.total}</strong><small>itens concluídos</small></span>
            </div> : null}
          </header>
          {isCurrentStage && workflow.stage === 'FINISHED' ? <section className="project-workflow-callout is-ok" data-project-workflow-closed><ProjectWorkflowIcon name="flag" /><p><strong>Missão encerrada.</strong> {workflow.closedAt ? `Encerrada em ${new Date(workflow.closedAt).toLocaleString('pt-BR')}` : 'Encerramento registrado'}{workflow.closedBy ? ` por ${workflow.closedBy.name}` : ''}.</p></section> : null}
          {activeStage === 'WAITING_PLANNING' && !isFutureStage ? <section className="project-workflow-callout is-info"><ProjectWorkflowIcon name="clock" /><p><strong>Aguardando D-30.</strong> A análise foi concluída{workflow.milestones.d30Date ? `; o planejamento abre em ${displayDateOnly(workflow.milestones.d30Date)}` : ''}. Itens críticos e documentação seguem monitorados aqui.</p></section> : null}
          {deadlineAlert ? <section className={`project-workflow-callout ${deadlineAlert.tone}`} role="status"><ProjectWorkflowIcon name="alert" /><p><strong>{deadlineAlert.title}</strong> {deadlineAlert.text}</p>{gateBlockers.length ? <Button type="button" variant="secondary" className="is-small" onClick={onShowBlockers}>Ver bloqueios</Button> : null}</section> : null}
          {stageContent}
        </div>
      </StageSectionProvider>
    </section>
  );
}

// "dd/mm" de uma data-chave (AAAA-MM-DD) sem passar por fuso, ou de um instante ISO no fuso local.
function shortDate(value: string) {
  const key = /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
  if (key) return `${key.slice(8, 10)}/${key.slice(5, 7)}`;
  return new Date(value).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

type StageDate = { text: string; kind: 'real' | 'since' | 'planned'; title: string };

// Data exibida sob cada etapa: conclusão real nas anteriores, abertura real na atual e início
// previsto (calculado da mobilização prevista) nas futuras que têm marco.
function workflowStageDate(workflow: ProjectWorkflow, stage: ProjectWorkflowStage): StageDate | null {
  const stageIndex = WORKFLOW_STAGES.indexOf(stage);
  const currentIndex = WORKFLOW_STAGES.indexOf(workflow.stage);
  const entry = workflow.stageTimeline?.[stage];
  if (stageIndex < currentIndex) {
    return entry?.completedAt
      ? { text: shortDate(entry.completedAt), kind: 'real', title: `Concluída em ${new Date(entry.completedAt).toLocaleDateString('pt-BR')}` }
      : null;
  }
  if (stageIndex === currentIndex) {
    return entry?.enteredAt
      ? { text: `desde ${shortDate(entry.enteredAt)}`, kind: 'since', title: `Etapa aberta em ${new Date(entry.enteredAt).toLocaleDateString('pt-BR')}` }
      : null;
  }
  const planned = stage === 'MOBILIZATION_PLANNING' ? { marker: 'D-30', date: workflow.milestones.d30Date }
    : stage === 'PREPARATION' ? { marker: `D-${workflow.preparationLeadTimeDays}`, date: workflow.milestones.preparationDate }
      : stage === 'MOBILIZATION' ? { marker: 'D-0', date: workflow.plannedMobilizationDate }
        : stage === 'EXECUTION' && workflow.executedAtHeadquarters ? { marker: 'D-0', date: workflow.plannedExecutionStartDate }
          : null;
  return planned?.date
    ? { text: `${planned.marker} · ${shortDate(planned.date)}`, kind: 'planned', title: `Início previsto em ${displayDateOnly(planned.date)}, calculado a partir ${workflow.executedAtHeadquarters ? 'do início da execução previsto' : 'da mobilização prevista'}` }
    : null;
}

export function ProjectWorkflowModal({ detail, leaders, loading, error, saving, onRetry, onClose, onStart, onPatch, onMoveLegacyMission, onOpenTeamProgramming, canManageMission, missionStatusSaving, onSetMissionStatus }: {
  detail: ProjectWorkflowDetail | null;
  leaders: WorkflowUserOption[];
  loading: boolean;
  error: boolean;
  saving: boolean;
  onRetry: () => void;
  onClose: () => void;
  onStart: (values: StartValues) => void;
  onPatch: (payload: ProjectWorkflowPatch) => void;
  onMoveLegacyMission: (stage: ProjectOperationalMissionSummary['stage'], returnDate?: string | null) => void;
  onOpenTeamProgramming: () => void;
  /** Somente o gestor do Efetivo confirma ou cancela a missão. Cancelar é reversível ("Reativar" na seção de
   * canceladas do Kanban); remover a programação em definitivo só é possível a partir de lá, com a missão já
   * cancelada. Líder, datas e equipe são canônicos do fluxo de gestão (Handover, análise inicial, planejamento
   * D-30) e não têm mais edição própria aqui. */
  canManageMission: boolean;
  missionStatusSaving: boolean;
  onSetMissionStatus: (status: 'CONFIRMED' | 'CANCELLED') => void;
}) {
  const projectId = detail?.project.id || '';
  const projectDocuments = useQuery({
    queryKey: [...projectDocumentsQueryKey(projectId), false],
    queryFn: () => listProjectDocuments(projectId),
    enabled: Boolean(projectId && detail?.workflow)
  });
  const [activeStage, setActiveStage] = useState<ProjectWorkflowStage>(detail?.workflow?.stage || 'HANDOVER');
  const [correctionStage, setCorrectionStage] = useState<ProjectWorkflowStage | null>(null);
  const [blockersOpen, setBlockersOpen] = useState(false);
  const selectStage = (stage: ProjectWorkflowStage) => {
    setActiveStage(stage);
    setCorrectionStage(null);
  };
  useEffect(() => {
    if (!detail?.workflow?.stage) return;
    setActiveStage(detail.workflow.stage);
    setCorrectionStage(null);
  }, [detail?.project.id, detail?.workflow?.stage]);
  const hasWorkflow = Boolean(detail?.workflow);
  // Em telas estreitas a linha do tempo rola na horizontal: mantém a etapa aberta à vista.
  useEffect(() => {
    if (!hasWorkflow) return;
    document.getElementById(stageTabId(activeStage))?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }, [activeStage, hasWorkflow]);
  if (typeof document === 'undefined' || (!detail && !loading && !error)) return null;
  const workflow = detail?.workflow || null;
  const transitionOptions = workflow?.transitionOptions || [];
  const nextMilestoneText = !workflow
    ? '—'
    : workflow.stage === 'FINISHED' ? 'Fluxo concluído'
    : workflow.milestones.nextMilestone
      ? `${workflow.milestones.nextMilestone.label} · ${displayDateOnly(workflow.milestones.nextMilestone.date)}`
      : workflow.milestones.daysUntilMobilization == null ? 'Data não definida' : 'Marcos preventivos atingidos';
  const footerIssues = workflow?.stage === 'HANDOVER'
    ? (workflow.permissions.canAccept ? workflow.handoverGate.issues : [`Aguardando ${workflow.leader.name} assumir formalmente o projeto`])
    : workflow?.stage === 'DEMOBILIZATION'
      ? (workflow.permissions.canEdit
          ? [...new Set(transitionOptions.filter(item => !item.allowed).flatMap(item => item.issues))]
          : [`Aguardando ${workflow.leader.name} ou o gestor atualizar a desmobilização`])
    : workflow?.stage === 'POST_JOB'
      ? (workflow.permissions.canEdit
          ? [...new Set(transitionOptions.filter(item => !item.allowed).flatMap(item => item.issues))]
          : [`Aguardando ${workflow.leader.name} ou o gestor atualizar o pós-job`])
    : workflow?.stage === 'FINAL_MEASUREMENT'
      ? (workflow.permissions.canEdit
          ? (transitionOptions.find(item => item.stage === 'FINISHED')?.issues || [])
          : [`Aguardando ${workflow.leader.name} ou o gestor atualizar o fechamento`])
    : workflow?.stage === 'FINISHED' ? []
    : workflow && ['MOBILIZATION', 'EXECUTION'].includes(workflow.stage)
      ? workflow.mobilizationGate.ready ? [] : workflow.mobilizationGate.blockers.map(item => `${item.label}: ${item.reason}`)
    : (workflow?.permissions.canEdit
        ? [...new Set(transitionOptions.filter(item => !item.allowed).flatMap(item => item.issues))]
        : workflow ? [`Aguardando ${workflow.leader.name} ou o gestor alterar a etapa`] : []);
  const isCurrentStageSelected = Boolean(workflow && activeStage === workflow.stage);
  const correctionMode = Boolean(workflow && correctionStage === activeStage && !isCurrentStageSelected && workflow.permissions.canEdit);
  // Na Sede as etapas de mobilização (Pronto para mobilizar, Mobilização e Desmobilização) não existem.
  const visibleStages = projectWorkflowVisibleStages(workflow?.executedAtHeadquarters === true) as readonly ProjectWorkflowStage[];
  const moveTabFocus = (event: KeyboardEvent<HTMLButtonElement>, stage: ProjectWorkflowStage) => {
    const index = visibleStages.indexOf(stage);
    let nextIndex: number;
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % visibleStages.length;
    else if (event.key === 'ArrowLeft') nextIndex = (index - 1 + visibleStages.length) % visibleStages.length;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = visibleStages.length - 1;
    else return;
    event.preventDefault();
    const nextStage = visibleStages[nextIndex];
    selectStage(nextStage);
    requestAnimationFrame(() => document.getElementById(stageTabId(nextStage))?.focus());
  };
  const footerTone = !workflow ? 'is-idle'
    : !isCurrentStageSelected ? 'is-idle'
      : workflow.stage === 'FINISHED' || (footerIssues.length === 0) ? 'is-ok' : 'is-crit';
  const showBlockers = isCurrentStageSelected && footerIssues.length > 0;
  const content = (
    <Modal open onClose={onClose} closeOnEscape={!saving} ariaLabelledBy="project-workflow-title" panelClassName="modal-card efetivo-modal project-workflow-modal">
      <div className="efetivo-modal-layout">
        <header className="efetivo-modal-header project-workflow-header">
          <div className="project-workflow-header-id">
            {detail ? <span className="project-workflow-code">{detail.project.code}</span> : null}
            <div>
              <h3 id="project-workflow-title">{detail ? detail.project.name : 'Gestão do projeto'}</h3>
              <p>{detail ? `${detail.project.clientName} · ${detail.project.location || 'Local não informado'}` : 'Carregando dados do projeto…'}</p>
            </div>
          </div>
          {workflow ? <dl className="project-workflow-meta" aria-label="Resumo fixo do projeto">
            <div><dt>Líder</dt><dd title={workflow.leader.email || 'Sem e-mail cadastrado'}><span className="project-workflow-avatar" aria-hidden="true">{initialsOf(workflow.leader.name)}</span>{workflow.leader.name}</dd></div>
            <div><dt>Gestor de Contrato</dt><dd title={workflow.planner?.email || 'Sem e-mail cadastrado'}>{workflow.planner ? <span className="project-workflow-avatar" aria-hidden="true">{initialsOf(workflow.planner.name)}</span> : null}{workflow.planner?.name || 'Não definido'}</dd></div>
            {workflow.executedAtHeadquarters
              ? <div><dt>Início da execução</dt><dd className="is-numeric">{workflow.plannedExecutionStartDate ? displayDateOnly(workflow.plannedExecutionStartDate) : 'Não informado'}</dd></div>
              : <div><dt>Mobilização</dt><dd className="is-numeric">{workflow.plannedMobilizationDate ? displayDateOnly(workflow.plannedMobilizationDate) : 'Não informada'}</dd></div>}
            <div><dt>Próximo marco</dt><dd className={workflow.milestones.dueMilestones.length ? 'is-due' : undefined}><ProjectWorkflowIcon name="clock" />{nextMilestoneText}</dd></div>
          </dl> : null}
          <button className="project-workflow-icon-button" type="button" disabled={saving} aria-label="Fechar" onClick={onClose}><ProjectWorkflowIcon name="x" /></button>
        </header>
        {workflow && canManageMission && detail?.project.operationalMission ? (
          <div className="project-workflow-mission-bar" data-project-workflow-mission-bar>
            <span>Programação operacional: <strong>{LEGACY_MISSION_STAGE_LABELS[detail.project.operationalMission.stage]}</strong> · {detail.project.operationalMission.participantCount} participante(s)</span>
            <div className="project-workflow-mission-bar-actions">
              <ProjectWorkflowBooleanChoice
                value={detail.project.operationalMission.scheduleStatus === 'CONFIRMED' ? true : detail.project.operationalMission.scheduleStatus === 'CANCELLED' ? false : null}
                label="Missão confirmada?"
                yesLabel="Confirmada"
                noLabel="Cancelada"
                disabled={saving || missionStatusSaving}
                onSelect={value => onSetMissionStatus(value ? 'CONFIRMED' : 'CANCELLED')}
              />
            </div>
          </div>
        ) : null}
        {workflow ? <div className="project-workflow-fixed-top">
          <div className="project-workflow-stage-tabs-scroll">
            <div className="project-workflow-stage-tabs" role="tablist" aria-label="Etapas do planejamento">
              {visibleStages.map(stage => {
                const stageIssues = workflowStagePendingItems(workflow, stage, footerIssues);
                const flag = workflowStageFlag(workflow, stage, stageIssues);
                const position = workflow.stage === 'FINISHED' || WORKFLOW_STAGES.indexOf(stage) < WORKFLOW_STAGES.indexOf(workflow.stage) ? 'is-done'
                  : stage === workflow.stage ? 'is-now' : 'is-next';
                const date = workflowStageDate(workflow, stage);
                return <PortalTip
                  key={stage}
                  triggerClassName="project-workflow-stage-tab-tip"
                  triggerTabIndex={-1}
                  balloonClassName="project-workflow-stage-tip-balloon"
                  preferredPlacement="below"
                  interactive
                  content={<div className={`project-workflow-stage-tip is-${flag.tone}`}><header><strong>{WORKFLOW_STAGE_LABELS[stage]}</strong><span>{flag.label}</span></header><ul>{flag.items.map((item, index) => <li key={`${stage}-${index}`}><i aria-hidden="true" /><span>{item}</span></li>)}</ul>{date ? <p className="project-workflow-stage-tip-date">{date.title}</p> : null}</div>}
                >
                  <button className={`project-workflow-stage-tab is-${flag.tone} ${position}`} id={stageTabId(stage)} type="button" role="tab" aria-label={flag.tooltip} aria-selected={activeStage === stage} aria-controls={stagePanelId(stage)} tabIndex={activeStage === stage ? 0 : -1} onClick={() => selectStage(stage)} onKeyDown={event => moveTabFocus(event, stage)}>
                    <span className="project-workflow-stage-node" aria-hidden="true">
                      {position === 'is-done' ? <ProjectWorkflowIcon name="check" /> : null}
                      {flag.tone === 'pending' && stageIssues.length ? <b>{stageIssues.length > 99 ? '99+' : stageIssues.length}</b> : null}
                    </span>
                    <span className="project-workflow-stage-flag sr-only">{flag.label}</span>
                    <span className="project-workflow-stage-tab-label">{WORKFLOW_STAGE_LABELS[stage]}</span>
                    <span className={`project-workflow-stage-date${date ? ` is-${date.kind}` : ''}`}>{date?.text || '\u00a0'}</span>
                  </button>
                </PortalTip>;
              })}
            </div>
          </div>
          <p className="project-workflow-stage-legend" aria-hidden="true">
            <span><b className="is-real">dd/mm</b>concluída em</span>
            <span><b className="is-since">desde dd/mm</b>etapa atual aberta em</span>
            <span><b className="is-planned">D-x · dd/mm</b>início previsto pela mobilização</span>
          </p>
        </div> : null}
        <div className={`efetivo-modal-body project-workflow-modal-body${workflow ? ' has-stage-layout' : ''}`}>
          {error ? <section className="placeholder-copy"><p>Não foi possível carregar os dados deste projeto.</p><Button variant="secondary" onClick={onRetry}>Tentar novamente</Button></section> : loading || !detail ? <p className="placeholder-copy">Carregando gestão do projeto…</p> : !workflow ? (
            <>
              {detail.project.operationalMission ? <LegacyMissionStageForm mission={detail.project.operationalMission} saving={saving} canManage={detail.permissions.canInitialize} onMove={onMoveLegacyMission} /> : null}
              {detail.permissions.canInitialize
                ? <StartWorkflowForm detail={detail} leaders={leaders} saving={saving} onStart={onStart} />
                : <section className="placeholder-copy"><h4>Gestão ainda não iniciada</h4><p>O gestor do Efetivo precisa iniciar o handover e designar o Líder de Projetos.</p></section>}
            </>
          ) : <WorkflowStagePanel detail={detail} leaders={leaders} workflow={workflow} activeStage={activeStage} saving={saving} correctionMode={correctionMode} documents={projectDocuments.data?.documents || []} onPatch={onPatch} onOpenTeamProgramming={onOpenTeamProgramming} onShowBlockers={() => setBlockersOpen(true)} />}
        </div>
        <footer className="efetivo-modal-footer project-workflow-modal-footer">
          <div className="project-workflow-footer-status" aria-live="polite">
            {workflow ? <span className={`project-workflow-footer-icon ${footerTone}`} aria-hidden="true"><ProjectWorkflowIcon name={footerTone === 'is-crit' ? 'lock' : footerTone === 'is-ok' ? 'check' : 'clock'} /></span> : null}
            <div>
            {workflow ? correctionMode ? <>
              <strong>Modo de correção: {WORKFLOW_STAGE_LABELS[activeStage]}</strong>
              <span>As alterações serão salvas nesta etapa sem mover o projeto no Kanban.</span>
            </> : !isCurrentStageSelected ? <>
              <strong>Visualizando {WORKFLOW_STAGE_LABELS[activeStage]}</strong>
              <span>A etapa atual é {WORKFLOW_STAGE_LABELS[workflow.stage]}. Dados contínuos ainda podem ser atualizados; volte à etapa atual para usar as ações de avanço.</span>
            </> : <>
              <strong>{workflow.stage === 'HANDOVER' ? 'Gate do handover' : workflow.stage === 'DEMOBILIZATION' ? 'Desmobilização' : workflow.stage === 'POST_JOB' ? 'Pós-job' : workflow.stage === 'FINAL_MEASUREMENT' ? 'Gate de encerramento' : workflow.stage === 'FINISHED' ? 'Encerramento' : ['PREPARATION', 'MOBILIZATION', 'EXECUTION'].includes(workflow.stage) ? workflow.executedAtHeadquarters ? 'Gate de execução' : 'Gate de mobilização' : 'Avanço do projeto'}</strong>
              {!workflow.executedAtHeadquarters && !['DEMOBILIZATION', 'POST_JOB', 'FINAL_MEASUREMENT', 'FINISHED'].includes(workflow.stage) && workflow.mobilizationAuthorization.status === 'AUTHORIZED'
                ? <span>Autorização vigente na versão {workflow.mobilizationAuthorization.authorizedVersion}.</span>
                : footerIssues.length
                  ? <span>{footerIssues.length} bloqueio{footerIssues.length === 1 ? '' : 's'} · {footerIssues[0]}{footerIssues.length > 1 ? ` e mais ${footerIssues.length - 1}` : ''}</span>
                  : workflow.stage === 'DEMOBILIZATION' ? <span>Desmobilização concluída. O projeto pode avançar para Pós-job.</span>
                  : workflow.stage === 'POST_JOB' ? <span>Pós-job concluído. O projeto pode avançar para Documentação / medição.</span>
                  : workflow.stage === 'FINAL_MEASUREMENT' ? <span>Os {workflow.closureGate.total} controles e validações foram concluídos. O projeto pode ser encerrado.</span>
                  : workflow.stage === 'FINISHED' ? <span>Projeto encerrado em modo de consulta. Use a reabertura justificada para corrigir dados.</span>
                  : <span>Requisitos concluídos. Confirme a próxima etapa.</span>}
            </> : null}
            </div>
            {showBlockers ? <button type="button" className="project-workflow-link" aria-expanded={blockersOpen} onClick={() => setBlockersOpen(open => !open)}>Ver bloqueios</button> : null}
            {showBlockers && blockersOpen ? <div className="project-workflow-blockers" role="dialog" aria-label="Bloqueios para avançar">
              <header><strong>O que impede o avanço</strong><button type="button" className="project-workflow-icon-button" aria-label="Fechar lista de bloqueios" onClick={() => setBlockersOpen(false)}><ProjectWorkflowIcon name="x" /></button></header>
              <ul>{footerIssues.map(item => <li key={item}><ProjectWorkflowIcon name="alert" /><span>{item}</span></li>)}</ul>
            </div> : null}
          </div>
          <div className="project-workflow-footer-actions">
            {workflow && !isCurrentStageSelected && workflow.permissions.canEdit ? <Button variant="secondary" className={`project-workflow-correction-button${correctionMode ? ' is-active' : ''}`} disabled={saving} onClick={() => setCorrectionStage(correctionMode ? null : activeStage)}><ProjectWorkflowIcon name={correctionMode ? 'check' : 'edit'} />{correctionMode ? 'Encerrar correção' : 'Fazer correção'}</Button> : null}
            <Button variant="secondary" className="is-ghost" disabled={saving} onClick={onClose}>Fechar</Button>
            {workflow && !isCurrentStageSelected && !correctionMode ? <Button disabled={saving} onClick={() => selectStage(workflow.stage)}>Ir para a etapa atual</Button> : null}
            {workflow?.stage === 'HANDOVER' && isCurrentStageSelected && workflow.permissions.canAccept ? <Button disabled={saving || !workflow.handoverGate.ready} onClick={() => onPatch({ action: 'accept', version: workflow.version })}>Assumir e iniciar análise</Button> : null}
            {workflow?.stage !== 'HANDOVER' && isCurrentStageSelected && workflow?.permissions.canEdit ? transitionOptions.map(option => <Button variant={WORKFLOW_STAGES.indexOf(option.stage) > WORKFLOW_STAGES.indexOf(workflow.stage) ? 'primary' : 'secondary'} disabled={saving || !option.allowed} title={option.issues.join(' · ') || undefined} onClick={() => onPatch({ action: 'stage', version: workflow.version, stage: option.stage })} key={option.stage}>{option.allowed ? null : <ProjectWorkflowIcon name="lock" />}{transitionLabel(workflow.stage, option.stage, workflow.preparationLeadTimeDays)}</Button>) : null}
          </div>
        </footer>
      </div>
    </Modal>
  );
  return createPortal(content, document.body);
}
