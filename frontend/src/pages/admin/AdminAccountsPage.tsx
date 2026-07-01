import { FormEvent, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';


import { useAuth } from '../../auth/AuthContext';
import { accountPageStateFromPath } from '../../auth/moduleNavigation';
import { SearchBar } from '../../components/ui/SearchBar';
import { useUserMutations, useUsers } from '../../hooks/useUsers';
import { useCollaborators } from '../../hooks/useCollaborators';
import { Shell } from '../../layout/Shell';
import { TopBar } from '../../layout/TopBar';
import {
  assignableRoleOptionsForAccountType,
  moduleIdForPublicRole,
  moduleRegistry,
  moduleRoleLabel,
  sameModuleRoles
} from '../../modules/registry';
import { rolesForAccountType } from './accountRoleRules';
import type { UserPayload } from '../../api/users';
import type { AccountType, ModuleRole, UserRole } from '../../types/auth';
import type { InternalUserSummary } from '../../types/domain';

type AccountFilter = 'all' | AccountType;
type ModuleFilter = 'all' | string;

interface AccountFormState {
  accountType: AccountType;
  username: string;
  name: string;
  email: string;
  password: string;
  isActive: boolean;
  collaboratorId: string;
  moduleRoles: ModuleRole[];
}

const emptyForm: AccountFormState = {
  accountType: 'INTERNAL',
  username: '',
  name: '',
  email: '',
  password: '',
  isActive: true,
  collaboratorId: '',
  moduleRoles: []
};

function accountTypeLabel(accountType?: AccountType) {
  if (accountType === 'ADMIN') return 'Admin';
  if (accountType === 'CLIENT') return 'Cliente';
  return 'Interno';
}

function moduleForRole(role: ModuleRole) {
  return moduleIdForPublicRole(role) || role.split(':')[0];
}

function legacyRoleForForm(form: AccountFormState): UserRole {
  if (form.accountType === 'CLIENT') return 'CLIENT';
  if (form.accountType === 'ADMIN') return 'MANAGER';
  if (form.moduleRoles.includes('rdo:coordinator')) return 'COORDINATOR';
  return 'COLLABORATOR';
}

function userToForm(user: InternalUserSummary): AccountFormState {
  const accountType = user.accountType || (user.role === 'CLIENT' ? 'CLIENT' : user.role === 'MANAGER' ? 'ADMIN' : 'INTERNAL');
  return {
    accountType,
    username: user.username,
    name: user.name,
    email: user.email || '',
    password: '',
    isActive: user.isActive,
    collaboratorId: user.collaboratorId || '',
    moduleRoles: rolesForAccountType(accountType, user.moduleRoles || [])
  };
}

function matchesAccountSearch(user: InternalUserSummary, search: string) {
  const query = search.trim().toLowerCase();
  if (!query) return true;
  return [
    user.username,
    user.name,
    user.email,
    user.role,
    user.accountType,
    user.collaborator?.name,
    ...(user.moduleRoles || []),
    ...(user.linkedProjects || []).flatMap(project => [project.code, project.name, project.contractCode])
  ]
    .filter(Boolean)
    .some(value => String(value).toLowerCase().includes(query));
}

function accountHasModule(user: InternalUserSummary, module: ModuleFilter) {
  if (module === 'all') return true;
  return (user.moduleRoles || []).some(role => moduleForRole(role) === module);
}

function linkedProjectsLabel(user: InternalUserSummary) {
  return (user.linkedProjects || [])
    .map(project => [project.code, project.name].filter(Boolean).join(' - '))
    .filter(Boolean)
    .join(', ');
}

export function AdminAccountsPage() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const usersQuery = useUsers();
  const collaboratorsQuery = useCollaborators();
  const userMutations = useUserMutations();
  const [accountFilter, setAccountFilter] = useState<AccountFilter>('all');
  const [moduleFilter, setModuleFilter] = useState<ModuleFilter>('all');
  const [search, setSearch] = useState('');
  const [form, setForm] = useState<AccountFormState>(emptyForm);
  const [editingUser, setEditingUser] = useState<InternalUserSummary | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const visibleUsers = useMemo(() => {
    return (usersQuery.data || [])
      .filter(user => accountFilter === 'all' || user.accountType === accountFilter)
      .filter(user => accountHasModule(user, moduleFilter))
      .filter(user => matchesAccountSearch(user, search))
      .sort((a, b) => {
        const typeDelta = accountTypeLabel(a.accountType).localeCompare(accountTypeLabel(b.accountType));
        if (typeDelta) return typeDelta;
        return a.name.localeCompare(b.name);
      });
  }, [accountFilter, moduleFilter, search, usersQuery.data]);

  const availableRoleOptions = assignableRoleOptionsForAccountType(form.accountType);
  const isSaving = userMutations.createUser.isPending || userMutations.updateUser.isPending;

  function resetForm() {
    setForm(emptyForm);
    setEditingUser(null);
    setShowForm(false);
    setError('');
  }

  function openCreateForm(accountType: AccountType = 'INTERNAL') {
    setForm({ ...emptyForm, accountType, moduleRoles: rolesForAccountType(accountType, emptyForm.moduleRoles) });
    setEditingUser(null);
    setShowForm(true);
    setMessage('');
    setError('');
  }

  function openEditForm(user: InternalUserSummary) {
    setForm(userToForm(user));
    setEditingUser(user);
    setShowForm(true);
    setMessage('');
    setError('');
  }

  function updateAccountType(accountType: AccountType) {
    setForm(current => ({
      ...current,
      accountType,
      collaboratorId: accountType === 'CLIENT' ? '' : current.collaboratorId,
      moduleRoles: rolesForAccountType(accountType, current.moduleRoles)
    }));
  }

  function toggleRole(role: ModuleRole) {
    setForm(current => {
      const hasRole = current.moduleRoles.includes(role);
      const nextRoles = hasRole
        ? current.moduleRoles.filter(item => item !== role)
        : [...current.moduleRoles.filter(item => !sameModuleRoles(role).includes(item)), role];
      return {
        ...current,
        moduleRoles: rolesForAccountType(current.accountType, nextRoles)
      };
    });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage('');
    setError('');

    const isEditingClient = editingUser?.accountType === 'CLIENT' || editingUser?.role === 'CLIENT';

    if (editingUser?.accountType === 'CLIENT' && form.accountType === 'ADMIN') {
      setError('Altere a conta de cliente para interna antes de torná-la admin.');
      return;
    }

    const payload: Partial<UserPayload> = isEditingClient
      ? {
          name: form.name.trim(),
          email: form.email.trim() || null,
          password: form.password || undefined
        }
      : {
          username: form.username.trim(),
          name: form.name.trim(),
          email: form.email.trim() || null,
          password: form.password || undefined,
          role: legacyRoleForForm(form),
          accountType: form.accountType,
          moduleRoles: rolesForAccountType(form.accountType, form.moduleRoles),
          isActive: form.isActive,
          collaboratorId: form.accountType === 'CLIENT' ? null : form.collaboratorId || null
        };

    try {
      if (editingUser) {
        await userMutations.updateUser.mutateAsync({ id: editingUser.id, payload });
        setMessage('Conta atualizada.');
      } else {
        if (!payload.password) {
          setError('Senha obrigatória para nova conta.');
          return;
        }
        await userMutations.createUser.mutateAsync(payload as UserPayload);
        setMessage('Conta criada.');
      }
      resetForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao salvar conta.');
    }
  }

  function renderAccountForm() {
    const isEditingClient = editingUser?.accountType === 'CLIENT' || editingUser?.role === 'CLIENT';

    return (
      <form className="admin-inline-form" onSubmit={handleSubmit} autoComplete="off">
        <div className="admin-toolbar full">
          <div className="sec">{editingUser ? 'Editar conta' : 'Nova conta'}</div>
          <button className="mini-btn alt" type="button" onClick={resetForm}>
            Cancelar
          </button>
        </div>
        <div className="admin-inline-grid">
          {!isEditingClient ? (
            <div className="field-group">
              <label htmlFor="account-type">Tipo</label>
              <select id="account-type" value={form.accountType} onChange={event => updateAccountType(event.target.value as AccountType)}>
                <option value="INTERNAL">Interno</option>
                <option value="ADMIN">Admin</option>
                <option value="CLIENT">Cliente</option>
              </select>
            </div>
          ) : null}
          {!isEditingClient ? (
            <div className="field-group">
              <label htmlFor="account-username">Usuário</label>
              <input id="account-username" value={form.username} onChange={event => setForm(current => ({ ...current, username: event.target.value }))} required />
            </div>
          ) : null}
          <div className="field-group">
            <label htmlFor="account-name">Nome</label>
            <input id="account-name" value={form.name} onChange={event => setForm(current => ({ ...current, name: event.target.value }))} required />
          </div>
          <div className="field-group">
            <label htmlFor="account-email">E-mail</label>
            <input id="account-email" type="email" value={form.email} onChange={event => setForm(current => ({ ...current, email: event.target.value }))} />
          </div>
          {!isEditingClient ? (
            <div className="field-group">
              <label htmlFor="account-active">Status</label>
              <select id="account-active" value={String(form.isActive)} onChange={event => setForm(current => ({ ...current, isActive: event.target.value === 'true' }))}>
                <option value="true">Ativo</option>
                <option value="false">Inativo</option>
              </select>
            </div>
          ) : null}
          {!isEditingClient && form.accountType !== 'CLIENT' ? (
            <div className="field-group">
              <label htmlFor="account-collaborator">Colaborador</label>
              <select id="account-collaborator" value={form.collaboratorId} onChange={event => setForm(current => ({ ...current, collaboratorId: event.target.value }))}>
                <option value="">Sem vínculo</option>
                {(collaboratorsQuery.data || []).filter(item => item.isActive).map(item => (
                  <option key={item.id} value={item.id}>{item.name}</option>
                ))}
              </select>
            </div>
          ) : null}
          <div className="field-group">
            <label htmlFor="account-password">{editingUser ? 'Senha nova' : 'Senha'}</label>
            <input
              id="account-password"
              type="password"
              value={form.password}
              autoComplete="new-password"
              onChange={event => setForm(current => ({ ...current, password: event.target.value }))}
              required={!editingUser}
            />
          </div>
          {!isEditingClient ? (
            <div className="field-group field-group-wide">
              <label>Módulos da conta</label>
              {form.accountType === 'CLIENT' ? (
                <div className="admin-role-fixed">RDO - Cliente atribuído automaticamente</div>
              ) : (
                <div className="admin-role-grid">
                  {availableRoleOptions.map(option => (
                    <label className="admin-role-option" key={option.value}>
                      <input
                        type="checkbox"
                        checked={form.moduleRoles.includes(option.value)}
                        onChange={() => toggleRole(option.value)}
                      />
                      <span>{option.label}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          ) : null}
          <div className="admin-form-actions">
            <button className="mini-btn" type="submit" disabled={isSaving}>
              Salvar
            </button>
          </div>
        </div>
      </form>
    );
  }

  async function toggleActive(user: InternalUserSummary) {
    setMessage('');
    setError('');
    try {
      await userMutations.updateUser.mutateAsync({
        id: user.id,
        payload: { isActive: !user.isActive }
      });
      setMessage(user.isActive ? 'Conta desativada.' : 'Conta ativada.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao alterar status.');
    }
  }

  async function handleLogout() {
    await logout();
    navigate('/login', { replace: true });
  }

  return (
    <Shell>
      <TopBar
        title="Gestão de contas"
        subtitle={user?.name || 'Filtrovali App'}
        showLogo
        actions={
          <>
            <button className="topbar-chip" type="button" onClick={() => navigate('/conta', { state: accountPageStateFromPath(location.pathname) })}>
              Conta
            </button>
            <button className="topbar-chip" type="button" onClick={handleLogout}>
              Sair
            </button>
          </>
        }
      />
      <main className="page-scroll admin-accounts-page">
        <section className="admin-toolbar">
          <div>
            <div className="section-title">Contas</div>
            <div className="admin-card-subtitle">Usuários internos, admins e clientes vinculados ao RDO.</div>
          </div>
          {!showForm ? (
            <button className="mini-btn" type="button" onClick={() => openCreateForm()}>
              Nova conta
            </button>
          ) : null}
        </section>

        <section className="page-card admin-account-filters">
          <div className="field-group">
            <label htmlFor="account-search">Buscar</label>
            <SearchBar id="account-search" value={search} onChange={setSearch} placeholder="Usuário, nome, e-mail ou módulo" />
          </div>
          <div className="field-group">
            <label htmlFor="account-type-filter">Tipo</label>
            <select id="account-type-filter" value={accountFilter} onChange={event => setAccountFilter(event.target.value as AccountFilter)}>
              <option value="all">Todos</option>
              <option value="ADMIN">Admins</option>
              <option value="INTERNAL">Internos</option>
              <option value="CLIENT">Clientes</option>
            </select>
          </div>
          <div className="field-group">
            <label htmlFor="account-module-filter">Módulo</label>
            <select id="account-module-filter" value={moduleFilter} onChange={event => setModuleFilter(event.target.value as ModuleFilter)}>
              <option value="all">Todos</option>
              {moduleRegistry.filter(module => module.roles.length).map(module => (
                <option key={module.id} value={module.id}>{module.title}</option>
              ))}
            </select>
          </div>
        </section>

        {message ? <div className="inline-success">{message}</div> : null}
        {error ? <div className="inline-error">{error}</div> : null}

        {showForm && !editingUser ? renderAccountForm() : null}

        {usersQuery.isLoading ? (
          <div className="page-card placeholder-copy">Carregando contas...</div>
        ) : visibleUsers.length ? (
          <div className="admin-stack">
            {visibleUsers.map(user => (
              <article className="card admin-card admin-account-card" key={user.id}>
                <div className="admin-section-head">
                  <div>
                    <div className="admin-item-title">{user.name} · {user.username}</div>
                    <div className="admin-item-sub">
                      {accountTypeLabel(user.accountType)}
                      {user.email ? ` · ${user.email}` : ''}
                      {user.collaborator?.name ? ` · ${user.collaborator.name}` : ''}
                    </div>
                  </div>
                  <span className={`status-pill ${user.isActive ? 'status-approved' : 'status-returned'}`}>
                    {user.isActive ? 'Ativo' : 'Inativo'}
                  </span>
                </div>
                <div className="admin-account-role-list">
                  {(user.moduleRoles || []).length ? (
                    (user.moduleRoles || []).map(role => (
                      <span className="admin-account-role-pill" key={role}>{moduleRoleLabel(role)}</span>
                    ))
                  ) : (
                    <span className="admin-account-role-pill">Sem módulos</span>
                  )}
                </div>
                {user.accountType === 'CLIENT' ? (
                  <div className="admin-account-projects">
                    <strong>Projetos RDO:</strong> {linkedProjectsLabel(user) || 'Sem vínculo ativo'}
                  </div>
                ) : null}
                <div className="admin-actions">
                  <button className="mini-btn alt" type="button" onClick={() => openEditForm(user)}>
                    Editar
                  </button>
                  <button className={`mini-btn ${user.isActive ? 'danger' : 'alt'}`} type="button" onClick={() => void toggleActive(user)} disabled={userMutations.updateUser.isPending}>
                    {user.isActive ? 'Desativar' : 'Ativar'}
                  </button>
                </div>
                {editingUser?.id === user.id ? renderAccountForm() : null}
              </article>
            ))}
          </div>
        ) : (
          <div className="page-card placeholder-copy">Nenhuma conta encontrada.</div>
        )}
      </main>
    </Shell>
  );
}
