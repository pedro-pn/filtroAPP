import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect } from 'react';
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
  ProjectWorkflow
} from '../../../api/projectWorkflow';
import { Button } from '../../../components/ui/Button';
import { Modal } from '../../../components/ui/Modal';
import { displayDateOnly } from '../../../utils/calendarGrid';
import { WORKFLOW_STAGE_LABELS } from '../../../utils/projectWorkflow';

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

function commercialFactSchema(item: ProjectWorkflowCommercialFact) {
  return z.object({
    status: z.enum(['PENDING', 'CONFIRMED', 'NOT_APPLICABLE']),
    reference: z.string().trim().max(500, 'A referência deve ter no máximo 500 caracteres.'),
    note: z.string().trim().max(1000, 'A observação deve ter no máximo 1000 caracteres.'),
    occurredOn: z.string()
  }).superRefine((value, ctx) => {
    if (value.status === 'NOT_APPLICABLE') {
      if (!item.allowNotApplicable) ctx.addIssue({ code: 'custom', path: ['status'], message: 'Este fato não aceita “não aplicável”.' });
      if (!value.note) ctx.addIssue({ code: 'custom', path: ['note'], message: 'Justifique por que este fato não se aplica.' });
    }
    if (value.status !== 'CONFIRMED') return;
    if (!value.occurredOn) ctx.addIssue({ code: 'custom', path: ['occurredOn'], message: 'Informe a data da confirmação.' });
    if (item.evidence === 'reference' && !value.reference) ctx.addIssue({ code: 'custom', path: ['reference'], message: 'Informe a referência ou número do documento.' });
    if (item.evidence === 'note' && !value.note) ctx.addIssue({ code: 'custom', path: ['note'], message: 'Descreva a condição comercial definida.' });
  });
}
type CommercialFactValues = { status: ProjectWorkflowCommercialFactStatus; reference: string; note: string; occurredOn: string };

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

function WorkflowChecklistSection({ title, description, items, version, saving, onPatch, className = '' }: {
  title: string;
  description?: string;
  items: ProjectWorkflowChecklist[];
  version: number;
  saving: boolean;
  onPatch: (payload: ProjectWorkflowPatch) => void;
  className?: string;
}) {
  const completed = items.filter(item => item.status !== 'PENDING').length;
  return (
    <section className={`project-workflow-section ${className}`.trim()}>
      <header><div><h4>{title}</h4>{description ? <p>{description}</p> : null}</div><span>{completed}/{items.length}</span></header>
      {items.map(item => <ChecklistEditor item={item} version={version} saving={saving} canEdit={item.canEdit} onPatch={onPatch} key={item.key} />)}
    </section>
  );
}

