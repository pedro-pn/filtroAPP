import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { makeProjectWorkflowSchemas } from '../../../../../shared/schemas/project-workflow.js';
import type {
  ProjectWorkflowChecklist,
  ProjectWorkflowChecklistStatus,
  ProjectWorkflowCommercialFact,
  ProjectWorkflowCommercialFactStatus,
  ProjectWorkflowDetail,
  ProjectWorkflowIssue,
  ProjectWorkflowPatch,
  ProjectWorkflow,
  ProjectOperationalMissionSummary
} from '../../../api/projectWorkflow';
import { Button } from '../../../components/ui/Button';
import { Modal } from '../../../components/ui/Modal';
import { displayDateOnly } from '../../../utils/calendarGrid';
import { WORKFLOW_STAGE_LABELS } from '../../../utils/projectWorkflow';
import { ProjectExecutionDashboard } from './ProjectExecutionDashboard';
import { ProjectCloseoutPanel } from './ProjectCloseoutPanel';
import { ProjectPostJobPanel } from './ProjectPostJobPanel';
import { ProjectWorkflowCategory } from './ProjectWorkflowCategory';
import { ProjectDocumentsCategory } from './ProjectDocumentsCategory';
import {
  listProjectDocuments,
  projectDocumentsQueryKey,
  type ProjectDocument,
  type ProjectDocumentType
} from '../../../api/projectDocuments';

const sharedSchemas = makeProjectWorkflowSchemas(z);
type StartValues = { leaderUserId: string; plannedMobilizationDate: string };
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
  area: z.string().trim().min(1, 'Informe a área.').max(120),
  ownerName: z.string().trim().min(1, 'Informe o responsável.').max(160),
  requiredLeadTimeDays: z.string().regex(/^\d+$/, 'Informe o prazo em dias.').refine(value => Number(value) >= 1 && Number(value) <= 3650, 'Informe um prazo entre 1 e 3650 dias.'),
  dueDate: z.string().min(1, 'Informe a data limite.'),
  criticality: z.enum(['HIGH', 'MEDIUM', 'LOW']),
  status: z.enum(['OPEN', 'IN_PROGRESS', 'RESOLVED'])
});
type IssueValues = z.infer<typeof issueSchema>;
type LegacyMissionValues = { stage: ProjectOperationalMissionSummary['stage']; returnDate: string };

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

function commercialFactSchema(item: ProjectWorkflowCommercialFact) {
  return z.object({
    status: z.enum(['PENDING', 'CONFIRMED', 'NOT_APPLICABLE']),
    reference: z.string().trim().max(500, 'A referência deve ter no máximo 500 caracteres.'),
    note: z.string().trim().max(1000, 'A observação deve ter no máximo 1000 caracteres.'),
    occurredOn: z.string(),
    evidenceDocumentId: z.string()
  }).superRefine((value, ctx) => {
    if (value.status === 'NOT_APPLICABLE') {
      if (!item.allowNotApplicable) ctx.addIssue({ code: 'custom', path: ['status'], message: 'Este fato não aceita “não aplicável”.' });
      if (!value.note) ctx.addIssue({ code: 'custom', path: ['note'], message: 'Justifique por que este fato não se aplica.' });
    }
    if (value.status !== 'CONFIRMED') return;
    if (!value.occurredOn) ctx.addIssue({ code: 'custom', path: ['occurredOn'], message: 'Informe a data da confirmação.' });
    if (item.evidence === 'reference' && !value.reference && !value.evidenceDocumentId) ctx.addIssue({ code: 'custom', path: ['reference'], message: 'Informe a referência ou selecione um documento.' });
    if (item.evidence === 'note' && !value.note) ctx.addIssue({ code: 'custom', path: ['note'], message: 'Descreva a condição comercial definida.' });
  });
}
type CommercialFactValues = { status: ProjectWorkflowCommercialFactStatus; evidenceDocumentId: string; reference: string; note: string; occurredOn: string };

const commercialEvidenceTypes: Record<string, ProjectDocumentType[]> = {
  COMMERCIAL_PROPOSAL_CREATED: ['COMMERCIAL_PROPOSAL'],
  TECHNICAL_PROPOSAL_CREATED: ['TECHNICAL_PROPOSAL'],
  PROPOSAL_ACCEPTED: ['COMMERCIAL_PROPOSAL', 'TECHNICAL_PROPOSAL'],
  PURCHASE_ORDER_RECEIVED: ['PURCHASE_ORDER'],
  CONTRACT_SIGNED: ['CONTRACT']
};

function fieldClass(error?: unknown) {
  return `field-group ${error ? 'field-invalid' : ''}`;
}

function StartWorkflowForm({ detail, leaders, saving, onStart }: {
  detail: ProjectWorkflowDetail;
  leaders: Array<{ id: string; name: string }>;
  saving: boolean;
  onStart: (values: StartValues) => void;
}) {
  const { register, handleSubmit, formState: { errors } } = useForm<StartValues>({
    resolver: zodResolver(sharedSchemas.start),
    defaultValues: { leaderUserId: '', plannedMobilizationDate: '' }
  });
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
        <div className={fieldClass(errors.plannedMobilizationDate)}>
          <label htmlFor="workflow-start-date">Previsão de mobilização *</label>
          <input id="workflow-start-date" type="date" disabled={saving} aria-invalid={Boolean(errors.plannedMobilizationDate)} {...register('plannedMobilizationDate')} />
          {errors.plannedMobilizationDate ? <span className="field-error">{errors.plannedMobilizationDate.message}</span> : null}
        </div>
      </div>
      <div className="project-workflow-inline-actions"><Button type="submit" disabled={saving || !detail.permissions.canInitialize}>{saving ? 'Iniciando…' : 'Iniciar handover'}</Button></div>
    </form>
  );
}

