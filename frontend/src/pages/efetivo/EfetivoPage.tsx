import { useQuery } from '@tanstack/react-query';
import { useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router';

import { listPlanningJobRoles } from '../../api/efetivoPlanning';
import { useAuth } from '../../auth/AuthContext';
import { DateInput } from '../../components/ui/DateInput';
import { Shell } from '../../layout/Shell';
import { TopBar } from '../../layout/TopBar';
import { parseDateOnly, todayDateOnly } from '../../utils/calendarGrid';
import { groupJobRoles } from '../../utils/jobRoleDisplay';
import { parsePlanningSection, setPlanningSectionParams, type EfetivoPlanningSection } from '../../utils/planningNavigation';
import { PROJECT_KANBAN_STAGES, type ProjectKanbanStage } from '../../utils/projectWorkflow';
import { AbsencesBoard } from './components/AbsencesBoard';
import { AdministrationBoard } from './components/AdministrationBoard';
import { AvailabilityBoard } from './components/AvailabilityBoard';
import { CollaboratorsBoard } from './components/CollaboratorsBoard';
import { OperationalCalendar } from './components/OperationalCalendar';
import { OverviewBoard } from './components/OverviewBoard';
import { ProductivityBoard } from './components/ProductivityBoard';
import { ProjectWorkflowBoard } from './components/ProjectWorkflowBoard';
import { ScenariosBoard } from './components/ScenariosBoard';
import { EfetivoPlanningNovelty } from './EfetivoPlanningNovelty';
import { EfetivoTutorial } from './EfetivoTutorial';
import { ProjectWorkflowNovelty } from './ProjectWorkflowNovelty';
import './efetivo.css';

const SECTIONS: Array<{ id: EfetivoPlanningSection; label: string; icon: string }> = [
  { id: 'visao-geral', label: 'Visão geral', icon: '▦' },
  { id: 'calendario', label: 'Calendário', icon: '□' },
  { id: 'colaboradores', label: 'Colaboradores', icon: '♙' },
  { id: 'disponibilidade', label: 'Disponibilidade', icon: '◫' },
  { id: 'evolucao', label: 'Evolução', icon: '⇥' },
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
  const scenarioId = searchParams.get('cenario') || undefined;
  const selectedWorkflowProjectId = searchParams.get('projeto') || undefined;
  const selectedCollaboratorId = searchParams.get('colaborador') || undefined;
  const selectedAbsenceId = searchParams.get('ausencia') || undefined;
  const workflowStage = (PROJECT_KANBAN_STAGES.includes(searchParams.get('faseProjeto') as ProjectKanbanStage) ? searchParams.get('faseProjeto') : 'HANDOVER') as ProjectKanbanStage;
  const workflowSearch = searchParams.get('busca') || '';
  const parsedWorkflowPage = Number(searchParams.get('pagina') || 1);
  const workflowPage = Number.isInteger(parsedWorkflowPage) && parsedWorkflowPage > 0 ? parsedWorkflowPage : 1;
  const adminTab = (['regras', 'feriados', 'notificacoes', 'atividade'].includes(searchParams.get('adminTab') || '') ? searchParams.get('adminTab') : 'regras') as 'regras' | 'feriados' | 'notificacoes' | 'atividade';
  const canManage = user?.accountType === 'ADMIN' || Boolean(user?.moduleRoles?.includes('efetivo:manager'));
  const needsPositionFilters = ['visao-geral', 'calendario', 'colaboradores', 'disponibilidade', 'simulacoes'].includes(section);
  const roles = useQuery({ queryKey: ['efetivo-planning-job-roles'], queryFn: listPlanningJobRoles, enabled: needsPositionFilters });

  const updateParam = useCallback((key: string, value?: string, replace = true) => {
    setSearchParams(current => { const next = new URLSearchParams(current); if (value) next.set(key, value); else next.delete(key); return next; }, { replace });
  }, [setSearchParams]);
  const setSection = useCallback((nextSection: EfetivoPlanningSection) => {
    setSearchParams(current => setPlanningSectionParams(current, nextSection), { replace: true });
  }, [setSearchParams]);
  const setWorkflowSearch = useCallback((value: string) => {
    setSearchParams(current => {
      const next = new URLSearchParams(current);
      if (value) next.set('busca', value); else next.delete('busca');
      next.delete('pagina');
      return next;
    }, { replace: true });
  }, [setSearchParams]);
  // Atalhos entre painéis: troca de seção sem recarregar a página, preservando o parâmetro alvo.
  const goToSection = useCallback((nextSection: EfetivoPlanningSection, params: Record<string, string> = {}) => {
    setSearchParams(current => {
      const next = setPlanningSectionParams(current, nextSection);
      for (const [key, value] of Object.entries(params)) next.set(key, value);
      return next;
    }, { replace: false });
  }, [setSearchParams]);
  return (
    <Shell>
      <TopBar title="Efetivo Operacional" subtitle="Capacidade, missões, pessoas e produtividade" actions={<button className="topbar-chip" type="button" onClick={() => tutorialTrigger.current?.()}>Ver tutorial</button>} />
      <main className="page-scroll equip-page efetivo-page">
        <div className="equip-layout">
          <nav className="equip-nav" aria-label="Áreas de Efetivo Operacional" data-efetivo-nav>{SECTIONS.map(item => <button className={`equip-nav-item ${section === item.id ? 'active' : ''}`} type="button" aria-current={section === item.id ? 'page' : undefined} onClick={() => setSection(item.id)} key={item.id}><span className="equip-nav-ico" aria-hidden="true">{item.icon}</span><span className="equip-nav-label">{item.label}</span></button>)}</nav>
          <div className="equip-mobile-nav"><label className="equip-mobile-nav-label" htmlFor="efetivo-section-select">Seção do módulo</label><select id="efetivo-section-select" className="equip-nav-select" value={section} onChange={event => setSection(event.target.value as EfetivoPlanningSection)}>{SECTIONS.map(item => <option value={item.id} key={item.id}>{item.label}</option>)}</select></div>
          <section className="equip-content" data-efetivo-content>
            {needsPositionFilters ? <section className="page-card efetivo-context-toolbar" data-efetivo-planning-filters><div className="field-group"><label htmlFor="efetivo-position-date">Data de posição</label><DateInput id="efetivo-position-date" value={date} onCommit={value => updateParam('date', value)} /></div><div className="field-group"><label htmlFor="efetivo-role-filter">Função</label><select id="efetivo-role-filter" value={jobRoleId || ''} onChange={event => updateParam('funcao', event.target.value || undefined)}><option value="">Todas as funções</option>{groupJobRoles((roles.data || []).filter(item => item.isOperational)).map(role => <option value={role.id} key={role.id}>{role.name}</option>)}</select></div><p>Planejamento oficial por dias úteis. Produtividade realizada continua baseada no Ponto Mais.</p></section> : null}
            {section === 'visao-geral' ? <OverviewBoard date={date} jobRoleId={jobRoleId} onNavigate={goToSection} /> : null}
            {section === 'calendario' ? <OperationalCalendar date={date} view={calendarView} jobRoleId={jobRoleId} selectedDay={selectedDay} onDateChange={value => updateParam('date', value)} onViewChange={value => updateParam('view', value === 'month' ? undefined : value)} onDaySelect={value => updateParam('dia', value)} /> : null}
            {section === 'colaboradores' ? <><CollaboratorsBoard date={date} jobRoleId={jobRoleId} search={search} canManage={canManage} selectedCollaboratorId={selectedCollaboratorId} onSearchChange={value => updateParam('search', value || undefined)} onCollaboratorSelect={value => updateParam('colaborador', value)} /><AbsencesBoard canManage={canManage} selectedAbsenceId={selectedAbsenceId} /></> : null}
            {section === 'disponibilidade' ? <AvailabilityBoard date={date} jobRoleId={jobRoleId} /> : null}
            {section === 'evolucao' ? <ProjectWorkflowBoard canManage={canManage} search={workflowSearch} page={workflowPage} mobileStage={workflowStage} selectedProjectId={selectedWorkflowProjectId} onSearchChange={setWorkflowSearch} onPageChange={value => updateParam('pagina', value > 1 ? String(value) : undefined)} onMobileStageChange={value => updateParam('faseProjeto', value === 'HANDOVER' ? undefined : value)} onProjectSelect={value => updateParam('projeto', value, false)} /> : null}
            {section === 'simulacoes' ? <ScenariosBoard date={date} jobRoleId={jobRoleId} selectedScenarioId={scenarioId} canManage={canManage} onScenarioSelect={value => updateParam('cenario', value)} /> : null}
            {section === 'produtividade' ? <ProductivityBoard canManage={canManage} /> : null}
            {section === 'administracao' ? <AdministrationBoard canManage={canManage} tab={adminTab} onTabChange={value => updateParam('adminTab', value === 'regras' ? undefined : value)} /> : null}
          </section>
        </div>
      </main>
      <EfetivoTutorial userKey={user?.id || ''} ready={Boolean(user)} goToSection={setSection} triggerRef={tutorialTrigger} />
      <EfetivoPlanningNovelty userId={user?.id || ''} />
      <ProjectWorkflowNovelty userId={user?.id || ''} enabled={section === 'evolucao'} />
    </Shell>
  );
}
