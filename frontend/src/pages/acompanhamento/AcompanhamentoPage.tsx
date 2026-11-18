import { useCallback, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { CircleHelp } from 'lucide-react';
import { AppIcon } from '../../components/icons/AppIcon';

import { useAuth } from '../../auth/AuthContext';
import { markAcompanhamentoNoveltySeen } from '../../auth/moduleNavigation';
import { Button, IconButton } from '../../components/ui/ds';
import { AcompanhamentoDashboard } from '../../components/projects/AcompanhamentoDashboard';
import { ProjectCardsBoard } from '../../components/projects/ProjectCardsBoard';
import { SedeCostsBoard } from '../../components/projects/SedeCostsBoard';
import { CostEngineManager } from '../../components/projects/CostEngineManager';
import { getPontoPendencyCounts } from '../../api/acompanhamentoPonto';
import { AcompanhamentoTutorial } from '../../components/AcompanhamentoTutorial';
import { AcompanhamentoAppShell } from './AcompanhamentoAppShell';
import { parseSection, sectionSearchParams, type AcompanhamentoSection } from './navigation';
import './AcompanhamentoPage.ds.css';

function tutorialUserKey(user: ReturnType<typeof useAuth>['user'], isManager: boolean) {
  const identity = String(user?.email || user?.username || user?.id || '').trim().toLowerCase();
  return identity ? `${isManager ? 'manager' : 'viewer'}:${identity}` : '';
}

export function AcompanhamentoPage() {
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
          {section === 'projetos' ? <ProjectCardsBoard canManage={hasAcompanhamentoAccess} canManageGroups={isManager} canManageManualCosts={isManager} canManageProjectNotes={isManager} progressHistoryNoveltyUser={user} />
            : section === 'sede' ? <SedeCostsBoard />
            : section === 'custo' && isManager ? <CostEngineManager canManageCosts={isManager} />
            : <AcompanhamentoDashboard canManage={hasAcompanhamentoAccess} />}
        </section>
      </main>
      <AcompanhamentoTutorial userKey={userKey} ready={section === 'dashboard'} goToSection={setSection}
        triggerRef={tutorialTrigger} groupingNoveltyEnabled={isManager} groupingNoveltyUser={user}
        projectSectionActive={section === 'projetos'} />
    </AcompanhamentoAppShell>
  );
}