function MobilizationGate({ workflow }: { workflow: ProjectWorkflow }) {
  const authorization = workflow.mobilizationAuthorization;
  const statusLabel = authorization.status === 'AUTHORIZED'
    ? '🔒 Autorizado para mobilização'
    : authorization.status === 'SUSPENDED' ? '🔴 Autorização suspensa'
      : workflow.mobilizationGate.ready ? '🟢 Pronto para autorizar' : '🔴 Bloqueado';
  return (
    <section className={`project-workflow-gate-panel is-${authorization.status.toLowerCase()}`} data-project-workflow-gate>
      <header><div><h4>Gate de mobilização</h4><p>As nove frentes e o pré-job precisam permanecer liberados na mesma versão.</p></div><strong>{statusLabel}</strong></header>
      <div className="project-workflow-gate-table" role="table" aria-label="Prontidão para mobilização">
        <div className="project-workflow-gate-table-head" role="row"><span role="columnheader">Frente</span><span role="columnheader">Situação</span><span role="columnheader">Progresso</span></div>
        {workflow.mobilizationGate.fronts.map(front => <div className="project-workflow-gate-row" role="row" key={front.key}><strong role="cell">{front.label}</strong><span role="cell" className={front.status === 'READY' ? 'is-ready' : 'is-blocked'}>{front.status === 'READY' ? '🟢 Liberada' : '🔴 Pendente'}</span><span role="cell">{front.completed}/{front.total}</span></div>)}
      </div>
      <div className={`project-workflow-pre-job-status is-${workflow.mobilizationGate.preJob.status.toLowerCase()}`}><strong>Pré-job</strong><span>{workflow.mobilizationGate.preJob.status === 'READY' ? '🟢 Realizado' : `🔴 ${workflow.mobilizationGate.preJob.completed}/${workflow.mobilizationGate.preJob.total}`}</span></div>
      {workflow.mobilizationGate.blockers.length ? <details><summary>{workflow.mobilizationGate.blockers.length} bloqueio(s) para mobilizar</summary><ul>{workflow.mobilizationGate.blockers.slice(0, 12).map((item, index) => <li key={`${item.front}-${item.key}-${index}`}>{item.label}: {item.reason}</li>)}</ul>{workflow.mobilizationGate.blockers.length > 12 ? <p>Existem mais {workflow.mobilizationGate.blockers.length - 12} bloqueio(s).</p> : null}</details> : null}
      {authorization.authorizedAt ? <small>Última emissão: {new Date(authorization.authorizedAt).toLocaleString('pt-BR')} · versão {authorization.authorizedVersion}</small> : null}
    </section>
  );
}

function transitionLabel(current: ProjectWorkflow['stage'], target: ProjectWorkflow['stage']) {
  if (target === 'READY_TO_MOBILIZE') return 'Autorizar mobilização';
  if (target === 'PREPARATION') return current === 'READY_TO_MOBILIZE' ? 'Voltar para preparação' : 'Iniciar preparação D-15';
  if (target === 'MOBILIZATION_PLANNING') return current === 'PREPARATION' ? 'Voltar ao planejamento' : 'Iniciar planejamento';
  if (target === 'WAITING_PLANNING') return 'Aguardar planejamento';
  return 'Voltar para análise';
}

