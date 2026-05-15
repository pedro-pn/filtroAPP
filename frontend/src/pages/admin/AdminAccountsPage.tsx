import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

import {
  listAccounts,
  createAccount,
  updateAccount,
  toggleAccountStatus,
  resendClientAccess
} from '../../api/admin';
import type { CreateAccountPayload, UpdateAccountPayload } from '../../api/admin';
import { useAuth } from '../../auth/AuthContext';
import { Shell } from '../../layout/Shell';
import { TopBar } from '../../layout/TopBar';
import { useToast } from '../../components/ui/Toast';
import type { AccountType, AppModule, ModuleRoleCode } from '../../types/auth';
import type { InternalUserSummary } from '../../types/domain';

const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  ADMIN: 'Administrador',
  INTERNAL: 'Interno',
  CLIENT: 'Cliente'
};

const MODULE_ROLE_OPTIONS: { module: AppModule; role: ModuleRoleCode; label: string }[] = [
  { module: 'RDO', role: 'RDO_MANAGER', label: 'RDO — Gestor' },
  { module: 'RDO', role: 'RDO_COORDINATOR', label: 'RDO — Coordenador' },
  { module: 'RDO', role: 'RDO_COLLABORATOR', label: 'RDO — Colaborador' },
  { module: 'ROMANEIO', role: 'ROMANEIO_MANAGER', label: 'Romaneio — Gerente' },
  { module: 'ROMANEIO', role: 'ROMANEIO_OPERATOR', label: 'Romaneio — Operador' },
  { module: 'EPI', role: 'EPI_TECHNICIAN', label: 'EPI — Técnico' },
  { module: 'EPI', role: 'EPI_COLLABORATOR', label: 'EPI — Colaborador' }
];

interface AccountFormState {
  username: string;
  name: string;
  email: string;
  password: string;
  accountType: AccountType;
  moduleRoles: Array<{ module: AppModule; role: ModuleRoleCode }>;
}

const emptyForm = (): AccountFormState => ({
  username: '',
  name: '',
  email: '',
  password: '',
  accountType: 'INTERNAL',
  moduleRoles: []
});

function accountToForm(account: InternalUserSummary): AccountFormState {
  return {
    username: account.username,
    name: account.name,
    email: account.email || '',
    password: '',
    accountType: account.accountType,
    moduleRoles: account.moduleRoles
  };
}

function formatModuleRoles(roles: Array<{ module: AppModule; role: ModuleRoleCode }>) {
  if (!roles.length) return 'Sem permissões';
  return roles
    .map(mr => MODULE_ROLE_OPTIONS.find(o => o.module === mr.module && o.role === mr.role)?.label ?? `${mr.module}:${mr.role}`)
    .join(', ');
}

interface AccountFormProps {
  formId: string;
  form: AccountFormState;
  isEdit: boolean;
  isSaving: boolean;
  onChange: (form: AccountFormState) => void;
  onSubmit: (e: FormEvent) => void;
  onCancel: () => void;
}

