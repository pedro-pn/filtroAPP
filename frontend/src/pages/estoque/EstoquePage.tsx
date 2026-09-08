import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router';

import { useAuth } from '../../auth/AuthContext';
import { accountPageStateFromPath } from '../../auth/moduleNavigation';
import { Shell } from '../../layout/Shell';
import { TopBar } from '../../layout/TopBar';
import { StockCategoriesTab } from './StockCategoriesTab';
import { StockItemsTab } from './StockItemsTab';
import { StockMovementFormModal } from './StockMovementFormModal';
import { StockMovementsTab } from './StockMovementsTab';
import { StockSummaryTab } from './StockSummaryTab';
import { useUrlParamState } from '../../hooks/useUrlParamState';

type EstoqueTab = 'resumo' | 'movimentacoes' | 'itens' | 'categorias';

const TABS: Array<{ key: EstoqueTab; label: string }> = [
  { key: 'resumo', label: 'Resumo' },
  { key: 'movimentacoes', label: 'Movimentações' },
  { key: 'itens', label: 'Itens' },
  { key: 'categorias', label: 'Categorias' }
];
const TAB_KEYS = TABS.map(item => item.key);

function parseEstoqueTab(value: string | null): EstoqueTab {
  return TAB_KEYS.includes(value as EstoqueTab) ? value as EstoqueTab : 'resumo';
}

export function EstoquePage() {
  const [tab, setTab] = useUrlParamState<EstoqueTab>({
    param: 'tab',
    defaultValue: 'resumo',
    parse: parseEstoqueTab
  });
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout } = useAuth();
  const isManager = Boolean(user?.moduleRoles?.includes('estoque:manager'));
  const [movementModalOpen, setMovementModalOpen] = useState(false);

  async function handleLogout() {
    await logout();
    navigate('/login');
  }

  return (
    <Shell>
      <TopBar
        title="Estoque"
        subtitle="Filtros, produtos químicos e movimentações"
        actions={
          <>
            <button className="topbar-chip" type="button" onClick={() => navigate('/conta', { state: accountPageStateFromPath(location) })}>Conta</button>
            <button className="topbar-chip" type="button" onClick={handleLogout}>Sair</button>
          </>
        }
      />
      <main className="page-scroll stock-page">
        <section className="page-card">
          <div className="nav-tabs" role="tablist" aria-label="Seções do estoque">
            {TABS.map(item => (
              <button
                key={item.key}
                className={`nav-tab ${tab === item.key ? 'active' : ''}`}
                type="button"
                role="tab"
                aria-selected={tab === item.key}
                onClick={() => setTab(item.key)}
              >
                {item.label}
              </button>
            ))}
          </div>
        </section>

        {tab === 'resumo' && <StockSummaryTab isManager={isManager} onRegisterMovement={() => setMovementModalOpen(true)} />}
        {tab === 'movimentacoes' && <StockMovementsTab isManager={isManager} />}
        {tab === 'itens' && <StockItemsTab isManager={isManager} />}
        {tab === 'categorias' && <StockCategoriesTab isManager={isManager} />}
      </main>
      {movementModalOpen ? (
        <StockMovementFormModal
          open
          onClose={() => setMovementModalOpen(false)}
        />
      ) : null}
    </Shell>
  );
}
