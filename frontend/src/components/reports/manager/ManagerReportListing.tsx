import type { MouseEvent as ReactMouseEvent, ReactNode } from 'react';

import type { ReportSummary } from '../../../types/domain';
import { formatDateOnlyPtBr } from '../../../utils/dateOnly';
import type { ProjectSortDirection } from '../../../utils/projectSort';
import { reportSignatureProgress } from '../../../utils/signatureProgress';
import { AppIcon } from '../../icons/AppIcon';
import {
  DataTable,
  StatusPill,
  type DataTableColumn,
  type DataTableProps,
  type StatusToneMap
} from '../../ui/ds';
import { DS_ICONS } from '../../ui/ds/icons';
import { serviceTypeLabels } from '../serviceTypes';
import { SignatureProgress } from '../SignatureProgress';
import './ManagerReportListing.css';

const REPORT_STATUS_TONES: StatusToneMap = {
  approved: 'success',
  edited: 'info',
  pending: 'warning',
  returned: 'danger',
  signed: 'info'
};

const REPORT_STATUS_LABELS: Readonly<Record<string, string>> = {
  APPROVED: 'Aprovado',
  PENDING: 'Pendente',
  RETURNED: 'Devolvido',
  SIGNED: 'Assinado'
};

type SummaryService = NonNullable<ReportSummary['services']>[number];
type ClientReview = NonNullable<ReportSummary['clientReviews']>[number];

export interface ManagerReportListingProps {
  reports: readonly ReportSummary[];
  selectedReportIds: readonly string[];
  onSelectionChange: (ids: string[]) => void;
  onOpenReport: (report: ReportSummary) => void;
  renderActions: (report: ReportSummary) => ReactNode;
  reportType: string;
  projectLabel: string;
  sortDirection: ProjectSortDirection;
  onSortChange: () => void;
  selectable?: boolean;
  layout?: DataTableProps<ReportSummary>['layout'];
}

function reportLabel(report: ReportSummary) {
  return report.sequenceNumber
    ? `${report.reportType} ${report.sequenceNumber}`
    : report.reportType;
}

function fullReportLabel(report: ReportSummary, projectLabel: string) {
  return `${reportLabel(report)} · ${report.project?.name || projectLabel}`;
}

function ownerLabel(report: ReportSummary) {
  return report.createdBy?.collaborator?.name || report.createdBy?.name || '—';
}

function stringValue(value: unknown): string {
  if (Array.isArray(value)) {
    return value
      .map((item) => stringValue(item))
      .filter(Boolean)
      .join(', ');
  }

  if (typeof value === 'string' || typeof value === 'number') {
    return String(value).trim();
  }

  return '';
}

function extraString(
  extraData: SummaryService['extraData'],
  keys: readonly string[]
) {
  const extra = extraData || {};
  for (const key of keys) {
    const value = stringValue(extra[key]);
    if (value) return value;
  }
  return '';
}

function serviceEquipmentLabel(service: SummaryService) {
  if (service.equipment) {
    return [service.equipment.code, service.equipment.name]
      .filter(Boolean)
      .join(' - ');
  }

  return (
    extraString(service.extraData, [
      'Equipamento(s)',
      'Equipamentos',
      'Equipamento',
      'equipment',
      'equipmentId'
    ]) ||
    service.equipmentId ||
    ''
  );
}

function serviceSystemLabel(service: SummaryService) {
  return (
    service.system || extraString(service.extraData, ['Sistema', 'system'])
  );
}

function summarizeServices(services: ReportSummary['services']) {
  if (!services?.length) return '';

  return services
    .map((service) => {
      const type =
        serviceTypeLabels[service.serviceType] || service.serviceType;
      const equipment = serviceEquipmentLabel(service);
      const system = serviceSystemLabel(service);
      return [type, equipment, system].filter(Boolean).join(' · ');
    })
    .join(' | ');
}

function isManualUploadedReport(report: ReportSummary) {
  const specialConditions = report.specialConditions || {};
  const manualUpload = specialConditions.__manualUpload;

  return (
    specialConditions.source === 'MANUAL_UPLOAD' ||
    Boolean(
      manualUpload &&
      typeof manualUpload === 'object' &&
      !Array.isArray(manualUpload) &&
      'uploadedAt' in manualUpload
    )
  );
}

function servicesLabel(report: ReportSummary) {
  if (isManualUploadedReport(report)) {
    return 'Relatório adicionado manualmente';
  }

  return summarizeServices(report.services) || 'Sem serviços';
}