function AccountForm({ formId, form, isEdit, isSaving, onChange, onSubmit, onCancel }: AccountFormProps) {
  function set<K extends keyof AccountFormState>(key: K, value: AccountFormState[K]) {
    onChange({ ...form, [key]: value });
  }

  function toggleModuleRole(module: AppModule, role: ModuleRoleCode) {
    const exists = form.moduleRoles.some(mr => mr.module === module && mr.role === role);
    set('moduleRoles', exists
      ? form.moduleRoles.filter(mr => !(mr.module === module && mr.role === role))
      : [...form.moduleRoles, { module, role }]
    );
  }

  return (
    <form className="admin-inline-form" id={formId} onSubmit={onSubmit} autoComplete="off">
      <div className="admin-toolbar full">
        <div className="sec">{isEdit ? 'Editar conta' : 'Nova conta'}</div>
        <button className="mini-btn alt" type="button" onClick={onCancel}>Cancelar</button>
      </div>

      <div className="admin-inline-grid">
        <div className="field-group">
          <label htmlFor={`${formId}-name`}>Nome</label>
          <input
            id={`${formId}-name`}
            value={form.name}
            autoComplete="off"
            onChange={e => set('name', e.target.value)}
            required
          />
        </div>

        {!isEdit && (
          <div className="field-group">
            <label htmlFor={`${formId}-username`}>Usuário / login</label>
            <input
              id={`${formId}-username`}
              value={form.username}
              autoComplete="off"
              onChange={e => set('username', e.target.value)}
              required
            />
          </div>
        )}

        <div className="field-group">
          <label htmlFor={`${formId}-email`}>E-mail</label>
          <input
            id={`${formId}-email`}
            type="email"
            value={form.email}
            autoComplete="off"
            onChange={e => set('email', e.target.value)}
          />
        </div>

        <div className="field-group">
          <label htmlFor={`${formId}-password`}>
            {isEdit ? 'Nova senha (opcional)' : 'Senha'}
          </label>
          <input
            id={`${formId}-password`}
            type="password"
            value={form.password}
            autoComplete="new-password"
            onChange={e => set('password', e.target.value)}
            required={!isEdit}
            minLength={6}
          />
        </div>

        <div className="field-group">
          <label htmlFor={`${formId}-type`}>Tipo de conta</label>
          <select
            id={`${formId}-type`}
            value={form.accountType}
            onChange={e => set('accountType', e.target.value as AccountType)}
          >
            <option value="INTERNAL">Interno</option>
            <option value="ADMIN">Administrador</option>
            <option value="CLIENT">Cliente</option>
          </select>
        </div>

        {form.accountType === 'INTERNAL' && (
          <div className="field-group field-group-wide">
            <label>Permissões de módulo</label>
            {MODULE_ROLE_OPTIONS.map(opt => (
              <label
                key={`${opt.module}-${opt.role}`}
                className="rdo-check-row"
                style={{ marginBottom: 4 }}
              >
                <input
                  type="checkbox"
                  checked={form.moduleRoles.some(mr => mr.module === opt.module && mr.role === opt.role)}
                  onChange={() => toggleModuleRole(opt.module, opt.role)}
                />
                <span>{opt.label}</span>
              </label>
            ))}
          </div>
        )}

        <div className="admin-form-actions">
          <button className="mini-btn" type="submit" disabled={isSaving}>
            {isSaving ? 'Salvando...' : isEdit ? 'Salvar' : 'Criar conta'}
          </button>
        </div>
      </div>
    </form>
  );
}

