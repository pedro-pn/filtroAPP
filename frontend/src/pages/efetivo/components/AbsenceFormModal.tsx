import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import type { EfetivoAbsence, EfetivoAbsencePayload, EfetivoCollaboratorOption } from '../../../api/efetivo';
import { Button } from '../../../components/ui/Button';
import { Modal } from '../../../components/ui/Modal';

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Informe uma data válida.');
const absenceFormSchema = z.object({
  collaboratorId: z.string().min(1, 'Selecione o colaborador.'),
  type: z.enum(['FERIAS', 'FOLGA', 'AFASTAMENTO']),
  startDate: dateSchema,
  endDate: dateSchema,
  note: z.string().max(500, 'Use no máximo 500 caracteres.')
}).refine(values => values.endDate >= values.startDate, {
  path: ['endDate'],
  message: 'A data de fim não pode ser anterior à data de início.'
});

type AbsenceFormValues = z.infer<typeof absenceFormSchema>;

interface Props {
  open: boolean;
  absence: EfetivoAbsence | null;
  collaborators: EfetivoCollaboratorOption[];
  saving: boolean;
  onClose: () => void;
  onSubmit: (payload: EfetivoAbsencePayload) => void;
  initialCollaboratorId?: string;
}

function initialValues(absence: EfetivoAbsence | null, initialCollaboratorId = ''): AbsenceFormValues {
  return {
    collaboratorId: absence?.collaboratorId || initialCollaboratorId,
    type: absence?.type || 'FERIAS',
    startDate: absence?.startDate?.slice(0, 10) || '',
    endDate: absence?.endDate?.slice(0, 10) || '',
    note: absence?.note || ''
  };
}

export function AbsenceFormModal({ open, absence, collaborators, saving, onClose, onSubmit, initialCollaboratorId = '' }: Props) {
  const { register, handleSubmit, reset, formState: { errors } } = useForm<AbsenceFormValues>({
    resolver: zodResolver(absenceFormSchema),
    defaultValues: initialValues(absence, initialCollaboratorId)
  });

  useEffect(() => {
    if (open) reset(initialValues(absence, initialCollaboratorId));
  }, [absence, initialCollaboratorId, open, reset]);

  return (
    <Modal open={open} onClose={onClose} ariaLabelledBy="efetivo-absence-title" panelClassName="modal-card efetivo-modal">
      <form
        className="efetivo-modal-layout"
        noValidate
        onSubmit={handleSubmit(values => onSubmit({
          collaboratorId: values.collaboratorId,
          type: values.type,
          startDate: values.startDate,
          endDate: values.endDate,
          note: values.note.trim() || null
        }))}
      >
        <header className="efetivo-modal-header">
          <div>
            <h3 id="efetivo-absence-title">{absence ? 'Editar indisponibilidade' : 'Programar indisponibilidade'}</h3>
            <p>Férias, folga e afastamento bloqueiam a alocação no período inteiro.</p>
          </div>
          <button className="icon-button" type="button" aria-label="Fechar" onClick={onClose} disabled={saving}>×</button>
        </header>
        <div className="efetivo-modal-body efetivo-absence-form-body">
          <div className={errors.collaboratorId ? 'field-group field-invalid' : 'field-group'}>
            <label htmlFor="efetivo-absence-collaborator">Colaborador *</label>
            <select
              id="efetivo-absence-collaborator"
              disabled={Boolean(absence) || saving}
              aria-invalid={Boolean(errors.collaboratorId)}
              {...register('collaboratorId')}
            >
              <option value="">Selecione</option>
              {collaborators.map(collaborator => (
                <option key={collaborator.id} value={collaborator.id}>{collaborator.name} · {collaborator.role}</option>
              ))}
            </select>
            {errors.collaboratorId ? <span className="field-error" role="alert">{errors.collaboratorId.message}</span> : null}
          </div>
          <div className={errors.startDate ? 'field-group field-invalid' : 'field-group'}>
            <label htmlFor="efetivo-absence-start">Início *</label>
            <input id="efetivo-absence-start" type="date" disabled={saving} aria-invalid={Boolean(errors.startDate)} {...register('startDate')} />
            {errors.startDate ? <span className="field-error" role="alert">{errors.startDate.message}</span> : null}
          </div>
          <div className={errors.type ? 'field-group field-invalid' : 'field-group'}>
            <label htmlFor="efetivo-absence-type">Tipo *</label>
            <select id="efetivo-absence-type" disabled={saving} aria-invalid={Boolean(errors.type)} {...register('type')}>
              <option value="FERIAS">Férias</option>
              <option value="FOLGA">Folga</option>
              <option value="AFASTAMENTO">Afastamento</option>
            </select>
            {errors.type ? <span className="field-error" role="alert">{errors.type.message}</span> : null}
          </div>
          <div className={errors.endDate ? 'field-group field-invalid' : 'field-group'}>
            <label htmlFor="efetivo-absence-end">Fim *</label>
            <input id="efetivo-absence-end" type="date" disabled={saving} aria-invalid={Boolean(errors.endDate)} {...register('endDate')} />
            {errors.endDate ? <span className="field-error" role="alert">{errors.endDate.message}</span> : null}
          </div>
          <div className={errors.note ? 'field-group field-invalid' : 'field-group'}>
            <label htmlFor="efetivo-absence-note">Observação</label>
            <textarea id="efetivo-absence-note" rows={4} disabled={saving} aria-invalid={Boolean(errors.note)} {...register('note')} />
            {errors.note ? <span className="field-error" role="alert">{errors.note.message}</span> : null}
          </div>
        </div>
        <footer className="efetivo-modal-footer">
          <Button variant="secondary" type="button" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button type="submit" disabled={saving}>{saving ? 'Salvando…' : 'Salvar indisponibilidade'}</Button>
        </footer>
      </form>
    </Modal>
  );
}
