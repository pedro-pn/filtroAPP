import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';

import { useAuth } from '../../auth/AuthContext';
import { roleHomePath } from '../../auth/rolePath';
import type { ReportSummary } from '../../types/domain';

const statusMap: Record<string, { label: string; className: string }> = {
  PENDING: { label: 'Pendente', className: 'status-pending' },
  RETURNED: { label: 'Devolvido', className: 'status-returned' },
  APPROVED: { label: 'Aprovado', className: 'status-approved' },
  SIGNED: { label: 'Assinado', className: 'status-signed' }
};

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('pt-BR');
}

function reportLabel(report: ReportSummary) {
  return report.sequenceNumber ? `${report.reportType} ${report.sequenceNumber}` : report.reportType;
}

export function ReportSummaryCard({ report, actions }: { report: ReportSummary; actions?: ReactNode }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const status = statusMap[report.status] || { label: report.status, className: 'status-pending' };

  function handleOpenDetail() {
    const base = roleHomePath(user?.role);
    const detailPath =
      base === '/gestor'
        ? `/gestor/relatorio/${report.id}`
        : base === '/coordenador'
          ? `/coordenador/relatorio/${report.id}`
          : base === '/cliente'
            ? `/cliente/relatorio/${report.id}`
            : `/relatorios/${report.id}`;
    navigate(detailPath);
  }

  return (
    <article className="report-card report-card-clickable" onClick={handleOpenDetail}>
      <div className="report-card-head">
        <div>
          <div className="report-title">{reportLabel(report)}</div>
          <div className="report-subtitle">{report.project.code} - {report.project.name}</div>
        </div>
        <span className={`status-pill ${status.className}`}>{status.label}</span>
      </div>
      <div className="report-meta-grid">
        <div>
          <span className="report-meta-label">Data</span>
          <span className="report-meta-value">{formatDate(report.reportDate)}</span>
        </div>
        <div>
          <span className="report-meta-label">Horário</span>
          <span className="report-meta-value">
            {report.arrivalTime} às {report.departureTime}
          </span>
        </div>
      </div>
      {report.reviewNotes ? <p className="report-note">{report.reviewNotes}</p> : null}
      {actions ? (
        <div className="report-card-actions" onClick={event => event.stopPropagation()}>
          {actions}
        </div>
      ) : null}
    </article>
  );
}
