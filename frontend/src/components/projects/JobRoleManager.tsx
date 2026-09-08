import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { createJobRole, deactivateJobRole, listJobRoles, updateJobRole } from '../../api/jobRoles';
import { useAuth } from '../../auth/AuthContext';
import { useToast } from '../ui/ToastContext';
import { EfetivoControlNovelty } from '../EfetivoControlNovelty';

// Administração da lista de cargos (JobRole). Permite adicionar, editar e desativar/reativar.
export function JobRoleManager() {
  const queryClient = useQueryClient();
  const showToast = useToast();
  const { user } = useAuth();
  const canManageOperational = user?.accountType === 'ADMIN'
    || Boolean(user?.moduleRoles?.includes('efetivo:manager'));
  const { data, isLoading } = useQuery({ queryKey: ['job-roles', 'all'], queryFn: () => listJobRoles(true) });

  const [newName, setNewName] = useState('');
  const [newIsOperational, setNewIsOperational] = useState(true);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [editing, setEditing] = useState<{ id: string; name: string; isOperational: boolean } | null>(null);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['job-roles'] });

  const createMutation = useMutation({
    mutationFn: (payload: { name: string; isOperational?: boolean }) => createJobRole(payload),
    onSuccess: () => {
      showToast('Cargo adicionado.');
      setNewName('');
      setNewIsOperational(true);
      setShowCreateForm(false);
      invalidate();
    },
    onError: () => showToast('Não foi possível adicionar (nome já existe?).')
  });

  const updateMutation = useMutation({
    mutationFn: (payload: { id: string; data: { name?: string; isActive?: boolean; isOperational?: boolean } }) => updateJobRole(payload.id, payload.data),
    onSuccess: () => { showToast('Cargo atualizado.'); setEditing(null); invalidate(); },
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
    if (!name || createMutation.isPending) return;
    createMutation.mutate({
      name,
      ...(canManageOperational ? { isOperational: newIsOperational } : {})
    });
  }

  function handleEditSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing || !editing.name.trim() || updateMutation.isPending) return;
    updateMutation.mutate({
      id: editing.id,
      data: {
        name: editing.name.trim(),
        ...(canManageOperational ? { isOperational: editing.isOperational } : {})
      }
    });
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
        Lista usada no cadastro de colaboradores. Cargos inativos não aparecem na seleção. A marcação operacional define quem entra no indicador do Efetivo.
      </p>
      {showCreateForm ? (
        <form className="admin-inline-form" onSubmit={handleCreateSubmit} autoComplete="off">
          <div className="admin-toolbar full">
            <div className="sec">Novo cargo</div>
            <button className="mini-btn alt" type="button" onClick={() => { setShowCreateForm(false); setNewName(''); setNewIsOperational(true); }}>
              Cancelar
            </button>
          </div>
          <div className="admin-inline-grid">
            <div className="field-group field-group-wide">
              <label htmlFor="job-role-name">Nome do cargo</label>
              <input
                id="job-role-name"
                value={newName}
                autoComplete="off"
                onChange={event => setNewName(event.target.value)}
                required
              />
            </div>
            <div className="tog-row job-role-operational-field" data-efetivo-operational-control>
              <span className="job-role-operational-copy">
                <span className="tog-lbl">Função operacional</span>
                <span className="placeholder-copy">Inclui este cargo nos indicadores e planejamentos do Efetivo.</span>
              </span>
              <label className="tog">
                <input
                  type="checkbox"
                  checked={newIsOperational}
                  disabled={!canManageOperational || createMutation.isPending}
                  aria-label="Função operacional"
                  onChange={event => setNewIsOperational(event.target.checked)}
                />
                <span className="tog-sl" />
              </label>
            </div>
            <div className="admin-form-actions">
              <button className="mini-btn" type="submit" disabled={createMutation.isPending || !newName.trim()}>
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
            <li key={role.id} className="det-row job-role-row" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              {editing?.id === role.id ? (
                <form className="admin-inline-form" onSubmit={handleEditSubmit} autoComplete="off">
                  <div className="admin-toolbar full">
                    <div className="sec">Editar cargo</div>
                    <button className="mini-btn alt" type="button" onClick={() => setEditing(null)}>Cancelar</button>
                  </div>
                  <div className="admin-inline-grid">
                    <div className="field-group field-group-wide">
                      <label htmlFor={`job-role-name-${role.id}`}>Nome do cargo</label>
                      <input
                        id={`job-role-name-${role.id}`}
                        value={editing.name}
                        autoComplete="off"
                        onChange={event => setEditing({ ...editing, name: event.target.value })}
                        required
                      />
                    </div>
                    <div className="tog-row job-role-operational-field" data-efetivo-operational-control>
                      <span className="job-role-operational-copy">
                        <span className="tog-lbl">Função operacional</span>
                        <span className="placeholder-copy">Inclui este cargo nos indicadores e planejamentos do Efetivo.</span>
                      </span>
                      <label className="tog">
                        <input
                          type="checkbox"
                          checked={editing.isOperational}
                          disabled={!canManageOperational || updateMutation.isPending}
                          aria-label="Função operacional"
                          onChange={event => setEditing({ ...editing, isOperational: event.target.checked })}
                        />
                        <span className="tog-sl" />
                      </label>
                    </div>
                    <div className="admin-form-actions">
                      <button className="mini-btn" type="submit" disabled={updateMutation.isPending || !editing.name.trim()}>
                        Salvar
                      </button>
                    </div>
                  </div>
                </form>
              ) : (
                <>
                  <span style={{ flex: 1, opacity: role.isActive ? 1 : 0.5 }}>
                    {role.name}{role.isActive ? '' : ' (inativo)'}
                  </span>
                  <button
                    className="mini-btn"
                    type="button"
                    onClick={() => setEditing({ id: role.id, name: role.name, isOperational: role.isOperational !== false })}
                  >
                    Editar
                  </button>
                  {role.isActive ? (
                    <button className="mini-btn danger" type="button" disabled={deactivateMutation.isPending} onClick={() => deactivateMutation.mutate(role.id)}>Desativar</button>
                  ) : (
                    <button className="mini-btn" type="button" disabled={updateMutation.isPending} onClick={() => updateMutation.mutate({ id: role.id, data: { isActive: true } })}>Reativar</button>
                  )}
                  {!canManageOperational ? <span className="placeholder-copy">Somente leitura</span> : null}
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {!canManageOperational ? (
        <p className="placeholder-copy">A função operacional só pode ser alterada por um gestor do módulo Efetivo Operacional.</p>
      ) : null}
      <EfetivoControlNovelty user={user} control="operational-role" selector="[data-efetivo-operational-control]" />
    </div>
  );
}
