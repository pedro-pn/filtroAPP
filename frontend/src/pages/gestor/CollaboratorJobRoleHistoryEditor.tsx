import { useMemo, useState, type FormEvent } from 'react';

import type { CollaboratorJobRoleHistoryPayload } from '../../api/collaborators';
import type { JobRole } from '../../api/jobRoles';
import { useToast } from '../../components/ui/ToastContext';
import type { Collaborator, CollaboratorJobRoleHistory } from '../../types/domain';

interface Props {
  collaborator: Collaborator;
  jobRoles: JobRole[];
  isPending: boolean;
  onUpdate: (historyId: string, payload: CollaboratorJobRoleHistoryPayload) => Promise<unknown>;
  onRemove: (historyId: string) => Promise<unknown>;
}

const today = () => new Date().toISOString().slice(0, 10);

function dateLabel(value: string) {
  const key = value.slice(0, 10);
  return new Date(`${key}T00:00:00.000Z`).toLocaleDateString('pt-BR', { timeZone: 'UTC' });
}

export function CollaboratorJobRoleHistoryEditor({ collaborator, jobRoles, isPending, onUpdate, onRemove }: Props) {
  const toast = useToast();
  const [editing, setEditing] = useState<CollaboratorJobRoleHistory | null>(null);
  const [jobRoleId, setJobRoleId] = useState(collaborator.jobRoleId);
  const [effectiveDate, setEffectiveDate] = useState(today());
  const [note, setNote] = useState('');
  const history = useMemo(
    () => [...(collaborator.jobRoleHistory || [])].sort((left, right) => right.effectiveDate.localeCompare(left.effectiveDate)),
    [collaborator.jobRoleHistory]
  );
  const roles = useMemo(() => {
    const map = new Map(jobRoles.map(role => [role.id, role]));
    history.forEach(entry => {
      if (!map.has(entry.jobRole.id)) {
        map.set(entry.jobRole.id, {
          id: entry.jobRole.id,
          name: entry.jobRole.name,
          order: Number.MAX_SAFE_INTEGER,
          isActive: Boolean(entry.jobRole.isActive),
          isOperational: Boolean(entry.jobRole.isOperational)
        });
      }
    });
    return [...map.values()].sort((left, right) => left.name.localeCompare(right.name, 'pt-BR'));
  }, [history, jobRoles]);

  function closeForm() {
    setEditing(null);
    setJobRoleId(collaborator.jobRoleId);
    setEffectiveDate(today());
    setNote('');
  }

  function startEdit(entry: CollaboratorJobRoleHistory) {
    setEditing(entry);
    setJobRoleId(entry.jobRoleId);
    setEffectiveDate(entry.effectiveDate.slice(0, 10));
    setNote(entry.note || '');
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const payload = { jobRoleId, effectiveDate, note: note.trim() || null };
    try {
      if (!editing) return;
      await onUpdate(editing.id, payload);
      toast('Histórico de cargos atualizado.', 'success');
      closeForm();
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Não foi possível atualizar o histórico de cargos.', 'error');
    }
  }

  async function remove(historyId: string) {
    try {
      await onRemove(historyId);
      toast('Mudança de cargo excluída.', 'success');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Não foi possível excluir a mudança de cargo.', 'error');
    }
  }

  return (
    <section className="collaborator-role-history" aria-label={`Histórico de cargos de ${collaborator.name}`}>
      <div className="admin-toolbar full">
        <div>
          <div className="sec">Histórico de cargos</div>
          <p className="form-hint">O cargo vigente em cada data determina os parâmetros usados no custo do colaborador.</p>
        </div>
      </div>

      {editing ? (
        <form className="admin-inline-grid collaborator-role-history-form" onSubmit={event => void submit(event)}>
          <div className="field-group">
            <label htmlFor={`role-history-role-${collaborator.id}`}>Cargo</label>
            <select id={`role-history-role-${collaborator.id}`} value={jobRoleId} disabled={isPending} onChange={event => setJobRoleId(event.target.value)} required>
              <option value="" disabled>Selecione o cargo</option>
              {roles.map(role => <option value={role.id} key={role.id}>{role.name}{role.isActive ? '' : ' (inativo)'}</option>)}
            </select>
          </div>
          <div className="field-group">
            <label htmlFor={`role-history-date-${collaborator.id}`}>Vigente desde</label>
            <input id={`role-history-date-${collaborator.id}`} type="date" min={collaborator.admissionDate?.slice(0, 10)} max={today()} value={effectiveDate} disabled={isPending} onChange={event => setEffectiveDate(event.target.value)} required />
          </div>
          <div className="field-group">
            <label htmlFor={`role-history-note-${collaborator.id}`}>Observação</label>
            <input id={`role-history-note-${collaborator.id}`} maxLength={1000} value={note} disabled={isPending} onChange={event => setNote(event.target.value)} placeholder="Ex.: promoção, reenquadramento" />
          </div>
          <div className="admin-form-actions">
            <button className="mini-btn alt" type="button" onClick={closeForm} disabled={isPending}>Cancelar</button>
            <button className="mini-btn" type="submit" disabled={isPending}>{isPending ? 'Salvando…' : 'Atualizar mudança'}</button>
          </div>
        </form>
      ) : null}

      {history.length ? (
        <div className="efetivo-table-wrap">
          <table className="efetivo-table collaborator-role-history-table">
            <thead><tr><th>Vigência</th><th>Cargo</th><th>Observação</th><th>Ações</th></tr></thead>
            <tbody>{history.map(entry => (
              <tr key={entry.id}>
                <td data-label="Vigência">{dateLabel(entry.effectiveDate)}</td>
                <td data-label="Cargo"><strong>{entry.jobRole.name}</strong></td>
                <td data-label="Observação">{entry.note || '—'}</td>
                <td data-label="Ações"><div className="admin-actions"><button className="mini-btn alt" type="button" disabled={isPending} onClick={() => startEdit(entry)}>Editar</button><button className="mini-btn danger" type="button" disabled={isPending || history.length <= 1} title={history.length <= 1 ? 'O único registro de cargo não pode ser excluído.' : undefined} onClick={() => { if (window.confirm('Excluir esta mudança de cargo? Os custos históricos serão recalculados.')) void remove(entry.id); }}>Excluir</button></div></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      ) : <p className="placeholder-copy">Nenhum histórico de cargo cadastrado.</p>}
    </section>
  );
}