function mobileServicesLabel(report: ReportSummary) {
  if (isManualUploadedReport(report)) {
    return 'Relatório adicionado manualmente';
  }

  const services = report.services || [];
  if (!services.length) return 'Sem serviços';

  const firstService = summarizeServices(services.slice(0, 1));
  const remaining = services.length - 1;
  return remaining
    ? `${firstService} · +${remaining} serviço${remaining === 1 ? '' : 's'}`
    : firstService;
}

function hasWorkTimes(report: ReportSummary) {
  return (
    Boolean(report.arrivalTime || report.departureTime) &&
    (report.arrivalTime !== '00:00' || report.departureTime !== '00:00')
  );
}

function workTimesLabel(report: ReportSummary) {
  return hasWorkTimes(report)
    ? `${report.arrivalTime ?? ''} às ${report.departureTime ?? ''}`
    : 'Não informado';
}

function clientReviewDateValue(value?: string | null) {
  const time = value ? new Date(value).getTime() : 0;
  return Number.isNaN(time) ? 0 : time;
}

function formatReviewDate(value?: string | null) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('pt-BR');
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
  return (
    /^justificativa do cliente:/i.test(raw) ||
    /^reprova[cç][aã]o do cliente/i.test(raw)
  );
}

function clientRejectionReviews(report: ReportSummary) {
  const specialConditions = report.specialConditions || {};
  const rejectedAt = clientReviewDateValue(
    typeof specialConditions.__clientRejectedAt === 'string'
      ? specialConditions.__clientRejectedAt
      : null
  );
  const resolvedAt = clientReviewDateValue(
    typeof specialConditions.__clientRejectionResolvedAt === 'string'
      ? specialConditions.__clientRejectionResolvedAt
      : null
  );
  const rejections = (report.clientReviews || [])
    .filter((review) => review.action === 'REJECTED')
    .sort(
      (first, second) =>
        clientReviewDateValue(second.createdAt) -
        clientReviewDateValue(first.createdAt)
    );

  if (!rejections.length || report.status === 'SIGNED') return [];
  if (rejectedAt && (!resolvedAt || rejectedAt > resolvedAt)) {
    return rejections;
  }

  return rejections.filter(
    (review) =>
      !resolvedAt || clientReviewDateValue(review.createdAt) > resolvedAt
  );
}

function activeSpecialRejection(report: ReportSummary) {
  const specialConditions = report.specialConditions || {};
  const rejectedAt = clientReviewDateValue(
    typeof specialConditions.__clientRejectedAt === 'string'
      ? specialConditions.__clientRejectedAt
      : null
  );
  const resolvedAt = clientReviewDateValue(
    typeof specialConditions.__clientRejectionResolvedAt === 'string'
      ? specialConditions.__clientRejectionResolvedAt
      : null
  );

  if (!rejectedAt || report.status === 'SIGNED') return null;
  if (resolvedAt && rejectedAt <= resolvedAt) return null;

  return {
    comment:
      typeof specialConditions.__clientRejectionComment === 'string'
        ? specialConditions.__clientRejectionComment
        : '',
    createdAt:
      typeof specialConditions.__clientRejectedAt === 'string'
        ? specialConditions.__clientRejectedAt
        : null
  };
}

function clientReviewAuthor(review: ClientReview) {
  const name = String(review.clientUser?.name || '').trim();
  const email = String(review.clientUser?.email || '').trim();
  const username = String(review.clientUser?.username || '').trim();

  if (name && email && name.toLowerCase() !== email.toLowerCase()) {
    return `${name} (${email})`;
  }
  return name || email || username;
}

function reportStatus(report: ReportSummary) {
  if (
    report.status === 'PENDING' &&
    report.reviewNotes === 'Editado pelo colaborador'
  ) {
    return { key: 'EDITED', label: 'Editado' };
  }

  return {
    key: report.status,
    label: REPORT_STATUS_LABELS[report.status] || report.status
  };
}

function ReportStatus({ report }: { report: ReportSummary }) {
  const status = reportStatus(report);
  return (
    <StatusPill
      status={status.key}
      label={status.label}
      toneMap={REPORT_STATUS_TONES}
      data-row-navigation-ignore="true"
    />
  );
}