export function AdminAccountsPage() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const showToast = useToast();

  const [typeFilter, setTypeFilter] = useState<AccountType | ''>('');
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [createForm, setCreateForm] = useState<AccountFormState>(emptyForm());
  const [editForm, setEditForm] = useState<AccountFormState>(emptyForm());
  const [isSaving, setIsSaving] = useState(false);

  const { data: accounts = [], isLoading } = useQuery({
    queryKey: ['admin-accounts', typeFilter],
    queryFn: () => listAccounts(typeFilter ? { type: typeFilter } : undefined)
  });

  const toggleMutation = useMutation({
    mutationFn: (id: string) => toggleAccountStatus(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-accounts'] });
      showToast('Status atualizado.', 'success');
    },
    onError: () => showToast('Falha ao atualizar status.', 'error')
  });

  const resendMutation = useMutation({
    mutationFn: (id: string) => resendClientAccess(id),
    onSuccess: () => showToast('E-mail de acesso reenviado.', 'success'),
    onError: () => showToast('Falha ao reenviar e-mail.', 'error')
  });

  function resetCreate() {
    setCreateForm(emptyForm());
    setShowCreateForm(false);
  }

  function resetEdit() {
    setEditingId(null);
    setEditForm(emptyForm());
  }

  async function handleCreateSubmit(e: FormEvent) {
    e.preventDefault();
    setIsSaving(true);
    try {
      const payload: CreateAccountPayload = {
        username: createForm.username,
        name: createForm.name,
        email: createForm.email || null,
        password: createForm.password,
        accountType: createForm.accountType,
        moduleRoles: createForm.accountType === 'INTERNAL' ? createForm.moduleRoles : undefined
      };
      await createAccount(payload);
      showToast('Conta criada.', 'success');
      queryClient.invalidateQueries({ queryKey: ['admin-accounts'] });
      resetCreate();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Falha ao criar conta.', 'error');
    } finally {
      setIsSaving(false);
    }
  }

  async function handleEditSubmit(e: FormEvent) {
    e.preventDefault();
    if (!editingId) return;
    setIsSaving(true);
    try {
      const payload: UpdateAccountPayload = {
        name: editForm.name,
        email: editForm.email || null,
        ...(editForm.password ? { password: editForm.password } : {}),
        accountType: editForm.accountType,
        moduleRoles: editForm.accountType === 'INTERNAL' ? editForm.moduleRoles : undefined
      };
      await updateAccount(editingId, payload);
      showToast('Conta atualizada.', 'success');
      queryClient.invalidateQueries({ queryKey: ['admin-accounts'] });
      resetEdit();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Falha ao salvar conta.', 'error');
    } finally {
      setIsSaving(false);
    }
  }

  function handleLogout() {
    logout();
  }

  if (user?.accountType !== 'ADMIN') return null;

  return (
    <Shell>
      <TopBar
        title="Gestão de Contas"
        actions={
          <>
            <button className="topbar-chip" type="button" onClick={() => navigate('/hub')}>
              ← Hub
            </button>
            <button className="topbar-chip" type="button" onClick={handleLogout}>
              Sair
            </button>
          </>
        }
      />

      <div className="page-scroll">
        <section className="page-card">
          <div className="admin-toolbar">
            <div className="sec">Contas</div>
            {!showCreateForm && !editingId ? (
              <button
                className="mini-btn"
                type="button"
                onClick={() => { setShowCreateForm(true); setEditingId(null); }}
              >
                + Nova conta
              </button>
            ) : null}
          </div>

          <div className="admin-search-row">
            <select
              value={typeFilter}
              onChange={e => setTypeFilter(e.target.value as AccountType | '')}
              style={{ width: '100%', boxSizing: 'border-box', border: '1px solid var(--br)', borderRadius: 'var(--rs)', padding: '9px 11px', background: '#fafafa', color: 'var(--tx)' }}
            >
              <option value="">Todos os tipos</option>
              <option value="ADMIN">Administradores</option>
              <option value="INTERNAL">Internos</option>
              <option value="CLIENT">Clientes</option>
            </select>
          </div>

          {showCreateForm && (
            <AccountForm
              formId="create"
              form={createForm}
              isEdit={false}
              isSaving={isSaving}
              onChange={setCreateForm}
              onSubmit={handleCreateSubmit}
              onCancel={resetCreate}
            />
          )}

          {isLoading && (
            <div className="placeholder-copy">Carregando contas...</div>
          )}

          {!isLoading && accounts.length === 0 && (
            <div className="placeholder-copy">Nenhuma conta encontrada.</div>
          )}

          {!isLoading && accounts.length > 0 && (
            <div className="admin-stack" style={{ marginTop: showCreateForm ? 12 : 0 }}>
              {accounts.map(account => (
                <article className="card admin-card" key={account.id}>
                  <div className="admin-item-title">
                    {account.name} · {account.username}
                  </div>
                  <div className="admin-item-sub">
                    {ACCOUNT_TYPE_LABELS[account.accountType]}
                    {account.email ? ` · ${account.email}` : ''}
                  </div>
                  <div className="admin-item-sub" style={{ marginTop: 2 }}>
                    {formatModuleRoles(account.moduleRoles)}
                  </div>
                  <div className="client-account-badges" style={{ marginTop: 6 }}>
                    <span className={`status-pill ${account.isActive ? 'status-approved' : 'status-returned'}`}>
                      {account.isActive ? 'Ativo' : 'Inativo'}
                    </span>
                  </div>
                  <div className="admin-actions">
                    <button
                      className="mini-btn alt"
                      type="button"
                      onClick={() => {
                        setEditingId(account.id);
                        setShowCreateForm(false);
                        setEditForm(accountToForm(account));
                      }}
                    >
                      Editar
                    </button>
                    <button
                      className="mini-btn alt"
                      type="button"
                      disabled={toggleMutation.isPending}
                      onClick={() => toggleMutation.mutate(account.id)}
                    >
                      {account.isActive ? 'Desativar' : 'Ativar'}
                    </button>
                    {account.accountType === 'CLIENT' && account.email && (
                      <button
                        className="mini-btn alt"
                        type="button"
                        disabled={resendMutation.isPending}
                        onClick={() => resendMutation.mutate(account.id)}
                      >
                        Reenviar acesso
                      </button>
                    )}
                  </div>

                  {editingId === account.id && (
                    <AccountForm
                      formId={`edit-${account.id}`}
                      form={editForm}
                      isEdit
                      isSaving={isSaving}
                      onChange={setEditForm}
                      onSubmit={handleEditSubmit}
                      onCancel={resetEdit}
                    />
                  )}
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </Shell>
  );
}
