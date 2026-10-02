import { useEffect } from 'react';

import { AllocationAuditPanel } from './AllocationAuditPanel';
import { CargoProfilesPanel } from './CargoProfilesPanel';
import { CostSimulatorPanel } from './CostSimulatorPanel';
import { EpiConfigCard } from './EpiConfigCard';
import { LaborRateTable } from './LaborRateTable';
import { OmieCostCategoriesPanel } from './OmieCostCategoriesPanel';
import { PontoImportPanel } from './PontoImportPanel';
import { useUrlParamState } from '../../hooks/useUrlParamState';
import { Button } from '../ui/ds';
import './CostEngineManager.ds.css';

type CostTab = 'cargos' | 'ponto' | 'auditoria' | 'rates' | 'categorias' | 'simulador';

const TABS: Array<[CostTab, string]> = [
  ['cargos', 'Cargos'],
  ['ponto', 'Ponto'],
  ['auditoria', 'Auditoria'],
  ['rates', 'Custo/hora'],
  ['categorias', 'Categorias Omie'],
  ['simulador', 'Simulador']
];
const COST_TABS = TABS.map(([key]) => key);

function parseCostTab(value: string | null): CostTab {
  return COST_TABS.includes(value as CostTab) ? value as CostTab : 'cargos';
}

export function CostEngineManager({ canManageCosts = true }: { canManageCosts?: boolean }) {
  const tabs = canManageCosts ? TABS : TABS.filter(([key]) => key === 'rates');
  const [tab, setTab] = useUrlParamState<CostTab>({
    param: 'cost',
    defaultValue: 'cargos',
    parse: parseCostTab
  });
  const activeTab = canManageCosts ? tab : 'rates';

  useEffect(() => {
    if (!canManageCosts && tab !== 'rates') setTab('rates');
  }, [canManageCosts, setTab, tab]);

  return (
    <div className="fv-ds acp-cost-ds" data-acp-custo>
      <div className="acp-cost-ds__tabs" role="tablist" aria-label="Seções de custo">
        {tabs.map(([key, label]) => (
          <Button
            key={key}
            role="tab"
            aria-selected={activeTab === key}
            variant={activeTab === key ? 'primary' : 'secondary'}
            size="sm"
            onClick={() => setTab(key)}
          >
            {label}
          </Button>
        ))}
      </div>

      {canManageCosts && activeTab === 'cargos' ? <><EpiConfigCard /><CargoProfilesPanel /></>
        : activeTab === 'ponto' ? <PontoImportPanel />
        : canManageCosts && activeTab === 'auditoria' ? <AllocationAuditPanel />
        : activeTab === 'rates' ? <LaborRateTable />
        : canManageCosts && activeTab === 'categorias' ? <OmieCostCategoriesPanel />
        : <CostSimulatorPanel />}
    </div>
  );
}
