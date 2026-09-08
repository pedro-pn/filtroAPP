import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { getPlanningSettings, listEfetivoRoleUsers, listPlanningJobRoles, updatePlanningJobRole, updatePlanningSettings, type PlanningJobRole } from '../../../api/efetivoPlanning';
import { Button } from '../../../components/ui/Button';
import { useToast } from '../../../components/ui/ToastContext';
import { EfetivoActivityList } from './EfetivoActivityList';
import { HolidayManager } from './HolidayManager';

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
  const mutation = useMutation({ mutationFn: () => updatePlanningJobRole(role.id, { calendarColor: color, continuousWorkLimitDays: limit ? Number(limit) : null, isOperational: operational }), onSuccess: () => { onSaved(); toast('Função atualizada.', 'success'); }, onError: (error: Error) => toast(error.message, 'error') });
  return <article className="efetivo-admin-role"><div><span className="efetivo-role-color" style={{ background: color }} /><strong>{role.name}</strong></div><label><input type="checkbox" checked={operational} disabled={!canManage} onChange={event => setOperational(event.target.checked)} /> Operacional</label><div className="field-group"><label htmlFor={`role-color-${role.id}`}>Cor</label><input id={`role-color-${role.id}`} type="color" value={color} disabled={!canManage} onChange={event => setColor(event.target.value)} /></div><div className={`field-group ${limitInvalid ? 'field-invalid' : ''}`}><label htmlFor={`role-limit-${role.id}`}>Folga após (dias)</label><input id={`role-limit-${role.id}`} type="number" min="1" max="365" value={limit} disabled={!canManage} placeholder="Padrão da categoria" aria-invalid={limitInvalid} onChange={event => setLimit(event.target.value)} />{limitInvalid ? <span className="field-error">Use um inteiro de 1 a 365.</span> : null}</div>{canManage ? <Button variant="mini" disabled={mutation.isPending || limitInvalid} onClick={() => mutation.mutate()}>Salvar</Button> : null}</article>;
}

export function AdministrationBoard({ canManage, tab, onTabChange }: {
  canManage: boolean;
  tab: 'regras' | 'feriados' | 'atividade';
  onTabChange: (tab: 'regras' | 'feriados' | 'atividade') => void;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const roles = useQuery({ queryKey: ['efetivo-planning-job-roles'], queryFn: listPlanningJobRoles });
  const settings = useQuery({ queryKey: ['efetivo-planning-settings'], queryFn: getPlanningSettings });
  const users = useQuery({ queryKey: ['efetivo-planning-users'], queryFn: listEfetivoRoleUsers });
  const [target, setTarget] = useState('80');
  useEffect(() => { if (settings.data) setTarget(String(settings.data.plannedUtilizationTarget)); }, [settings.data]);
  const targetNumber = Number(target);
  const targetInvalid = target === '' || !Number.isFinite(targetNumber) || targetNumber < 0 || targetNumber > 100;
  const saveTarget = useMutation({ mutationFn: () => updatePlanningSettings(Number(target)), onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ['efetivo-planning-settings'] }); toast('Meta atualizada.', 'success'); }, onError: (error: Error) => toast(error.message, 'error') });
  return <div className="efetivo-board" data-efetivo-administration>
    <nav className="page-card efetivo-admin-tabs" aria-label="Áreas da administração">{([['regras', 'Regras e acessos'], ['feriados', 'Feriados'], ['atividade', 'Atividade']] as const).map(([value, label]) => <button type="button" className={tab === value ? 'active' : ''} aria-current={tab === value ? 'page' : undefined} onClick={() => onTabChange(value)} key={value}>{label}</button>)}</nav>
    {tab === 'regras' ? <>
      <section className="page-card"><div className="efetivo-section-heading"><div><h2>Funções operacionais</h2><p>Cor do calendário e limite de permanência. Nome/ordem continuam sob o cadastro RDO.</p></div></div>{roles.isLoading ? <p className="placeholder-copy">Carregando funções…</p> : roles.isError ? <p className="placeholder-copy">Não foi possível carregar as funções.</p> : <div className="efetivo-admin-role-list">{roles.data?.map(role => <JobRoleRow role={role} canManage={canManage} onSaved={() => queryClient.invalidateQueries({ queryKey: ['efetivo-planning-job-roles'] })} key={role.id} />)}</div>}</section>
      <section className="page-card efetivo-setting-row"><div><h2>Meta de utilização planejada</h2><p>Indicador futuro; não altera a Improdutividade Real.</p></div><div className={`field-group ${targetInvalid ? 'field-invalid' : ''}`}><label htmlFor="planned-target">Meta (%)</label><input id="planned-target" type="number" min="0" max="100" value={target} disabled={!canManage} aria-invalid={targetInvalid} onChange={event => setTarget(event.target.value)} />{targetInvalid ? <span className="field-error">Use um valor de 0 a 100.</span> : null}</div>{canManage ? <Button disabled={saveTarget.isPending || targetInvalid} onClick={() => saveTarget.mutate()}>Salvar meta</Button> : null}</section>
      <section className="page-card"><div className="efetivo-section-heading"><div><h2>Acessos do módulo</h2><p>Usuários com papel viewer ou manager do Efetivo.</p></div></div>{users.isLoading ? <p className="placeholder-copy">Carregando acessos…</p> : users.isError ? <p className="placeholder-copy">Não foi possível carregar os acessos.</p> : <div className="efetivo-user-grid">{users.data?.map(user => <article key={user.id}><strong>{user.name}</strong><span>{user.accountType === 'ADMIN' ? 'Administrador' : user.moduleRoles.map(role => role.role === 'EFETIVO_MANAGER' ? 'Gestor' : 'Viewer').join(', ')}</span></article>)}</div>}</section>
    </> : null}
    {tab === 'feriados' ? <HolidayManager canManage={canManage} /> : null}
    {tab === 'atividade' ? <EfetivoActivityList /> : null}
  </div>;
}
