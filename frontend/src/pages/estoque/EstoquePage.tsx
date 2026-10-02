import { useState } from 'react';

import { useAuth } from '../../auth/AuthContext';
import { PageHeader } from '../../layout/PageHeader';
import { OperationalModuleAppShell } from '../OperationalModuleAppShell';
import { StockCategoriesTab } from './StockCategoriesTab';
import { StockItemsTab } from './StockItemsTab';
import { StockMovementFormModal } from './StockMovementFormModal';
import { StockMovementsTab } from './StockMovementsTab';
import { StockSummaryTab } from './StockSummaryTab';
import { useUrlParamState } from '../../hooks/useUrlParamState';
import './EstoquePage.ds.css';

type EstoqueTab = 'resumo' | 'movimentacoes' | 'itens' | 'categorias';

const TABS: Array<{ key: EstoqueTab; label: string }> = [
  { key: 'resumo', label: 'Estoque' },
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
  const { user } = useAuth();
  const isManager = Boolean(user?.moduleRoles?.includes('estoque:manager'));
  const [movementModalOpen, setMovementModalOpen] = useState(false);

  const sectionLabel = TABS.find(item => item.key === tab)?.label || 'Estoque';
  const subNavigation = TABS.map(item => ({
    id: item.key,
    label: item.label,
    shortLabel: item.key === 'movimentacoes' ? 'Movimentos' : undefined,
    href: item.key === 'resumo' ? '/estoque' : `/estoque?tab=${item.key}`,
    active: tab === item.key,
    onSelect: () => setTab(item.key)
  }));

  return (
    <OperationalModuleAppShell moduleId="estoque" title="Estoque" sectionLabel={sectionLabel} subNavigation={subNavigation}>
      <main className="fv-ds stock-page stock-page-v2">
        <PageHeader title={sectionLabel} description="Controle de filtros, produtos químicos, lotes e movimentações." />
        {tab === 'resumo' && <StockSummaryTab isManager={isManager} onRegisterMovement={() => setMovementModalOpen(true)} />}
        {tab === 'movimentacoes' && <StockMovementsTab isManager={isManager} onRegisterMovement={() => setMovementModalOpen(true)} />}
        {tab === 'itens' && <StockItemsTab isManager={isManager} />}
        {tab === 'categorias' && <StockCategoriesTab isManager={isManager} />}
      </main>
      {movementModalOpen ? (
        <StockMovementFormModal
          open
          onClose={() => setMovementModalOpen(false)}
        />
      ) : null}
    </OperationalModuleAppShell>
  );
}
