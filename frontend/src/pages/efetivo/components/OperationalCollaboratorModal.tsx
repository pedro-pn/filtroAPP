import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { useEffect } from 'react';
import { z } from 'zod';

import type { CollaboratorInput, PlanningCollaborator, PlanningJobRole } from '../../../api/efetivoPlanning';
import { Button, Field, Input, Select, Textarea } from '../../../components/ui/ds';
import { Modal } from '../../../components/ui/Modal';
import '../EfetivoDialogs.css';

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
    <Modal
      open={open}
      onClose={onClose}
      closeOnEscape={!saving}
      showCloseButton={!saving}
      appearance="design-system"
      title={collaborator ? 'Editar colaborador' : 'Novo colaborador'}
      size="md"
      fullscreenOnMobile={false}
      panelClassName="efetivo-dialog"
      ariaDescribedBy="operational-collaborator-description"
      footer={<>
        <Button variant="secondary" size="sm" onClick={onClose} disabled={saving}>Cancelar</Button>
        <Button variant="primary" size="sm" type="submit" form="operational-collaborator-form" loading={saving}>Salvar colaborador</Button>
      </>}
    >
      <form
        id="operational-collaborator-form"
        className="efetivo-dialog-form"
        noValidate
        onSubmit={handleSubmit(values => onSubmit({ name: values.name.trim(), jobRoleId: values.jobRoleId, jobRoleEffectiveDate: values.jobRoleEffectiveDate, admissionDate: values.admissionDate, terminationDate: values.terminationDate || null, note: values.note.trim() || null }))}
      >
        <p className="efetivo-dialog-description" id="operational-collaborator-description">Mantenha os dados, a função e o vínculo do colaborador atualizados.</p>
        <div className="efetivo-dialog-fields">
          <Field id="operational-collaborator-name" label="Nome" required errorText={errors.name?.message}>
            <Input size="sm" disabled={saving} {...register('name')} />
          </Field>
          <Field id="operational-collaborator-role" label="Função" required errorText={errors.jobRoleId?.message}>
            <Select size="sm" disabled={saving} {...register('jobRoleId')}>
              <option value="">Selecione</option>
              {jobRoles.filter(item => item.isOperational).map(item => <option value={item.id} key={item.id}>{item.name}</option>)}
            </Select>
          </Field>
          <Field id="operational-collaborator-role-date" label="Cargo vigente desde" required errorText={errors.jobRoleEffectiveDate?.message}>
            <Input size="sm" type="date" max={new Date().toISOString().slice(0, 10)} disabled={saving} {...register('jobRoleEffectiveDate')} />
          </Field>
          <Field id="operational-collaborator-admission" label="Admissão" required errorText={errors.admissionDate?.message}>
            <Input size="sm" type="date" disabled={saving} {...register('admissionDate')} />
          </Field>
          <Field id="operational-collaborator-termination" label="Desligamento" optionalText="" errorText={errors.terminationDate?.message}>
            <Input size="sm" type="date" disabled={saving} {...register('terminationDate')} />
          </Field>
          <Field id="operational-collaborator-note" label="Observação operacional" optionalText="" className="efetivo-dialog-wide" errorText={errors.note?.message}>
            <Textarea size="sm" rows={3} disabled={saving} {...register('note')} />
          </Field>
        </div>
      </form>
    </Modal>
  );
}