function ReportFeedback({ report }: { report: ReportSummary }) {
  const clientRejections = clientRejectionReviews(report);
  const rejectionComments = new Set(
    clientRejections.map((review) => normalizeComment(review.comment))
  );
  const specialRejection = activeSpecialRejection(report);
  const specialRejectionComment = normalizeComment(specialRejection?.comment);
  const reviewNotes = normalizeComment(report.reviewNotes);
  const legacyRejectionComment =
    clientRejections.length &&
    reviewNotes &&
    !rejectionComments.has(reviewNotes)
      ? reviewNotes
      : '';
  const showReviewNote =
    reviewNotes &&
    !rejectionComments.has(reviewNotes) &&
    !legacyRejectionComment &&
    !isClientRejectionNote(report.reviewNotes);

  if (
    !clientRejections.length &&
    !specialRejectionComment &&
    !legacyRejectionComment &&
    !showReviewNote
  ) {
    return null;
  }

  return (
    <div className="rdo-manager-listing__feedback">
      {clientRejections.map((review, index) => {
        const author = clientReviewAuthor(review);
        const date = formatReviewDate(review.createdAt);

        return (
          <p
            className="rdo-manager-listing__feedback-note rdo-manager-listing__feedback-note--danger"
            key={review.id}
          >
            <strong>
              Reprovação do cliente{author ? ` ${author}` : ''}{' '}
              {date ? `- ${date}` : `#${index + 1}`}:
            </strong>{' '}
            {normalizeComment(review.comment) || 'Sem comentário'}
          </p>
        );
      })}

      {specialRejectionComment &&
      !rejectionComments.has(specialRejectionComment) ? (
        <p className="rdo-manager-listing__feedback-note rdo-manager-listing__feedback-note--danger">
          <strong>{`Reprovação do cliente${formatReviewDate(specialRejection?.createdAt) ? ` - ${formatReviewDate(specialRejection?.createdAt)}` : ''}:`}</strong>{' '}
          {specialRejectionComment}
        </p>
      ) : null}

      {legacyRejectionComment ? (
        <p className="rdo-manager-listing__feedback-note rdo-manager-listing__feedback-note--danger">
          <strong>Reprovação anterior:</strong> {legacyRejectionComment}
        </p>
      ) : null}

      {showReviewNote ? (
        <p
          className={`rdo-manager-listing__feedback-note rdo-manager-listing__feedback-note--${report.status === 'RETURNED' ? 'danger' : 'info'}`}
        >
          {report.reviewNotes}
        </p>
      ) : null}
    </div>
  );
}

function hasReportFeedback(report: ReportSummary) {
  const clientRejections = clientRejectionReviews(report);
  const rejectionComments = new Set(
    clientRejections.map((review) => normalizeComment(review.comment))
  );
  const specialRejectionComment = normalizeComment(
    activeSpecialRejection(report)?.comment
  );
  const reviewNotes = normalizeComment(report.reviewNotes);
  const legacyRejectionComment =
    clientRejections.length > 0 &&
    Boolean(reviewNotes) &&
    !rejectionComments.has(reviewNotes);
  const showReviewNote =
    Boolean(reviewNotes) &&
    !rejectionComments.has(reviewNotes) &&
    !legacyRejectionComment &&
    !isClientRejectionNote(report.reviewNotes);

  return (
    clientRejections.length > 0 ||
    Boolean(specialRejectionComment) ||
    legacyRejectionComment ||
    showReviewNote
  );
}

function ReportIdentity({
  report,
  projectLabel,
  onOpenReport
}: {
  report: ReportSummary;
  projectLabel: string;
  onOpenReport: (report: ReportSummary) => void;
}) {
  const label = fullReportLabel(report, projectLabel);

  return (
    <div className="rdo-manager-listing__identity">
      <span className="rdo-manager-listing__icon" aria-hidden="true">
        <AppIcon icon={DS_ICONS.fileText} size="md" />
      </span>
      <div className="rdo-manager-listing__identity-copy">
        <button
          className="rel-name rdo-manager-listing__report-link"
          type="button"
          onClick={() => onOpenReport(report)}
        >
          {label}
        </button>
        <SignatureProgress report={report} />
        <ReportFeedback report={report} />
      </div>
    </div>
  );
}

function ReportSummaryDetails({ report }: { report: ReportSummary }) {
  return (
    <dl className="rdo-manager-listing__metadata">
      <div>
        <dt>Responsável</dt>
        <dd>{ownerLabel(report)}</dd>
      </div>
      <div>
        <dt>Data</dt>
        <dd>{formatDateOnlyPtBr(report.reportDate, report.reportDate)}</dd>
      </div>
      <div>
        <dt>Serviços</dt>
        <dd>{servicesLabel(report)}</dd>
      </div>
      {hasWorkTimes(report) ? (
        <div>
          <dt>Horário</dt>
          <dd>{workTimesLabel(report)}</dd>
        </div>
      ) : null}
    </dl>
  );
}

