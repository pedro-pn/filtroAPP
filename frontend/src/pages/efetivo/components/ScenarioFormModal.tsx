import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import type { PlanningJobRole, ScenarioInput } from '../../../api/efetivoPlanning';
import { Button } from '../../../components/ui/Button';
import { Modal } from '../../../components/ui/Modal';

const schema = z.object({
  name: z.string().trim().min(1, 'Informe o nome do cenário.').max(120),
  objective: z.string().max(1000),
  hireJobRoleId: z.string(),
  hireQuantity: z.number().int().min(0, 'Use um inteiro não negativo.').max(1000),
  hireAvailableFrom: z.string()
}).refine(value => !value.hireQuantity || Boolean(value.hireJobRoleId), { path: ['hireJobRoleId'], message: 'Selecione a função da contratação.' })
  .refine(value => !value.hireQuantity || /^\d{4}-\d{2}-\d{2}$/.test(value.hireAvailableFrom), { path: ['hireAvailableFrom'], message: 'Informe a partir de quando estará disponível.' });

type Values = z.infer<typeof schema>;

export function ScenarioFormModal({ open, saving, roles, defaultAvailableFrom, onClose, onSubmit }: {
  open: boolean;
  saving: boolean;
  roles: PlanningJobRole[];
  defaultAvailableFrom: string;
  onClose: () => void;
  onSubmit: (payload: ScenarioInput) => void;
}) {
  const operationalRoles = roles.filter(role => role.isOperational);
  const defaults: Values = { name: '', objective: '', hireJobRoleId: '', hireQuantity: 0, hireAvailableFrom: defaultAvailableFrom };
  const { register, handleSubmit, reset, formState: { errors } } = useForm<Values>({ resolver: zodResolver(schema), defaultValues: defaults });
  useEffect(() => { if (open) reset(defaults); }, [defaultAvailableFrom, open, reset]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Modal open={open} onClose={onClose} ariaLabelledBy="scenario-form-title" panelClassName="modal-card efetivo-modal">
      <form
        className="efetivo-modal-layout"
        noValidate
        onSubmit={handleSubmit(values => onSubmit({
          name: values.name.trim(),
          objective: values.objective.trim() || null,
          initialHire: values.hireQuantity > 0
            ? { jobRoleId: values.hireJobRoleId, quantity: values.hireQuantity, availableFrom: values.hireAvailableFrom }
            : null
        }))}
      >
        <header className="efetivo-modal-header"><div><h3 id="scenario-form-title">Novo cenário</h3><p>Uma cópia isolada do planejamento oficial será criada.</p></div><button className="icon-button" type="button" aria-label="Fechar" onClick={onClose}>×</button></header>
        <div className="efetivo-modal-body efetivo-form-grid">
          <div className={`field-group efetivo-form-wide ${errors.name ? 'field-invalid' : ''}`}><label htmlFor="scenario-name">Nome do cenário *</label><input id="scenario-name" placeholder="Ex.: Pico de outubro" aria-invalid={Boolean(errors.name)} disabled={saving} {...register('name')} />{errors.name ? <span className="field-error" role="alert">{errors.name.message}</span> : null}</div>
          <div className={`field-group efetivo-form-wide ${errors.objective ? 'field-invalid' : ''}`}><label htmlFor="scenario-objective">Objetivo da simulação</label><textarea id="scenario-objective" rows={3} aria-invalid={Boolean(errors.objective)} disabled={saving} {...register('objective')} />{errors.objective ? <span className="field-error" role="alert">{errors.objective.message}</span> : null}</div>
          <p className="efetivo-form-wide efetivo-form-section-title">Contratação hipotética</p>
          <div className={`field-group ${errors.hireJobRoleId ? 'field-invalid' : ''}`}><label htmlFor="scenario-hire-function">Função</label><select id="scenario-hire-function" aria-invalid={Boolean(errors.hireJobRoleId)} disabled={saving} {...register('hireJobRoleId')}><option value="">Sem contratação</option>{operationalRoles.map(role => <option value={role.id} key={role.id}>{role.name}</option>)}</select>{errors.hireJobRoleId ? <span className="field-error" role="alert">{errors.hireJobRoleId.message}</span> : null}</div>
          <div className="field-group"><label htmlFor="scenario-hire-count">Quantidade</label><input id="scenario-hire-count" type="number" min="0" disabled={saving} {...register('hireQuantity', { valueAsNumber: true })} /></div>
          <div className={`field-group ${errors.hireAvailableFrom ? 'field-invalid' : ''}`}><label htmlFor="scenario-hire-available">Disponíveis a partir de</label><input id="scenario-hire-available" type="date" aria-invalid={Boolean(errors.hireAvailableFrom)} disabled={saving} {...register('hireAvailableFrom')} />{errors.hireAvailableFrom ? <span className="field-error" role="alert">{errors.hireAvailableFrom.message}</span> : <span className="field-hint">Deixe a quantidade em zero para criar o cenário sem contratação.</span>}</div>
        </div>
        <footer className="efetivo-modal-footer"><Button variant="secondary" onClick={onClose} disabled={saving}>Cancelar</Button><Button type="submit" disabled={saving}>{saving ? 'Criando…' : 'Criar cenário'}</Button></footer>
      </form>
    </Modal>
  );
}
