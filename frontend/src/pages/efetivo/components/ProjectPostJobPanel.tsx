import { useEffect } from 'react';
import { useForm, type Resolver } from 'react-hook-form';
import { z } from 'zod';

import { makeProjectWorkflowSchemas } from '../../../../../shared/schemas/project-workflow.js';
import type { ProjectWorkflow, ProjectWorkflowPatch } from '../../../api/projectWorkflow';
import { Button } from '../../../components/ui/Button';
import { displayDateOnly } from '../../../utils/calendarGrid';

type PostJobValues = {
  meetingDate: string;
  fieldLeaderFeedback: string;
  teamFeedback: string;
  problemsFound: string;
  solutionsAdopted: string;
  improvementOpportunities: string;
  lessonsLearned: string;
  equipmentFeedback: string;
  planningFeedback: string;
};

const NARRATIVE_FIELDS: Array<{
  name: Exclude<keyof PostJobValues, 'meetingDate'>;
  id: string;
  label: string;
  rows: number;
  wide?: boolean;
}> = [
  { name: 'fieldLeaderFeedback', id: 'post-job-field-feedback', label: 'Feedback do responsável de campo', rows: 3, wide: true },
  { name: 'teamFeedback', id: 'post-job-team-feedback', label: 'Feedback dos colaboradores', rows: 3, wide: true },
  { name: 'problemsFound', id: 'post-job-problems', label: 'Problemas encontrados', rows: 4 },
  { name: 'solutionsAdopted', id: 'post-job-solutions', label: 'Soluções adotadas', rows: 4 },
  { name: 'improvementOpportunities', id: 'post-job-improvements', label: 'Oportunidades de melhoria', rows: 4 },
  { name: 'lessonsLearned', id: 'post-job-lessons', label: 'Lições aprendidas', rows: 4 },
  { name: 'equipmentFeedback', id: 'post-job-equipment-feedback', label: 'Feedback sobre equipamentos', rows: 4 },
  { name: 'planningFeedback', id: 'post-job-planning-feedback', label: 'Feedback sobre planejamento', rows: 4 }
];

const postJobSchema = makeProjectWorkflowSchemas(z).postJob;

function payloadFromValues(values: PostJobValues, version: number): Extract<ProjectWorkflowPatch, { action: 'post_job' }> {
  const optional = (value: string) => value.trim() || null;
  return {
    action: 'post_job',
    version,
    meetingDate: optional(values.meetingDate),
    fieldLeaderFeedback: optional(values.fieldLeaderFeedback),
    teamFeedback: optional(values.teamFeedback),
    problemsFound: optional(values.problemsFound),
    solutionsAdopted: optional(values.solutionsAdopted),
    improvementOpportunities: optional(values.improvementOpportunities),
    lessonsLearned: optional(values.lessonsLearned),
    equipmentFeedback: optional(values.equipmentFeedback),
    planningFeedback: optional(values.planningFeedback)
  };
}

function resolver(version: number): Resolver<PostJobValues> {
  return async values => {
    const result = postJobSchema.safeParse(payloadFromValues(values, version));
    if (result.success) return { values, errors: {} };
    const errors = (result.error as z.ZodError).issues.reduce<Record<string, { type: string; message: string }>>((all, issue) => {
      const key = String(issue.path[0] || 'form');
      if (!all[key]) all[key] = { type: 'manual', message: issue.message };
      return all;
    }, {});
    return { values: {}, errors };
  };
}

function valuesFor(workflow: ProjectWorkflow): PostJobValues {
  return {
    meetingDate: workflow.postJob.meetingDate || '',
    fieldLeaderFeedback: workflow.postJob.fieldLeaderFeedback || '',
    teamFeedback: workflow.postJob.teamFeedback || '',
    problemsFound: workflow.postJob.problemsFound || '',
    solutionsAdopted: workflow.postJob.solutionsAdopted || '',
    improvementOpportunities: workflow.postJob.improvementOpportunities || '',
    lessonsLearned: workflow.postJob.lessonsLearned || '',
    equipmentFeedback: workflow.postJob.equipmentFeedback || '',
    planningFeedback: workflow.postJob.planningFeedback || ''
  };
}

function serviceLabel(value: string) {
  return value.replaceAll('_', ' ').toLocaleLowerCase('pt-BR').replace(/^./, letter => letter.toLocaleUpperCase('pt-BR'));
}

