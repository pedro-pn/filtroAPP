import { useQuery } from '@tanstack/react-query';
import { useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router';

import { listPendingMissionProjects, listPlanningJobRoles, listPlanningMissions, type MissionScheduleStatus, type MissionStage } from '../../api/efetivoPlanning';
import { useAuth } from '../../auth/AuthContext';
import { Shell } from '../../layout/Shell';
import { TopBar } from '../../layout/TopBar';
import { parseDateOnly, todayDateOnly } from '../../utils/calendarGrid';
import { countMissionPendencies } from '../../utils/missionPendencies';
import { parsePlanningSection, setPlanningSectionParams, type EfetivoPlanningSection } from '../../utils/planningNavigation';
import { AbsencesBoard } from './components/AbsencesBoard';
import { AdministrationBoard } from './components/AdministrationBoard';
import { AvailabilityBoard } from './components/AvailabilityBoard';
import { CollaboratorsBoard } from './components/CollaboratorsBoard';
import { MissionKanban } from './components/MissionKanban';
import { MissionsBoard } from './components/MissionsBoard';
import { OperationalCalendar } from './components/OperationalCalendar';
import { OverviewBoard } from './components/OverviewBoard';
import { ProductivityBoard } from './components/ProductivityBoard';
import { ScenariosBoard } from './components/ScenariosBoard';
import { EfetivoPlanningNovelty } from './EfetivoPlanningNovelty';
import { EfetivoTutorial } from './EfetivoTutorial';
import './efetivo.css';

const SECTIONS: Array<{ id: EfetivoPlanningSection; label: string; icon: string }> = [
  { id: 'visao-geral', label: 'Visão geral', icon: '▦' },
  { id: 'calendario', label: 'Calendário', icon: '□' },
  { id: 'colaboradores', label: 'Colaboradores', icon: '♙' },
  { id: 'disponibilidade', label: 'Disponibilidade', icon: '◫' },
  { id: 'missoes', label: 'Missões', icon: '◆' },
  { id: 'evolucao', label: 'Evolução das missões', icon: '⇥' },
  { id: 'simulacoes', label: 'Simulações', icon: '◈' },
  { id: 'produtividade', label: 'Produtividade', icon: '▥' },
  { id: 'administracao', label: 'Administração', icon: '⚙' }
];

function safeDate(value: string | null) {
  try { return value ? parseDateOnly(value).toISOString().slice(0, 10) : todayDateOnly(); } catch { return todayDateOnly(); }
}

export function EfetivoPage() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const tutorialTrigger = useRef<(() => void) | null>(null);
  const section = parsePlanningSection(searchParams.get('section'));
  const date = safeDate(searchParams.get('date'));
  const jobRoleId = searchParams.get('funcao') || undefined;
  const search = searchParams.get('search') || '';
  const calendarView = (['day', 'week', 'month'].includes(searchParams.get('view') || '') ? searchParams.get('view') : 'month') as 'day' | 'week' | 'month';
  const selectedDay = safeDate(searchParams.get('dia') || date);
  const missionStatus = (['CONFIRMED', 'CANCELLED'].includes(searchParams.get('status') || '') ? searchParams.get('status') : undefined) as MissionScheduleStatus | undefined;
  const scenarioId = searchParams.get('cenario') || undefined;
  const selectedMissionId = searchParams.get('missao') || undefined;
  const selectedCollaboratorId = searchParams.get('colaborador') || undefined;
  const selectedAbsenceId = searchParams.get('ausencia') || undefined;
  const missionStage = (['STANDBY', 'MOBILIZATION', 'EXECUTION', 'FINAL_MEASUREMENT', 'FINISHED'].includes(searchParams.get('etapa') || '') ? searchParams.get('etapa') : 'STANDBY') as MissionStage;
  const adminTab = (['regras', 'feriados', 'atividade'].includes(searchParams.get('adminTab') || '') ? searchParams.get('adminTab') : 'regras') as 'regras' | 'feriados' | 'atividade';
  const canManage = user?.accountType === 'ADMIN' || Boolean(user?.moduleRoles?.includes('efetivo:manager'));
  const roles = useQuery({ queryKey: ['efetivo-planning-job-roles'], queryFn: listPlanningJobRoles });
  const missions = useQuery({ queryKey: ['efetivo-planning-missions', 'official', 'all'], queryFn: () => listPlanningMissions() });
  const pendingProjects = useQuery({ queryKey: ['efetivo-planning-missions-pending', 'official'], queryFn: () => listPendingMissionProjects() });
  const missionPendencyCount = countMissionPendencies(missions.data || [], pendingProjects.data || []);

  const updateParam = useCallback((key: string, value?: string, replace = true) => {
    setSearchParams(current => { const next = new URLSearchParams(current); if (value) next.set(key, value); else next.delete(key); return next; }, { replace });
  }, [setSearchParams]);
  const setSection = useCallback((nextSection: EfetivoPlanningSection) => {
    setSearchParams(current => setPlanningSectionParams(current, nextSection), { replace: true });
  }, [setSearchParams]);
  // Atalhos entre painéis: troca de seção sem recarregar a página, preservando o parâmetro alvo.
  const goToSection = useCallback((nextSection: EfetivoPlanningSection, params: Record<string, string> = {}) => {
    setSearchParams(current => {
      const next = setPlanningSectionParams(current, nextSection);
      for (const [key, value] of Object.entries(params)) next.set(key, value);
      return next;
    }, { replace: false });
  }, [setSearchParams]);
  const needsPositionFilters = ['visao-geral', 'calendario', 'colaboradores', 'disponibilidade', 'simulacoes'].includes(section);

  return (
    <Shell>
      <TopBar title="Efetivo Operacional" subtitle="Capacidade, missões, pessoas e produtividade" actions={<button className="topbar-chip" type="button" onClick={() => tutorialTrigger.current?.()}>Ver tutorial</button>} />
      <main className="page-scroll equip-page efetivo-page">
        <div className="equip-layout">
          <nav className="equip-nav" aria-label="Áreas de Efetivo Operacional" data-efetivo-nav>{SECTIONS.map(item => <button className={`equip-nav-item ${section === item.id ? 'active' : ''}`} type="button" aria-current={section === item.id ? 'page' : undefined} onClick={() => setSection(item.id)} key={item.id}><span className="equip-nav-ico" aria-hidden="true">{item.icon}</span><span className="equip-nav-label">{item.label}</span>{item.id === 'missoes' && missionPendencyCount ? <span className="equip-nav-count efetivo-nav-pending" title={`${missionPendencyCount} missão(ões) com informações pendentes`}>{missionPendencyCount}</span> : null}</button>)}</nav>
          <div className="equip-mobile-nav"><label className="equip-mobile-nav-label" htmlFor="efetivo-section-select">Seção do módulo</label><select id="efetivo-section-select" className="equip-nav-select" value={section} onChange={event => setSection(event.target.value as EfetivoPlanningSection)}>{SECTIONS.map(item => <option value={item.id} key={item.id}>{item.label}</option>)}</select></div>
          <section className="equip-content" data-efetivo-content>
            {needsPositionFilters ? <section className="page-card efetivo-context-toolbar" data-efetivo-planning-filters><div className="field-group"><label htmlFor="efetivo-position-date">Data de posição</label><input id="efetivo-position-date" type="date" value={date} onChange={event => updateParam('date', event.target.value)} /></div><div className="field-group"><label htmlFor="efetivo-role-filter">Função</label><select id="efetivo-role-filter" value={jobRoleId || ''} onChange={event => updateParam('funcao', event.target.value || undefined)}><option value="">Todas as funções</option>{(roles.data || []).filter(item => item.isOperational).map(role => <option value={role.id} key={role.id}>{role.name}</option>)}</select></div><p>Planejamento oficial por dias úteis. Produtividade realizada continua baseada no Ponto Mais.</p></section> : null}
            {section === 'visao-geral' ? <OverviewBoard date={date} jobRoleId={jobRoleId} onNavigate={goToSection} /> : null}
            {section === 'calendario' ? <OperationalCalendar date={date} view={calendarView} jobRoleId={jobRoleId} selectedDay={selectedDay} onDateChange={value => updateParam('date', value)} onViewChange={value => updateParam('view', value === 'month' ? undefined : value)} onDaySelect={value => updateParam('dia', value)} /> : null}
            {section === 'colaboradores' ? <><CollaboratorsBoard date={date} jobRoleId={jobRoleId} search={search} canManage={canManage} selectedCollaboratorId={selectedCollaboratorId} onSearchChange={value => updateParam('search', value || undefined)} onCollaboratorSelect={value => updateParam('colaborador', value)} /><AbsencesBoard canManage={canManage} selectedAbsenceId={selectedAbsenceId} /></> : null}
            {section === 'disponibilidade' ? <AvailabilityBoard date={date} jobRoleId={jobRoleId} /> : null}
            {section === 'missoes' ? <MissionsBoard canManage={canManage} status={missionStatus} search={search} selectedMissionId={selectedMissionId} onMissionSelect={value => updateParam('missao', value)} onSearchChange={value => updateParam('search', value || undefined)} onStatusChange={value => updateParam('status', value)} /> : null}
            {section === 'evolucao' ? <MissionKanban canManage={canManage} mobileStage={missionStage} selectedMissionId={selectedMissionId} onMobileStageChange={value => updateParam('etapa', value === 'STANDBY' ? undefined : value)} onMissionSelect={value => updateParam('missao', value)} /> : null}
            {section === 'simulacoes' ? <ScenariosBoard date={date} jobRoleId={jobRoleId} selectedScenarioId={scenarioId} canManage={canManage} onScenarioSelect={value => updateParam('cenario', value)} /> : null}
            {section === 'produtividade' ? <ProductivityBoard canManage={canManage} /> : null}
            {section === 'administracao' ? <AdministrationBoard canManage={canManage} tab={adminTab} onTabChange={value => updateParam('adminTab', value === 'regras' ? undefined : value)} /> : null}
          </section>
        </div>
      </main>
      <EfetivoTutorial userKey={user?.id || ''} ready={Boolean(user)} goToSection={setSection} triggerRef={tutorialTrigger} />
      <EfetivoPlanningNovelty userId={user?.id || ''} />
    </Shell>
  );
}
