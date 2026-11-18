import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { createJobRole, deactivateJobRole, listJobRoles, updateJobRole } from '../../api/jobRoles';
import { useToast } from '../ui/ToastContext';

// Administração da lista de cargos (JobRole). Permite adicionar, renomear e desativar/reativar.
export function JobRoleManager() {
  const queryClient = useQueryClient();
  const showToast = useToast();
  const { data, isLoading } = useQuery({ queryKey: ['job-roles', 'all'], queryFn: () => listJobRoles(true) });

  const [newName, setNewName] = useState('');
  const [newIsOperational, setNewIsOperational] = useState(true);
  const [newNameError, setNewNameError] = useState('');
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [editingNameError, setEditingNameError] = useState('');

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['job-roles'] });

  const createMutation = useMutation({
    mutationFn: (payload: { name: string; isOperational: boolean }) => createJobRole(payload),
    onSuccess: () => {
      showToast('Cargo adicionado.');
      setNewName('');
      setNewIsOperational(true);
      setNewNameError('');
      setShowCreateForm(false);
      invalidate();
    },
    onError: () => showToast('Não foi possível adicionar (nome já existe?).')
  });

  const updateMutation = useMutation({
    mutationFn: (payload: { id: string; data: { name?: string; isActive?: boolean; isOperational?: boolean } }) => updateJobRole(payload.id, payload.data),
    onSuccess: () => { showToast('Cargo atualizado.'); setEditing(null); setEditingNameError(''); invalidate(); },
    onError: () => showToast('Não foi possível atualizar o cargo.')
  });

  const deactivateMutation = useMutation({
    mutationFn: (id: string) => deactivateJobRole(id),
    onSuccess: () => { showToast('Cargo desativado.'); invalidate(); },
    onError: () => showToast('Não foi possível desativar o cargo.')
  });

  const roles = data ?? [];

  function handleCreateSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = newName.trim();
    if (!name) {
      setNewNameError('Informe o nome do cargo.');
      return;
    }
    if (createMutation.isPending) return;
    createMutation.mutate({ name, isOperational: newIsOperational });
  }

  function handleEditSave(roleId: string) {
    const name = editing?.name.trim() ?? '';
    if (!name) {
      setEditingNameError('Informe o nome do cargo.');
      return;
    }
    updateMutation.mutate({ id: roleId, data: { name } });
  }

  return (
    <div className="page-card">
      <div className="admin-toolbar">
        <div className="sec">Cargos</div>
        {!showCreateForm ? (
          <button className="mini-btn" type="button" onClick={() => setShowCreateForm(true)}>
            + Novo cargo
          </button>
        ) : null}
      </div>
      <p className="placeholder-copy" style={{ margin: '4px 0 10px' }}>
        Lista usada no cadastro de colaboradores. Cargos inativos não aparecem na seleção.
      </p>
      {showCreateForm ? (
        <form className="admin-inline-form" onSubmit={handleCreateSubmit} autoComplete="off">
          <div className="admin-toolbar full">
            <div className="sec">Novo cargo</div>
            <button className="mini-btn alt" type="button" onClick={() => { setShowCreateForm(false); setNewName(''); setNewNameError(''); setNewIsOperational(true); }}>
              Cancelar
            </button>
          </div>
          <div className="admin-inline-grid">
            <div className={newNameError ? 'field-group field-group-wide field-invalid' : 'field-group field-group-wide'}>
              <label htmlFor="job-role-name">Nome do cargo</label>
              <input
                id="job-role-name"
                value={newName}
                autoComplete="off"
                aria-invalid={Boolean(newNameError)}
                aria-describedby={newNameError ? 'job-role-name-error' : undefined}
                onChange={event => { setNewName(event.target.value); if (newNameError) setNewNameError(''); }}
              />
              {newNameError ? <small id="job-role-name-error" className="field-error">{newNameError}</small> : null}
            </div>
            <div className="field-group field-group-wide">
              <label className="equip-toggle">
                <input
                  type="checkbox"
                  checked={newIsOperational}
                  onChange={event => setNewIsOperational(event.target.checked)}
                />
                Cargo operacional
              </label>
              <span className="placeholder-copy">Cargos administrativos ficam fora da Taxa Geral da aba Colaboradores.</span>
            </div>
            <div className="admin-form-actions">
              <button className="mini-btn" type="submit" disabled={createMutation.isPending}>
                Salvar
              </button>
            </div>
          </div>
        </form>
      ) : null}
      {isLoading ? (
        <div className="placeholder-copy">Carregando cargos…</div>
      ) : (
        <ul className="admin-stack" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {roles.map(role => (
            <li key={role.id} className="det-row job-role-row">
              {editing?.id === role.id ? (
                <>
                  <div className={editingNameError ? 'field-group field-invalid job-role-edit-field' : 'field-group job-role-edit-field'}>
                    <label htmlFor={`job-role-edit-${role.id}`}>Nome do cargo</label>
                    <input
                      id={`job-role-edit-${role.id}`}
                      value={editing.name}
                      aria-invalid={Boolean(editingNameError)}
                      aria-describedby={editingNameError ? `job-role-edit-${role.id}-error` : undefined}
                      onChange={event => { setEditing({ id: role.id, name: event.target.value }); if (editingNameError) setEditingNameError(''); }}
                    />
                    {editingNameError ? <small id={`job-role-edit-${role.id}-error`} className="field-error">{editingNameError}</small> : null}
                  </div>
                  <button
                    className="mini-btn"
                    type="button"
                    disabled={updateMutation.isPending}
                    onClick={() => handleEditSave(role.id)}
                  >
                    Salvar
                  </button>
                  <button className="mini-btn alt" type="button" onClick={() => { setEditing(null); setEditingNameError(''); }}>Cancelar</button>
                </>
              ) : (
                <>
                  <span className="job-role-name" style={{ opacity: role.isActive ? 1 : 0.5 }}>
                    <strong>{role.name}{role.isActive ? '' : ' (inativo)'}</strong>
                    <small>{role.isOperational ? 'Operacional' : 'Administrativo'}</small>
                  </span>
                  <label className="equip-toggle compact job-role-operational-toggle">
                    <input
                      type="checkbox"
                      checked={role.isOperational}
                      disabled={updateMutation.isPending}
                      onChange={event => updateMutation.mutate({ id: role.id, data: { isOperational: event.target.checked } })}
                    />
                    Operacional
                  </label>
                  <button className="mini-btn" type="button" onClick={() => { setEditing({ id: role.id, name: role.name }); setEditingNameError(''); }}>Renomear</button>
                  {role.isActive ? (
                    <button className="mini-btn danger" type="button" disabled={deactivateMutation.isPending} onClick={() => deactivateMutation.mutate(role.id)}>Desativar</button>
                  ) : (
                    <button className="mini-btn" type="button" disabled={updateMutation.isPending} onClick={() => updateMutation.mutate({ id: role.id, data: { isActive: true } })}>Reativar</button>
                  )}
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
