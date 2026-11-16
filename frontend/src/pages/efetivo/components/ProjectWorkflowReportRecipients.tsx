import { useState, type FormEvent } from 'react';
import { z } from 'zod';
import { makeProjectReportRecipientsSchema } from '../../../../../shared/schemas/project-report-recipients.js';
import type { ProjectWorkflow, ProjectWorkflowPatch, ProjectWorkflowProject } from '../../../api/projectWorkflow';
import { ProjectClientFields, type ProjectClientFormState } from '../../../components/projects/ProjectClientFields';
import { Button } from '../../../components/ui/Button';
import { parseEmailList, signerFirstName, signerLastName } from '../../../utils/projectClientContacts';
import { ProjectWorkflowCategory } from './ProjectWorkflowCategory';
import './ProjectWorkflowReportRecipients.css';

const schema = makeProjectReportRecipientsSchema(z);

export function ProjectWorkflowReportRecipients({ project, workflow, saving, onPatch }: {
  project: ProjectWorkflowProject;
  workflow: ProjectWorkflow;
  saving: boolean;
  onPatch: (payload: ProjectWorkflowPatch) => void;
}) {
  const [form, setForm] = useState<ProjectClientFormState>(() => ({
    clientEmailPrimary: project.clientEmailPrimary || '',
    clientSignerFirstName: project.clientSignerFirstName || '',
    clientSignerLastName: project.clientSignerLastName || '',
    clientEmailCc: parseEmailList([...(project.clientEmailCc || []), ...(project.clientSigners || []).map(signer => signer.email)].join('\n')).join('\n'),
    clientSigners: (project.clientSigners || []).map(signer => ({ ...signer, firstName: signerFirstName(signer), lastName: signerLastName(signer) }))
  }));
  const [error, setError] = useState('');
  const savedComplete = schema.safeParse({
    clientEmailPrimary: project.clientEmailPrimary || '',
    clientSignerFirstName: project.clientSignerFirstName || '',
    clientSignerLastName: project.clientSignerLastName || '',
    clientEmailCc: project.clientEmailCc || [],
    clientSigners: (project.clientSigners || []).map(signer => ({ ...signer, firstName: signerFirstName(signer), lastName: signerLastName(signer) }))
  }).success;

  function submit(event: FormEvent) {
    event.preventDefault();
    const result = schema.safeParse({ ...form, clientEmailCc: parseEmailList(form.clientEmailCc) });
    if (!result.success) {
      setError(result.error.issues[0]?.message || 'Revise os destinatários.');
      return;
    }
    setError('');
    onPatch({ action: 'report_recipients', version: workflow.version, ...result.data });
  }

  return <ProjectWorkflowCategory
    title="Destinatários dos relatórios"
    description="Informe o e-mail principal e, se houver, os e-mails em cópia. Marque quais pessoas em cópia também assinam. Os dados ficam salvos no projeto."
    area="Planejamento"
    status={savedComplete ? 'Cadastrados' : 'Preenchimento obrigatório'}
    complete={savedComplete}
    data-project-workflow-report-recipients
  >
    <form className="project-workflow-form project-workflow-report-recipients" onSubmit={submit}>
      <p className="project-workflow-category-note">O e-mail principal é obrigatório. E-mails em cópia são opcionais.</p>
      <fieldset disabled={saving || !workflow.permissions.canEdit}>
        <ProjectClientFields form={form} setForm={setForm} idPrefix={`workflow-${project.id}`} required />
      </fieldset>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      {workflow.permissions.canEdit ? <div className="project-workflow-inline-actions">
        <Button type="submit" disabled={saving}>{saving ? 'Salvando…' : 'Salvar destinatários'}</Button>
      </div> : null}
    </form>
  </ProjectWorkflowCategory>;
}
