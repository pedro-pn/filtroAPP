import { FormEvent, useEffect, useMemo, useState } from 'react';

import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { PasswordSetupLinkCard } from '../../components/accounts/PasswordSetupLinkCard';
import { RemoveIconButton } from '../../components/ui/RemoveIconButton';
import { Alert, Badge, Button, Card, DataTable, EmptyState, Field, Input, SearchInput, Select, Skeleton, type DataTableColumn } from '../../components/ui/ds';
import { useUserMutations, useUsers } from '../../hooks/useUsers';
import { useCollaborators } from '../../hooks/useCollaborators';
import { PageHeader } from '../../layout/PageHeader';
import { assignableRoleOptionsForAccountType, moduleIdForPublicRole, moduleRegistry, moduleRoleLabel, sameModuleRoles } from '../../modules/registry';
import { rolesForAccountType } from './accountRoleRules';
import type { UserDeletionImpact, UserPayload } from '../../api/users';
import type { AccountType, ModuleRole, ReportEmissionPermission, UserRole } from '../../types/auth';
import type { InternalUserSummary } from '../../types/domain';
import { PROJECT_TAXES_AND_BILLING, canReceiveAcompanhamentoExtraPermissions, normalizeAcompanhamentoExtraPermissions, type AcompanhamentoExtraPermission } from '../../../../shared/modules/acompanhamento-permissions.js';
import { REVIEW_REPORTS, canReceiveRdoExtraPermissions, normalizeRdoExtraPermissions, type RdoExtraPermission } from '../../../../shared/modules/rdo-permissions.js';
import { AdminModuleAppShell } from './AdminModuleAppShell';
import './AdminAccountsPage.ds.css';

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
  reportEmissionPermissions: ReportEmissionPermission[];
  acompanhamentoExtraPermissions: AcompanhamentoExtraPermission[];
  rdoExtraPermissions: RdoExtraPermission[];
}

interface ManualPasswordSetup {
  username: string;
  url: string;
}

const emptyForm: AccountFormState = {
  accountType: 'INTERNAL',
  username: '',
  name: '',
  email: '',
  password: '',
  isActive: true,
  collaboratorId: '',
  moduleRoles: [],
  reportEmissionPermissions: [],
  acompanhamentoExtraPermissions: [],
  rdoExtraPermissions: []
};

const reportPermissionOptions: Array<{
  value: ReportEmissionPermission;
  label: string;
  description: string;
}> = [
  { value: 'SITE_RDO', label: 'RDO de obra', description: 'Criar relatórios de serviço em obras.' },
  { value: 'MAINTENANCE', label: 'Manutenção', description: 'Acessar o módulo e emitir relatórios de manutenção.' },
  { value: 'PRODUCTION', label: 'Produção', description: 'Acessar o módulo e emitir relatórios de produção.' }
];

const INTERNAL_RDO_ROLES: ModuleRole[] = ['rdo:manager', 'rdo:coordinator', 'rdo:collaborator'];

function impliedReportPermission(form: Pick<AccountFormState, 'accountType' | 'moduleRoles'>, permission: ReportEmissionPermission) {
  return permission === 'SITE_RDO' && form.accountType !== 'CLIENT' && form.moduleRoles.some(role => INTERNAL_RDO_ROLES.includes(role));
}

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
    moduleRoles: rolesForAccountType(accountType, user.moduleRoles || []),
    reportEmissionPermissions: accountType === 'CLIENT' ? [] : user.reportEmissionPermissions || [],
    acompanhamentoExtraPermissions: normalizeAcompanhamentoExtraPermissions(user.acompanhamentoExtraPermissions, { accountType, moduleRoles: user.moduleRoles }),
    rdoExtraPermissions: normalizeRdoExtraPermissions(user.rdoExtraPermissions, { accountType, moduleRoles: user.moduleRoles })
  };
}

