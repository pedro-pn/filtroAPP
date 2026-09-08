import type { FormEvent, ReactNode } from 'react';

import { useAuth } from '../../auth/AuthContext';
import { EfetivoControlNovelty } from '../../components/EfetivoControlNovelty';

export interface CollaboratorFormState {
  name: string;
  jobRoleId: string;
  jobRoleEffectiveDate: string;
  email: string;
  terminationDate: string;
  signatureImage: string;
  signatureNoticeAccepted: boolean;
  isActive: boolean;
}

interface CollaboratorFormProps {
  idSuffix?: string;
  title: string;
  value: CollaboratorFormState;
  roleOptions: ReactNode;
  signatureField: ReactNode;
  isPending: boolean;
  onChange: (value: CollaboratorFormState) => void;
  onCancel: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}

export function CollaboratorForm({
  idSuffix = '',
  title,
  value,
  roleOptions,
  signatureField,
  isPending,
  onChange,
  onCancel,
  onSubmit
}: CollaboratorFormProps) {
  const { user } = useAuth();
  const id = (field: string) => `collaborator-${field}${idSuffix ? `-${idSuffix}` : ''}`;
  const set = <K extends keyof CollaboratorFormState>(field: K, next: CollaboratorFormState[K]) => {
    onChange({ ...value, [field]: next });
  };

  return (
    <form className="admin-inline-form" onSubmit={onSubmit} autoComplete="off">
      <div className="admin-toolbar full">
        <div className="sec">{title}</div>
        <button className="mini-btn alt" type="button" onClick={onCancel}>Cancelar</button>
      </div>
      <div className="admin-inline-grid">
        <div className="field-group">
          <label htmlFor={id('name')}>Nome</label>
          <input id={id('name')} value={value.name} autoComplete="off" onChange={event => set('name', event.target.value)} required />
        </div>
        <div className="field-group">
          <label htmlFor={id('role')}>Cargo</label>
          <select id={id('role')} value={value.jobRoleId} onChange={event => set('jobRoleId', event.target.value)} required>
            {roleOptions}
          </select>
        </div>
        <div className="field-group">
          <label htmlFor={id('role-effective-date')}>Cargo vigente desde</label>
          <input id={id('role-effective-date')} type="date" max={new Date().toISOString().slice(0, 10)} value={value.jobRoleEffectiveDate} onChange={event => set('jobRoleEffectiveDate', event.target.value)} required />
        </div>
        <div className="field-group">
          <label htmlFor={id('email')}>E-mail</label>
          <input id={id('email')} type="email" value={value.email} autoComplete="off" placeholder="email@empresa.com" onChange={event => set('email', event.target.value)} />
        </div>
        <div className="field-group" data-efetivo-termination-control>
          <label htmlFor={id('termination-date')}>Data de desligamento</label>
          <input id={id('termination-date')} type="date" value={value.terminationDate} onChange={event => set('terminationDate', event.target.value)} />
        </div>
        <div className="field-group">
          <label htmlFor={id('active')}>Status</label>
          <select id={id('active')} value={String(value.isActive)} onChange={event => set('isActive', event.target.value === 'true')}>
            <option value="true">Ativo</option>
            <option value="false">Inativo</option>
          </select>
        </div>
        {signatureField}
        <div className="admin-form-actions">
          <button className="mini-btn" type="submit" disabled={isPending}>Salvar</button>
        </div>
        <EfetivoControlNovelty user={user} control="termination-date" selector="[data-efetivo-termination-control]" />
      </div>
    </form>
  );
}
