import { SortableTable } from '../ui/SortableTable';
import type {
  MaintenanceScheduleItem,
  MaintenanceSchedulePage,
  MaintenanceScheduleStatus
} from '../../api/operationalReports';
import { Badge, Button, Card, MetricCard } from '../ui/ds';

const statusLabels: Record<MaintenanceScheduleStatus, string> = {
  OVERDUE: 'Vencida',
  DUE_TODAY: 'Vence hoje',
  UPCOMING: 'Em dia',
  NO_HISTORY: 'Sem histórico',
  UNCONFIGURED: 'Não configurado'
};

function dateLabel(value: string | null) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC' }).format(
    new Date(`${value.slice(0, 10)}T00:00:00Z`)
  );
}

function dueDetail(item: MaintenanceScheduleItem) {
  if (item.status === 'OVERDUE' && item.daysUntilDue !== null)
    return `${Math.abs(item.daysUntilDue)} dia(s) em atraso`;
  if (item.status === 'DUE_TODAY') return 'Prazo termina hoje';
  if (item.status === 'UPCOMING' && item.daysUntilDue !== null)
    return `Faltam ${item.daysUntilDue} dia(s)`;
  if (item.status === 'NO_HISTORY') return 'Registre a primeira manutenção';
  if (item.status === 'UNCONFIGURED') return 'Configure o prazo da categoria';
  return '';
}

function statusPill(item: MaintenanceScheduleItem) {
  return (
    <Badge tone={item.status === 'OVERDUE' ? 'danger' : item.status === 'DUE_TODAY' ? 'warning' : item.status === 'UPCOMING' ? 'success' : 'neutral'}>
      {statusLabels[item.status]}
    </Badge>
  );
}

export function MaintenanceScheduleBoard({
  data,
  onPageChange
}: {
  data: MaintenanceSchedulePage;
  onPageChange: (page: number) => void;
}) {
  const groups = Array.from(
    data.items.reduce((result, item) => {
      const current = result.get(item.category.id) || {
        category: item.category,
        items: [] as MaintenanceScheduleItem[]
      };
      current.items.push(item);
      result.set(item.category.id, current);
      return result;
    }, new Map<string, { category: MaintenanceScheduleItem['category']; items: MaintenanceScheduleItem[] }>()).values()
  );

  return (
    <>
      <section
        className="operational-schedule-summary"
        aria-label="Resumo da programação de manutenção"
      >
        <MetricCard tone="danger" value={data.summary.OVERDUE} label="Vencidas" />
        <MetricCard tone="warning" value={data.summary.DUE_TODAY} label="Vencem hoje" />
        <MetricCard tone="success" value={data.summary.UPCOMING} label="Em dia" />
        <MetricCard value={data.summary.NO_HISTORY + data.summary.UNCONFIGURED} label="A configurar" />
      </section>

      {groups.map(({ category, items }) => (
        <Card
          className="operational-maintenance-schedule-group"
          key={category.id}
        >
          <header className="operational-schedule-group-head">
            <div>
              <div className="section-title">{category.name}</div>
              <div className="form-hint">
                {category.maintenanceIntervalDays
                  ? `Intervalo de ${category.maintenanceIntervalDays} dias`
                  : 'Intervalo não configurado'}
              </div>
            </div>
            <span className="operational-schedule-group-count">
              {items.length} equipamento(s)
            </span>
          </header>

          <div className="operational-schedule-table">
            <SortableTable>
              <thead>
                <tr>
                  <th>TAG</th>
                  <th>Equipamento</th>
                  <th>Última manutenção</th>
                  <th>Próxima manutenção</th>
                  <th>Situação</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr
                    className={
                      item.status === 'OVERDUE'
                        ? 'is-overdue'
                        : item.status === 'DUE_TODAY'
                          ? 'is-due-today'
                          : ''
                    }
                    key={item.equipment.id}
                  >
                    <td><strong>{item.equipment.code}</strong></td>
                    <td>{item.equipment.name}</td>
                    <td data-sort-value={item.lastMaintenanceDate}>{dateLabel(item.lastMaintenanceDate)}</td>
                    <td data-sort-value={item.nextMaintenanceDate}>{dateLabel(item.nextMaintenanceDate)}</td>
                    <td>
                      {statusPill(item)}
                      <div className="form-hint">{dueDetail(item)}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </SortableTable>
          </div>

          <div className="operational-schedule-cards">
            {items.map((item) => (
              <article
                className={
                  item.status === 'OVERDUE'
                    ? 'is-overdue'
                    : item.status === 'DUE_TODAY'
                      ? 'is-due-today'
                      : ''
                }
                key={item.equipment.id}
              >
                <div className="operational-card-head">
                  <div>
                    <strong>{item.equipment.code}</strong>
                    <div>{item.equipment.name}</div>
                  </div>
                  {statusPill(item)}
                </div>
                <dl className="operational-detail-list">
                  <div>
                    <dt>Última</dt>
                    <dd>{dateLabel(item.lastMaintenanceDate)}</dd>
                  </div>
                  <div>
                    <dt>Próxima</dt>
                    <dd>{dateLabel(item.nextMaintenanceDate)}</dd>
                  </div>
                  <div>
                    <dt>Prazo</dt>
                    <dd>{dueDetail(item)}</dd>
                  </div>
                </dl>
              </article>
            ))}
          </div>
        </Card>
      ))}

      {data.pagination.totalPages > 1 ? (
        <nav className="operational-pagination" aria-label="Páginas da programação">
          <Button
            variant="secondary"
            disabled={data.pagination.page <= 1}
            onClick={() => onPageChange(data.pagination.page - 1)}
          >
            Anterior
          </Button>
          <span>
            Página {data.pagination.page} de {data.pagination.totalPages}
          </span>
          <Button
            variant="secondary"
            disabled={data.pagination.page >= data.pagination.totalPages}
            onClick={() => onPageChange(data.pagination.page + 1)}
          >
            Próxima
          </Button>
        </nav>
      ) : null}
    </>
  );
}
