import type { KeyboardEvent } from 'react';

import type {
  OperationalReport,
  OperationalStatus
} from '../../api/operationalReports';

const statusLabels: Record<OperationalStatus, string> = {
  PENDING: 'Pendente',
  APPROVED: 'Aprovado',
  RETURNED: 'Devolvido'
};

function dateLabel(value: string) {
  return new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC' }).format(
    new Date(`${value.slice(0, 10)}T00:00:00Z`)
  );
}

function statusClass(status: OperationalStatus) {
  return `status-${status.toLowerCase()}`;
}

function handleCardKeyDown(
  event: KeyboardEvent<HTMLElement>,
  onOpen: () => void
) {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  event.preventDefault();
  onOpen();
}

export function OperationalReportSummaryCard({
  report,
  onOpen
}: {
  report: OperationalReport;
  onOpen: () => void;
}) {
  const isMaintenance = report.kind === 'MAINTENANCE';
  const detail = isMaintenance
    ? `${report.maintenanceRecords.length} manutenção(ões)`
    : `${report.chemicalCleanings
        .reduce((sum, item) => sum + Number(item.quantityKg), 0)
        .toLocaleString('pt-BR')} kg em limpeza química`;

  return (
    <article
      className="rel-item report-card report-card-clickable"
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(event) => handleCardKeyDown(event, onOpen)}
    >
      <div className="report-card-main">
        <div className="rel-icon" aria-hidden="true">
          {isMaintenance ? '🔧' : '🧪'}
        </div>
        <div className="rel-info">
          <div className="rel-name">
            {isMaintenance ? 'Manutenção' : 'Produção'} Nº{' '}
            {report.sequenceNumber} · {report.project.code} -{' '}
            {report.project.name}
          </div>
          <div className="rel-meta">
            {report.createdBy.name} · {dateLabel(report.reportDate)}
            <br />
            {detail}
            <br />
            {report.arrivalTime} às {report.departureTime}
          </div>
        </div>
        <div className="report-card-side">
          <span className={`status-pill ${statusClass(report.status)}`}>
            {statusLabels[report.status]}
          </span>
        </div>
      </div>
      {report.reviewNotes ? (
        <p className="report-note">{report.reviewNotes}</p>
      ) : null}
    </article>
  );
}