function narrative(label: string, value: string | null) {
  return value ? <div><strong>{label}</strong><p>{value}</p></div> : null;
}

export function ProjectPostJobPanel({ workflow, saving, onPatch }: {
  workflow: ProjectWorkflow;
  saving: boolean;
  onPatch: (payload: ProjectWorkflowPatch) => void;
}) {
  const { register, handleSubmit, reset, formState: { errors, isDirty } } = useForm<PostJobValues>({
    defaultValues: valuesFor(workflow),
    resolver: resolver(workflow.version)
  });

  useEffect(() => {
    reset(valuesFor(workflow));
  }, [reset, workflow]);

  return (
    <div className="project-post-job-panel">
      <form className="project-post-job-form" onSubmit={handleSubmit(values => onPatch(payloadFromValues(values, workflow.version)))}>
        <div className="project-post-job-service-scope">
          <span>Serviços usados no histórico</span>
          <div>{workflow.postJob.serviceTypes.map(service => <strong key={service}>{serviceLabel(service)}</strong>)}</div>
        </div>
        <div className="project-post-job-grid">
          <div className={errors.meetingDate ? 'field-group field-invalid' : 'field-group'}>
            <label htmlFor="post-job-meeting-date">Data da reunião</label>
            <input id="post-job-meeting-date" type="date" disabled={saving || !workflow.permissions.canEdit} aria-invalid={Boolean(errors.meetingDate)} {...register('meetingDate')} />
            {errors.meetingDate ? <span className="field-error">{errors.meetingDate.message}</span> : null}
          </div>
          <div className="project-post-job-quality-link">
            <span>Registro em Qualidade</span>
            {workflow.postJob.qualityRecord
              ? <a className="equip-link" href="/qualidade?tab=registros">{workflow.postJob.qualityRecord.number} · abrir Qualidade</a>
              : <small>Será criado quando houver uma lição aprendida.</small>}
          </div>
          {NARRATIVE_FIELDS.map(field => (
            <div className={[errors[field.name] ? 'field-group field-invalid' : 'field-group', field.wide ? 'project-post-job-wide' : ''].filter(Boolean).join(' ')} key={field.name}>
              <label htmlFor={field.id}>{field.label}</label>
              <textarea id={field.id} rows={field.rows} maxLength={4000} disabled={saving || !workflow.permissions.canEdit} aria-invalid={Boolean(errors[field.name])} {...register(field.name)} />
              {errors[field.name] ? <span className="field-error">{errors[field.name]?.message}</span> : null}
            </div>
          ))}
        </div>
        {workflow.permissions.canEdit ? <div className="project-workflow-inline-actions"><Button type="submit" disabled={saving || !isDirty}>{saving ? 'Salvando…' : 'Salvar fechamento técnico'}</Button></div> : null}
      </form>

      <section className="project-post-job-history">
        <header><div><h5>Histórico relacionado</h5><p>Pós-jobs do mesmo cliente ou com serviço em comum.</p></div><span>{workflow.relatedPostJobs.length}</span></header>
        {workflow.relatedPostJobs.length ? <div className="project-post-job-history-list">{workflow.relatedPostJobs.map(item => (
          <details key={item.projectId}>
            <summary>
              <span><strong>{item.project.code} · {item.project.name}</strong><small>{item.project.clientName} · {displayDateOnly(item.meetingDate)}</small></span>
              <em>{[item.matches.sameClient ? 'Mesmo cliente' : '', item.matches.services.length ? `Serviço: ${item.matches.services.map(serviceLabel).join(', ')}` : ''].filter(Boolean).join(' · ')}</em>
            </summary>
            <div className="project-post-job-history-content">
              {narrative('Problemas', item.problemsFound)}
              {narrative('Soluções', item.solutionsAdopted)}
              {narrative('Melhorias', item.improvementOpportunities)}
              {narrative('Lições aprendidas', item.lessonsLearned)}
              {narrative('Equipamentos', item.equipmentFeedback)}
              {narrative('Planejamento', item.planningFeedback)}
              {item.qualityRecord ? <a className="equip-link" href="/qualidade?tab=registros">{item.qualityRecord.number} em Qualidade</a> : null}
            </div>
          </details>
        ))}</div> : <p className="placeholder-copy">Ainda não há pós-jobs relacionados a este cliente ou serviço.</p>}
      </section>
    </div>
  );
}
