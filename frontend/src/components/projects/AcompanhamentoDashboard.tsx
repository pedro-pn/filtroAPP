import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { getCommercialDashboard, getRealizedByCategory, type DashboardRow } from '../../api/acompanhamentoComercial';
import { Modal } from '../ui/Modal';
import { ProjectScheduleEditor, type ScheduleEditorHandle } from './ProjectScheduleEditor';
import { acompanhamentoRefreshQueryOptions } from './acompanhamentoRefresh';
import { AcompanhamentoDashboardView } from './AcompanhamentoDashboardView';
import type { DashboardFilterValues } from './AcompanhamentoDashboardFilters';

export function AcompanhamentoDashboard({ canManage = false }: { canManage?: boolean }) {
  const [values, setValues] = useState<DashboardFilterValues>({ search: '', modality: 'todas', status: 'todos', category: '', metricKey: 'custo' });
  const [managed, setManaged] = useState<DashboardRow | null>(null);
  const [managedDirty, setManagedDirty] = useState(false);
  const scheduleRef = useRef<ScheduleEditorHandle>(null);
  const { category } = values;
  const dashboard = useQuery({
    queryKey: ['commercial-dashboard', category],
    queryFn: () => getCommercialDashboard(category || undefined),
    ...acompanhamentoRefreshQueryOptions
  });
  const categories = useQuery({
    queryKey: ['realized-categories', 'all'],
    queryFn: () => getRealizedByCategory(),
    ...acompanhamentoRefreshQueryOptions
  });

  return (
    <>
      <AcompanhamentoDashboardView data={dashboard.data} loading={dashboard.isLoading} error={dashboard.isError}
        updating={dashboard.isFetching} onRetry={() => { void dashboard.refetch(); }}
        values={values} onChange={patch => setValues(current => ({ ...current, ...patch }))}
        categories={categories.data ?? []} categoriesLoading={categories.isLoading}
        categoriesError={categories.isError} onRetryCategories={() => { void categories.refetch(); }}
        onOpen={row => { setManagedDirty(false); setManaged(row); }} />
      <Modal open={managed !== null} onClose={() => setManaged(null)} ariaLabelledBy="acp-manage-title" panelClassName="modal-card acp-manage-card">
        {managed ? (
          <div className="acp-manage">
            <div className="acp-manage-head">
              <div className="sec" id="acp-manage-title">Cronograma — {managed.code}{managed.name ? ` — ${managed.name}` : ''}</div>
              <button className="mini-btn alt" type="button" onClick={() => setManaged(null)} aria-label="Fechar">✕</button>
            </div>
            <div className="acp-manage-body">
              <ProjectScheduleEditor key={managed.projectId} ref={scheduleRef} projectId={managed.projectId} canManage={canManage} onDirtyChange={setManagedDirty} />
            </div>
            <div className="acp-manage-foot">
              <button type="button" className="mini-btn alt" onClick={() => setManaged(null)}>Cancelar</button>
              {canManage ? <button type="button" className="mini-btn" disabled={!managedDirty} onClick={() => scheduleRef.current?.save()}>Salvar</button> : null}
            </div>
          </div>
        ) : <div />}
      </Modal>
    </>
  );
}
