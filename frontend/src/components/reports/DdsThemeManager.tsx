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
  createDdsTheme,
  deactivateDdsTheme,
  listDdsThemes,
  updateDdsTheme,
  type DdsTheme
} from '../../api/ddsThemes';
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
import '../../styles/rdo-ds-actions.css';
import './DdsThemeManager.ds.css';

export type DdsThemeManagerAppearance = 'legacy' | 'design-system';

export interface DdsThemeManagerProps {
  appearance?: DdsThemeManagerAppearance;
  createOpen?: boolean;
  onCreateOpenChange?: (open: boolean) => void;
  searchValue?: string;
  showCreateAction?: boolean;
}

// Administração da lista de temas de DDS. Permite adicionar, renomear e desativar/reativar.
export function DdsThemeManager({
  appearance = 'legacy',
  createOpen,
  onCreateOpenChange,
  searchValue = '',
  showCreateAction = true
}: DdsThemeManagerProps) {
  const queryClient = useQueryClient();
  const showToast = useToast();
  const { data, isLoading } = useQuery({
    queryKey: ['dds-themes', 'all'],
    queryFn: () => listDdsThemes(true)
  });

  const [newName, setNewName] = useState('');
  const [internalCreateOpen, setInternalCreateOpen] = useState(false);
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(
    null
  );
  const designSystemSurfaceRef = useRef<HTMLElement>(null);
  const createInputRef = useRef<HTMLInputElement>(null);
  const renameLauncherIdRef = useRef<string | null>(null);
  const editingInputRef = useRef<HTMLInputElement>(null);

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['dds-themes'] });

  const createMutation = useMutation({
    mutationFn: (name: string) => createDdsTheme(name),
    onSuccess: () => {
      showToast('Tema adicionado.');
      setNewName('');
      setShowCreateForm(false);
      invalidate();
    },
    onError: () => showToast('Não foi possível adicionar (nome já existe?).')
  });

  const updateMutation = useMutation({
    mutationFn: (payload: {
      id: string;
      data: { name?: string; isActive?: boolean };
    }) => updateDdsTheme(payload.id, payload.data),
    onSuccess: () => {
      showToast('Tema atualizado.');
      setEditing(null);
      invalidate();
    },
    onError: () => showToast('Não foi possível atualizar o tema.')
  });

  const deactivateMutation = useMutation({
    mutationFn: (id: string) => deactivateDdsTheme(id),
    onSuccess: () => {
      showToast('Tema desativado.');
      invalidate();
    },
    onError: () => showToast('Não foi possível desativar o tema.')
  });

  const themes = data ?? [];
  const showCreateForm = createOpen ?? internalCreateOpen;
  const normalizedSearch = searchValue.trim().toLocaleLowerCase('pt-BR');
  const visibleThemes = normalizedSearch
    ? themes.filter((theme) =>
        theme.name.toLocaleLowerCase('pt-BR').includes(normalizedSearch)
      )
    : themes;
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
    createMutation.mutate(name);
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
    restoreDesignSystemLauncherFocus('[data-dds-theme-create]');
  }

  function openDesignSystemRename(theme: DdsTheme) {
    renameLauncherIdRef.current = theme.id;
    setEditing({ id: theme.id, name: theme.name });
  }

  function cancelDesignSystemRename() {
    const launcherId = renameLauncherIdRef.current;
    setEditing(null);
    if (launcherId) {
      restoreDesignSystemLauncherFocus(
        `[data-dds-theme-rename="${launcherId}"]`
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

  function renderDesignSystemThemeName(theme: DdsTheme) {
    if (editing?.id === theme.id) {
      return (
        <Field
          className="rdo-dds-themes__rename-field"
          label="Novo nome"
          optionalText={null}
        >
          <Input
            ref={editingInputRef}
            size="lg"
            value={editing.name}
            aria-label={`Novo nome para ${theme.name}`}
            onChange={(event) =>
              setEditing({ id: theme.id, name: event.target.value })
            }
            onKeyDown={(event) =>
              handleDesignSystemEscape(event, cancelDesignSystemRename)
            }
          />
        </Field>
      );
    }

    return (
      <span className="rdo-dds-themes__name" data-dds-theme-name={theme.name}>
        {theme.name}
      </span>
    );
  }

  function renderDesignSystemThemeActions(theme: DdsTheme) {
    if (editing?.id === theme.id) {
      return (
        <>
          <Button
            size="sm"
            variant="primary"
            disabled={updateMutation.isPending || !editing.name.trim()}
            loading={updateMutation.isPending}
            onClick={() =>
              updateMutation.mutate({
                id: theme.id,
                data: { name: editing.name.trim() }
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
          data-dds-theme-rename={theme.id}
          onClick={() => openDesignSystemRename(theme)}
        >
          Renomear
        </Button>
        {theme.isActive ? (
          <Button
            size="sm"
            variant="danger"
            disabled={deactivateMutation.isPending}
            loading={deactivateMutation.isPending}
            onClick={() => deactivateMutation.mutate(theme.id)}
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
                id: theme.id,
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
    const columns: readonly DataTableColumn<DdsTheme>[] = [
      {
        key: 'name',
        header: 'Tema',
        rowHeader: true,
        render: renderDesignSystemThemeName
      },
      {
        key: 'status',
        header: 'Status',
        render: (theme) => (
          <StatusPill
            status={theme.isActive ? 'ACTIVE' : 'INACTIVE'}
            label={theme.isActive ? 'Ativo' : 'Inativo'}
            tone={theme.isActive ? 'success' : 'neutral'}
          />
        )
      }
    ];

    return (
      <section
        ref={designSystemSurfaceRef}
        className="fv-ds rdo-dds-themes rdo-ds-actions"
        aria-labelledby="rdo-dds-themes-title"
      >
        <Card
          className="rdo-dds-themes__card"
          padding="md"
          title={
            <div className="rdo-dds-themes__title">
              <span className="rdo-dds-themes__title-icon" aria-hidden="true">
                <AppIcon icon={DS_ICONS.fileText} size="md" />
              </span>
              <h2 id="rdo-dds-themes-title">Temas de DDS</h2>
            </div>
          }
          actions={
            showCreateAction && !showCreateForm ? (
              <Button
                data-dds-theme-create
                size="sm"
                variant="primary"
                onClick={() => setShowCreateForm(true)}
              >
                Novo tema
              </Button>
            ) : null
          }
        >
          <p className="rdo-dds-themes__description">
            Lista usada no registro de DDS dos RDOs. Temas inativos não aparecem
            na seleção.
          </p>

          {showCreateForm ? (
            <form
              className="rdo-dds-themes__create-form"
              onSubmit={handleCreateSubmit}
              onKeyDown={(event) =>
                handleDesignSystemEscape(event, cancelDesignSystemCreate)
              }
              autoComplete="off"
            >
              <Field label="Nome do tema" required>
                <Input
                  ref={createInputRef}
                  size="lg"
                  value={newName}
                  autoComplete="off"
                  onChange={(event) => setNewName(event.target.value)}
                  required
                />
              </Field>
              <div className="rdo-dds-themes__form-actions">
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
              className="rdo-dds-themes__loading"
              variant="table-rows"
              lines={6}
              label="Carregando temas…"
            />
          ) : (
            <DataTable
              className="rdo-dds-themes__table"
              rows={visibleThemes}
              columns={columns}
              getRowId={(theme) => theme.id}
              getRowClassName={(theme) =>
                theme.isActive
                  ? 'rdo-dds-themes__row'
                  : 'rdo-dds-themes__row rdo-dds-themes__row--inactive'
              }
              ariaLabel="Temas de DDS"
              density="compact"
              actionsLabel="Ações"
              rowActions={renderDesignSystemThemeActions}
              emptyState={
                <EmptyState
                  variant={normalizedSearch ? 'search' : 'default'}
                  title={
                    normalizedSearch
                      ? 'Nenhum tema de DDS encontrado.'
                      : 'Nenhum tema de DDS cadastrado.'
                  }
                  description={
                    normalizedSearch
                      ? 'Revise a busca para localizar outro tema.'
                      : 'Cadastre um tema para disponibilizá-lo no registro de DDS dos RDOs.'
                  }
                />
              }
              mobile={{
                ariaLabel: 'Temas de DDS',
                renderItem: (theme) => ({
                  title: renderDesignSystemThemeName(theme),
                  status: (
                    <StatusPill
                      status={theme.isActive ? 'ACTIVE' : 'INACTIVE'}
                      label={theme.isActive ? 'Ativo' : 'Inativo'}
                      tone={theme.isActive ? 'success' : 'neutral'}
                    />
                  ),
                  actions: renderDesignSystemThemeActions(theme)
                })
              }}
            />
          )}
        </Card>
      </section>
    );
  }

  return (
    <div className="page-card">
      <div className="admin-toolbar">
        <div className="sec">Temas de DDS</div>
        {!showCreateForm ? (
          <button
            className="mini-btn"
            type="button"
            onClick={() => setShowCreateForm(true)}
          >
            + Novo tema
          </button>
        ) : null}
      </div>
      <p className="placeholder-copy" style={{ margin: '4px 0 10px' }}>
        Lista usada no registro de DDS dos RDOs. Temas inativos não aparecem na
        seleção.
      </p>
      {showCreateForm ? (
        <form
          className="admin-inline-form"
          onSubmit={handleCreateSubmit}
          autoComplete="off"
        >
          <div className="admin-toolbar full">
            <div className="sec">Novo tema de DDS</div>
            <button
              className="mini-btn alt"
              type="button"
              onClick={() => {
                setShowCreateForm(false);
                setNewName('');
              }}
            >
              Cancelar
            </button>
          </div>
          <div className="admin-inline-grid">
            <div className="field-group field-group-wide">
              <label htmlFor="dds-theme-name">Nome do tema</label>
              <input
                id="dds-theme-name"
                value={newName}
                autoComplete="off"
                onChange={(event) => setNewName(event.target.value)}
                required
              />
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
        <div className="placeholder-copy"><BrandLoading label="Carregando temas" /></div>
      ) : (
        <ul
          className="admin-stack"
          style={{ listStyle: 'none', padding: 0, margin: 0 }}
        >
          {themes.map((theme) => (
            <li
              key={theme.id}
              className="det-row"
              style={{ display: 'flex', gap: 8, alignItems: 'center' }}
            >
              {editing?.id === theme.id ? (
                <>
                  <input
                    style={{ flex: 1 }}
                    value={editing.name}
                    onChange={(event) =>
                      setEditing({ id: theme.id, name: event.target.value })
                    }
                  />
                  <button
                    className="mini-btn"
                    type="button"
                    disabled={updateMutation.isPending || !editing.name.trim()}
                    onClick={() =>
                      updateMutation.mutate({
                        id: theme.id,
                        data: { name: editing.name.trim() }
                      })
                    }
                  >
                    Salvar
                  </button>
                  <button
                    className="mini-btn alt"
                    type="button"
                    onClick={() => setEditing(null)}
                  >
                    Cancelar
                  </button>
                </>
              ) : (
                <>
                  <span style={{ flex: 1, opacity: theme.isActive ? 1 : 0.5 }}>
                    {theme.name}
                    {theme.isActive ? '' : ' (inativo)'}
                  </span>
                  <button
                    className="mini-btn"
                    type="button"
                    onClick={() =>
                      setEditing({ id: theme.id, name: theme.name })
                    }
                  >
                    Renomear
                  </button>
                  {theme.isActive ? (
                    <button
                      className="mini-btn danger"
                      type="button"
                      disabled={deactivateMutation.isPending}
                      onClick={() => deactivateMutation.mutate(theme.id)}
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
                          id: theme.id,
                          data: { isActive: true }
                        })
                      }
                    >
                      Reativar
                    </button>
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
