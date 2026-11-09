import { lazy, Suspense, useCallback, useEffect, useRef } from 'react';
import { useLocation, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { CircleHelp } from 'lucide-react';
import { AppIcon } from '../../components/icons/AppIcon';

import { useAuth } from '../../auth/AuthContext';
import { markAcompanhamentoNoveltySeen } from '../../auth/moduleNavigation';
import { Button, IconButton, Skeleton } from '../../components/ui/ds';
import { getPontoPendencyCounts } from '../../api/acompanhamentoPonto';
import { AcompanhamentoTutorial } from '../../components/AcompanhamentoTutorial';
import { AcompanhamentoAppShell } from './AcompanhamentoAppShell';
import { parseSection, sectionSearchParams, type AcompanhamentoSection } from './navigation';
import { canViewProjectFinancials } from '../../../../shared/modules/acompanhamento-permissions.js';
import './AcompanhamentoPage.ds.css';

const AcompanhamentoDashboard = lazy(() => import('../../components/projects/AcompanhamentoDashboard').then(module => ({ default: module.AcompanhamentoDashboard })));
const ProjectCardsBoard = lazy(() => import('../../components/projects/ProjectCardsBoard').then(module => ({ default: module.ProjectCardsBoard })));
const ProjectSystemReconciliation = lazy(() => import('../../components/projects/ProjectSystemReconciliation').then(module => ({ default: module.ProjectSystemReconciliation })));
const SedeCostsBoard = lazy(() => import('../../components/projects/SedeCostsBoard').then(module => ({ default: module.SedeCostsBoard })));
const CostEngineManager = lazy(() => import('../../components/projects/CostEngineManager').then(module => ({ default: module.CostEngineManager })));

function tutorialUserKey(user: ReturnType<typeof useAuth>['user'], isManager: boolean) {
  const identity = String(user?.email || user?.username || user?.id || '').trim().toLowerCase();
  return identity ? `${isManager ? 'manager' : 'viewer'}:${identity}` : '';
}

export function AcompanhamentoPage() {
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuth();
  const tutorialTrigger = useRef<(() => void) | null>(null);
  const isManager = user?.accountType === 'ADMIN' || Boolean(user?.moduleRoles?.includes('acompanhamento:manager'));
  const hasAcompanhamentoAccess = user?.accountType === 'ADMIN'
    || Boolean(user?.moduleRoles?.some(role => role === 'acompanhamento:manager' || role === 'acompanhamento:viewer'));
  const userKey = tutorialUserKey(user, isManager);
  // Não inclui projetos ainda não cadastrados, que pertencem à fila de cadastro de missão.
  const { data: pendencyCounts } = useQuery({
    queryKey: ['ponto-pendencias-contagem'], queryFn: getPontoPendencyCounts, enabled: isManager
  });
  const pendencyTotal = pendencyCounts?.total ?? 0;
  const projectDetailFromUrl = searchParams.has('project') || searchParams.has('group');
  const section = parseSection(searchParams.get('section'), projectDetailFromUrl ? 'projetos' : 'dashboard');
  const reconciliationProject = section === 'projetos' && searchParams.get('reconcile') === '1' ? searchParams.get('project') : null;
  const closeReconciliation = () => {
    const returnSearch = location.state?.scheduleReturnSearch;
    const next = new URLSearchParams(typeof returnSearch === 'string' ? returnSearch : searchParams);
    next.delete('reconcile');
    if (reconciliationProject) next.set('schedule', reconciliationProject);
    setSearchParams(next, { state: null });
  };
  const setSection = useCallback((nextSection: AcompanhamentoSection) => {
    setSearchParams(current => sectionSearchParams(current, nextSection), { replace: true });
  }, [setSearchParams]);

  useEffect(() => { if (user) markAcompanhamentoNoveltySeen(user); }, [user]);
  useEffect(() => {
    if (!isManager && section === 'custo') setSection('dashboard');
  }, [isManager, section, setSection]);

  return (
    <AcompanhamentoAppShell section={section} isManager={isManager} pendencyTotal={pendencyTotal} actions={
      <>
        <Button className="acp-tutorial-desktop" variant="ghost" size="sm" iconLeft={<AppIcon icon={CircleHelp} />}
          onClick={() => tutorialTrigger.current?.()}>Ver tutorial</Button>
        <IconButton className="acp-tutorial-mobile" icon={CircleHelp} label="Ver tutorial" size="sm"
          onClick={() => tutorialTrigger.current?.()} />
      </>
    }>
      <main className="acp-page">
        <section className="acp-page__content">
          <Suspense fallback={<Skeleton height={240} />}>
          {reconciliationProject ? <ProjectSystemReconciliation key={reconciliationProject} projectId={reconciliationProject} canManage={isManager} onBack={closeReconciliation} />
            : section === 'projetos' ? <ProjectCardsBoard canManage={hasAcompanhamentoAccess} canManageGroups={isManager} canManageManualCosts={isManager} canManageProjectNotes={isManager} progressHistoryNoveltyUser={user} />
            : section === 'sede' ? <SedeCostsBoard />
            : section === 'custo' && isManager ? <CostEngineManager canManageCosts={isManager} />
            : <AcompanhamentoDashboard canManage={hasAcompanhamentoAccess} canManageProposal={isManager} canViewFinancials={canViewProjectFinancials(user)} />}
          </Suspense>
        </section>
      </main>
      <AcompanhamentoTutorial userKey={userKey} ready={section === 'dashboard'} goToSection={setSection}
        triggerRef={tutorialTrigger} groupingNoveltyEnabled={isManager} groupingNoveltyUser={user}
        projectSectionActive={section === 'projetos'} />
    </AcompanhamentoAppShell>
  );
}
