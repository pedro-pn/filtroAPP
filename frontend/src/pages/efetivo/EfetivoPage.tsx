import { useQuery } from '@tanstack/react-query';
import { useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router';

import { listPlanningJobRoles } from '../../api/efetivoPlanning';
import { useAuth } from '../../auth/AuthContext';
import { Button, Card, Field, Select } from '../../components/ui/ds';
import { DateInput } from '../../components/ui/DateInput';
import { PageHeader } from '../../layout/PageHeader';
import { addDateOnlyDays, parseDateOnly, todayDateOnly } from '../../utils/calendarGrid';
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
import { EfetivoAppShell, type EfetivoSectionDefinition } from './EfetivoAppShell';
import { EfetivoPlanningNovelty } from './EfetivoPlanningNovelty';
import { EfetivoSectionNavigation } from './EfetivoSectionNavigation';
import { EfetivoTutorial } from './EfetivoTutorial';
import { ProjectWorkflowNovelty } from './ProjectWorkflowNovelty';
import './efetivo.css';
import './EfetivoPage.ds.css';
import './EfetivoDialogs.css';

const SECTIONS: readonly EfetivoSectionDefinition[] = [
  { id: 'visao-geral', label: 'Visão geral', description: 'Capacidade, alocação e alertas do dia.' },
  { id: 'calendario', label: 'Calendário', description: 'Agenda operacional por dia, semana ou mês.' },
  { id: 'colaboradores', label: 'Colaboradores', description: 'Pessoas, funções, férias e afastamentos.' },
  { id: 'disponibilidade', label: 'Disponibilidade', description: 'Situação diária e necessidade de equipe no período.' },
  { id: 'evolucao', label: 'Evolução', description: 'Acompanhamento das etapas de cada missão.' },
  { id: 'simulacoes', label: 'Simulações', description: 'Cenários de capacidade antes da aplicação.' },
  { id: 'produtividade', label: 'Produtividade', description: 'Indicadores realizados e evolução mensal.' },
  { id: 'administracao', label: 'Administração', description: 'Regras, feriados e atividade do módulo.' }
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
  const endDate = safeDate(searchParams.get('final') || addDateOnlyDays(date, 29));
  const availabilityView = searchParams.get('disponibilidadeView') === 'calendar' ? 'calendar' : 'kanban';
  const jobRoleId = searchParams.get('funcao') || undefined;
  const search = searchParams.get('search') || '';
  const calendarView = (['day', 'week', 'month'].includes(searchParams.get('view') || '') ? searchParams.get('view') : 'month') as 'day' | 'week' | 'month';
  const selectedDay = safeDate(searchParams.get('dia') || date);
  const selectedWorkflowProjectId = searchParams.get('projeto') || undefined;
  const selectedCollaboratorId = searchParams.get('colaborador') || undefined;
  const selectedAbsenceId = searchParams.get('ausencia') || undefined;
  const scenarioId = searchParams.get('cenario') || undefined;
  const workflowStage = (PROJECT_KANBAN_STAGES.includes(searchParams.get('faseProjeto') as ProjectKanbanStage) ? searchParams.get('faseProjeto') : 'HANDOVER') as ProjectKanbanStage;
  const workflowSearch = searchParams.get('busca') || '';
  const parsedWorkflowPage = Number(searchParams.get('pagina') || 1);
  const workflowPage = Number.isInteger(parsedWorkflowPage) && parsedWorkflowPage > 0 ? parsedWorkflowPage : 1;
  const adminTab = (['regras', 'feriados', 'notificacoes', 'atividade'].includes(searchParams.get('adminTab') || '') ? searchParams.get('adminTab') : 'regras') as 'regras' | 'feriados' | 'notificacoes' | 'atividade';
  const canManage = user?.accountType === 'ADMIN' || Boolean(user?.moduleRoles?.includes('efetivo:manager'));
  const needsPositionFilters = ['visao-geral', 'calendario', 'colaboradores', 'disponibilidade', 'simulacoes'].includes(section);
  const roles = useQuery({ queryKey: ['efetivo-planning-job-roles'], queryFn: listPlanningJobRoles, enabled: needsPositionFilters });
  const currentSection = SECTIONS.find(item => item.id === section) || SECTIONS[0];

  const updateParam = useCallback((key: string, value?: string, replace = true) => {
    setSearchParams(current => { const next = new URLSearchParams(current); if (value) next.set(key, value); else next.delete(key); return next; }, { replace });
  }, [setSearchParams]);
  const setPositionDate = useCallback((value: string) => {
    setSearchParams(current => {
      const next = new URLSearchParams(current);
      if (value) next.set('date', value); else next.delete('date');
      const final = next.get('final');
      if (section === 'disponibilidade' && value && final && (final < value || final > addDateOnlyDays(value, 370))) {
        next.set('final', addDateOnlyDays(value, 29));
      }
      return next;
    }, { replace: true });
  }, [section, setSearchParams]);
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
    <EfetivoAppShell currentSection={section} sections={SECTIONS}>
      <main className="fv-ds efetivo-page efetivo-page-v2">
        <PageHeader
          title={currentSection.label}
          description={currentSection.description}
          breadcrumb={[{ label: 'Efetivo Operacional' }, { label: currentSection.label }]}
          actions={(
            <Button
              variant="secondary"
              size="sm"
              onClick={() => tutorialTrigger.current?.()}
            >
              Ver tutorial
            </Button>
          )}
        />

        <EfetivoSectionNavigation
          current={section}
          sections={SECTIONS}
          onNavigate={setSection}
        />

        <section className="efetivo-page-v2__content" data-efetivo-content>
            {needsPositionFilters ? (
              <Card
                className="efetivo-position-filters"
                padding="sm"
                elevation="none"
                data-efetivo-planning-filters
              >
                <Field id="efetivo-position-date" label="Data de posição" optionalText="">
                  <span className="fv-control-shell fv-control-shell--sm">
                    <DateInput id="efetivo-position-date" className="fv-input" value={date} onCommit={setPositionDate} />
                  </span>
                </Field>
                {section === 'disponibilidade' ? (
                  <Field id="efetivo-final-date" label="Data final" optionalText="">
                    <span className="fv-control-shell fv-control-shell--sm">
                      <DateInput id="efetivo-final-date" className="fv-input" value={endDate} min={date} max={addDateOnlyDays(date, 370)} onCommit={value => updateParam('final', value)} />
                    </span>
                  </Field>
                ) : null}
                <Field id="efetivo-role-filter" label="Função" optionalText="">
                  <Select
                    size="sm"
                    value={jobRoleId || ''}
                    onChange={event => updateParam('funcao', event.target.value || undefined)}
                  >
                    <option value="">Todas as funções</option>
                    {groupJobRoles((roles.data || []).filter(item => item.isOperational))
                      .map(role => (
                        <option value={role.id} key={role.id}>{role.name}</option>
                      ))}
                  </Select>
                </Field>
                <p>
                  {section === 'disponibilidade'
                    ? 'Situação diária e necessidade de equipe conforme o planejamento dos projetos.'
                    : 'Planejamento oficial por dias úteis. A produtividade realizada continua baseada no Ponto Mais.'}
                </p>
              </Card>
            ) : null}
            {section === 'visao-geral' ? <OverviewBoard date={date} jobRoleId={jobRoleId} onNavigate={goToSection} /> : null}
            {section === 'calendario' ? <OperationalCalendar date={date} view={calendarView} jobRoleId={jobRoleId} selectedDay={selectedDay} dayOpen={Boolean(searchParams.get('dia'))} onDayClose={() => updateParam('dia')} onDateChange={value => updateParam('date', value)} onViewChange={value => updateParam('view', value === 'month' ? undefined : value)} onDaySelect={value => updateParam('dia', value)} /> : null}
            {section === 'colaboradores' ? <><CollaboratorsBoard date={date} jobRoleId={jobRoleId} search={search} canManage={canManage} selectedCollaboratorId={selectedCollaboratorId} onSearchChange={value => updateParam('search', value || undefined)} onCollaboratorSelect={value => updateParam('colaborador', value)} /><AbsencesBoard canManage={canManage} selectedAbsenceId={selectedAbsenceId} /></> : null}
            {section === 'disponibilidade' ? <AvailabilityBoard date={date} endDate={endDate} jobRoleId={jobRoleId} view={availabilityView} onViewChange={value => updateParam('disponibilidadeView', value === 'kanban' ? undefined : value)} /> : null}
            {section === 'evolucao' ? <ProjectWorkflowBoard canManage={canManage} search={workflowSearch} page={workflowPage} mobileStage={workflowStage} selectedProjectId={selectedWorkflowProjectId} onSearchChange={setWorkflowSearch} onPageChange={value => updateParam('pagina', value > 1 ? String(value) : undefined)} onMobileStageChange={value => updateParam('faseProjeto', value === 'HANDOVER' ? undefined : value)} onProjectSelect={value => updateParam('projeto', value, false)} /> : null}
            {section === 'simulacoes' ? <ScenariosBoard date={date} jobRoleId={jobRoleId} selectedScenarioId={scenarioId} canManage={canManage} onScenarioSelect={value => updateParam('cenario', value)} /> : null}
            {section === 'produtividade' ? <ProductivityBoard canManage={canManage} /> : null}
            {section === 'administracao' ? <AdministrationBoard canManage={canManage} tab={adminTab} onTabChange={value => updateParam('adminTab', value === 'regras' ? undefined : value)} /> : null}
        </section>
      </main>
      <EfetivoTutorial userKey={user?.id || ''} ready={Boolean(user)} goToSection={setSection} triggerRef={tutorialTrigger} />
      <EfetivoPlanningNovelty userId={user?.id || ''} />
      <ProjectWorkflowNovelty userId={user?.id || ''} enabled={section === 'evolucao'} />
    </EfetivoAppShell>
  );
}
