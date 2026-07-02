import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { useAuth } from '../../auth/AuthContext';
import { accountPageStateFromPath } from '../../auth/moduleNavigation';
import { Shell } from '../../layout/Shell';
import { TopBar } from '../../layout/TopBar';
import { AcompanhamentoDashboard } from '../../components/projects/AcompanhamentoDashboard';
import { ProjectCardsBoard } from '../../components/projects/ProjectCardsBoard';
import { CostEngineManager } from '../../components/projects/CostEngineManager';

type Section = 'dashboard' | 'projetos' | 'custo';

export function AcompanhamentoPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { logout } = useAuth();
  const [section, setSection] = useState<Section>('dashboard');

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
            <button className="topbar-chip" type="button" onClick={() => navigate('/modulos')}>Módulos</button>
            <button className="topbar-chip" type="button" onClick={() => navigate('/conta', { state: accountPageStateFromPath(location.pathname) })}>Conta</button>
            <button className="topbar-chip" type="button" onClick={handleLogout}>Sair</button>
          </>
        }
      />
      <main className="page-scroll equip-page">
        <div className="equip-layout">
          <nav className="equip-nav" aria-label="Áreas de Acompanhamento">
            <button className={`equip-nav-item ${section === 'dashboard' ? 'active' : ''}`} type="button" aria-current={section === 'dashboard'} onClick={() => setSection('dashboard')}>
              <span className="equip-nav-ico" aria-hidden="true">◧</span>
              <span className="equip-nav-label">Dashboard</span>
            </button>
            <button className={`equip-nav-item ${section === 'projetos' ? 'active' : ''}`} type="button" aria-current={section === 'projetos'} onClick={() => setSection('projetos')}>
              <span className="equip-nav-ico" aria-hidden="true">▦</span>
              <span className="equip-nav-label">Projetos</span>
            </button>
            <button className={`equip-nav-item ${section === 'custo' ? 'active' : ''}`} type="button" aria-current={section === 'custo'} onClick={() => setSection('custo')}>
              <span className="equip-nav-ico" aria-hidden="true">$</span>
              <span className="equip-nav-label">Custo</span>
            </button>
          </nav>

          <div className="equip-mobile-nav">
            <label className="equip-mobile-nav-label" htmlFor="acp-section-select">Seção do módulo</label>
            <select
              id="acp-section-select"
              className="equip-nav-select"
              value={section}
              onChange={event => setSection(event.target.value as Section)}
            >
              <option value="dashboard">Dashboard</option>
              <option value="projetos">Projetos</option>
              <option value="custo">Custo</option>
            </select>
          </div>

          <section className="equip-content">
            {section === 'dashboard' ? <AcompanhamentoDashboard />
              : section === 'projetos' ? <ProjectCardsBoard />
              : <CostEngineManager />}
          </section>
        </div>
      </main>
    </Shell>
  );
}
