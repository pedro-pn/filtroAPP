import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

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
import { useToast } from '../../../components/ui/ToastContext';
import { EfetivoActivityList } from './EfetivoActivityList';
import { HolidayManager } from './HolidayManager';

const EFETIVO_ROLE_LABELS: Record<string, string> = {
  EFETIVO_MANAGER: 'Gestor',
  EFETIVO_VIEWER: 'Visualizador',
  EFETIVO_COMMERCIAL: 'Comercial',
  EFETIVO_OPERATIONS: 'Operações',
  EFETIVO_ASSETS: 'Ativos',
  EFETIVO_SUPPLIES: 'Suprimentos',
  EFETIVO_ADMINISTRATIVE: 'Administrativo/RH',
  EFETIVO_QSMS: 'QSMS'
};

const ADMIN_TABS = [
  ['regras', 'Regras e acessos'],
  ['feriados', 'Feriados'],
  ['notificacoes', 'Notificações'],
  ['atividade', 'Atividade']
] as const;
type AdminTab = typeof ADMIN_TABS[number][0];

function JobRoleRow({ role, canManage, onSaved }: { role: PlanningJobRole; canManage: boolean; onSaved: () => void }) {
  const toast = useToast();
  const [color, setColor] = useState(role.calendarColor || '#64748B');
  const [limit, setLimit] = useState(role.continuousWorkLimitDays?.toString() || '');
  const [operational, setOperational] = useState(role.isOperational);
  useEffect(() => {
    setColor(role.calendarColor || '#64748B');
    setLimit(role.continuousWorkLimitDays?.toString() || '');
    setOperational(role.isOperational);
  }, [role]);
  const limitNumber = Number(limit);
  const limitInvalid = Boolean(limit) && (!Number.isInteger(limitNumber) || limitNumber < 1 || limitNumber > 365);
  const mutation = useMutation({
    mutationFn: () => updatePlanningJobRole(role.id, {
      calendarColor: color,
      continuousWorkLimitDays: limit ? Number(limit) : null,
      isOperational: operational
    }),
    onSuccess: () => { onSaved(); toast('Função atualizada.', 'success'); },
    onError: (error: Error) => toast(error.message, 'error')
  });

  return <article className="efetivo-admin-role">
    <div className="efetivo-admin-role__name"><span className="efetivo-role-color" style={{ background: color }} /><strong>{role.name}</strong></div>
    <Switch label="Operacional" checked={operational} disabled={!canManage || mutation.isPending} onChange={event => setOperational(event.target.checked)} />
    <Field id={`role-color-${role.id}`} label="Cor do calendário" optionalText="">
      <input id={`role-color-${role.id}-control`} className="efetivo-admin-color-input" type="color" value={color} disabled={!canManage || mutation.isPending} onChange={event => setColor(event.target.value)} />
    </Field>
    <Field id={`role-limit-${role.id}`} label="Folga após (dias)" optionalText="" errorText={limitInvalid ? 'Use um inteiro de 1 a 365.' : undefined}>
      <Input id={`role-limit-${role.id}-control`} size="sm" type="number" min="1" max="365" value={limit} disabled={!canManage || mutation.isPending} placeholder="Padrão da categoria" onChange={event => setLimit(event.target.value)} />
    </Field>
    {canManage ? <Button variant="secondary" size="sm" loading={mutation.isPending} disabled={limitInvalid} onClick={() => mutation.mutate()}>Salvar</Button> : null}
  </article>;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function NotificationEmailRow({ setting, canManage, onSaved }: { setting: NotificationEmailSetting; canManage: boolean; onSaved: () => void }) {
  const toast = useToast();
  const [email, setEmail] = useState(setting.email || '');
  useEffect(() => { setEmail(setting.email || ''); }, [setting.email]);
  const invalid = email.trim() !== '' && !EMAIL_PATTERN.test(email.trim());
  const mutation = useMutation({
    mutationFn: () => updateNotificationEmailSetting(setting.key, email.trim()),
    onSuccess: () => { onSaved(); toast('E-mail de aviso atualizado.', 'success'); },
    onError: (error: Error) => toast(error.message, 'error')
  });

  return <article className="efetivo-admin-role efetivo-admin-role--email">
    <div className="efetivo-admin-role__name"><strong>{setting.label}</strong><p>{setting.description}</p></div>
    <Field id={`notification-email-${setting.key}`} label="E-mail de aviso" optionalText="" errorText={invalid ? 'Informe um e-mail válido.' : undefined}>
      <Input id={`notification-email-${setting.key}-control`} size="sm" type="email" value={email} disabled={!canManage || mutation.isPending} placeholder="nome@filtrovali.com.br" onChange={event => setEmail(event.target.value)} />
    </Field>
    {canManage ? <Button variant="secondary" size="sm" loading={mutation.isPending} disabled={invalid || email.trim() === ''} onClick={() => mutation.mutate()}>Salvar</Button> : null}
  </article>;
}

export function AdministrationBoard({ canManage, tab, onTabChange }: {
  canManage: boolean;
  tab: AdminTab;
  onTabChange: (tab: AdminTab) => void;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const roles = useQuery({ queryKey: ['efetivo-planning-job-roles'], queryFn: listPlanningJobRoles });
  const settings = useQuery({ queryKey: ['efetivo-planning-settings'], queryFn: getPlanningSettings });
  const users = useQuery({ queryKey: ['efetivo-planning-users'], queryFn: listEfetivoRoleUsers });
  const notificationEmails = useQuery({ queryKey: ['efetivo-notification-emails'], queryFn: listNotificationEmailSettings, enabled: tab === 'notificacoes' });
  const [target, setTarget] = useState('80');
  useEffect(() => { if (settings.data) setTarget(String(settings.data.plannedUtilizationTarget)); }, [settings.data]);
  const targetNumber = Number(target);
  const targetInvalid = target === '' || !Number.isFinite(targetNumber) || targetNumber < 0 || targetNumber > 100;
  const saveTarget = useMutation({
    mutationFn: () => updatePlanningSettings(Number(target)),
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ['efetivo-planning-settings'] }); toast('Meta atualizada.', 'success'); },
    onError: (error: Error) => toast(error.message, 'error')
  });

  return <div className="efetivo-board efetivo-administration-ds" data-efetivo-administration>
    <nav className="efetivo-admin-tabs" aria-label="Áreas da administração">
      {ADMIN_TABS.map(([value, label]) => <button type="button" className={tab === value ? 'active' : ''} aria-current={tab === value ? 'page' : undefined} onClick={() => onTabChange(value)} key={value}>{label}</button>)}
    </nav>
    {tab === 'regras' ? <>
      <Card className="efetivo-administration-section">
        <div className="efetivo-section-heading"><div><h2>Funções operacionais</h2><p>Cor do calendário e limite de permanência. Nome/ordem continuam sob o cadastro RDO.</p></div></div>
        {roles.isLoading ? <Skeleton variant="card" /> : roles.isError ? <EmptyState variant="error" title="Não foi possível carregar as funções." action={{ label: 'Tentar novamente', onClick: () => void roles.refetch() }} /> : roles.data?.length ? <div className="efetivo-admin-role-list">{roles.data.map(role => <JobRoleRow role={role} canManage={canManage} onSaved={() => void queryClient.invalidateQueries({ queryKey: ['efetivo-planning-job-roles'] })} key={role.id} />)}</div> : <EmptyState title="Nenhuma função operacional cadastrada." />}
      </Card>
      <Card className="efetivo-administration-section efetivo-admin-target">
        <div className="efetivo-section-heading"><div><h2>Meta de utilização planejada</h2><p>Indicador futuro; não altera a Improdutividade Real.</p></div></div>
        <div className="efetivo-admin-target__controls">
          <Field id="planned-target" label="Meta (%)" optionalText="" errorText={targetInvalid ? 'Use um valor de 0 a 100.' : undefined}>
            <Input id="planned-target-control" size="sm" type="number" min="0" max="100" value={target} disabled={!canManage || saveTarget.isPending || settings.isLoading} onChange={event => setTarget(event.target.value)} />
          </Field>
          {canManage ? <Button variant="primary" size="sm" loading={saveTarget.isPending} disabled={targetInvalid || settings.isLoading || settings.isError} onClick={() => saveTarget.mutate()}>Salvar meta</Button> : null}
        </div>
        {settings.isError ? <EmptyState variant="error" title="Não foi possível carregar a meta." action={{ label: 'Tentar novamente', onClick: () => void settings.refetch() }} /> : null}
      </Card>
      <Card className="efetivo-administration-section">
        <div className="efetivo-section-heading"><div><h2>Acessos do módulo</h2><p>Usuários com papéis de gestão, consulta e responsabilidade por área no Efetivo.</p></div></div>
        {users.isLoading ? <Skeleton variant="card" /> : users.isError ? <EmptyState variant="error" title="Não foi possível carregar os acessos." action={{ label: 'Tentar novamente', onClick: () => void users.refetch() }} /> : users.data?.length ? <div className="efetivo-user-grid">{users.data.map(user => <article key={user.id}><strong>{user.name}</strong><span>{user.accountType === 'ADMIN' ? 'Administrador' : user.moduleRoles.map(role => EFETIVO_ROLE_LABELS[role.role] || role.role).join(', ')}</span></article>)}</div> : <EmptyState title="Nenhum acesso registrado." />}
      </Card>
    </> : null}
    {tab === 'feriados' ? <HolidayManager canManage={canManage} /> : null}
    {tab === 'notificacoes' ? <Card className="efetivo-administration-section">
      <div className="efetivo-section-heading"><div><h2>E-mails de aviso</h2><p>Destinatário padrão de cada aviso automático da Gestão de Projetos. Pode ser corrigido pontualmente em cada projeto.</p></div></div>
      {notificationEmails.isLoading ? <Skeleton variant="card" /> : notificationEmails.isError ? <EmptyState variant="error" title="Não foi possível carregar os e-mails." action={{ label: 'Tentar novamente', onClick: () => void notificationEmails.refetch() }} /> : notificationEmails.data?.length ? <div className="efetivo-admin-role-list">{notificationEmails.data.map(setting => <NotificationEmailRow setting={setting} canManage={canManage} onSaved={() => void queryClient.invalidateQueries({ queryKey: ['efetivo-notification-emails'] })} key={setting.key} />)}</div> : <EmptyState title="Nenhum e-mail de aviso configurado." />}
    </Card> : null}
    {tab === 'atividade' ? <EfetivoActivityList /> : null}
  </div>;
}
