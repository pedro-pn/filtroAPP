import { useEffect } from 'react';
import { useForm } from 'react-hook-form';

import { Button } from '../../components/ui/ds';
import type { Project } from '../../types/domain';
import {
  pendingProjectReviewPayload,
  pendingProjectReviewResolver,
  pendingProjectReviewValues,
  type PendingProjectReviewValues
} from './projectPendingReview';

interface PendingProjectReviewFormProps {
  project: Project;
  saving: boolean;
  onCancel: () => void;
  onSubmit: (values: PendingProjectReviewValues) => Promise<void> | void;
}

export function PendingProjectReviewForm({ project, saving, onCancel, onSubmit }: PendingProjectReviewFormProps) {
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors }
  } = useForm<PendingProjectReviewValues>({
    defaultValues: pendingProjectReviewValues(project),
    resolver: pendingProjectReviewResolver
  });

  useEffect(() => {
    reset(pendingProjectReviewValues(project));
  }, [project, reset]);

  const field = (name: keyof PendingProjectReviewValues, label: string, readOnly = false) => {
    const error = errors[name];
    const inputId = `pending-project-${name}-${project.id}`;
    const errorId = `${inputId}-error`;
    return (
      <div className={`field-group ${error ? 'field-invalid' : ''}`}>
        <label htmlFor={inputId}>{label}</label>
        <input
          id={inputId}
          readOnly={readOnly}
          aria-invalid={error ? 'true' : 'false'}
          aria-describedby={error ? errorId : undefined}
          {...register(name)}
        />
        {error ? <span className="field-error" id={errorId}>{error.message}</span> : null}
      </div>
    );
  };

  return (
    <form
      className="admin-inline-form admin-inline-grid pending-project-review-form"
      noValidate
      onSubmit={handleSubmit(values => onSubmit(pendingProjectReviewPayload(values)))}
    >
      {field('code', 'Número do projeto', true)}
      {field('name', 'Nome do projeto')}
      {field('clientName', 'Cliente')}
      {field('clientCnpj', 'CNPJ')}
      {field('contractCode', 'Proposta')}
      {field('location', 'Local')}
      <div className="admin-form-actions">
        <Button variant="primary" type="submit" disabled={saving}>Confirmar e salvar</Button>
        <Button variant="secondary" size="sm" type="button" onClick={onCancel}>Cancelar revisão</Button>
      </div>
    </form>
  );
}
