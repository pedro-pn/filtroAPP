import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { makeProjectWorkflowSchemas } from '../../../../../shared/schemas/project-workflow.js';
import type {
  ProjectWorkflowChecklist,
  ProjectWorkflowChecklistStatus,
  ProjectWorkflowDetail,
  ProjectWorkflowIssue,
  ProjectWorkflowPatch
} from '../../../api/projectWorkflow';
import { Button } from '../../../components/ui/Button';
import { Modal } from '../../../components/ui/Modal';
import { displayDateOnly } from '../../../utils/calendarGrid';
import { projectWorkflowStageOptions, WORKFLOW_STAGE_LABELS } from '../../../utils/projectWorkflow';

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
  const currentChecklists = workflow?.checklists.filter(item => item.stage === (workflow.stage === 'HANDOVER' ? 'HANDOVER' : 'INITIAL_ANALYSIS')) || [];
  const stageOptions = workflow ? projectWorkflowStageOptions(workflow.stage) : [];
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
              <section className="project-workflow-status-block"><div><span>Etapa atual</span><strong>{WORKFLOW_STAGE_LABELS[workflow.stage]}</strong></div><div><span>Líder</span><strong>{workflow.leader.name}</strong></div><div><span>Mobilização prevista</span><strong>{displayDateOnly(workflow.plannedMobilizationDate)}</strong></div><div><span>Próximo marco</span><strong>D-30 · {workflow.milestones.d30Date ? displayDateOnly(workflow.milestones.d30Date) : '—'}</strong></div></section>
              <WorkflowSettingsForm detail={detail} leaders={leaders} saving={saving} onPatch={onPatch} />
              <section className="project-workflow-section"><header><h4>{workflow.stage === 'HANDOVER' ? 'Checklist do handover' : 'Checklist da análise inicial'}</h4><span>{currentChecklists.filter(item => item.status !== 'PENDING').length}/{currentChecklists.length}</span></header>{currentChecklists.map(item => <ChecklistEditor item={item} version={workflow.version} saving={saving} canEdit={workflow.permissions.canEdit} onPatch={onPatch} key={item.key} />)}</section>
              {workflow.stage !== 'HANDOVER' ? <section className="project-workflow-section"><header><h4>Itens críticos</h4><span>{workflow.criticalAnswers.filter(item => item.answer !== null).length}/{workflow.criticalAnswers.length}</span></header>{workflow.criticalAnswers.map(item => <article className="project-workflow-critical" key={item.key}><span>{item.label}</span><div><Button variant={item.answer === true ? 'primary' : 'secondary'} disabled={saving || !workflow.permissions.canEdit} onClick={() => onPatch({ action: 'critical', version: workflow.version, key: item.key, answer: true })}>Sim</Button><Button variant={item.answer === false ? 'primary' : 'secondary'} disabled={saving || !workflow.permissions.canEdit} onClick={() => onPatch({ action: 'critical', version: workflow.version, key: item.key, answer: false })}>Não</Button></div></article>)}</section> : null}
              {workflow.issues.length ? <section className="project-workflow-section"><header><h4>Pendências</h4><span>{workflow.issues.filter(item => item.status !== 'RESOLVED').length} abertas</span></header>{workflow.issues.map(issue => <IssueEditor issue={issue} version={workflow.version} saving={saving} canEdit={workflow.permissions.canEdit} onPatch={onPatch} key={issue.id} />)}</section> : null}
              {workflow.permissions.canAccept ? <section className="project-workflow-gate"><div><strong>Gate do handover</strong><p>O aceite confirma formalmente que o líder recebeu o projeto.</p></div><Button disabled={saving} onClick={() => onPatch({ action: 'accept', version: workflow.version })}>Assumir projeto</Button></section> : null}
              {stageOptions.length && workflow.permissions.canEdit ? <section className="project-workflow-gate"><div><strong>Alterar etapa</strong><p>Os gates são conferidos pelo sistema antes do avanço.</p></div><div className="project-workflow-stage-actions">{stageOptions.map(stage => <Button variant="secondary" disabled={saving} onClick={() => onPatch({ action: 'stage', version: workflow.version, stage })} key={stage}>{WORKFLOW_STAGE_LABELS[stage]}</Button>)}</div></section> : null}
              {workflow.stage === 'MOBILIZATION_PLANNING' ? <a className="mini-btn project-workflow-planning-link" href={`/efetivo?section=missoes&search=${encodeURIComponent(detail.project.code)}`}>Abrir programação da equipe</a> : null}
            </>
          )}
        </div>
        <footer className="efetivo-modal-footer"><Button variant="secondary" disabled={saving} onClick={onClose}>Fechar</Button></footer>
      </div>
    </Modal>
  );
  return createPortal(content, document.body);
}
