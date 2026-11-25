import { useUsefulQueryContent } from '../../../observability/useUsefulContent';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import {
  getPlanningSettings,
  listEfetivoRoleUsers,
  listNotificationEmailSettings,
  listPlanningJobRoles,
  updateNotificationEmailSetting,
  updatePlanningJobRole,
  updatePlanningSettings,
  type NotificationEmailSetting,
  type PlanningJobRole
} from '../../../api/efetivoPlanning';
import { Button, Card, EmptyState, Field, Input, Skeleton, Switch } from '../../../components/ui/ds';
import { EfetivoActivityList } from './EfetivoActivityList';
import { HolidayManager } from './HolidayManager';
import { AllocationReviewParticipants } from './AllocationReviewParticipants';
import { useAdministrationAutosave } from './useAdministrationAutosave';

const EFETIVO_ROLE_LABELS: Record<string, string> = {
  EFETIVO_MANAGER: 'Gestor',
  EFETIVO_VIEWER: 'Visualizador',
  EFETIVO_COMMERCIAL: 'Comercial',
  EFETIVO_OPERATIONS: 'Operações',
  EFETIVO_ASSETS: 'Ativos',
  EFETIVO_SUPPLIES: 'Suprimentos',
  EFETIVO_ADMINISTRATIVE: 'Administrativo/RH',
  EFETIVO_QSMS: 'QSMS',
  EFETIVO_ALLOCATION_REVIEW: 'Conferência de alocação'
};

const ADMIN_TABS = [
  ['regras', 'Regras e acessos'],
  ['conferencia', 'Conferência'],
  ['feriados', 'Feriados'],
  ['notificacoes', 'Notificações'],
  ['atividade', 'Atividade']
] as const;
type AdminTab = typeof ADMIN_TABS[number][0];

function AdministrationAutosaveStatus({ state }: {
  state: { isPending: boolean; isError: boolean; isSuccess: boolean; canManage: boolean; commit: () => void };
}) {
  if (!state.canManage) return null;
  return <span role="status" className="efetivo-admin-autosave-status">
    {state.isPending ? 'Salvando…' : state.isError ? <>Alteração não salva. <Button variant="secondary" size="sm" onClick={() => state.commit()}>Tentar novamente</Button></> : state.isSuccess ? 'Salvo automaticamente.' : 'Salvamento automático'}
  </span>;
}

function JobRoleRow({ role, canManage }: { role: PlanningJobRole; canManage: boolean }) {
  const queryClient = useQueryClient();
  async function save(payload: Parameters<typeof updatePlanningJobRole>[1]) {
    await updatePlanningJobRole(role.id, payload);
    queryClient.setQueryData<PlanningJobRole[]>(['efetivo-planning-job-roles'], items => items?.map(item => item.id === role.id ? { ...item, ...payload } : item));
    void queryClient.invalidateQueries({ queryKey: ['efetivo-planning-job-roles'] });
  }
  const color = useAdministrationAutosave({ savedValue: role.calendarColor || '#64748B', canManage,
    validate: value => /^#[0-9a-f]{6}$/i.test(value), save: value => save({ calendarColor: value }) });
  const limit = useAdministrationAutosave({ savedValue: role.continuousWorkLimitDays?.toString() || '', canManage,
    validate: validLimit, save: value => save({ continuousWorkLimitDays: value ? Number(value) : null }) });
  const operational = useAdministrationAutosave({ savedValue: role.isOperational, canManage,
    validate: () => true, save: value => save({ isOperational: value }) });

  return <article className="efetivo-admin-role">
    <div className="efetivo-admin-role__name"><span className="efetivo-role-color" style={{ background: color.value }} /><strong>{role.name}</strong></div>
    <div><Switch label="Operacional" checked={operational.value} disabled={!canManage || operational.isPending} onChange={event => { operational.change(event.target.checked); operational.commit(event.target.checked); }} /><AdministrationAutosaveStatus state={operational} /></div>
    <Field id={`role-color-${role.id}`} label="Cor do calendário" optionalText="" helperText={<AdministrationAutosaveStatus state={color} />}>
      <input id={`role-color-${role.id}-control`} className="efetivo-admin-color-input" type="color" value={color.value} disabled={!canManage || color.isPending} onChange={event => color.change(event.target.value)} onBlur={() => color.commit()} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }} />
    </Field>
    <Field id={`role-limit-${role.id}`} label="Folga após (dias)" optionalText="" errorText={!validLimit(limit.value) ? 'Use um inteiro de 1 a 365.' : undefined} helperText={<AdministrationAutosaveStatus state={limit} />}>
      <Input id={`role-limit-${role.id}-control`} size="sm" type="number" min="1" max="365" value={limit.value} disabled={!canManage || limit.isPending} placeholder="Padrão da categoria" onChange={event => limit.change(event.target.value)} onBlur={() => limit.commit()} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }} />
    </Field>
  </article>;
}

