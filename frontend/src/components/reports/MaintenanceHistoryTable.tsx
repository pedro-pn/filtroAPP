import { useQuery } from '@tanstack/react-query';

import {
  downloadMaintenanceDocument,
  listMaintenanceHistory,
  type MaintenanceHistorySort,
  type MaintenanceHistorySortDirection,
  type MaintenanceRecord
} from '../../api/operationalReports';
import { Button } from '../ui/Button';
import { useToast } from '../ui/ToastContext';

function dateLabel(value: string) {
  return new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC' }).format(
    new Date(`${value.slice(0, 10)}T00:00:00Z`)
  );
}

function categoryLabel(record: MaintenanceRecord) {
  return record.equipment.category?.name || record.profileNameSnapshot || '—';
}

function servicesLabel(record: MaintenanceRecord) {
  return [...record.selectedServices]
    .sort((left, right) => left.order - right.order)
    .map((item) => item.label)
    .join(', ');
}

export function MaintenanceHistoryTable({
  search,
  page,
  sortBy,
  sortDirection,
  onPageChange,
  onSortChange
}: {
  search: string;
  page: number;
  sortBy: MaintenanceHistorySort;
  sortDirection: MaintenanceHistorySortDirection;
  onPageChange: (page: number) => void;
  onSortChange: (
    sortBy: MaintenanceHistorySort,
    sortDirection: MaintenanceHistorySortDirection
  ) => void;
}) {
  const showToast = useToast();
  const historyQuery = useQuery({
    queryKey: [
      'operational-reports',
      'maintenance-history',
      search,
      page,
      sortBy,
      sortDirection
    ],
    queryFn: () =>
      listMaintenanceHistory({
        q: search || undefined,
        page,
        pageSize: 20,
        sortBy,
        sortDirection
      })
  });

  function sortableHeader(label: string, field: MaintenanceHistorySort) {
    const active = sortBy === field;
    const nextDirection =
      active && sortDirection === 'asc' ? 'desc' : 'asc';
    const ariaSort = active
      ? sortDirection === 'asc'
        ? 'ascending'
        : 'descending'
      : 'none';
    return (
      <th aria-sort={ariaSort}>
        <button
          className="operational-sort-button"
          type="button"
          onClick={() => onSortChange(field, nextDirection)}
          aria-label={`${label}: ordenar em ordem ${nextDirection === 'asc' ? 'crescente' : 'decrescente'}`}
        >
          <span>{label}</span>
          <span className="operational-sort-indicator" aria-hidden="true">
            {active ? (sortDirection === 'asc' ? '▲' : '▼') : '↕'}
          </span>
        </button>
      </th>
    );
  }

  async function handleDownload(record: MaintenanceRecord) {
    if (!record.document) return;
    try {
      await downloadMaintenanceDocument(record);
    } catch {
      showToast('Não foi possível baixar o PDF da manutenção.', 'error');
    }
  }

  if (historyQuery.isLoading) {
    return <section className="page-card">Carregando histórico…</section>;
  }
  if (historyQuery.isError) {
    return (
      <div className="inline-error">
        Não foi possível carregar o histórico de manutenção.
      </div>
    );
  }

  const items = historyQuery.data?.items || [];
  const pagination = historyQuery.data?.pagination;

  if (!items.length) {
    return (
      <section className="page-card placeholder-copy">
        {search
          ? 'Nenhuma manutenção encontrada com esta busca.'
          : 'Nenhuma manutenção aprovada disponível.'}
      </section>
    );
  }

  return (
    <>
      <section className="page-card operational-maintenance-history-table">
        <div className="operational-table-scroll">
          <table>
            <thead>
              <tr>
                {sortableHeader('Data', 'maintenanceDate')}
                {sortableHeader('TAG', 'tag')}
                {sortableHeader('Equipamento', 'equipment')}
                {sortableHeader('Categoria / perfil', 'category')}
                {sortableHeader('Responsável', 'responsible')}
                <th>Serviços realizados</th>
                <th>Documento</th>
              </tr>
            </thead>
            <tbody>
              {items.map((record) => (
                <tr key={record.id}>
                  <td>{dateLabel(record.maintenanceDate)}</td>
                  <td><strong>{record.equipment.code}</strong></td>
                  <td>{record.equipment.name}</td>
                  <td>{categoryLabel(record)}</td>
                  <td>{record.responsibleNameSnapshot}</td>
                  <td>{servicesLabel(record)}</td>
                  <td>
                    {record.document ? (
                      <Button
                        variant="mini"
                        onClick={() => void handleDownload(record)}
                      >
                        Baixar PDF
                      </Button>
                    ) : (
                      <span className="form-hint">Indisponível</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section
        className="operational-maintenance-history-cards"
        aria-label="Histórico de manutenção"
      >
        {items.map((record) => (
          <article className="page-card" key={record.id}>
            <div className="operational-card-head">
              <div>
                <strong>{record.equipment.code}</strong>
                <div>{record.equipment.name}</div>
              </div>
              <span className="status-pill status-approved">Aprovado</span>
            </div>
            <dl className="operational-detail-list">
              <div><dt>Data</dt><dd>{dateLabel(record.maintenanceDate)}</dd></div>
              <div><dt>Categoria / perfil</dt><dd>{categoryLabel(record)}</dd></div>
              <div><dt>Responsável</dt><dd>{record.responsibleNameSnapshot}</dd></div>
              <div><dt>Serviços</dt><dd>{servicesLabel(record)}</dd></div>
            </dl>
            {record.document ? (
              <Button
                variant="secondary"
                onClick={() => void handleDownload(record)}
              >
                Baixar PDF
              </Button>
            ) : (
              <span className="form-hint">Documento indisponível</span>
            )}
          </article>
        ))}
      </section>

      {pagination && pagination.totalPages > 1 ? (
        <nav className="operational-pagination" aria-label="Páginas do histórico">
          <Button
            variant="secondary"
            disabled={pagination.page <= 1}
            onClick={() => onPageChange(pagination.page - 1)}
          >
            Anterior
          </Button>
          <span>
            Página {pagination.page} de {pagination.totalPages}
          </span>
          <Button
            variant="secondary"
            disabled={pagination.page >= pagination.totalPages}
            onClick={() => onPageChange(pagination.page + 1)}
          >
            Próxima
          </Button>
        </nav>
      ) : null}
    </>
  );
}