function WorkflowSettingsForm({ detail, leaders, saving, onPatch }: {
  detail: ProjectWorkflowDetail;
  leaders: Array<{ id: string; name: string }>;
  saving: boolean;
  onPatch: (payload: ProjectWorkflowPatch) => void;
}) {
  const workflow = detail.workflow!;
  const schema = z.object({
    leaderUserId: z.string().min(1, 'Selecione o líder.'),
    plannedMobilizationDate: z.string().min(1, 'Informe a previsão de mobilização.')
  });
  type Values = z.infer<typeof schema>;
  const { register, handleSubmit, reset, formState: { errors, isDirty } } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { leaderUserId: workflow.leaderUserId, plannedMobilizationDate: workflow.plannedMobilizationDate }
  });
  useEffect(() => reset({ leaderUserId: workflow.leaderUserId, plannedMobilizationDate: workflow.plannedMobilizationDate }), [reset, workflow.leaderUserId, workflow.plannedMobilizationDate]);
  return (
    <form className="project-workflow-form" noValidate onSubmit={handleSubmit(values => onPatch({ action: 'settings', version: workflow.version, ...values }))}>
      <div className="project-workflow-form-grid">
        <div className={fieldClass(errors.leaderUserId)}>
          <label htmlFor="workflow-leader">Líder de Projetos *</label>
          <select id="workflow-leader" disabled={saving || !workflow.permissions.canChangeLeader} aria-invalid={Boolean(errors.leaderUserId)} {...register('leaderUserId')}>
            {leaders.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}
          </select>
          {errors.leaderUserId ? <span className="field-error">{errors.leaderUserId.message}</span> : null}
          {!workflow.permissions.canChangeLeader ? <span className="field-hint">Somente o gestor pode trocar o líder.</span> : null}
        </div>
        <div className={fieldClass(errors.plannedMobilizationDate)}>
          <label htmlFor="workflow-date">Previsão de mobilização *</label>
          <input id="workflow-date" type="date" disabled={saving || !workflow.permissions.canEdit} aria-invalid={Boolean(errors.plannedMobilizationDate)} {...register('plannedMobilizationDate')} />
          {errors.plannedMobilizationDate ? <span className="field-error">{errors.plannedMobilizationDate.message}</span> : null}
        </div>
      </div>
      {workflow.permissions.canEdit ? <div className="project-workflow-inline-actions"><Button type="submit" variant="secondary" disabled={saving || !isDirty}>Salvar responsáveis e data</Button></div> : null}
    </form>
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

function ChecklistEditor({ item, version, saving, canEdit, onPatch }: {
  item: ProjectWorkflowChecklist;
  version: number;
  saving: boolean;
  canEdit: boolean;
  onPatch: (payload: ProjectWorkflowPatch) => void;
}) {
  const { register, handleSubmit, reset, formState: { errors, isDirty } } = useForm<ChecklistValues>({
    resolver: zodResolver(checklistSchema),
    defaultValues: { status: item.status, note: item.note || '' }
  });
  useEffect(() => reset({ status: item.status, note: item.note || '' }), [item.note, item.status, reset]);
  return (
    <form className="project-workflow-check-item" noValidate onSubmit={handleSubmit(values => onPatch({
      action: 'checklist', version, key: item.key, status: values.status as ProjectWorkflowChecklistStatus, note: values.note || null
    }))}>
      <span>{item.label}</span>
      <div className="project-workflow-check-controls">
        <div className={fieldClass(errors.status)}><label className="sr-only" htmlFor={`workflow-status-${item.key}`}>Situação</label><select id={`workflow-status-${item.key}`} disabled={saving || !canEdit} {...register('status')}><option value="PENDING">Pendente</option><option value="DONE">Concluído</option><option value="NOT_APPLICABLE">Não se aplica</option></select></div>
        <div className={fieldClass(errors.note)}><label className="sr-only" htmlFor={`workflow-note-${item.key}`}>Observação</label><input id={`workflow-note-${item.key}`} placeholder="Observação ou evidência" disabled={saving || !canEdit} aria-invalid={Boolean(errors.note)} {...register('note')} />{errors.note ? <span className="field-error">{errors.note.message}</span> : null}</div>
        {canEdit ? <Button type="submit" variant="mini" disabled={saving || !isDirty}>Salvar</Button> : null}
      </div>
    </form>
  );
}

function WorkflowChecklistSection({ title, description, status, items, version, saving, onPatch, className = '' }: {
  title: string;
  description?: string;
  status?: ReactNode;
  items: ProjectWorkflowChecklist[];
  version: number;
  saving: boolean;
  onPatch: (payload: ProjectWorkflowPatch) => void;
  className?: string;
}) {
  const completed = items.filter(item => item.status !== 'PENDING').length;
  return (
    <ProjectWorkflowCategory title={title} description={description} status={status ?? `${completed}/${items.length}`} complete={items.length > 0 && completed === items.length} className={className}>
      {items.map(item => <ChecklistEditor item={item} version={version} saving={saving} canEdit={item.canEdit} onPatch={onPatch} key={item.key} />)}
    </ProjectWorkflowCategory>
  );
}

function MobilizationGate({ workflow }: { workflow: ProjectWorkflow }) {
  const authorization = workflow.mobilizationAuthorization;
  const statusLabel = authorization.status === 'AUTHORIZED'
    ? '🔒 Autorizado para mobilização'
    : authorization.status === 'SUSPENDED' ? '🔴 Autorização suspensa'
      : workflow.mobilizationGate.ready ? '🟢 Pronto para autorizar' : '🔴 Bloqueado';
  return (
    <ProjectWorkflowCategory
      title="Gate de mobilização"
      description="As nove frentes e o pré-job precisam permanecer liberados na mesma versão."
      status={statusLabel}
      complete={authorization.status === 'AUTHORIZED'}
      className={`project-workflow-gate-panel is-${authorization.status.toLowerCase()}`}
      data-project-workflow-gate
    >
      <p className="project-workflow-category-note">Em projetos com gestão iniciada, a autorização libera equipe no Efetivo, romaneios de saída e retiradas do Estoque.</p>
      <div className="project-workflow-gate-table" role="table" aria-label="Prontidão para mobilização">
        <div className="project-workflow-gate-table-head" role="row"><span role="columnheader">Frente</span><span role="columnheader">Situação</span><span role="columnheader">Progresso</span></div>
        {workflow.mobilizationGate.fronts.map(front => <div className="project-workflow-gate-row" role="row" key={front.key}><strong role="cell">{front.label}</strong><span role="cell" className={front.status === 'READY' ? 'is-ready' : 'is-blocked'}>{front.status === 'READY' ? '🟢 Liberada' : '🔴 Pendente'}</span><span role="cell">{front.completed}/{front.total}</span></div>)}
      </div>
      <div className={`project-workflow-pre-job-status is-${workflow.mobilizationGate.preJob.status.toLowerCase()}`}><strong>Pré-job</strong><span>{workflow.mobilizationGate.preJob.status === 'READY' ? '🟢 Realizado' : `🔴 ${workflow.mobilizationGate.preJob.completed}/${workflow.mobilizationGate.preJob.total}`}</span></div>
      {workflow.mobilizationGate.blockers.length ? <details><summary>{workflow.mobilizationGate.blockers.length} bloqueio(s) para mobilizar</summary><ul>{workflow.mobilizationGate.blockers.slice(0, 12).map((item, index) => <li key={`${item.front}-${item.key}-${index}`}>{item.label}: {item.reason}</li>)}</ul>{workflow.mobilizationGate.blockers.length > 12 ? <p>Existem mais {workflow.mobilizationGate.blockers.length - 12} bloqueio(s).</p> : null}</details> : null}
      {authorization.authorizedAt ? <small>Última emissão: {new Date(authorization.authorizedAt).toLocaleString('pt-BR')} · versão {authorization.authorizedVersion}</small> : null}
    </ProjectWorkflowCategory>
  );
}

function transitionLabel(current: ProjectWorkflow['stage'], target: ProjectWorkflow['stage']) {
  if (current === 'FINISHED' && target === 'FINAL_MEASUREMENT') return 'Reabrir em documentação e medição';
  if (current === 'MOBILIZATION' && target === 'READY_TO_MOBILIZE') return 'Voltar para pronto para mobilizar';
  if (current === 'EXECUTION' && target === 'MOBILIZATION') return 'Voltar para mobilização';
  if (current === 'DEMOBILIZATION' && target === 'EXECUTION') return 'Voltar para execução';
  if (current === 'POST_JOB' && target === 'DEMOBILIZATION') return 'Voltar para desmobilização';
  if (current === 'FINAL_MEASUREMENT' && target === 'POST_JOB') return 'Voltar para pós-job';
  if (target === 'FINAL_MEASUREMENT') return 'Iniciar documentação e medição';
  if (target === 'FINISHED') return 'Encerrar projeto';
  if (target === 'POST_JOB') return 'Iniciar pós-job';
  if (target === 'DEMOBILIZATION') return 'Iniciar desmobilização';
  if (target === 'MOBILIZATION') return 'Iniciar mobilização';
  if (target === 'EXECUTION') return 'Iniciar execução';
  if (target === 'READY_TO_MOBILIZE') return 'Autorizar mobilização';
  if (target === 'PREPARATION') return current === 'READY_TO_MOBILIZE' ? 'Voltar para preparação' : 'Iniciar preparação D-15';
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

function CommercialFactEditor({ item, documents, version, saving, canEdit, onPatch }: {
  item: ProjectWorkflowCommercialFact;
  documents: ProjectDocument[];
  version: number;
  saving: boolean;
  canEdit: boolean;
  onPatch: (payload: ProjectWorkflowPatch) => void;
}) {
  const schema = commercialFactSchema(item);
  const { register, handleSubmit, reset, watch, formState: { errors, isDirty } } = useForm<CommercialFactValues>({
    resolver: zodResolver(schema),
    defaultValues: { status: item.status, evidenceDocumentId: item.evidenceDocumentId || '', reference: item.reference || '', note: item.note || '', occurredOn: item.occurredOn || '' }
  });
  useEffect(() => reset({ status: item.status, evidenceDocumentId: item.evidenceDocumentId || '', reference: item.reference || '', note: item.note || '', occurredOn: item.occurredOn || '' }), [item.evidenceDocumentId, item.note, item.occurredOn, item.reference, item.status, reset]);
  const status = watch('status');
  const readOnly = item.readOnly || !canEdit;
  const eligibleDocuments = documents.filter(document => (commercialEvidenceTypes[item.key] || []).includes(document.type) && document.currentVersion && !document.archivedAt);
  return (
    <form className={`project-workflow-commercial-fact ${item.readOnly ? 'is-crm' : ''}`} noValidate onSubmit={handleSubmit(values => onPatch({
      action: 'commercial_fact', version, key: item.key, status: values.status,
      evidenceDocumentId: values.evidenceDocumentId || null, reference: values.reference || null, note: values.note || null, occurredOn: values.occurredOn || null
    }))}>
      <header><div><strong>{item.label}</strong><span>{item.source === 'CRM' ? 'Sincronizado pelo CRM' : 'Registro manual'}</span></div><span className={`project-workflow-fact-status is-${item.status.toLowerCase()}`}>{item.status === 'CONFIRMED' ? 'Confirmado' : item.status === 'NOT_APPLICABLE' ? 'Não aplicável' : 'Pendente'}</span></header>
      <div className="project-workflow-commercial-fields">
        <div className={fieldClass(errors.status)}><label htmlFor={`commercial-status-${item.key}`}>Situação *</label><select id={`commercial-status-${item.key}`} disabled={saving || readOnly} aria-invalid={Boolean(errors.status)} {...register('status')}><option value="PENDING">Pendente</option><option value="CONFIRMED">Confirmado</option>{item.allowNotApplicable ? <option value="NOT_APPLICABLE">Não aplicável</option> : null}</select>{errors.status ? <span className="field-error">{errors.status.message}</span> : null}</div>
        <div className={fieldClass(errors.occurredOn)}><label htmlFor={`commercial-date-${item.key}`}>Data da confirmação {status === 'CONFIRMED' ? '*' : ''}</label><input id={`commercial-date-${item.key}`} type="date" disabled={saving || readOnly || status !== 'CONFIRMED'} aria-invalid={Boolean(errors.occurredOn)} {...register('occurredOn')} />{errors.occurredOn ? <span className="field-error">{errors.occurredOn.message}</span> : null}</div>
        {item.evidence === 'reference' && eligibleDocuments.length ? <div className={fieldClass(errors.evidenceDocumentId)}><label htmlFor={`commercial-document-${item.key}`}>Documento do projeto</label><select id={`commercial-document-${item.key}`} disabled={saving || readOnly || status !== 'CONFIRMED'} {...register('evidenceDocumentId')}><option value="">Nenhum selecionado</option>{eligibleDocuments.map(document => <option value={document.id} key={document.id}>{document.title} · {document.currentVersion?.versionLabel || `versão ${document.currentVersion?.sequence}`}</option>)}</select></div> : null}
        <div className={fieldClass(errors.reference)}><label htmlFor={`commercial-reference-${item.key}`}>Referência {status === 'CONFIRMED' && item.evidence === 'reference' ? '*' : ''}</label><input id={`commercial-reference-${item.key}`} placeholder="Número, revisão ou documento" disabled={saving || readOnly || status !== 'CONFIRMED'} aria-invalid={Boolean(errors.reference)} {...register('reference')} />{errors.reference ? <span className="field-error">{errors.reference.message}</span> : null}</div>
        <div className={fieldClass(errors.note)}><label htmlFor={`commercial-note-${item.key}`}>{status === 'NOT_APPLICABLE' ? 'Justificativa' : 'Detalhe / observação'} {(status === 'NOT_APPLICABLE' || (status === 'CONFIRMED' && item.evidence === 'note')) ? '*' : ''}</label><input id={`commercial-note-${item.key}`} placeholder="Condição, premissa ou justificativa" disabled={saving || readOnly || status === 'PENDING'} aria-invalid={Boolean(errors.note)} {...register('note')} />{errors.note ? <span className="field-error">{errors.note.message}</span> : null}</div>
      </div>
      {item.source === 'CRM' ? <p className="project-workflow-source-detail">Fonte CRM{item.sourceVersion ? ` · versão ${item.sourceVersion}` : ''}{item.lastSyncedAt ? ` · sincronizado em ${new Date(item.lastSyncedAt).toLocaleString('pt-BR')}` : ''}{item.externalUrl ? <> · <a href={item.externalUrl} target="_blank" rel="noreferrer">Abrir na origem</a></> : null}</p> : null}
      {canEdit && !item.readOnly ? <div className="project-workflow-inline-actions"><Button type="submit" variant="mini" disabled={saving || !isDirty}>Salvar fato comercial</Button></div> : null}
    </form>
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
    defaultValues: { description: issue.description, area: issue.area, ownerName: issue.ownerName || '', requiredLeadTimeDays: issue.requiredLeadTimeDays ? String(issue.requiredLeadTimeDays) : '', dueDate: issue.dueDate || '', criticality: issue.criticality, status: issue.status }
  });
  useEffect(() => reset({ description: issue.description, area: issue.area, ownerName: issue.ownerName || '', requiredLeadTimeDays: issue.requiredLeadTimeDays ? String(issue.requiredLeadTimeDays) : '', dueDate: issue.dueDate || '', criticality: issue.criticality, status: issue.status }), [issue, reset]);
  return (
    <form className={`project-workflow-issue ${issue.overdue ? 'is-overdue' : ''}`} noValidate onSubmit={handleSubmit(values => onPatch({ action: 'issue', version, issueId: issue.id, ...values, requiredLeadTimeDays: Number(values.requiredLeadTimeDays) }))}>
      <div className={fieldClass(errors.description)}><label htmlFor={`issue-description-${issue.id}`}>Pendência *</label><input id={`issue-description-${issue.id}`} disabled={saving || !canEdit} aria-invalid={Boolean(errors.description)} {...register('description')} />{errors.description ? <span className="field-error">{errors.description.message}</span> : null}</div>
      <div className="project-workflow-form-grid compact">
        <div className={fieldClass(errors.area)}><label htmlFor={`issue-area-${issue.id}`}>Área *</label><input id={`issue-area-${issue.id}`} disabled={saving || !canEdit} aria-invalid={Boolean(errors.area)} {...register('area')} />{errors.area ? <span className="field-error">{errors.area.message}</span> : null}</div>
        <div className={fieldClass(errors.ownerName)}><label htmlFor={`issue-owner-${issue.id}`}>Responsável *</label><input id={`issue-owner-${issue.id}`} disabled={saving || !canEdit} aria-invalid={Boolean(errors.ownerName)} {...register('ownerName')} />{errors.ownerName ? <span className="field-error">{errors.ownerName.message}</span> : null}</div>
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

export function ProjectWorkflowModal({ detail, leaders, loading, error, saving, onRetry, onClose, onStart, onPatch, onMoveLegacyMission, onOpenTeamProgramming }: {
  detail: ProjectWorkflowDetail | null;
  leaders: Array<{ id: string; name: string }>;
  loading: boolean;
  error: boolean;
  saving: boolean;
  onRetry: () => void;
  onClose: () => void;
  onStart: (values: StartValues) => void;
  onPatch: (payload: ProjectWorkflowPatch) => void;
  onMoveLegacyMission: (stage: ProjectOperationalMissionSummary['stage'], returnDate?: string | null) => void;
  onOpenTeamProgramming: () => void;
}) {
  const projectId = detail?.project.id || '';
  const projectDocuments = useQuery({
    queryKey: [...projectDocumentsQueryKey(projectId), false],
    queryFn: () => listProjectDocuments(projectId),
    enabled: Boolean(projectId && detail?.workflow)
  });
  if (typeof document === 'undefined' || (!detail && !loading && !error)) return null;
  const workflow = detail?.workflow || null;
  const stageChecklists = workflow?.checklists.filter(item => item.section === workflow.stage) || [];
  const documentationChecklists = workflow?.checklists.filter(item => item.section === 'ADVANCE_DOCUMENTATION') || [];
  const planningSections = [
    ['D30_TEAM', 'Equipe'],
    ['D30_EQUIPMENT', 'Equipamentos'],
    ['D30_MATERIALS', 'Materiais e insumos'],
    ['D30_LOGISTICS', 'Logística preliminar']
  ] as const;
  const preparationSections = [
    ['D15_TEAM', 'Equipe definitiva'],
    ['D15_CLIENT', 'Cliente e liberações'],
    ['D15_EQUIPMENT', 'Equipamentos'],
    ['D15_MATERIALS', 'Materiais'],
    ['D15_PRE_JOB', 'Pré-job'],
    ['D15_TRAVEL', 'Viagem e logística'],
    ['D15_QSMS', 'QSMS']
  ] as const;
  const demobilizationSections = [
    ['DEMOBILIZATION_FIELD', 'Conclusão de campo'],
    ['DEMOBILIZATION_LOGISTICS', 'Logística de retorno'],
    ['DEMOBILIZATION_ASSETS', 'Retorno de ativos']
  ] as const;
  const postJobSections = [
    ['POST_JOB_FEEDBACK', 'Reunião e feedbacks'],
    ['POST_JOB_LEARNING', 'Aprendizados e melhorias']
  ] as const;
  const closeoutSections = [
    ['CLOSEOUT_DOCUMENTATION', 'Documentação'],
    ['CLOSEOUT_MEASUREMENT', 'Medição']
  ] as const;
  const finalCloseoutChecklists = workflow?.checklists.filter(item => item.section === 'FINAL_CLOSEOUT') || [];
  const transitionOptions = workflow?.transitionOptions || [];
  const nextMilestoneText = !workflow
    ? '—'
    : workflow.stage === 'FINISHED' ? 'Fluxo concluído'
    : workflow.milestones.nextMilestone
      ? `${workflow.milestones.nextMilestone.label} · ${displayDateOnly(workflow.milestones.nextMilestone.date)}`
      : workflow.milestones.daysUntilMobilization == null ? 'Data não definida' : 'Marcos preventivos atingidos';
  const documentationStatus = workflow?.documentationReadiness.status === 'OK'
    ? '🟢 OK'
    : workflow?.documentationReadiness.status === 'CRITICAL' ? '🔴 Crítica' : '🟡 Em andamento';
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
    : workflow && ['READY_TO_MOBILIZE', 'MOBILIZATION', 'EXECUTION'].includes(workflow.stage)
      ? workflow.mobilizationGate.ready
        ? workflow.mobilizationAuthorization.status === 'SUSPENDED' ? ['O projeto mudou após a última autorização e precisa ser revalidado'] : []
        : workflow.mobilizationGate.blockers.map(item => `${item.label}: ${item.reason}`)
    : (workflow?.permissions.canEdit
        ? [...new Set(transitionOptions.filter(item => !item.allowed).flatMap(item => item.issues))]
        : workflow ? [`Aguardando ${workflow.leader.name} ou o gestor alterar a etapa`] : []);
  const content = (
    <Modal open onClose={onClose} closeOnEscape={!saving} ariaLabelledBy="project-workflow-title" panelClassName="modal-card efetivo-modal project-workflow-modal">
      <div className="efetivo-modal-layout">
        <header className="efetivo-modal-header"><div><h3 id="project-workflow-title">{detail ? `${detail.project.code} · ${detail.project.name}` : 'Gestão do projeto'}</h3><p>{detail ? `${detail.project.clientName} · ${detail.project.location || 'Local não informado'}` : 'Carregando dados do projeto…'}</p></div><button className="icon-button" type="button" disabled={saving} aria-label="Fechar" onClick={onClose}>×</button></header>
        <div className="efetivo-modal-body project-workflow-modal-body">
          {error ? <section className="placeholder-copy"><p>Não foi possível carregar os dados deste projeto.</p><Button variant="secondary" onClick={onRetry}>Tentar novamente</Button></section> : loading || !detail ? <p className="placeholder-copy">Carregando gestão do projeto…</p> : !workflow ? (
            <>
              {detail.project.operationalMission ? <LegacyMissionStageForm mission={detail.project.operationalMission} saving={saving} canManage={detail.permissions.canInitialize} onMove={onMoveLegacyMission} /> : null}
              {detail.permissions.canInitialize
                ? <StartWorkflowForm detail={detail} leaders={leaders} saving={saving} onStart={onStart} />
                : <section className="placeholder-copy"><h4>Gestão ainda não iniciada</h4><p>O gestor do Efetivo precisa iniciar o handover e designar o Líder de Projetos.</p></section>}
            </>
          ) : (
            <>
              <section className="project-workflow-status-block"><div><span>Etapa atual</span><strong>{WORKFLOW_STAGE_LABELS[workflow.stage]}</strong></div><div><span>Líder</span><strong>{workflow.leader.name}</strong></div><div><span>Mobilização prevista</span><strong>{displayDateOnly(workflow.plannedMobilizationDate)}</strong></div><div><span>Próximo marco</span><strong>{nextMilestoneText}</strong></div></section>
              {workflow.stage === 'FINISHED' ? <section className="project-workflow-closed-banner" data-project-workflow-closed><strong>🏁 Missão encerrada</strong><span>{workflow.closedAt ? `Encerrada em ${new Date(workflow.closedAt).toLocaleString('pt-BR')}` : 'Encerramento registrado'}{workflow.closedBy ? ` por ${workflow.closedBy.name}` : ''}.</span></section> : null}
              {workflow.stage !== 'FINISHED' && workflow.milestones.dueMilestones.length ? <section className="project-workflow-milestones" aria-label="Marcos de mobilização atingidos"><strong>Atenção aos prazos</strong><span>{workflow.milestones.dueMilestones.map(key => key.replace('D', 'D-')).join(' · ')} já atingido(s); execute agora as verificações pendentes.</span></section> : null}
              {workflow.stage !== 'FINISHED' && workflow.mobilizationGate.deadlineStatus === 'ATTENTION' ? <section className="project-workflow-deadline-risk is-attention"><strong>🟡 D-7 atingido</strong><span>{workflow.mobilizationGate.blockers.length} bloqueio(s) ainda precisam ser resolvidos.</span></section> : null}
              {workflow.stage !== 'FINISHED' && workflow.mobilizationGate.deadlineStatus === 'RISK' ? <section className="project-workflow-deadline-risk is-risk"><strong>🔴 Risco de mobilização</strong><span>D-1 atingido com {workflow.mobilizationGate.blockers.length} bloqueio(s).</span></section> : null}
              <WorkflowSettingsForm detail={detail} leaders={leaders} saving={saving} onPatch={onPatch} />
              <ProjectWorkflowCategory title="Liberação comercial e contratual" description="A análise e o planejamento podem continuar; pendências bloqueiam compra, contratação e mobilização." status={workflow.commercialReadiness.status === 'RELEASED' ? '🟢 Liberado' : `🔴 Não liberado · ${workflow.commercialReadiness.resolvedCount}/${workflow.commercialReadiness.totalCount}`} complete={workflow.commercialReadiness.status === 'RELEASED'} className={`project-workflow-commercial is-${workflow.commercialReadiness.status.toLowerCase()}`} data-project-workflow-commercial><div className="project-workflow-commercial-list">{workflow.commercialFacts.map(item => <CommercialFactEditor item={item} documents={projectDocuments.data?.documents || []} version={workflow.version} saving={saving} canEdit={workflow.permissions.canEditCommercial} onPatch={onPatch} key={item.key} />)}</div></ProjectWorkflowCategory>
              <ProjectDocumentsCategory projectId={workflow.projectId} users={leaders} />
              {workflow.stage === 'HANDOVER' ? <WorkflowChecklistSection title="Checklist do handover" items={stageChecklists} version={workflow.version} saving={saving} onPatch={onPatch} /> : null}
              {workflow.stage === 'INITIAL_ANALYSIS' ? <WorkflowChecklistSection title="Checklist da análise inicial" items={stageChecklists} version={workflow.version} saving={saving} onPatch={onPatch} /> : null}
              {workflow.stage === 'WAITING_PLANNING' ? <ProjectWorkflowCategory title="🕐 Aguardando D-30" description="A análise foi concluída. O sistema continua acompanhando itens críticos e documentação até o início do planejamento." status={workflow.milestones.d30Date ? displayDateOnly(workflow.milestones.d30Date) : 'Data não definida'} className="project-workflow-waiting"><p className="project-workflow-category-note">Itens críticos e documentação continuam monitorados nesta etapa.</p></ProjectWorkflowCategory> : null}
              <WorkflowChecklistSection title="Documentação antecipada" description="Requisitos do cliente, exames, treinamentos, certificações e regularização da equipe." status={`${documentationStatus} · ${workflow.documentationReadiness.completed}/${workflow.documentationReadiness.total}`} items={documentationChecklists} version={workflow.version} saving={saving} onPatch={onPatch} className={`project-workflow-documentation is-${workflow.documentationReadiness.status.toLowerCase()}`} />
              {workflow.stage === 'MOBILIZATION_PLANNING' ? <ProjectWorkflowCategory title="Planejamento da mobilização · D-30" description="Previsões organizadas por área responsável." status={`${workflow.planningReadiness.completed}/${workflow.planningReadiness.total} · ${workflow.planningReadiness.percentage}%`} complete={workflow.planningReadiness.percentage === 100} className="project-workflow-planning" data-project-workflow-d30><div className="project-workflow-planning-grid">{planningSections.map(([section, title]) => <WorkflowChecklistSection title={title} items={workflow.checklists.filter(item => item.section === section)} version={workflow.version} saving={saving} onPatch={onPatch} key={section} />)}</div></ProjectWorkflowCategory> : null}
              {workflow.stage === 'PREPARATION' || workflow.stage === 'READY_TO_MOBILIZE' ? <ProjectWorkflowCategory title="Preparação para mobilização · D-15" description="Confirmações definitivas por frente responsável." status={`${workflow.preparationReadiness.completed}/${workflow.preparationReadiness.total} · ${workflow.preparationReadiness.percentage}%`} complete={workflow.preparationReadiness.percentage === 100} className="project-workflow-planning" data-project-workflow-d15><div className="project-workflow-planning-grid">{preparationSections.map(([section, title]) => <WorkflowChecklistSection title={title} items={workflow.checklists.filter(item => item.section === section)} version={workflow.version} saving={saving} onPatch={onPatch} key={section} />)}</div></ProjectWorkflowCategory> : null}
              {['PREPARATION', 'READY_TO_MOBILIZE', 'MOBILIZATION', 'EXECUTION'].includes(workflow.stage) ? <MobilizationGate workflow={workflow} /> : null}
              {workflow.stage === 'EXECUTION' ? <ProjectWorkflowCategory title="Dashboard de execução" description="Avanço, RDOs, relatórios técnicos e desvios da obra." status="Acompanhamento ativo"><ProjectExecutionDashboard projectId={workflow.projectId} /></ProjectWorkflowCategory> : null}
              {workflow.stage === 'DEMOBILIZATION' ? <ProjectWorkflowCategory title="Desmobilização" description="Conclusão do campo, retorno da equipe e entrega dos ativos." status={`${workflow.demobilizationReadiness.completed}/${workflow.demobilizationReadiness.total} · ${workflow.demobilizationReadiness.percentage}%`} complete={workflow.demobilizationReadiness.percentage === 100 && Boolean(workflow.fieldCompletionDate && workflow.demobilizationDate)} className="project-workflow-planning" data-project-workflow-demobilization><DemobilizationDatesForm workflow={workflow} project={detail.project} mission={detail.project.operationalMission} saving={saving} onPatch={onPatch} /><div className="project-workflow-planning-grid">{demobilizationSections.map(([section, title]) => <WorkflowChecklistSection title={title} items={workflow.checklists.filter(item => item.section === section)} version={workflow.version} saving={saving} onPatch={onPatch} key={section} />)}</div></ProjectWorkflowCategory> : null}
              {['POST_JOB', 'FINISHED'].includes(workflow.stage) ? <ProjectWorkflowCategory title="Pós-job / fechamento técnico" description="Registre a experiência da obra e alimente a base histórica da Filtrovali." status={`${workflow.postJobReadiness.completed}/${workflow.postJobReadiness.total} · ${workflow.postJobReadiness.percentage}%`} complete={workflow.postJobReadiness.percentage === 100} className="project-workflow-planning" data-project-workflow-post-job><ProjectPostJobPanel workflow={workflow} saving={saving} onPatch={onPatch} /><div className="project-workflow-planning-grid">{postJobSections.map(([section, title]) => <WorkflowChecklistSection title={title} items={workflow.checklists.filter(item => item.section === section)} version={workflow.version} saving={saving} onPatch={onPatch} key={section} />)}</div></ProjectWorkflowCategory> : null}
              {['FINAL_MEASUREMENT', 'FINISHED'].includes(workflow.stage) ? <ProjectWorkflowCategory title="Documentação / medição" description="Consolide os documentos técnicos, a medição e os valores de fechamento da obra." status={`${workflow.closeoutReadiness.completed}/${workflow.closeoutReadiness.total} · ${workflow.closeoutReadiness.percentage}%`} complete={workflow.closeoutReadiness.percentage === 100} className="project-workflow-planning" data-project-workflow-closeout><ProjectCloseoutPanel workflow={workflow} saving={saving} onPatch={onPatch} /><div className="project-workflow-planning-grid">{closeoutSections.map(([section, title]) => <WorkflowChecklistSection title={title} items={workflow.checklists.filter(item => item.section === section)} version={workflow.version} saving={saving} onPatch={onPatch} key={section} />)}</div></ProjectWorkflowCategory> : null}
              {['FINAL_MEASUREMENT', 'FINISHED'].includes(workflow.stage) ? <ProjectWorkflowCategory title="Gate de encerramento" description="Valida escopo, documentos, medição, pós-job, ativos e pendências antes de encerrar." status={workflow.closureGate.ready ? '🟢 Pronto para encerrar' : `🔴 ${workflow.closureGate.blockers.length} bloqueio(s)`} complete={workflow.closureGate.ready} className={`project-workflow-closure-gate ${workflow.closureGate.ready ? 'is-ready' : 'is-blocked'}`} data-project-workflow-closure-gate><WorkflowChecklistSection title="Checklist final de encerramento" items={finalCloseoutChecklists} version={workflow.version} saving={saving} onPatch={onPatch} />{workflow.closureGate.blockers.length ? <details open><summary>Motivos do bloqueio</summary><ul>{workflow.closureGate.blockers.map(item => <li key={item.key}><strong>{item.label}:</strong> {item.reason}</li>)}</ul></details> : <p className="project-workflow-category-note">Todos os requisitos foram concluídos. O Líder ou gestor pode encerrar o projeto.</p>}</ProjectWorkflowCategory> : null}
              {workflow.stage !== 'HANDOVER' ? <ProjectWorkflowCategory title="Itens críticos" status={`${workflow.criticalAnswers.filter(item => item.answer !== null).length}/${workflow.criticalAnswers.length}`} complete={workflow.criticalAnswers.every(item => item.answer !== null)}>{workflow.criticalAnswers.map(item => <article className="project-workflow-critical" key={item.key}><span>{item.label}</span><div><Button variant={item.answer === true ? 'primary' : 'secondary'} disabled={saving || !workflow.permissions.canEdit} onClick={() => onPatch({ action: 'critical', version: workflow.version, key: item.key, answer: true })}>Sim</Button><Button variant={item.answer === false ? 'primary' : 'secondary'} disabled={saving || !workflow.permissions.canEdit} onClick={() => onPatch({ action: 'critical', version: workflow.version, key: item.key, answer: false })}>Não</Button></div></article>)}</ProjectWorkflowCategory> : null}
              {workflow.issues.length ? <ProjectWorkflowCategory title="Pendências" status={`${workflow.issues.filter(item => item.status !== 'RESOLVED').length} abertas`} complete={workflow.issues.every(item => item.status === 'RESOLVED')}>{workflow.issues.map(issue => <IssueEditor issue={issue} version={workflow.version} saving={saving} canEdit={workflow.permissions.canEdit} onPatch={onPatch} key={issue.id} />)}</ProjectWorkflowCategory> : null}
              {['MOBILIZATION_PLANNING', 'PREPARATION', 'READY_TO_MOBILIZE', 'MOBILIZATION', 'EXECUTION', 'DEMOBILIZATION', 'POST_JOB', 'FINAL_MEASUREMENT', 'FINISHED'].includes(workflow.stage) ? <Button type="button" variant="mini" className="project-workflow-planning-link" onClick={onOpenTeamProgramming}>Abrir programação da equipe</Button> : null}
              {workflow.stage === 'FINISHED' && workflow.permissions.canReopen ? <ReopenProjectForm workflow={workflow} saving={saving} onPatch={onPatch} /> : null}
            </>
          )}
        </div>
        <footer className="efetivo-modal-footer project-workflow-modal-footer">
          <div className="project-workflow-footer-status" aria-live="polite">
            {workflow ? <>
              <strong>{workflow.stage === 'HANDOVER' ? 'Gate do handover' : workflow.stage === 'DEMOBILIZATION' ? 'Desmobilização' : workflow.stage === 'POST_JOB' ? 'Pós-job' : workflow.stage === 'FINAL_MEASUREMENT' ? 'Gate de encerramento' : workflow.stage === 'FINISHED' ? 'Encerramento' : ['PREPARATION', 'READY_TO_MOBILIZE', 'MOBILIZATION', 'EXECUTION'].includes(workflow.stage) ? 'Gate de mobilização' : 'Avanço do projeto'}</strong>
              {!['DEMOBILIZATION', 'POST_JOB', 'FINAL_MEASUREMENT', 'FINISHED'].includes(workflow.stage) && workflow.mobilizationAuthorization.status === 'AUTHORIZED'
                ? <span>Autorização vigente na versão {workflow.mobilizationAuthorization.authorizedVersion}.</span>
                : footerIssues.length
                  ? <span>{footerIssues.length} bloqueio(s): {footerIssues.slice(0, 3).join(' · ')}{footerIssues.length > 3 ? ` · e mais ${footerIssues.length - 3}` : ''}</span>
                  : workflow.stage === 'DEMOBILIZATION' ? <span>Desmobilização concluída. O projeto pode avançar para Pós-job.</span>
                  : workflow.stage === 'POST_JOB' ? <span>Pós-job concluído. O projeto pode avançar para Documentação / medição.</span>
                  : workflow.stage === 'FINAL_MEASUREMENT' ? <span>Os {workflow.closureGate.total} controles e validações foram concluídos. O projeto pode ser encerrado.</span>
                  : workflow.stage === 'FINISHED' ? <span>Projeto encerrado em modo de consulta. Use a reabertura justificada para corrigir dados.</span>
                  : <span>Requisitos concluídos. Confirme a próxima etapa.</span>}
            </> : null}
          </div>
          <div className="project-workflow-footer-actions">
            <Button variant="secondary" disabled={saving} onClick={onClose}>Fechar</Button>
            {workflow?.stage === 'HANDOVER' && workflow.permissions.canAccept ? <Button disabled={saving || !workflow.handoverGate.ready} onClick={() => onPatch({ action: 'accept', version: workflow.version })}>Assumir e iniciar análise</Button> : null}
            {workflow?.stage !== 'HANDOVER' && workflow?.permissions.canEdit ? transitionOptions.map(option => <Button variant={['PREPARATION', 'READY_TO_MOBILIZE', 'MOBILIZATION', 'EXECUTION', 'DEMOBILIZATION', 'POST_JOB', 'FINAL_MEASUREMENT', 'FINISHED'].includes(option.stage) ? 'primary' : 'secondary'} disabled={saving || !option.allowed} title={option.issues.join(' · ') || undefined} onClick={() => onPatch({ action: 'stage', version: workflow.version, stage: option.stage })} key={option.stage}>{transitionLabel(workflow.stage, option.stage)}</Button>) : null}
            {workflow && ['READY_TO_MOBILIZE', 'MOBILIZATION', 'EXECUTION', 'DEMOBILIZATION'].includes(workflow.stage) && workflow.permissions.canAuthorizeMobilization && (workflow.stage === 'DEMOBILIZATION' ? workflow.mobilizationAuthorization.authorizedVersion !== workflow.version : workflow.mobilizationAuthorization.status !== 'AUTHORIZED') ? <Button disabled={saving || !workflow.mobilizationGate.ready} onClick={() => onPatch({ action: 'authorize_mobilization', version: workflow.version })}>{workflow.stage === 'DEMOBILIZATION' ? 'Revalidar retorno à execução' : 'Revalidar autorização'}</Button> : null}
          </div>
        </footer>
      </div>
    </Modal>
  );
  return createPortal(content, document.body);
}
