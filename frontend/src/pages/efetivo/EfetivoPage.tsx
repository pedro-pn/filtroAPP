import { useQuery } from '@tanstack/react-query';
import { useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router';

import { listPendingMissionProjects, listPlanningJobRoles, listPlanningMissions, type MissionScheduleStatus, type MissionStage } from '../../api/efetivoPlanning';
import { useAuth } from '../../auth/AuthContext';
import { Button, Card, Field, Input, Select } from '../../components/ui/ds';
import { PageHeader } from '../../layout/PageHeader';
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
import { EfetivoAppShell, type EfetivoSectionDefinition } from './EfetivoAppShell';
import { EfetivoPlanningNovelty } from './EfetivoPlanningNovelty';
import { EfetivoSectionNavigation } from './EfetivoSectionNavigation';
import { EfetivoTutorial } from './EfetivoTutorial';
import './efetivo.css';
import './EfetivoPage.ds.css';
import './EfetivoDialogs.css';

const SECTIONS: readonly EfetivoSectionDefinition[] = [
  { id: 'visao-geral', label: 'Visão geral', description: 'Capacidade, alocação e alertas do dia.' },
  { id: 'calendario', label: 'Calendário', description: 'Agenda operacional por dia, semana ou mês.' },
  { id: 'colaboradores', label: 'Colaboradores', description: 'Pessoas, funções, férias e afastamentos.' },
  { id: 'disponibilidade', label: 'Disponibilidade', description: 'Situação atual da equipe operacional.' },
  { id: 'missoes', label: 'Missões', description: 'Planejamento, equipes e pendências das missões.' },
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
  const currentSection = SECTIONS.find(item => item.id === section) || SECTIONS[0];

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
          pendingMissions={missionPendencyCount}
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
                  <Input
                    size="sm"
                    type="date"
                    value={date}
                    onChange={event => updateParam('date', event.target.value)}
                  />
                </Field>
                <Field id="efetivo-role-filter" label="Função" optionalText="">
                  <Select
                    size="sm"
                    value={jobRoleId || ''}
                    onChange={event => updateParam('funcao', event.target.value || undefined)}
                  >
                    <option value="">Todas as funções</option>
                    {(roles.data || [])
                      .filter(item => item.isOperational)
                      .map(role => (
                        <option value={role.id} key={role.id}>{role.name}</option>
                      ))}
                  </Select>
                </Field>
                <p>
                  Planejamento oficial por dias úteis. A produtividade realizada
                  continua baseada no Ponto Mais.
                </p>
              </Card>
            ) : null}
            {section === 'visao-geral' ? <OverviewBoard date={date} jobRoleId={jobRoleId} onNavigate={goToSection} /> : null}
            {section === 'calendario' ? <OperationalCalendar date={date} view={calendarView} jobRoleId={jobRoleId} selectedDay={selectedDay} dayOpen={Boolean(searchParams.get('dia'))} onDayClose={() => updateParam('dia')} onDateChange={value => updateParam('date', value)} onViewChange={value => updateParam('view', value === 'month' ? undefined : value)} onDaySelect={value => updateParam('dia', value)} /> : null}
            {section === 'colaboradores' ? <><CollaboratorsBoard date={date} jobRoleId={jobRoleId} search={search} canManage={canManage} selectedCollaboratorId={selectedCollaboratorId} onSearchChange={value => updateParam('search', value || undefined)} onCollaboratorSelect={value => updateParam('colaborador', value)} /><AbsencesBoard canManage={canManage} selectedAbsenceId={selectedAbsenceId} /></> : null}
            {section === 'disponibilidade' ? <AvailabilityBoard date={date} jobRoleId={jobRoleId} /> : null}
            {section === 'missoes' ? <MissionsBoard canManage={canManage} status={missionStatus} search={search} selectedMissionId={selectedMissionId} onMissionSelect={value => updateParam('missao', value)} onSearchChange={value => updateParam('search', value || undefined)} onStatusChange={value => updateParam('status', value)} /> : null}
            {section === 'evolucao' ? <MissionKanban canManage={canManage} mobileStage={missionStage} selectedMissionId={selectedMissionId} onMobileStageChange={value => updateParam('etapa', value === 'STANDBY' ? undefined : value)} onMissionSelect={value => updateParam('missao', value)} /> : null}
            {section === 'simulacoes' ? <ScenariosBoard date={date} jobRoleId={jobRoleId} selectedScenarioId={scenarioId} canManage={canManage} onScenarioSelect={value => updateParam('cenario', value)} /> : null}
            {section === 'produtividade' ? <ProductivityBoard canManage={canManage} /> : null}
            {section === 'administracao' ? <AdministrationBoard canManage={canManage} tab={adminTab} onTabChange={value => updateParam('adminTab', value === 'regras' ? undefined : value)} /> : null}
        </section>
      </main>
      <EfetivoTutorial userKey={user?.id || ''} ready={Boolean(user)} goToSection={setSection} triggerRef={tutorialTrigger} />
      <EfetivoPlanningNovelty userId={user?.id || ''} />
    </EfetivoAppShell>
  );
}
