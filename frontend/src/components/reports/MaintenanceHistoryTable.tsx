import { useQuery } from '@tanstack/react-query';

import {
  downloadMaintenanceDocument,
  listMaintenanceHistory,
  type MaintenanceHistorySort,
  type MaintenanceHistorySortDirection,
  type MaintenanceRecord
} from '../../api/operationalReports';
import { AppIcon } from '../icons/AppIcon';
import { Button, StatusPill } from '../ui/ds';
import { DS_ICONS } from '../ui/ds/icons';
import { useToast } from '../ui/ToastContext';

function dateLabel(value: string) {
  return new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC' }).format(
    new Date(`${value.slice(0, 10)}T00:00:00Z`)
  );
}

function categoryLabel(record: MaintenanceRecord) {
  return record.equipment.category?.name || record.profileNameSnapshot || '—';
}

function serviceLabels(record: MaintenanceRecord) {
  return [...record.selectedServices]
    .sort((left, right) => left.order - right.order)
    .map((item) => item.label);
}

function MaintenanceServices({ record }: { record: MaintenanceRecord }) {
  const services = serviceLabels(record);
  if (!services.length) return <span className="operational-history-empty">Nenhum serviço</span>;

  return <details className="operational-history-services">
    <summary>
      <strong>{services.length} {services.length === 1 ? 'serviço' : 'serviços'}</strong>
      <AppIcon icon={DS_ICONS.chevronDown} size="sm" />
    </summary>
    <ul>{services.map((service, index) => <li key={`${index}-${service}`}>{service}</li>)}</ul>
  </details>;
}

export function MaintenanceHistoryTable({
  search,
  categoryId,
  page,
  sortBy,
  sortDirection,
  onPageChange,
  onSortChange
}: {
  search: string;
  categoryId?: string;
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
      categoryId,
      page,
      sortBy,
      sortDirection
    ],
    queryFn: () =>
      listMaintenanceHistory({
        q: search || undefined,
        categoryId,
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
      <th scope="col" aria-sort={ariaSort}>
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
        <div className="operational-history-table-heading">
          <div><strong>Manutenções aprovadas</strong><span>{pagination?.total || items.length} registros</span></div>
          <span>Ordene pelos títulos das colunas</span>
        </div>
        <div className="operational-table-scroll">
          <table aria-label="Histórico de manutenção">
            <thead>
              <tr>
                {sortableHeader('Data', 'maintenanceDate')}
                {sortableHeader('TAG', 'tag')}
                {sortableHeader('Equipamento', 'equipment')}
                {sortableHeader('Categoria / perfil', 'category')}
                {sortableHeader('Responsável', 'responsible')}
                <th scope="col">Serviços realizados</th>
                <th scope="col">Documento</th>
              </tr>
            </thead>
            <tbody>
              {items.map((record) => (
                <tr key={record.id}>
                  <td className="operational-history-date">{dateLabel(record.maintenanceDate)}</td>
                  <td className="operational-history-tag"><strong>{record.equipment.code}</strong></td>
                  <td className="operational-history-equipment">{record.equipment.name}</td>
                  <td>{categoryLabel(record)}</td>
                  <td>{record.responsibleNameSnapshot}</td>
                  <td><MaintenanceServices record={record} /></td>
                  <td className="operational-history-document">
                    {record.document ? (
                      <Button
                        variant="secondary"
                        size="sm"
                        aria-label={`Baixar PDF da manutenção ${record.equipment.code}`}
                        onClick={() => void handleDownload(record)}
                      >
                        PDF
                      </Button>
                    ) : (
                      <span className="operational-history-empty">Indisponível</span>
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
          <article className="page-card operational-history-mobile-card" key={record.id}>
            <div className="operational-card-head">
              <div>
                <strong className="operational-history-mobile-tag">{record.equipment.code}</strong>
                <div className="operational-history-mobile-name">{record.equipment.name}</div>
              </div>
              <StatusPill status="APPROVED" label="Aprovado" tone="success" />
            </div>
            <dl className="operational-detail-list">
              <div><dt>Data</dt><dd>{dateLabel(record.maintenanceDate)}</dd></div>
              <div><dt>Categoria / perfil</dt><dd>{categoryLabel(record)}</dd></div>
              <div><dt>Responsável</dt><dd>{record.responsibleNameSnapshot}</dd></div>
              <div><dt>Serviços</dt><dd><MaintenanceServices record={record} /></dd></div>
            </dl>
            {record.document ? (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void handleDownload(record)}
              >
                Baixar PDF
              </Button>
            ) : (
              <span className="operational-history-empty">Documento indisponível</span>
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