function matchesAccountSearch(user: InternalUserSummary, search: string) {
  const query = search.trim().toLowerCase();
  if (!query) return true;
  return [user.username, user.name, user.email, user.role, user.accountType, user.collaborator?.name, ...(user.moduleRoles || []), ...(user.linkedProjects || []).flatMap(project => [project.code, project.name, project.contractCode])].filter(Boolean).some(value => String(value).toLowerCase().includes(query));
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

function accountAccess(user: InternalUserSummary) {
  return <div className="admin-account-access">
    <div className="admin-account-access__roles" aria-label="Módulos da conta">
      {(user.moduleRoles || []).length
        ? (user.moduleRoles || []).map(role => <Badge key={role}>{moduleRoleLabel(role)}</Badge>)
        : <Badge>Sem módulos</Badge>}
    </div>
    {user.collaborator?.name ? <span>Colaborador: {user.collaborator.name}</span> : null}
    {user.accountType === 'CLIENT' ? <span>Projetos RDO: {linkedProjectsLabel(user) || 'Sem vínculo ativo'}</span> : null}
  </div>;
}

function absolutePasswordSetupUrl(url: string) {
  return new URL(url, window.location.origin).href;
}

export function AdminAccountsPage() {
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
  const [deletingUser, setDeletingUser] = useState<InternalUserSummary | null>(null);
  const [deletionImpact, setDeletionImpact] = useState<UserDeletionImpact | null>(null);
  const [manualPasswordSetup, setManualPasswordSetup] = useState<ManualPasswordSetup | null>(null);

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

  useEffect(() => {
    if (!showForm) return;
    document.getElementById('admin-account-form')?.scrollIntoView({ block: 'start' });
  }, [editingUser?.id, showForm]);

  function resetForm() {
    setForm(emptyForm);
    setEditingUser(null);
    setShowForm(false);
    setError('');
  }

  function openCreateForm(accountType: AccountType = 'INTERNAL') {
    setForm({
      ...emptyForm,
      accountType,
      moduleRoles: rolesForAccountType(accountType, emptyForm.moduleRoles)
    });
    setEditingUser(null);
    setShowForm(true);
    setMessage('');
    setError('');
    setManualPasswordSetup(null);
  }

  function openEditForm(user: InternalUserSummary) {
    setForm(userToForm(user));
    setEditingUser(user);
    setShowForm(true);
    setMessage('');
    setError('');
    setManualPasswordSetup(null);
  }

  function updateAccountType(accountType: AccountType) {
    setForm(current => ({
      ...current,
      accountType,
      collaboratorId: accountType === 'CLIENT' ? '' : current.collaboratorId,
      moduleRoles: rolesForAccountType(accountType, current.moduleRoles),
      acompanhamentoExtraPermissions: normalizeAcompanhamentoExtraPermissions(current.acompanhamentoExtraPermissions, { accountType, moduleRoles: current.moduleRoles }),
      rdoExtraPermissions: normalizeRdoExtraPermissions(current.rdoExtraPermissions, { accountType, moduleRoles: current.moduleRoles }),
      reportEmissionPermissions: accountType === 'CLIENT' ? [] : current.reportEmissionPermissions
    }));
  }

  function toggleReportPermission(permission: ReportEmissionPermission) {
    setForm(current => ({
      ...current,
      reportEmissionPermissions: current.reportEmissionPermissions.includes(permission) ? current.reportEmissionPermissions.filter(item => item !== permission) : [...current.reportEmissionPermissions, permission]
    }));
  }

  function toggleRole(role: ModuleRole) {
    setForm(current => {
      const hasRole = current.moduleRoles.includes(role);
      const nextRoles = hasRole ? current.moduleRoles.filter(item => item !== role) : [...current.moduleRoles.filter(item => !sameModuleRoles(role).includes(item)), role];
      return {
        ...current,
        moduleRoles: rolesForAccountType(current.accountType, nextRoles),
        acompanhamentoExtraPermissions: normalizeAcompanhamentoExtraPermissions(current.acompanhamentoExtraPermissions, { accountType: current.accountType, moduleRoles: nextRoles }),
        rdoExtraPermissions: normalizeRdoExtraPermissions(current.rdoExtraPermissions, { accountType: current.accountType, moduleRoles: nextRoles })
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
          ...(editingUser && form.password ? { password: form.password } : {})
        }
      : {
          username: form.username.trim(),
          name: form.name.trim(),
          email: form.email.trim() || null,
          ...(editingUser && form.password ? { password: form.password } : {}),
          role: legacyRoleForForm(form),
          accountType: form.accountType,
          moduleRoles: rolesForAccountType(form.accountType, form.moduleRoles),
          reportEmissionPermissions: form.accountType === 'CLIENT' ? [] : form.reportEmissionPermissions,
          acompanhamentoExtraPermissions: normalizeAcompanhamentoExtraPermissions(form.acompanhamentoExtraPermissions, form),
          rdoExtraPermissions: normalizeRdoExtraPermissions(form.rdoExtraPermissions, form),
          isActive: form.isActive,
          collaboratorId: form.accountType === 'CLIENT' ? null : form.collaboratorId || null
        };

    try {
      if (editingUser) {
        await userMutations.updateUser.mutateAsync({
          id: editingUser.id,
          payload
        });
        setMessage('Conta atualizada.');
      } else {
        const createdUser = await userMutations.createUser.mutateAsync(payload as UserPayload);
        if (createdUser.passwordSetup.delivery === 'email') {
          setMessage(`Conta criada. Enviamos para ${createdUser.email} o link para criar a senha.`);
          setManualPasswordSetup(null);
        } else {
          setMessage('Conta criada. Compartilhe o link abaixo com o usuário.');
          setManualPasswordSetup({
            username: createdUser.username,
            url: absolutePasswordSetupUrl(createdUser.passwordSetup.url)
          });
        }
      }
      resetForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao salvar conta.');
    }
  }

  async function copyManualPasswordSetup() {
    if (!manualPasswordSetup) return;
    try {
      await navigator.clipboard.writeText(manualPasswordSetup.url);
      setMessage('Link copiado. Compartilhe-o somente com o usuário da conta.');
    } catch {
      setError('Não foi possível copiar automaticamente. Selecione o link e copie manualmente.');
    }
  }

  function renderAccountForm() {
    const isEditingClient = editingUser?.accountType === 'CLIENT' || editingUser?.role === 'CLIENT';

    return (
      <form id="admin-account-form" className="admin-account-form" onSubmit={handleSubmit} autoComplete="off">
        <div className="admin-account-form__header">
          <div>
            <h2>{editingUser ? `Editar conta · ${editingUser.name}` : 'Nova conta'}</h2>
            <p>Defina os dados de acesso e os módulos disponíveis para esta conta.</p>
          </div>
          <Button variant="secondary" size="sm" onClick={resetForm}>
            Cancelar
          </Button>
        </div>
        <div className="admin-account-form__grid">
          {!isEditingClient ? (
            <Field id="account-type" label="Tipo" optionalText="">
              <Select value={form.accountType} onChange={event => updateAccountType(event.target.value as AccountType)}>
                <option value="INTERNAL">Interno</option>
                <option value="ADMIN">Admin</option>
                <option value="CLIENT">Cliente</option>
              </Select>
            </Field>
          ) : null}
          {!isEditingClient ? (
            <Field id="account-username" label="Usuário" required>
              <Input
                value={form.username}
                onChange={event =>
                  setForm(current => ({
                    ...current,
                    username: event.target.value
                  }))
                }
                required
              />
            </Field>
          ) : null}
          <Field id="account-name" label="Nome" required>
            <Input value={form.name} onChange={event => setForm(current => ({ ...current, name: event.target.value }))} required />
          </Field>
          <Field id="account-email" label="E-mail">
            <Input
              type="email"
              value={form.email}
              onChange={event =>
                setForm(current => ({
                  ...current,
                  email: event.target.value
                }))
              }
            />
          </Field>
          {!isEditingClient ? (
            <Field id="account-active" label="Status" optionalText="">
              <Select
                value={String(form.isActive)}
                onChange={event =>
                  setForm(current => ({
                    ...current,
                    isActive: event.target.value === 'true'
                  }))
                }
              >
                <option value="true">Ativo</option>
                <option value="false">Inativo</option>
              </Select>
            </Field>
          ) : null}
          {!isEditingClient && form.accountType !== 'CLIENT' ? (
            <Field id="account-collaborator" label="Colaborador">
              <Select
                value={form.collaboratorId}
                onChange={event =>
                  setForm(current => ({
                    ...current,
                    collaboratorId: event.target.value
                  }))
                }
              >
                <option value="">Sem vínculo</option>
                {(collaboratorsQuery.data || [])
                  .filter(item => item.isActive)
                  .map(item => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
              </Select>
            </Field>
          ) : null}
          {editingUser ? (
            <Field id="account-password" label="Senha nova">
              <Input
                type="password"
                value={form.password}
                autoComplete="new-password"
                onChange={event =>
                  setForm(current => ({
                    ...current,
                    password: event.target.value
                  }))
                }
              />
            </Field>
          ) : (
            <div className="admin-account-form__wide">
              <Alert tone="info">A senha será criada pelo próprio usuário por um link único. Com e-mail, o link será enviado automaticamente.</Alert>
            </div>
          )}
          {!isEditingClient ? (
            <section className="admin-account-permission-group admin-account-form__wide" aria-labelledby="account-modules-title">
              <h3 id="account-modules-title">Módulos da conta</h3>
              {form.accountType === 'CLIENT' ? (
                <div className="admin-role-fixed">RDO - Cliente atribuído automaticamente</div>
              ) : (
                <div className="admin-role-grid">
                  {availableRoleOptions.map(option => (
                    <label className="admin-role-option" key={option.value}>
                      <input type="checkbox" checked={form.moduleRoles.includes(option.value)} onChange={() => toggleRole(option.value)} />
                      <span>{option.label}</span>
                    </label>
                  ))}
                </div>
              )}
            </section>
          ) : null}
          {!isEditingClient && (form.accountType === 'ADMIN' || canReceiveAcompanhamentoExtraPermissions(form)) ? (
            <section className="admin-account-permission-group admin-account-form__wide" aria-labelledby="account-tracking-title">
              <h3 id="account-tracking-title">Permissões adicionais do Acompanhamento</h3>
              {form.accountType === 'ADMIN' ? (
                <div className="form-hint">Administradores têm acesso automático aos impostos e faturamentos dos projetos.</div>
              ) : (
                <label className="admin-role-option">
                  <input
                    type="checkbox"
                    checked={form.acompanhamentoExtraPermissions.includes(PROJECT_TAXES_AND_BILLING)}
                    onChange={event => setForm(current => ({
                      ...current,
                      acompanhamentoExtraPermissions: event.target.checked ? [PROJECT_TAXES_AND_BILLING] : []
                    }))}
                  />
                  <span>Visualizar impostos pagos e faturamentos realizados no projeto</span>
                </label>
              )}
            </section>
          ) : null}
          {!isEditingClient && (form.accountType === 'ADMIN' || canReceiveRdoExtraPermissions(form)) ? (
            <section className="admin-account-permission-group admin-account-form__wide" aria-labelledby="account-rdo-title">
              <h3 id="account-rdo-title">Permissões adicionais do RDO</h3>
              {form.accountType === 'ADMIN' ? (
                <div className="form-hint">Administradores já revisam, editam e aprovam relatórios de qualquer projeto.</div>
              ) : (
                <>
                  <label className="admin-role-option">
                    <input
                      type="checkbox"
                      checked={form.rdoExtraPermissions.includes(REVIEW_REPORTS)}
                      onChange={event => setForm(current => ({
                        ...current,
                        rdoExtraPermissions: event.target.checked ? [REVIEW_REPORTS] : []
                      }))}
                    />
                    <span>Revisar relatórios: abrir a tela de edição do gestor, aprovar e devolver</span>
                  </label>
                  <div className="form-hint">
                    Inclui baixar DOCX, alterar a numeração, descartar edições pendentes e consultar a auditoria.
                    Não inclui excluir relatórios nem acessar projetos visíveis somente para o gestor.
                  </div>
                </>
              )}
            </section>
          ) : null}
          {!isEditingClient && form.accountType !== 'CLIENT' ? (
            <section className="admin-account-permission-group admin-account-form__wide admin-report-permissions" aria-labelledby="account-report-title">
              <h3 id="account-report-title">Emissão de relatórios</h3>
              <div className="admin-role-grid admin-report-permissions__grid">
                {reportPermissionOptions.map(option => (
                  <label className="admin-role-option admin-report-permissions__option" key={option.value}>
                    <input
                      type="checkbox"
                      checked={impliedReportPermission(form, option.value) || form.reportEmissionPermissions.includes(option.value)}
                      disabled={impliedReportPermission(form, option.value)}
                      onChange={() => toggleReportPermission(option.value)}
                    />
                    <span>
                      <strong>{option.label}</strong>
                      <small>{option.description}</small>
                      {impliedReportPermission(form, option.value) ? <small className="admin-report-permissions__inherited">Incluída pelo papel RDO</small> : null}
                    </span>
                  </label>
                ))}
              </div>
              <div className="form-hint">As permissões são independentes. Sem nenhuma delas, a conta não poderá criar relatórios.</div>
            </section>
          ) : null}
          <div className="admin-account-form__actions admin-account-form__wide">
            <Button variant="secondary" onClick={resetForm}>Cancelar</Button>
            <Button variant="primary" type="submit" loading={isSaving}>
              {editingUser ? 'Salvar alterações' : 'Criar conta'}
            </Button>
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

  async function openDeleteDialog(target: InternalUserSummary) {
    setMessage('');
    setError('');
    setDeletingUser(target);
    setDeletionImpact(null);
    try {
      const impact = await userMutations.deletionImpact.mutateAsync(target.id);
      setDeletionImpact(impact);
    } catch (err) {
      setDeletingUser(null);
      setError(err instanceof Error ? err.message : 'Falha ao consultar o impacto da exclusão.');
    }
  }

  function closeDeleteDialog() {
    if (userMutations.removeUser.isPending) return;
    setDeletingUser(null);
    setDeletionImpact(null);
  }

  async function confirmDelete() {
    if (!deletingUser || !deletionImpact || deletionImpact.assinaturas.finalizing > 0) return;
    setError('');
    try {
      await userMutations.removeUser.mutateAsync(deletingUser.id);
      setMessage('Conta excluída. Documentos concluídos foram preservados sem proprietário.');
      setDeletingUser(null);
      setDeletionImpact(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao excluir a conta.');
    }
  }

  const deletionDescription = !deletionImpact
    ? 'Consultando documentos de assinatura vinculados à conta…'
    : deletionImpact.assinaturas.finalizing > 0
      ? `${deletionImpact.assinaturas.finalizing} documento(s) estão em finalização. Aguarde a conclusão para excluir a conta.`
      : `${deletionImpact.assinaturas.toDelete} documento(s) não concluído(s) serão colocados em quarentena e excluídos; ${deletionImpact.assinaturas.toPreserve} documento(s) concluído(s) serão preservados sem proprietário.`;

  function accountActions(user: InternalUserSummary) {
    return <>
      <Button variant="secondary" size="sm" onClick={() => openEditForm(user)}>Editar</Button>
      <Button variant={user.isActive ? 'danger' : 'secondary'} size="sm" onClick={() => void toggleActive(user)} disabled={userMutations.updateUser.isPending}>
        {user.isActive ? 'Desativar' : 'Ativar'}
      </Button>
      <RemoveIconButton label={`Remover conta de ${user.name}`} onClick={() => void openDeleteDialog(user)} disabled={userMutations.deletionImpact.isPending || userMutations.removeUser.isPending} />
    </>;
  }

  const accountColumns: DataTableColumn<InternalUserSummary>[] = [
    {
      key: 'account', header: 'Conta', rowHeader: true,
      render: user => <div className="admin-account-table__identity">
        <strong>{user.name}</strong>
        <span>@{user.username}</span>
        {user.email ? <span>{user.email}</span> : null}
      </div>
    },
    {
      key: 'profile', header: 'Perfil',
      render: user => <div className="admin-account-table__profile">
        <span>{accountTypeLabel(user.accountType)}</span>
        <Badge tone={user.isActive ? 'success' : 'neutral'} dot>{user.isActive ? 'Ativo' : 'Inativo'}</Badge>
      </div>
    },
    { key: 'access', header: 'Acessos e vínculos', render: accountAccess }
  ];

  return (
    <AdminModuleAppShell sectionLabel="Contas">
      <main className="fv-ds admin-accounts-page-v2">
        <PageHeader
          title="Gestão de contas"
          description="Gerencie usuários internos, administradores e clientes."
          actions={!showForm ? <Button variant="primary" onClick={() => openCreateForm()}>Nova conta</Button> : undefined}
        />

        <Card className="admin-account-filters-v2" padding="md">
          <div className="admin-account-filters-v2__grid">
            <Field id="account-search" label="Buscar" optionalText="">
              <SearchInput id="account-search-control" value={search} onChange={setSearch} placeholder="Nome, usuário ou e-mail" />
            </Field>
            <Field id="account-type-filter" label="Tipo" optionalText="">
              <Select value={accountFilter} onChange={event => setAccountFilter(event.target.value as AccountFilter)}>
                <option value="all">Todos</option>
                <option value="ADMIN">Admins</option>
                <option value="INTERNAL">Internos</option>
                <option value="CLIENT">Clientes</option>
              </Select>
            </Field>
            <Field id="account-module-filter" label="Módulo" optionalText="">
              <Select value={moduleFilter} onChange={event => setModuleFilter(event.target.value as ModuleFilter)}>
                <option value="all">Todos</option>
                {moduleRegistry
                  .filter(module => module.roles.length)
                  .map(module => (
                    <option key={module.id} value={module.id}>{module.title}</option>
                  ))}
              </Select>
            </Field>
          </div>
        </Card>

        {message ? <Alert tone="success">{message}</Alert> : null}
        {error ? <Alert tone="danger">{error}</Alert> : null}
        {manualPasswordSetup ? <PasswordSetupLinkCard
          inputId="manual-password-setup-link"
          username={manualPasswordSetup.username}
          url={manualPasswordSetup.url}
          onCopy={copyManualPasswordSetup}
        /> : null}

        {showForm ? renderAccountForm() : null}

        {usersQuery.isLoading ? (
          <Skeleton variant="card" label="Carregando contas…" />
        ) : usersQuery.isError ? (
          <Alert tone="danger" action={{ label: 'Tentar novamente', onClick: () => void usersQuery.refetch() }}>
            Não foi possível carregar as contas.
          </Alert>
        ) : visibleUsers.length ? (
          <section className="admin-account-results" aria-label="Contas encontradas">
            <div className="admin-account-results__heading">
              <h2>Contas</h2>
              <Badge>{visibleUsers.length} de {(usersQuery.data || []).length}</Badge>
            </div>
            <DataTable
              className="admin-account-table"
              rows={visibleUsers}
              columns={accountColumns}
              getRowId={user => user.id}
              ariaLabel="Contas cadastradas"
              density="compact"
              actionsLabel="Ações"
              rowActions={accountActions}
              mobile={{
                ariaLabel: 'Contas cadastradas',
                renderItem: user => ({
                  title: user.name,
                  subtitle: `@${user.username}`,
                  status: <Badge tone={user.isActive ? 'success' : 'neutral'} dot>{user.isActive ? 'Ativo' : 'Inativo'}</Badge>,
                  metadata: [
                    { label: 'Tipo', value: accountTypeLabel(user.accountType) },
                    ...(user.email ? [{ label: 'E-mail', value: user.email }] : [])
                  ],
                  details: accountAccess(user),
                  actions: accountActions(user)
                })
              }}
            />
          </section>
        ) : (
          <EmptyState
            variant={usersQuery.data?.length ? 'search' : 'create'}
            title={usersQuery.data?.length ? 'Nenhuma conta encontrada.' : 'Nenhuma conta cadastrada.'}
            description={usersQuery.data?.length ? 'Ajuste a busca ou os filtros para ver outras contas.' : 'Crie a primeira conta para liberar o acesso aos módulos.'}
            action={usersQuery.data?.length
              ? { label: 'Limpar filtros', onClick: () => { setSearch(''); setAccountFilter('all'); setModuleFilter('all'); } }
              : { label: 'Nova conta', onClick: () => openCreateForm() }}
          />
        )}
      </main>
      <ConfirmDialog
        appearance="design-system"
        open={Boolean(deletingUser)}
        title="Excluir conta permanentemente?"
        description={deletionDescription}
        highlight={deletingUser ? `${deletingUser.name} · ${deletingUser.username}` : undefined}
        confirmLabel={userMutations.removeUser.isPending ? 'Excluindo…' : 'Excluir conta'}
        confirmationText={deletingUser && deletionImpact && deletionImpact.assinaturas.finalizing === 0 ? deletingUser.username : undefined}
        confirmationLabel={deletingUser ? `Digite ${deletingUser.username} para confirmar` : undefined}
        confirmDisabled={!deletionImpact || deletionImpact.assinaturas.finalizing > 0 || userMutations.removeUser.isPending}
        onConfirm={() => void confirmDelete()}
        onCancel={closeDeleteDialog}
      />
    </AdminModuleAppShell>
  );
}
