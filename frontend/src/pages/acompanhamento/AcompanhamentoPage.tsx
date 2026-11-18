import { useCallback, useEffect, useRef } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';

import { useAuth } from '../../auth/AuthContext';
import { accountPageStateFromPath, markAcompanhamentoNoveltySeen } from '../../auth/moduleNavigation';
import { Shell } from '../../layout/Shell';
import { TopBar } from '../../layout/TopBar';
import { AcompanhamentoDashboard } from '../../components/projects/AcompanhamentoDashboard';
import { ProjectCardsBoard } from '../../components/projects/ProjectCardsBoard';
import { SedeCostsBoard } from '../../components/projects/SedeCostsBoard';
import { CostEngineManager } from '../../components/projects/CostEngineManager';
import { CollaboratorsBoard } from '../../components/projects/CollaboratorsBoard';
import { AcompanhamentoTutorial } from '../../components/AcompanhamentoTutorial';

type Section = 'dashboard' | 'projetos' | 'sede' | 'custo' | 'colaboradores';
const SECTIONS: Section[] = ['dashboard', 'projetos', 'sede', 'custo', 'colaboradores'];

function parseSection(value: string | null, fallback: Section = 'dashboard'): Section {
  return SECTIONS.includes(value as Section) ? value as Section : fallback;
}

function tutorialUserKey(user: ReturnType<typeof useAuth>['user'], isManager: boolean) {
  const identity = String(user?.email || user?.username || user?.id || '').trim().toLowerCase();
  return identity ? `${isManager ? 'manager' : 'viewer'}:${identity}` : '';
}

export function AcompanhamentoPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user, logout } = useAuth();
  const tutorialTrigger = useRef<(() => void) | null>(null);

  const isManager = user?.accountType === 'ADMIN' || Boolean(user?.moduleRoles?.includes('acompanhamento:manager'));
  const hasAcompanhamentoAccess = user?.accountType === 'ADMIN'
    || Boolean(user?.moduleRoles?.some(role => role === 'acompanhamento:manager' || role === 'acompanhamento:viewer'));
  const userKey = tutorialUserKey(user, isManager);
  const projectDetailFromUrl = searchParams.has('project') || searchParams.has('group');
  const section = parseSection(searchParams.get('section'), projectDetailFromUrl ? 'projetos' : 'dashboard');
  const setSection = useCallback((nextSection: Section) => {
    setSearchParams(currentParams => {
      const nextParams = new URLSearchParams(currentParams);
      if (nextSection === 'dashboard') nextParams.delete('section');
      else nextParams.set('section', nextSection);

      if (nextSection !== 'projetos') {
        nextParams.delete('project');
        nextParams.delete('group');
        nextParams.delete('cards');
      }
      if (nextSection !== 'custo') nextParams.delete('cost');
      if (nextSection !== 'colaboradores') nextParams.delete('colaborador');
      return nextParams;
    }, { replace: true });
  }, [setSearchParams]);

  // Ao entrar no módulo, a novidade do hub já foi "consumida".
  useEffect(() => { if (user) markAcompanhamentoNoveltySeen(user); }, [user]);
  useEffect(() => {
    if (!isManager && (section === 'custo' || section === 'colaboradores')) setSection('dashboard');
  }, [isManager, section, setSection]);

  const handleLogout = () => {
    logout();
    navigate('/login', { replace: true });
  };

  return (
    <Shell>
      <TopBar
        title="Acompanhamento de Projetos"
        subtitle="Previsto x realizado, custos e cronograma"
        actions={
          <>
            <button className="topbar-chip" type="button" onClick={() => tutorialTrigger.current?.()}>Ver tutorial</button>
            <button className="topbar-chip" type="button" onClick={() => navigate('/conta', { state: accountPageStateFromPath(location) })}>Conta</button>
            <button className="topbar-chip" type="button" onClick={handleLogout}>Sair</button>
          </>
        }
      />
      <main className="page-scroll equip-page">
        <div className="equip-layout">
          <nav className="equip-nav" aria-label="Áreas de Acompanhamento" data-acp-nav>
            <button className={`equip-nav-item ${section === 'dashboard' ? 'active' : ''}`} type="button" aria-current={section === 'dashboard'} onClick={() => setSection('dashboard')}>
              <span className="equip-nav-ico" aria-hidden="true">◧</span>
              <span className="equip-nav-label">Dashboard</span>
            </button>
            <button className={`equip-nav-item ${section === 'projetos' ? 'active' : ''}`} type="button" aria-current={section === 'projetos'} onClick={() => setSection('projetos')}>
              <span className="equip-nav-ico" aria-hidden="true">▦</span>
              <span className="equip-nav-label">Projetos</span>
            </button>
            <button className={`equip-nav-item ${section === 'sede' ? 'active' : ''}`} type="button" aria-current={section === 'sede'} onClick={() => setSection('sede')}>
              <span className="equip-nav-ico" aria-hidden="true">⌂</span>
              <span className="equip-nav-label">Sede</span>
            </button>
            {isManager ? (
              <button className={`equip-nav-item ${section === 'custo' ? 'active' : ''}`} type="button" aria-current={section === 'custo'} onClick={() => setSection('custo')}>
                <span className="equip-nav-ico" aria-hidden="true">$</span>
                <span className="equip-nav-label">Custo</span>
              </button>
            ) : null}
            {isManager ? (
              <button className={`equip-nav-item ${section === 'colaboradores' ? 'active' : ''}`} type="button" aria-current={section === 'colaboradores'} onClick={() => setSection('colaboradores')}>
                <span className="equip-nav-ico" aria-hidden="true">HH</span>
                <span className="equip-nav-label">Colaboradores</span>
              </button>
            ) : null}
          </nav>

          <div className="equip-mobile-nav" data-acp-mobile-nav>
            <label className="equip-mobile-nav-label" htmlFor="acp-section-select">Seção do módulo</label>
            <select
              id="acp-section-select"
              className="equip-nav-select"
              value={section}
              onChange={event => setSection(event.target.value as Section)}
            >
              <option value="dashboard">Dashboard</option>
              <option value="projetos">Projetos</option>
              <option value="sede">Sede</option>
              {isManager ? <option value="custo">Custo</option> : null}
              {isManager ? <option value="colaboradores">Colaboradores</option> : null}
            </select>
          </div>

          <section className="equip-content">
            {section === 'projetos' ? <ProjectCardsBoard canManage={hasAcompanhamentoAccess} canManageGroups={isManager} canManageManualCosts={isManager} progressHistoryNoveltyUser={user} />
              : section === 'sede' ? <SedeCostsBoard />
              : section === 'custo' && isManager ? <CostEngineManager canManageCosts={isManager} />
              : section === 'colaboradores' && isManager ? <CollaboratorsBoard noveltyUser={user} />
              : <AcompanhamentoDashboard canManage={hasAcompanhamentoAccess} />}
          </section>
        </div>
      </main>
      <AcompanhamentoTutorial
        userKey={userKey}
        ready={section === 'dashboard'}
        goToSection={setSection}
        triggerRef={tutorialTrigger}
        groupingNoveltyEnabled={isManager}
        groupingNoveltyUser={user}
        projectSectionActive={section === 'projetos'}
      />
    </Shell>
  );
}
