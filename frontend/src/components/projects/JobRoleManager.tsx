import { BrandLoading } from '../brand/BrandLoading';
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent
} from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  createJobRole,
  deactivateJobRole,
  listJobRoles,
  updateJobRole,
  type JobRole
} from '../../api/jobRoles';
import { useAuth } from '../../auth/AuthContext';
import {
  Button,
  Card,
  DataTable,
  EmptyState,
  Field,
  Input,
  Skeleton,
  StatusPill,
  type DataTableColumn
} from '../ui/ds';
import { AppIcon } from '../icons/AppIcon';
import { DS_ICONS } from '../ui/ds/icons';
import { useToast } from '../ui/ToastContext';
import { EfetivoControlNovelty } from '../EfetivoControlNovelty';
import '../../styles/rdo-ds-actions.css';
import './JobRoleManager.ds.css';

export type JobRoleManagerAppearance = 'legacy' | 'design-system';

export interface JobRoleManagerProps {
  appearance?: JobRoleManagerAppearance;
  createOpen?: boolean;
  onCreateOpenChange?: (open: boolean) => void;
  searchValue?: string;
  showCreateAction?: boolean;
}

// Administração da lista de cargos (JobRole). Permite adicionar, renomear e desativar/reativar.
export function JobRoleManager({
  appearance = 'legacy',
  createOpen,
  onCreateOpenChange,
  searchValue = '',
  showCreateAction = true
}: JobRoleManagerProps) {
  const queryClient = useQueryClient();
  const showToast = useToast();
  const { user } = useAuth();
  const canManageOperational =
    user?.accountType === 'ADMIN' ||
    Boolean(user?.moduleRoles?.includes('efetivo:manager'));
  const { data, isLoading } = useQuery({
    queryKey: ['job-roles', 'all'],
    queryFn: () => listJobRoles(true)
  });

  const [newName, setNewName] = useState('');
  const [newIsOperational, setNewIsOperational] = useState(true);
  const [internalCreateOpen, setInternalCreateOpen] = useState(false);
  const [editing, setEditing] = useState<{
    id: string;
    name: string;
    isOperational: boolean;
  } | null>(null);
  const designSystemSurfaceRef = useRef<HTMLElement>(null);
  const createInputRef = useRef<HTMLInputElement>(null);
  const renameLauncherIdRef = useRef<string | null>(null);
  const editingInputRef = useRef<HTMLInputElement>(null);

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['job-roles'] });

  const createMutation = useMutation({
    mutationFn: (payload: { name: string; isOperational?: boolean }) =>
      createJobRole(payload),
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
    mutationFn: (payload: {
      id: string;
      data: {
        name?: string;
        isActive?: boolean;
        isOperational?: boolean;
      };
    }) => updateJobRole(payload.id, payload.data),
    onSuccess: () => {
      showToast('Cargo atualizado.');
      setEditing(null);
      invalidate();
    },
    onError: () => showToast('Não foi possível atualizar o cargo.')
  });

  const deactivateMutation = useMutation({
    mutationFn: (id: string) => deactivateJobRole(id),
    onSuccess: () => {
      showToast('Cargo desativado.');
      invalidate();
    },
    onError: () => showToast('Não foi possível desativar o cargo.')
  });

  const roles = data ?? [];
  const showCreateForm = createOpen ?? internalCreateOpen;
  const normalizedSearch = searchValue.trim().toLocaleLowerCase('pt-BR');
  const visibleRoles = normalizedSearch
    ? roles.filter((role) =>
        role.name.toLocaleLowerCase('pt-BR').includes(normalizedSearch)
      )
    : roles;
  const editingId = editing?.id;

  function setShowCreateForm(open: boolean) {
    if (createOpen === undefined) setInternalCreateOpen(open);
    onCreateOpenChange?.(open);
  }

  useEffect(() => {
    if (appearance === 'design-system' && showCreateForm) {
      createInputRef.current?.focus();
    }
  }, [appearance, showCreateForm]);

  useEffect(() => {
    if (appearance === 'design-system' && editingId) {
      editingInputRef.current?.focus();
    }
  }, [appearance, editingId]);

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

  function restoreDesignSystemLauncherFocus(selector: string) {
    window.requestAnimationFrame(() => {
      designSystemSurfaceRef.current
        ?.querySelector<HTMLButtonElement>(selector)
        ?.focus();
    });
  }

  function cancelDesignSystemCreate() {
    setShowCreateForm(false);
    setNewName('');
    setNewIsOperational(true);
    restoreDesignSystemLauncherFocus('[data-job-role-create]');
  }

  function openDesignSystemRename(role: JobRole) {
    renameLauncherIdRef.current = role.id;
    setEditing({
      id: role.id,
      name: role.name,
      isOperational: role.isOperational !== false
    });
  }

  function cancelDesignSystemRename() {
    const launcherId = renameLauncherIdRef.current;
    setEditing(null);
    if (launcherId) {
      restoreDesignSystemLauncherFocus(
        `[data-job-role-rename="${launcherId}"]`
      );
    }
  }

  function handleDesignSystemEscape(
    event: KeyboardEvent<HTMLElement>,
    onCancel: () => void
  ) {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    onCancel();
  }

  function renderDesignSystemRoleName(role: JobRole) {
    if (editing?.id === role.id) {
      return (
        <div className="rdo-job-roles__edit-fields">
          <Field
            className="rdo-job-roles__rename-field"
            label="Novo nome"
            optionalText={null}
          >
            <Input
              ref={editingInputRef}
              size="lg"
              value={editing.name}
              aria-label={`Novo nome para ${role.name}`}
              onChange={(event) =>
                setEditing({ ...editing, name: event.target.value })
              }
              onKeyDown={(event) =>
                handleDesignSystemEscape(event, cancelDesignSystemRename)
              }
            />
          </Field>
          <label
            className="rdo-job-roles__operational-control"
            data-efetivo-operational-control
          >
            <input
              type="checkbox"
              checked={editing.isOperational}
              disabled={!canManageOperational || updateMutation.isPending}
              onChange={(event) =>
                setEditing({
                  ...editing,
                  isOperational: event.target.checked
                })
              }
            />
            <span>Função operacional</span>
          </label>
        </div>
      );
    }

    return (
      <span className="rdo-job-roles__name" data-job-role-name={role.name}>
        {role.name}
      </span>
    );
  }

  function renderDesignSystemRoleActions(role: JobRole) {
    if (editing?.id === role.id) {
      return (
        <>
          <Button
            size="sm"
            variant="primary"
            disabled={updateMutation.isPending || !editing.name.trim()}
            loading={updateMutation.isPending}
            onClick={() =>
              updateMutation.mutate({
                id: role.id,
                data: {
                  name: editing.name.trim(),
                  ...(canManageOperational
                    ? { isOperational: editing.isOperational }
                    : {})
                }
              })
            }
          >
            Salvar
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={cancelDesignSystemRename}
          >
            Cancelar
          </Button>
        </>
      );
    }

    return (
      <>
        <Button
          size="sm"
          variant="secondary"
          data-job-role-rename={role.id}
          onClick={() => openDesignSystemRename(role)}
        >
          Renomear
        </Button>
        {role.isActive ? (
          <Button
            size="sm"
            variant="danger"
            disabled={deactivateMutation.isPending}
            loading={deactivateMutation.isPending}
            onClick={() => deactivateMutation.mutate(role.id)}
          >
            Desativar
          </Button>
        ) : (
          <Button
            size="sm"
            variant="secondary"
            disabled={updateMutation.isPending}
            loading={updateMutation.isPending}
            onClick={() =>
              updateMutation.mutate({
                id: role.id,
                data: { isActive: true }
              })
            }
          >
            Reativar
          </Button>
        )}
      </>
    );
  }

  if (appearance === 'design-system') {
    const columns: readonly DataTableColumn<JobRole>[] = [
      {
        key: 'name',
        header: 'Cargo',
        rowHeader: true,
        render: renderDesignSystemRoleName
      },
      {
        key: 'operational',
        header: 'Efetivo',
        render: (role) => role.isOperational ? 'Operacional' : 'Administrativo'
      },
      {
        key: 'status',
        header: 'Status',
        render: (role) => (
          <StatusPill
            status={role.isActive ? 'ACTIVE' : 'INACTIVE'}
            label={role.isActive ? 'Ativo' : 'Inativo'}
            tone={role.isActive ? 'success' : 'neutral'}
          />
        )
      }
    ];

    return (
      <section
        ref={designSystemSurfaceRef}
        className="fv-ds rdo-job-roles rdo-ds-actions"
        aria-labelledby="rdo-job-roles-title"
      >
        <Card
          className="rdo-job-roles__card"
          padding="md"
          title={
            <div className="rdo-job-roles__title">
              <span className="rdo-job-roles__title-icon" aria-hidden="true">
                <AppIcon icon={DS_ICONS.settings} size="md" />
              </span>
              <h2 id="rdo-job-roles-title">Cargos</h2>
            </div>
          }
          actions={
            showCreateAction && !showCreateForm ? (
              <Button
                data-job-role-create
                size="sm"
                variant="primary"
                onClick={() => setShowCreateForm(true)}
              >
                Novo cargo
              </Button>
            ) : null
          }
        >
          <p className="rdo-job-roles__description">
            Lista usada no cadastro de colaboradores. Cargos inativos não
            aparecem na seleção. A marcação operacional define quem entra nos
            indicadores do Efetivo.
          </p>

          {showCreateForm ? (
            <form
              className="rdo-job-roles__create-form"
              onSubmit={handleCreateSubmit}
              onKeyDown={(event) =>
                handleDesignSystemEscape(event, cancelDesignSystemCreate)
              }
              autoComplete="off"
            >
              <Field label="Nome do cargo" required>
                <Input
                  ref={createInputRef}
                  size="lg"
                  value={newName}
                  autoComplete="off"
                  onChange={(event) => setNewName(event.target.value)}
                  required
                />
              </Field>
              <label
                className="rdo-job-roles__operational-control"
                data-efetivo-operational-control
              >
                <input
                  type="checkbox"
                  checked={newIsOperational}
                  disabled={!canManageOperational || createMutation.isPending}
                  onChange={(event) =>
                    setNewIsOperational(event.target.checked)
                  }
                />
                <span>Função operacional</span>
              </label>
              <div className="rdo-job-roles__form-actions">
                <Button
                  size="md"
                  variant="secondary"
                  onClick={cancelDesignSystemCreate}
                >
                  Cancelar
                </Button>
                <Button
                  size="md"
                  variant="primary"
                  type="submit"
                  disabled={createMutation.isPending || !newName.trim()}
                  loading={createMutation.isPending}
                >
                  Salvar
                </Button>
              </div>
            </form>
          ) : null}

          {isLoading ? (
            <Skeleton
              className="rdo-job-roles__loading"
              variant="table-rows"
              lines={6}
              label="Carregando cargos…"
            />
          ) : (
            <DataTable
              className="rdo-job-roles__table"
              rows={visibleRoles}
              columns={columns}
              getRowId={(role) => role.id}
              getRowClassName={(role) =>
                role.isActive
                  ? 'rdo-job-roles__row'
                  : 'rdo-job-roles__row rdo-job-roles__row--inactive'
              }
              ariaLabel="Cargos"
              density="compact"
              actionsLabel="Ações"
              rowActions={renderDesignSystemRoleActions}
              emptyState={
                <EmptyState
                  variant={normalizedSearch ? 'search' : 'default'}
                  title={
                    normalizedSearch
                      ? 'Nenhum cargo encontrado.'
                      : 'Nenhum cargo cadastrado.'
                  }
                  description={
                    normalizedSearch
                      ? 'Revise a busca para localizar outro cargo.'
                      : 'Cadastre um cargo para disponibilizá-lo na seleção de colaboradores.'
                  }
                />
              }
              mobile={{
                ariaLabel: 'Cargos',
                renderItem: (role) => ({
                  title: renderDesignSystemRoleName(role),
                  status: (
                    <StatusPill
                      status={role.isActive ? 'ACTIVE' : 'INACTIVE'}
                      label={role.isActive ? 'Ativo' : 'Inativo'}
                      tone={role.isActive ? 'success' : 'neutral'}
                    />
                  ),
                  actions: renderDesignSystemRoleActions(role)
                })
              }}
            />
          )}
          {!canManageOperational ? (
            <p className="rdo-job-roles__description">
              A função operacional só pode ser alterada por um gestor do
              módulo Efetivo Operacional.
            </p>
          ) : null}
        </Card>
        <EfetivoControlNovelty
          user={user}
          control="operational-role"
          selector="[data-efetivo-operational-control]"
        />
      </section>
    );
  }

  return (
    <div className="page-card">
      <div className="admin-toolbar">
        <div className="sec">Cargos</div>
        {!showCreateForm ? (
          <button
            className="mini-btn"
            type="button"
            onClick={() => setShowCreateForm(true)}
          >
            + Novo cargo
          </button>
        ) : null}
      </div>
      <p className="placeholder-copy" style={{ margin: '4px 0 10px' }}>
        Lista usada no cadastro de colaboradores. Cargos inativos não aparecem na seleção. A marcação operacional define quem entra no indicador do Efetivo.
      </p>
      {showCreateForm ? (
        <form
          className="admin-inline-form"
          onSubmit={handleCreateSubmit}
          autoComplete="off"
        >
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
                onChange={(event) => setNewName(event.target.value)}
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
              <button
                className="mini-btn"
                type="submit"
                disabled={createMutation.isPending || !newName.trim()}
              >
                Salvar
              </button>
            </div>
          </div>
        </form>
      ) : null}
      {isLoading ? (
        <div className="placeholder-copy"><BrandLoading label="Carregando cargos" /></div>
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
                    {role.name}
                    {role.isActive ? '' : ' (inativo)'}
                  </span>
                  <button
                    className="mini-btn"
                    type="button"
                    onClick={() => setEditing({ id: role.id, name: role.name, isOperational: role.isOperational !== false })}
                  >
                    Editar
                  </button>
                  {role.isActive ? (
                    <button
                      className="mini-btn danger"
                      type="button"
                      disabled={deactivateMutation.isPending}
                      onClick={() => deactivateMutation.mutate(role.id)}
                    >
                      Desativar
                    </button>
                  ) : (
                    <button
                      className="mini-btn"
                      type="button"
                      disabled={updateMutation.isPending}
                      onClick={() =>
                        updateMutation.mutate({
                          id: role.id,
                          data: { isActive: true }
                        })
                      }
                    >
                      Reativar
                    </button>
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
