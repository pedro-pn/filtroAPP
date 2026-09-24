import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router';

import { getCommercialDashboard, getRealizedByCategory, type DashboardRow } from '../../api/acompanhamentoComercial';
import { Modal } from '../ui/Modal';
import { ProjectScheduleEditor, type ScheduleEditorHandle } from './ProjectScheduleEditor';
import { acompanhamentoRefreshQueryOptions } from './acompanhamentoRefresh';
import { AcompanhamentoDashboardView } from './AcompanhamentoDashboardView';
import type { DashboardFilterValues } from './AcompanhamentoDashboardFilters';
import { isGroupRow } from './acompanhamentoDashboardModel';

export function AcompanhamentoDashboard({ canManage = false, canViewFinancials = false }: { canManage?: boolean; canViewFinancials?: boolean }) {
  const [values, setValues] = useState<DashboardFilterValues>({ search: '', modality: 'todas', status: 'todos', category: '', metricKey: 'custo' });
  const [selectedManaged, setManaged] = useState<DashboardRow | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
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
  const managed = selectedManaged ?? dashboard.data?.find((row): row is DashboardRow => !isGroupRow(row) && row.projectId === searchParams.get('schedule')) ?? null;
  const financialsVisible = canViewFinancials && Boolean(dashboard.data?.every(row => row.canViewProjectFinancials === true));
  function closeSchedule() {
    setManaged(null);
    setManagedDirty(false);
    if (searchParams.has('schedule')) setSearchParams(current => {
      const next = new URLSearchParams(current);
      next.delete('schedule');
      return next;
    }, { replace: true });
  }

  return (
    <>
      <AcompanhamentoDashboardView data={dashboard.data} loading={dashboard.isLoading} error={dashboard.isError}
        updating={dashboard.isFetching} onRetry={() => { void dashboard.refetch(); }}
        values={values} onChange={patch => setValues(current => ({ ...current, ...patch }))}
        canViewFinancials={financialsVisible}
        categories={categories.data ?? []} categoriesLoading={categories.isLoading}
        categoriesError={categories.isError} onRetryCategories={() => { void categories.refetch(); }}
        onOpen={row => { setManagedDirty(false); setManaged(row); setSearchParams(current => { const next = new URLSearchParams(current); next.set('schedule', row.projectId); return next; }, { replace: true }); }} />
      <Modal open={managed !== null} onClose={closeSchedule} ariaLabelledBy="acp-manage-title" panelClassName="modal-card acp-manage-card">
        {managed ? (
          <div className="acp-manage">
            <div className="acp-manage-head">
              <div className="sec" id="acp-manage-title">Cronograma — {managed.code}{managed.name ? ` — ${managed.name}` : ''}</div>
              <button className="mini-btn alt" type="button" onClick={closeSchedule} aria-label="Fechar">✕</button>
            </div>
            <div className="acp-manage-body">
              <ProjectScheduleEditor key={managed.projectId} ref={scheduleRef} projectId={managed.projectId} canManage={canManage} onDirtyChange={setManagedDirty} />
            </div>
            <div className="acp-manage-foot">
              <button type="button" className="mini-btn alt" onClick={closeSchedule}>Cancelar</button>
              {canManage ? <button type="button" className="mini-btn" disabled={!managedDirty} onClick={() => scheduleRef.current?.save()}>Salvar</button> : null}
            </div>
          </div>
        ) : <div />}
      </Modal>
    </>
  );
}