function validLimit(value: string) {
  return value === '' || (Number.isInteger(Number(value)) && Number(value) >= 1 && Number(value) <= 365);
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function NotificationEmailRow({ setting, canManage }: { setting: NotificationEmailSetting; canManage: boolean }) {
  const queryClient = useQueryClient();
  const email = useAdministrationAutosave({ savedValue: setting.email || '', canManage,
    validate: value => EMAIL_PATTERN.test(value.trim()) && value.trim().length <= 160,
    save: async value => {
      const updated = await updateNotificationEmailSetting(setting.key, value.trim());
      queryClient.setQueryData<NotificationEmailSetting[]>(['efetivo-notification-emails'], items => items?.map(item => item.key === setting.key ? { ...item, ...updated } : item));
      void queryClient.invalidateQueries({ queryKey: ['efetivo-notification-emails'] });
    }
  });
  const invalid = (email.value !== '' || Boolean(setting.email)) && (!EMAIL_PATTERN.test(email.value.trim()) || email.value.trim().length > 160);

  return <article className="efetivo-admin-role efetivo-admin-role--email">
    <div className="efetivo-admin-role__name"><strong>{setting.label}</strong><p>{setting.description}</p></div>
    <Field id={`notification-email-${setting.key}`} label="E-mail de aviso" optionalText="" errorText={invalid ? 'Informe um e-mail válido de até 160 caracteres.' : undefined} helperText={<AdministrationAutosaveStatus state={email} />}>
      <Input id={`notification-email-${setting.key}-control`} size="sm" type="email" value={email.value} disabled={!canManage || email.isPending} placeholder="nome@filtrovali.com.br" onChange={event => email.change(event.target.value)} onBlur={() => email.commit()} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }} />
    </Field>
  </article>;
}

