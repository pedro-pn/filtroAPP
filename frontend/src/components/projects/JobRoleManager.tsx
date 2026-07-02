import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { createJobRole, deactivateJobRole, listJobRoles, updateJobRole } from '../../api/jobRoles';
import { useToast } from '../ui/ToastContext';

// Administração da lista de cargos (JobRole). Permite adicionar, renomear e desativar/reativar.
export function JobRoleManager() {
  const queryClient = useQueryClient();
  const showToast = useToast();
  const { data, isLoading } = useQuery({ queryKey: ['job-roles', 'all'], queryFn: () => listJobRoles(true) });

  const [newName, setNewName] = useState('');
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['job-roles'] });

  const createMutation = useMutation({
    mutationFn: (name: string) => createJobRole(name),
    onSuccess: () => { showToast('Cargo adicionado.'); setNewName(''); invalidate(); },
    onError: () => showToast('Não foi possível adicionar (nome já existe?).')
  });

  const updateMutation = useMutation({
    mutationFn: (payload: { id: string; data: { name?: string; isActive?: boolean } }) => updateJobRole(payload.id, payload.data),
    onSuccess: () => { showToast('Cargo atualizado.'); setEditing(null); invalidate(); },
    onError: () => showToast('Não foi possível atualizar o cargo.')
  });

  const deactivateMutation = useMutation({
    mutationFn: (id: string) => deactivateJobRole(id),
    onSuccess: () => { showToast('Cargo desativado.'); invalidate(); },
    onError: () => showToast('Não foi possível desativar o cargo.')
  });

  const roles = data ?? [];

  return (
    <div className="page-card">
      <div className="sec">Cargos</div>
      <p className="placeholder-copy" style={{ margin: '4px 0 10px' }}>
        Lista usada no cadastro de colaboradores. Cargos inativos não aparecem na seleção.
      </p>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <input
          placeholder="Novo cargo"
          value={newName}
          onChange={event => setNewName(event.target.value)}
        />
        <button
          className="mini-btn"
          type="button"
          disabled={createMutation.isPending || !newName.trim()}
          onClick={() => createMutation.mutate(newName.trim())}
        >
          Adicionar
        </button>
      </div>
      {isLoading ? (
        <div className="placeholder-copy">Carregando cargos…</div>
      ) : (
        <ul className="admin-stack" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {roles.map(role => (
            <li key={role.id} className="det-row" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              {editing?.id === role.id ? (
                <>
                  <input
                    style={{ flex: 1 }}
                    value={editing.name}
                    onChange={event => setEditing({ id: role.id, name: event.target.value })}
                  />
                  <button
                    className="mini-btn"
                    type="button"
                    disabled={updateMutation.isPending || !editing.name.trim()}
                    onClick={() => updateMutation.mutate({ id: role.id, data: { name: editing.name.trim() } })}
                  >
                    Salvar
                  </button>
                  <button className="mini-btn alt" type="button" onClick={() => setEditing(null)}>Cancelar</button>
                </>
              ) : (
                <>
                  <span style={{ flex: 1, opacity: role.isActive ? 1 : 0.5 }}>
                    {role.name}{role.isActive ? '' : ' (inativo)'}
                  </span>
                  <button className="mini-btn" type="button" onClick={() => setEditing({ id: role.id, name: role.name })}>Renomear</button>
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
