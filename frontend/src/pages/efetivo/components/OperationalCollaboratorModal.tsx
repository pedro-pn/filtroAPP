import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { useEffect } from 'react';
import { z } from 'zod';

import type { CollaboratorInput, PlanningCollaborator, PlanningJobRole } from '../../../api/efetivoPlanning';
import { Button } from '../../../components/ui/Button';
import { Modal } from '../../../components/ui/Modal';

const schema = z.object({
  name: z.string().trim().min(1, 'Informe o nome.'),
  jobRoleId: z.string().min(1, 'Selecione a função.'),
  jobRoleEffectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Informe a vigência do cargo.'),
  admissionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Informe a admissão.'),
  terminationDate: z.string(),
  note: z.string().max(1000, 'Use no máximo 1.000 caracteres.')
}).refine(value => !value.terminationDate || value.terminationDate >= value.admissionDate, { path: ['terminationDate'], message: 'O desligamento não pode ser anterior à admissão.' })
  .refine(value => value.jobRoleEffectiveDate >= value.admissionDate, { path: ['jobRoleEffectiveDate'], message: 'A vigência não pode ser anterior à admissão.' });

type FormValues = z.infer<typeof schema>;

function initialValues(collaborator: PlanningCollaborator | null): FormValues {
  return {
    name: collaborator?.name || '',
    jobRoleId: collaborator?.jobRoleId || '',
    jobRoleEffectiveDate: new Date().toISOString().slice(0, 10),
    admissionDate: collaborator?.admissionDate?.slice(0, 10) || '',
    terminationDate: collaborator?.terminationDate?.slice(0, 10) || '',
    note: ''
  };
}

export function OperationalCollaboratorModal({ open, collaborator, jobRoles, saving, onClose, onSubmit }: {
  open: boolean;
  collaborator: PlanningCollaborator | null;
  jobRoles: PlanningJobRole[];
  saving: boolean;
  onClose: () => void;
  onSubmit: (payload: CollaboratorInput) => void;
}) {
  const { register, handleSubmit, reset, formState: { errors } } = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: initialValues(collaborator) });
  useEffect(() => { if (open) reset(initialValues(collaborator)); }, [collaborator, open, reset]);
  return (
    <Modal open={open} onClose={onClose} ariaLabelledBy="operational-collaborator-title" panelClassName="modal-card efetivo-modal">
      <form className="efetivo-modal-layout" noValidate onSubmit={handleSubmit(values => onSubmit({ name: values.name.trim(), jobRoleId: values.jobRoleId, jobRoleEffectiveDate: values.jobRoleEffectiveDate, admissionDate: values.admissionDate, terminationDate: values.terminationDate || null, note: values.note.trim() || null }))}>
        <header className="efetivo-modal-header"><div><h3 id="operational-collaborator-title">{collaborator ? 'Editar colaborador' : 'Novo colaborador'}</h3><p>Estes campos atualizam o cadastro canônico usado pelo APP.</p></div><button className="icon-button" type="button" aria-label="Fechar" onClick={onClose}>×</button></header>
        <div className="efetivo-modal-body efetivo-form-grid">
          <div className={`field-group ${errors.name ? 'field-invalid' : ''}`}><label htmlFor="operational-collaborator-name">Nome *</label><input id="operational-collaborator-name" aria-invalid={Boolean(errors.name)} disabled={saving} {...register('name')} />{errors.name ? <span className="field-error" role="alert">{errors.name.message}</span> : null}</div>
          <div className={`field-group ${errors.jobRoleId ? 'field-invalid' : ''}`}>
            <label htmlFor="operational-collaborator-role">Função *</label>
            <select id="operational-collaborator-role" disabled={saving} aria-invalid={Boolean(errors.jobRoleId)} {...register('jobRoleId')}>
              <option value="">Selecione</option>
              {jobRoles.filter(item => item.isOperational).map(item => <option value={item.id} key={item.id}>{item.name}</option>)}
            </select>
            {errors.jobRoleId ? <span className="field-error" role="alert">{errors.jobRoleId.message}</span> : null}
          </div>
          <div className={`field-group ${errors.jobRoleEffectiveDate ? 'field-invalid' : ''}`}><label htmlFor="operational-collaborator-role-date">Cargo vigente desde *</label><input id="operational-collaborator-role-date" type="date" max={new Date().toISOString().slice(0, 10)} aria-invalid={Boolean(errors.jobRoleEffectiveDate)} disabled={saving} {...register('jobRoleEffectiveDate')} />{errors.jobRoleEffectiveDate ? <span className="field-error" role="alert">{errors.jobRoleEffectiveDate.message}</span> : null}</div>
          <div className={`field-group ${errors.admissionDate ? 'field-invalid' : ''}`}><label htmlFor="operational-collaborator-admission">Admissão *</label><input id="operational-collaborator-admission" type="date" aria-invalid={Boolean(errors.admissionDate)} disabled={saving} {...register('admissionDate')} />{errors.admissionDate ? <span className="field-error" role="alert">{errors.admissionDate.message}</span> : null}</div>
          <div className={`field-group ${errors.terminationDate ? 'field-invalid' : ''}`}><label htmlFor="operational-collaborator-termination">Desligamento</label><input id="operational-collaborator-termination" type="date" aria-invalid={Boolean(errors.terminationDate)} disabled={saving} {...register('terminationDate')} />{errors.terminationDate ? <span className="field-error" role="alert">{errors.terminationDate.message}</span> : null}</div>
          <div className={`field-group efetivo-form-wide ${errors.note ? 'field-invalid' : ''}`}><label htmlFor="operational-collaborator-note">Observação operacional</label><textarea id="operational-collaborator-note" rows={4} aria-invalid={Boolean(errors.note)} disabled={saving} {...register('note')} />{errors.note ? <span className="field-error" role="alert">{errors.note.message}</span> : null}</div>
        </div>
        <footer className="efetivo-modal-footer"><Button variant="secondary" onClick={onClose} disabled={saving}>Cancelar</Button><Button type="submit" disabled={saving}>{saving ? 'Salvando…' : 'Salvar colaborador'}</Button></footer>
      </form>
    </Modal>
  );
}