export function AdministrationBoard({ canManage, tab, onTabChange }: {
  canManage: boolean;
  tab: AdminTab;
  onTabChange: (tab: AdminTab) => void;
}) {
  const queryClient = useQueryClient();
  const roles = useQuery({ queryKey: ['efetivo-planning-job-roles'], queryFn: listPlanningJobRoles });
  const settings = useQuery({ queryKey: ['efetivo-planning-settings'], queryFn: getPlanningSettings });
  const users = useQuery({ queryKey: ['efetivo-planning-users'], queryFn: listEfetivoRoleUsers });
  useUsefulQueryContent('efetivo:administracao', 'AdministrationBoard', [roles, settings, users], tab !== 'conferencia');
  const notificationEmails = useQuery({ queryKey: ['efetivo-notification-emails'], queryFn: listNotificationEmailSettings, enabled: tab === 'notificacoes' });
  const target = useAdministrationAutosave({ savedValue: settings.data ? String(settings.data.plannedUtilizationTarget) : '',
    canManage: canManage && settings.isSuccess,
    validate: value => value.trim() !== '' && Number.isFinite(Number(value)) && Number(value) >= 0 && Number(value) <= 100,
    save: async value => {
      await updatePlanningSettings(Number(value));
      queryClient.setQueryData(['efetivo-planning-settings'], { plannedUtilizationTarget: Number(value) });
      void queryClient.invalidateQueries({ queryKey: ['efetivo-planning-settings'] });
    }
  });
  const targetInvalid = Boolean(settings.data) && (target.value.trim() === '' || !Number.isFinite(Number(target.value)) || Number(target.value) < 0 || Number(target.value) > 100);

  return <div className="efetivo-board efetivo-administration-ds" data-efetivo-administration>
    <nav className="efetivo-admin-tabs" aria-label="Áreas da administração">
      {ADMIN_TABS.map(([value, label]) => <button type="button" className={tab === value ? 'active' : ''} aria-current={tab === value ? 'page' : undefined} onClick={() => onTabChange(value)} key={value}>{label}</button>)}
    </nav>
    {tab === 'regras' ? <>
      <Card className="efetivo-administration-section">
        <div className="efetivo-section-heading"><div><h2>Funções operacionais</h2><p>Cor do calendário e limite de permanência. As alterações são salvas automaticamente ao concluir cada campo. Nome/ordem continuam sob o cadastro RDO.</p></div></div>
        {roles.isLoading ? <Skeleton variant="card" /> : roles.isError ? <EmptyState variant="error" title="Não foi possível carregar as funções." action={{ label: 'Tentar novamente', onClick: () => void roles.refetch() }} /> : roles.data?.length ? <div className="efetivo-admin-role-list">{roles.data.map(role => <JobRoleRow role={role} canManage={canManage} key={role.id} />)}</div> : <EmptyState title="Nenhuma função operacional cadastrada." />}
      </Card>
      <Card className="efetivo-administration-section efetivo-admin-target">
        <div className="efetivo-section-heading"><div><h2>Meta de utilização planejada</h2><p>Indicador futuro; não altera a Improdutividade Real.</p></div></div>
        <div className="efetivo-admin-target__controls">
          <Field id="planned-target" label="Meta (%)" optionalText="" errorText={targetInvalid ? 'Use um valor de 0 a 100.' : undefined} helperText={<AdministrationAutosaveStatus state={target} />}>
            <Input id="planned-target-control" size="sm" type="number" min="0" max="100" value={target.value} disabled={!canManage || target.isPending || !settings.isSuccess} onChange={event => target.change(event.target.value)} onBlur={() => target.commit()} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }} />
          </Field>
        </div>
        {settings.isError ? <EmptyState variant="error" title="Não foi possível carregar a meta." action={{ label: 'Tentar novamente', onClick: () => void settings.refetch() }} /> : null}
      </Card>
      <Card className="efetivo-administration-section">
        <div className="efetivo-section-heading"><div><h2>Acessos do módulo</h2><p>Usuários com papéis de gestão, consulta e responsabilidade por área no Efetivo.</p></div></div>
        {users.isLoading ? <Skeleton variant="card" /> : users.isError ? <EmptyState variant="error" title="Não foi possível carregar os acessos." action={{ label: 'Tentar novamente', onClick: () => void users.refetch() }} /> : users.data?.length ? <div className="efetivo-user-grid">{users.data.map(user => <article key={user.id}><strong>{user.name}</strong><span>{user.accountType === 'ADMIN' ? 'Administrador' : user.moduleRoles.map(role => EFETIVO_ROLE_LABELS[role.role] || role.role).join(', ')}</span></article>)}</div> : <EmptyState title="Nenhum acesso registrado." />}
      </Card>
    </> : null}
    {tab === 'feriados' ? <HolidayManager canManage={canManage} /> : null}
    {tab === 'conferencia' ? <AllocationReviewParticipants canManage={canManage} /> : null}
    {tab === 'notificacoes' ? <Card className="efetivo-administration-section">
      <div className="efetivo-section-heading"><div><h2>E-mails de aviso</h2><p>Destinatário padrão de cada aviso automático da Gestão de Projetos. Pode ser corrigido pontualmente em cada projeto.</p></div></div>
      {notificationEmails.isLoading ? <Skeleton variant="card" /> : notificationEmails.isError ? <EmptyState variant="error" title="Não foi possível carregar os e-mails." action={{ label: 'Tentar novamente', onClick: () => void notificationEmails.refetch() }} /> : notificationEmails.data?.length ? <div className="efetivo-admin-role-list">{notificationEmails.data.map(setting => <NotificationEmailRow setting={setting} canManage={canManage} key={setting.key} />)}</div> : <EmptyState title="Nenhum e-mail de aviso configurado." />}
    </Card> : null}
    {tab === 'atividade' ? <EfetivoActivityList /> : null}
  </div>;
}