function CommercialFactEditor({ item, version, saving, canEdit, onPatch }: {
  item: ProjectWorkflowCommercialFact;
  version: number;
  saving: boolean;
  canEdit: boolean;
  onPatch: (payload: ProjectWorkflowPatch) => void;
}) {
  const schema = commercialFactSchema(item);
  const { register, handleSubmit, reset, watch, formState: { errors, isDirty } } = useForm<CommercialFactValues>({
    resolver: zodResolver(schema),
    defaultValues: { status: item.status, reference: item.reference || '', note: item.note || '', occurredOn: item.occurredOn || '' }
  });
  useEffect(() => reset({ status: item.status, reference: item.reference || '', note: item.note || '', occurredOn: item.occurredOn || '' }), [item.note, item.occurredOn, item.reference, item.status, reset]);
  const status = watch('status');
  const readOnly = item.readOnly || !canEdit;
  return (
    <form className={`project-workflow-commercial-fact ${item.readOnly ? 'is-crm' : ''}`} noValidate onSubmit={handleSubmit(values => onPatch({
      action: 'commercial_fact', version, key: item.key, status: values.status,
      reference: values.reference || null, note: values.note || null, occurredOn: values.occurredOn || null
    }))}>
      <header><div><strong>{item.label}</strong><span>{item.source === 'CRM' ? 'Sincronizado pelo CRM' : 'Registro manual'}</span></div><span className={`project-workflow-fact-status is-${item.status.toLowerCase()}`}>{item.status === 'CONFIRMED' ? 'Confirmado' : item.status === 'NOT_APPLICABLE' ? 'Não aplicável' : 'Pendente'}</span></header>
      <div className="project-workflow-commercial-fields">
        <div className={fieldClass(errors.status)}><label htmlFor={`commercial-status-${item.key}`}>Situação *</label><select id={`commercial-status-${item.key}`} disabled={saving || readOnly} aria-invalid={Boolean(errors.status)} {...register('status')}><option value="PENDING">Pendente</option><option value="CONFIRMED">Confirmado</option>{item.allowNotApplicable ? <option value="NOT_APPLICABLE">Não aplicável</option> : null}</select>{errors.status ? <span className="field-error">{errors.status.message}</span> : null}</div>
        <div className={fieldClass(errors.occurredOn)}><label htmlFor={`commercial-date-${item.key}`}>Data da confirmação {status === 'CONFIRMED' ? '*' : ''}</label><input id={`commercial-date-${item.key}`} type="date" disabled={saving || readOnly || status !== 'CONFIRMED'} aria-invalid={Boolean(errors.occurredOn)} {...register('occurredOn')} />{errors.occurredOn ? <span className="field-error">{errors.occurredOn.message}</span> : null}</div>
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

export function ProjectWorkflowModal({ detail, leaders, loading, error, saving, onRetry, onClose, onStart, onPatch }: {
  detail: ProjectWorkflowDetail | null;
  leaders: Array<{ id: string; name: string }>;
  loading: boolean;
  error: boolean;
  saving: boolean;
  onRetry: () => void;
  onClose: () => void;
  onStart: (values: StartValues) => void;
  onPatch: (payload: ProjectWorkflowPatch) => void;
}) {
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
  const transitionOptions = workflow?.transitionOptions || [];
  const nextMilestoneText = !workflow
    ? '—'
    : workflow.milestones.nextMilestone
      ? `${workflow.milestones.nextMilestone.label} · ${displayDateOnly(workflow.milestones.nextMilestone.date)}`
      : workflow.milestones.daysUntilMobilization == null ? 'Data não definida' : 'Marcos preventivos atingidos';
  const documentationStatus = workflow?.documentationReadiness.status === 'OK'
    ? '🟢 OK'
    : workflow?.documentationReadiness.status === 'CRITICAL' ? '🔴 Crítica' : '🟡 Em andamento';
  const footerIssues = workflow?.stage === 'HANDOVER'
    ? (workflow.permissions.canAccept ? workflow.handoverGate.issues : [`Aguardando ${workflow.leader.name} assumir formalmente o projeto`])
    : workflow?.stage === 'READY_TO_MOBILIZE'
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
            detail.permissions.canInitialize
              ? <StartWorkflowForm detail={detail} leaders={leaders} saving={saving} onStart={onStart} />
              : <section className="placeholder-copy"><h4>Gestão ainda não iniciada</h4><p>O gestor do Efetivo precisa iniciar o handover e designar o Líder de Projetos.</p></section>
          ) : (
            <>
              <section className="project-workflow-status-block"><div><span>Etapa atual</span><strong>{WORKFLOW_STAGE_LABELS[workflow.stage]}</strong></div><div><span>Líder</span><strong>{workflow.leader.name}</strong></div><div><span>Mobilização prevista</span><strong>{displayDateOnly(workflow.plannedMobilizationDate)}</strong></div><div><span>Próximo marco</span><strong>{nextMilestoneText}</strong></div></section>
              {workflow.milestones.dueMilestones.length ? <section className="project-workflow-milestones" aria-label="Marcos de mobilização atingidos"><strong>Atenção aos prazos</strong><span>{workflow.milestones.dueMilestones.map(key => key.replace('D', 'D-')).join(' · ')} já atingido(s); execute agora as verificações pendentes.</span></section> : null}
              {workflow.mobilizationGate.deadlineStatus === 'ATTENTION' ? <section className="project-workflow-deadline-risk is-attention"><strong>🟡 D-7 atingido</strong><span>{workflow.mobilizationGate.blockers.length} bloqueio(s) ainda precisam ser resolvidos.</span></section> : null}
              {workflow.mobilizationGate.deadlineStatus === 'RISK' ? <section className="project-workflow-deadline-risk is-risk"><strong>🔴 Risco de mobilização</strong><span>D-1 atingido com {workflow.mobilizationGate.blockers.length} bloqueio(s).</span></section> : null}
              <WorkflowSettingsForm detail={detail} leaders={leaders} saving={saving} onPatch={onPatch} />
              <section className={`project-workflow-section project-workflow-commercial is-${workflow.commercialReadiness.status.toLowerCase()}`} data-project-workflow-commercial><header><div><h4>Liberação comercial e contratual</h4><p>A análise e o planejamento podem continuar; pendências bloqueiam compra, contratação e mobilização.</p></div><span>{workflow.commercialReadiness.status === 'RELEASED' ? '🟢 Liberado' : `🔴 Não liberado · ${workflow.commercialReadiness.resolvedCount}/${workflow.commercialReadiness.totalCount}`}</span></header><div className="project-workflow-commercial-list">{workflow.commercialFacts.map(item => <CommercialFactEditor item={item} version={workflow.version} saving={saving} canEdit={workflow.permissions.canEditCommercial} onPatch={onPatch} key={item.key} />)}</div></section>
              {workflow.stage === 'HANDOVER' ? <WorkflowChecklistSection title="Checklist do handover" items={stageChecklists} version={workflow.version} saving={saving} onPatch={onPatch} /> : null}
              {workflow.stage === 'INITIAL_ANALYSIS' ? <WorkflowChecklistSection title="Checklist da análise inicial" items={stageChecklists} version={workflow.version} saving={saving} onPatch={onPatch} /> : null}
              {workflow.stage === 'WAITING_PLANNING' ? <section className="project-workflow-section project-workflow-waiting"><header><div><h4>🕐 Aguardando D-30</h4><p>A análise foi concluída. O sistema continua acompanhando itens críticos e documentação até o início do planejamento.</p></div><span>{workflow.milestones.d30Date ? displayDateOnly(workflow.milestones.d30Date) : 'Data não definida'}</span></header></section> : null}
              <WorkflowChecklistSection title="Documentação antecipada" description="Requisitos do cliente, exames, treinamentos, certificações e regularização da equipe." items={documentationChecklists} version={workflow.version} saving={saving} onPatch={onPatch} className={`project-workflow-documentation is-${workflow.documentationReadiness.status.toLowerCase()}`} />
              <div className="project-workflow-readiness-caption"><strong>Documentação para mobilização: {documentationStatus}</strong><span>{workflow.documentationReadiness.completed}/{workflow.documentationReadiness.total} itens resolvidos</span></div>
              {workflow.stage === 'MOBILIZATION_PLANNING' ? <section className="project-workflow-planning" data-project-workflow-d30><header><div><h4>Planejamento da mobilização · D-30</h4><p>Previsões organizadas por área responsável.</p></div><strong>{workflow.planningReadiness.completed}/{workflow.planningReadiness.total} · {workflow.planningReadiness.percentage}%</strong></header><div className="project-workflow-planning-grid">{planningSections.map(([section, title]) => <WorkflowChecklistSection title={title} items={workflow.checklists.filter(item => item.section === section)} version={workflow.version} saving={saving} onPatch={onPatch} key={section} />)}</div></section> : null}
              {workflow.stage === 'PREPARATION' || workflow.stage === 'READY_TO_MOBILIZE' ? <section className="project-workflow-planning" data-project-workflow-d15><header><div><h4>Preparação para mobilização · D-15</h4><p>Confirmações definitivas por frente responsável.</p></div><strong>{workflow.preparationReadiness.completed}/{workflow.preparationReadiness.total} · {workflow.preparationReadiness.percentage}%</strong></header><div className="project-workflow-planning-grid">{preparationSections.map(([section, title]) => <WorkflowChecklistSection title={title} items={workflow.checklists.filter(item => item.section === section)} version={workflow.version} saving={saving} onPatch={onPatch} key={section} />)}</div></section> : null}
              {workflow.stage === 'PREPARATION' || workflow.stage === 'READY_TO_MOBILIZE' ? <MobilizationGate workflow={workflow} /> : null}
              {workflow.stage !== 'HANDOVER' ? <section className="project-workflow-section"><header><h4>Itens críticos</h4><span>{workflow.criticalAnswers.filter(item => item.answer !== null).length}/{workflow.criticalAnswers.length}</span></header>{workflow.criticalAnswers.map(item => <article className="project-workflow-critical" key={item.key}><span>{item.label}</span><div><Button variant={item.answer === true ? 'primary' : 'secondary'} disabled={saving || !workflow.permissions.canEdit} onClick={() => onPatch({ action: 'critical', version: workflow.version, key: item.key, answer: true })}>Sim</Button><Button variant={item.answer === false ? 'primary' : 'secondary'} disabled={saving || !workflow.permissions.canEdit} onClick={() => onPatch({ action: 'critical', version: workflow.version, key: item.key, answer: false })}>Não</Button></div></article>)}</section> : null}
              {workflow.issues.length ? <section className="project-workflow-section"><header><h4>Pendências</h4><span>{workflow.issues.filter(item => item.status !== 'RESOLVED').length} abertas</span></header>{workflow.issues.map(issue => <IssueEditor issue={issue} version={workflow.version} saving={saving} canEdit={workflow.permissions.canEdit} onPatch={onPatch} key={issue.id} />)}</section> : null}
              {['MOBILIZATION_PLANNING', 'PREPARATION', 'READY_TO_MOBILIZE'].includes(workflow.stage) ? <a className="mini-btn project-workflow-planning-link" href={`/efetivo?section=missoes&search=${encodeURIComponent(detail.project.code)}`}>Abrir programação da equipe</a> : null}
            </>
          )}
        </div>
        <footer className="efetivo-modal-footer project-workflow-modal-footer"><div className="project-workflow-footer-status" aria-live="polite">{workflow ? <><strong>{workflow.stage === 'HANDOVER' ? 'Gate do handover' : ['PREPARATION', 'READY_TO_MOBILIZE'].includes(workflow.stage) ? 'Gate de mobilização' : 'Avanço do projeto'}</strong>{workflow.mobilizationAuthorization.status === 'AUTHORIZED' ? <span>Autorização vigente na versão {workflow.mobilizationAuthorization.authorizedVersion}.</span> : footerIssues.length ? <span>{footerIssues.length} bloqueio(s): {footerIssues.slice(0, 3).join(' · ')}{footerIssues.length > 3 ? ` · e mais ${footerIssues.length - 3}` : ''}</span> : <span>Requisitos concluídos. Confirme a próxima etapa.</span>}</> : null}</div><div className="project-workflow-footer-actions"><Button variant="secondary" disabled={saving} onClick={onClose}>Fechar</Button>{workflow?.stage === 'HANDOVER' && workflow.permissions.canAccept ? <Button disabled={saving || !workflow.handoverGate.ready} onClick={() => onPatch({ action: 'accept', version: workflow.version })}>Assumir e iniciar análise</Button> : null}{workflow?.stage !== 'HANDOVER' && workflow?.permissions.canEdit ? transitionOptions.map(option => <Button variant={['PREPARATION', 'READY_TO_MOBILIZE'].includes(option.stage) ? 'primary' : 'secondary'} disabled={saving || !option.allowed} title={option.issues.join(' · ') || undefined} onClick={() => onPatch({ action: 'stage', version: workflow.version, stage: option.stage })} key={option.stage}>{transitionLabel(workflow.stage, option.stage)}</Button>) : null}{workflow?.stage === 'READY_TO_MOBILIZE' && workflow.permissions.canAuthorizeMobilization && workflow.mobilizationAuthorization.status !== 'AUTHORIZED' ? <Button disabled={saving || !workflow.mobilizationGate.ready} onClick={() => onPatch({ action: 'authorize_mobilization', version: workflow.version })}>Revalidar autorização</Button> : null}</div></footer>
      </div>
    </Modal>
  );
  return createPortal(content, document.body);
}