export function ManagerReportListing({
  reports,
  selectedReportIds,
  onSelectionChange,
  onOpenReport,
  renderActions,
  reportType,
  projectLabel,
  sortDirection,
  onSortChange,
  selectable = true,
  layout = 'responsive'
}: ManagerReportListingProps) {
  const ariaLabel = `Relatórios ${reportType} do projeto ${projectLabel}`;
  const visibleReportIds = new Set(reports.map((report) => report.id));
  const selectedVisibleIds = selectedReportIds.filter((id) =>
    visibleReportIds.has(id)
  );
  const columns: readonly DataTableColumn<ReportSummary>[] = [
    {
      key: 'report',
      header: 'Relatório',
      rowHeader: true,
      sortable: true,
      sortLabel:
        sortDirection === 'asc'
          ? 'Ordenar relatórios em ordem decrescente'
          : 'Ordenar relatórios em ordem crescente',
      render: (report) => (
        <ReportIdentity
          report={report}
          projectLabel={projectLabel}
          onOpenReport={onOpenReport}
        />
      )
    },
    {
      key: 'details',
      header: 'Informações',
      render: (report) => <ReportSummaryDetails report={report} />
    },
    {
      key: 'status',
      header: 'Status',
      render: (report) => <ReportStatus report={report} />
    }
  ];

  function handleRowClick(event: ReactMouseEvent<HTMLDivElement>) {
    if (event.defaultPrevented || !(event.target instanceof Element)) return;
    if (
      event.target.closest(
        'a, button, input, select, textarea, label, [role="button"], [role="link"], [contenteditable="true"], [data-row-navigation-ignore]'
      )
    ) {
      return;
    }

    const tableCell = event.target.closest('td, th');
    if (
      tableCell?.matches('.fv-data-table__selection') ||
      tableCell?.querySelector('[data-row-navigation-ignore]') ||
      event.target.closest('.fv-mobile-list__status, .fv-mobile-list__actions')
    ) {
      return;
    }

    const row = event.target.closest<HTMLElement>('[data-row-id]');
    if (!row || !event.currentTarget.contains(row)) return;
    const report = reports.find((item) => item.id === row.dataset.rowId);
    if (report) onOpenReport(report);
  }

  return (
    <>
      <DataTable<ReportSummary>
        className="rdo-manager-listing"
        onClick={handleRowClick}
        rows={reports}
        columns={columns}
        getRowId={(report) => report.id}
        getRowClassName={() => 'rel-item rdo-manager-listing__row'}
        ariaLabel={ariaLabel}
        density="comfortable"
        mobileBreakpoint="xl"
        layout={layout}
        sort={{ key: 'report', direction: sortDirection }}
        onSortChange={onSortChange}
        selection={selectable ? {
          selectedRowIds: selectedVisibleIds,
          onSelectionChange: (rowIds) => {
            const selectedOutsideGroup = selectedReportIds.filter(
              (id) => !visibleReportIds.has(id)
            );
            onSelectionChange([
              ...selectedOutsideGroup,
              ...rowIds.map((rowId) => String(rowId))
            ]);
          },
          getRowLabel: (report) => fullReportLabel(report, projectLabel),
          label: `relatórios ${reportType}`,
          controlClassName: 'report-select-checkbox',
          showSelectAll: false
        } : undefined}
        rowActions={(report) => (
          <div
            className="rdo-manager-listing__actions"
            data-row-navigation-ignore="true"
          >
            {renderActions(report)}
          </div>
        )}
        mobile={{
          ariaLabel,
          renderItem: (report) => {
            const hasSignatureProgress = Boolean(
              reportSignatureProgress(report)
            );
            const hasFeedback = hasReportFeedback(report);

            return {
              title: (
                <span className="rdo-manager-listing__mobile-title">
                  <AppIcon icon={DS_ICONS.fileText} size="md" />
                  <span className="rel-name">{reportLabel(report)}</span>
                </span>
              ),
              subtitle: ownerLabel(report),
              status: <ReportStatus report={report} />,
              metadata: [
                {
                  label: 'Data',
                  value: formatDateOnlyPtBr(
                    report.reportDate,
                    report.reportDate
                  )
                },
                { label: 'Serviços', value: mobileServicesLabel(report) },
                ...(hasWorkTimes(report)
                  ? [{ label: 'Horário', value: workTimesLabel(report) }]
                  : [])
              ],
              value: hasSignatureProgress ? (
                <div className="rdo-manager-listing__mobile-feedback">
                  <SignatureProgress report={report} />
                </div>
              ) : undefined,
              actions: (
                <div
                  className="rdo-manager-listing__actions"
                  data-row-navigation-ignore="true"
                >
                  {renderActions(report)}
                </div>
              ),
              details: hasFeedback ? (
                <div className="rdo-manager-listing__mobile-feedback">
                  <ReportFeedback report={report} />
                </div>
              ) : undefined,
              onClick: () => onOpenReport(report),
              accessibleLabel: `Abrir ${fullReportLabel(report, projectLabel)}`
            };
          }
        }}
        actionsLabel="Ações"
      />
    </>
  );
}
