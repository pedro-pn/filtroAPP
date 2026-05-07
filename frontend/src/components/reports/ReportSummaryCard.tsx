import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';

import { useAuth } from '../../auth/AuthContext';
import { roleHomePath } from '../../auth/rolePath';
import type { ReportSummary } from '../../types/domain';
import { formatDateOnlyPtBr } from '../../utils/dateOnly';
import { serviceTypeLabels } from './ServiceFields';
import { SignatureProgress } from './SignatureProgress';

const statusMap: Record<string, { label: string; className: string }> = {
  PENDING: { label: 'Pendente', className: 'status-pending' },
  RETURNED: { label: 'Devolvido', className: 'status-returned' },
  APPROVED: { label: 'Aprovado', className: 'status-approved' },
  SIGNED: { label: 'Assinado', className: 'status-signed' }
};

const reportTypeIcon: Record<string, string> = {
  RDO: '\u{1F4CB}',
  RTP: '\u{1F4CF}',
  RLQ: '\u{1F9EA}',
  RCP: '\u{1F50D}',
  RCPU: '\u{1F50D}',
  RLM: '\u{1F527}',
  RLF: '\u{1F4A7}',
  RLI: '\u{1F4A7}'
};

function iconFor(type: string) {
  return reportTypeIcon[type] || '\u{1F4C4}';
}

function formatDate(value: string) {
  return formatDateOnlyPtBr(value, value);
}

function reportLabel(report: ReportSummary) {
  return report.sequenceNumber ? `${report.reportType} ${report.sequenceNumber}` : report.reportType;
}

type SummaryService = NonNullable<ReportSummary['services']>[number];

function stringValue(value: unknown): string {
  if (Array.isArray(value)) return value.map(item => stringValue(item)).filter(Boolean).join(', ');
  if (typeof value === 'string' || typeof value === 'number') return String(value).trim();
  return '';
}

function extraString(extraData: SummaryService['extraData'], keys: string[]) {
  const extra = extraData || {};
  for (const key of keys) {
    const value = stringValue(extra[key]);
    if (value) return value;
  }
  return '';
}

function serviceEquipmentLabel(service: SummaryService) {
  if (service.equipment) {
    return [service.equipment.code, service.equipment.name].filter(Boolean).join(' - ');
  }
  return extraString(service.extraData, ['Equipamento(s)', 'Equipamentos', 'Equipamento', 'equipment', 'equipmentId']) || service.equipmentId || '';
}

function serviceSystemLabel(service: SummaryService) {
  return service.system || extraString(service.extraData, ['Sistema', 'system']);
}

function summarizeServices(services: ReportSummary['services']) {
  if (!services?.length) return '';
  return services
    .map(s => {
      const type = serviceTypeLabels[s.serviceType] || s.serviceType;
      const equip = serviceEquipmentLabel(s);
      const system = serviceSystemLabel(s);
      const parts = [type, equip, system].filter(Boolean);
      return parts.join(' · ');
    })
    .join(' | ');
}

function clientReviewDateValue(value?: string | null) {
  const time = value ? new Date(value).getTime() : 0;
  return Number.isNaN(time) ? 0 : time;
}

function formatReviewDate(value?: string | null) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('pt-BR');
}

function clientRejectionReviews(report: ReportSummary) {
  const special = report.specialConditions || {};
  const rejectedAt = clientReviewDateValue(typeof special.__clientRejectedAt === 'string' ? special.__clientRejectedAt : null);
  const resolvedAt = clientReviewDateValue(typeof special.__clientRejectionResolvedAt === 'string' ? special.__clientRejectionResolvedAt : null);
  const rejections = (report.clientReviews || [])
    .filter(review => review.action === 'REJECTED')
    .sort((a, b) => clientReviewDateValue(b.createdAt) - clientReviewDateValue(a.createdAt));

  if (!rejections.length || report.status === 'SIGNED') return [];
  if (rejectedAt && (!resolvedAt || rejectedAt > resolvedAt)) return rejections;

  return rejections.filter(review => !resolvedAt || clientReviewDateValue(review.createdAt) > resolvedAt);
}

function normalizeComment(value?: string | null) {
  return String(value || '')
    .replace(/^justificativa do cliente:\s*/i, '')
    .replace(/^reprova[cç][aã]o do cliente(?:\s*[-#]\s*[^:]+)?:\s*/i, '')
    .trim();
}

function isClientRejectionNote(value?: string | null) {
  const text = normalizeComment(value);
  if (!text) return false;
  const raw = String(value || '').trim();
  return /^justificativa do cliente:/i.test(raw) || /^reprova[cç][aã]o do cliente/i.test(raw);
}

export function ReportSummaryCard({
  report,
  actions,
  leadingControl
}: {
  report: ReportSummary;
  actions?: ReactNode;
  leadingControl?: ReactNode;
}) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const status = report.status === 'PENDING' && report.reviewNotes === 'Editado pelo colaborador'
    ? { label: 'Editado', className: 'status-pending' }
    : (statusMap[report.status] || { label: report.status, className: 'status-pending' });
  const clientRejections = clientRejectionReviews(report);
  const rejectionComments = new Set(clientRejections.map(review => normalizeComment(review.comment)));
  const reviewNotes = normalizeComment(report.reviewNotes);
  const legacyRejectionComment =
    clientRejections.length && reviewNotes && !rejectionComments.has(reviewNotes) ? reviewNotes : '';
  const owner = report.createdBy?.collaborator?.name || report.createdBy?.name || '—';
  const services = summarizeServices(report.services) || 'Sem serviços';

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
    <article className="rel-item report-card report-card-clickable" onClick={handleOpenDetail}>
      <div className="report-card-main">
        {leadingControl ? (
          <div className="report-card-select" onClick={event => event.stopPropagation()}>
            {leadingControl}
          </div>
        ) : null}
        <div className="rel-icon" aria-hidden="true">{iconFor(report.reportType)}</div>
        <div className="rel-info">
          <div className="rel-name">
            {reportLabel(report)} · {report.project.name}
          </div>
          <div className="rel-meta">
            {owner} · {formatDate(report.reportDate)}
            <br />
            {services}
            {report.arrivalTime || report.departureTime ? (
              <>
                <br />
                {report.arrivalTime} às {report.departureTime}
              </>
            ) : null}
          </div>
          <SignatureProgress report={report} />
        </div>
        <div className="report-card-side" onClick={event => event.stopPropagation()}>
          <span className={`status-pill ${status.className}`}>{status.label}</span>
          {actions ? (
            <div className="report-card-actions">
              {actions}
            </div>
          ) : null}
        </div>
      </div>
      {clientRejections.length || legacyRejectionComment ? (
        <div className="client-rejection-list">
          {clientRejections.map((review, index) => (
            <div className="client-rejection-note" key={review.id}>
              <strong>
                Reprovação do cliente {formatReviewDate(review.createdAt) ? `- ${formatReviewDate(review.createdAt)}` : `#${index + 1}`}:
              </strong>{' '}
              {normalizeComment(review.comment) || 'Sem comentário'}
            </div>
          ))}
          {legacyRejectionComment ? (
            <div className="client-rejection-note">
              <strong>Reprovação anterior:</strong> {legacyRejectionComment}
            </div>
          ) : null}
        </div>
      ) : null}
      {reviewNotes && !rejectionComments.has(reviewNotes) && !legacyRejectionComment && !isClientRejectionNote(report.reviewNotes) ? (
        <p className="report-note">{report.reviewNotes}</p>
      ) : null}
    </article>
  );
}
