import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import type { EfetivoAbsence, EfetivoAbsencePayload, EfetivoCollaboratorOption } from '../../../api/efetivo';
import { Button, Field, Input, Select, Textarea } from '../../../components/ui/ds';
import { Modal } from '../../../components/ui/Modal';
import '../EfetivoDialogs.css';

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
    <Modal
      open={open}
      onClose={onClose}
      closeOnEscape={!saving}
      showCloseButton={!saving}
      appearance="design-system"
      title={absence ? 'Editar indisponibilidade' : 'Programar indisponibilidade'}
      size="md"
      fullscreenOnMobile={false}
      panelClassName="efetivo-dialog"
      ariaDescribedBy="efetivo-absence-description"
      footer={<>
        <Button variant="secondary" size="sm" onClick={onClose} disabled={saving}>Cancelar</Button>
        <Button variant="primary" size="sm" type="submit" form="efetivo-absence-form" loading={saving}>Salvar indisponibilidade</Button>
      </>}
    >
      <form
        id="efetivo-absence-form"
        className="efetivo-dialog-form"
        noValidate
        onSubmit={handleSubmit(values => onSubmit({
          collaboratorId: values.collaboratorId,
          type: values.type,
          startDate: values.startDate,
          endDate: values.endDate,
          note: values.note.trim() || null
        }))}
      >
        <p className="efetivo-dialog-description" id="efetivo-absence-description">Férias, folga e afastamento bloqueiam a alocação no período inteiro.</p>
        <div className="efetivo-dialog-fields">
          <Field id="efetivo-absence-collaborator" label="Colaborador" required className="efetivo-dialog-wide" errorText={errors.collaboratorId?.message}>
            <Select size="sm" disabled={Boolean(absence) || saving} {...register('collaboratorId')}>
              <option value="">Selecione</option>
              {collaborators.map(collaborator => (
                <option key={collaborator.id} value={collaborator.id}>{collaborator.name} · {collaborator.role}</option>
              ))}
            </Select>
          </Field>
          <Field id="efetivo-absence-type" label="Tipo" required className="efetivo-dialog-wide" errorText={errors.type?.message}>
            <Select size="sm" disabled={saving} {...register('type')}>
              <option value="FERIAS">Férias</option>
              <option value="FOLGA">Folga</option>
              <option value="AFASTAMENTO">Afastamento</option>
            </Select>
          </Field>
          <Field id="efetivo-absence-start" label="Início" required errorText={errors.startDate?.message}>
            <Input size="sm" type="date" disabled={saving} {...register('startDate')} />
          </Field>
          <Field id="efetivo-absence-end" label="Fim" required errorText={errors.endDate?.message}>
            <Input size="sm" type="date" disabled={saving} {...register('endDate')} />
          </Field>
          <Field id="efetivo-absence-note" label="Observação" optionalText="" className="efetivo-dialog-wide" errorText={errors.note?.message}>
            <Textarea size="sm" rows={3} disabled={saving} {...register('note')} />
          </Field>
        </div>
      </form>
    </Modal>
  );
}
