import type { MouseEvent as ReactMouseEvent } from 'react';

import type { MaintenanceRecord, OperationalReport, OperationalStatus } from '../../api/operationalReports';
import { formatDateOnlyPtBr } from '../../utils/dateOnly';
import { AppIcon } from '../icons/AppIcon';
import { DataTable, StatusPill, type DataTableColumn } from '../ui/ds';
import { DS_ICONS } from '../ui/ds/icons';
import './MaintenanceReportListing.css';

type MaintenanceItem =
  | { kind: 'report'; report: OperationalReport }
  | { kind: 'standalone'; record: MaintenanceRecord };

const statusLabels: Record<OperationalStatus, string> = {
  PENDING: 'Pendente',
  APPROVED: 'Aprovado',
  RETURNED: 'Devolvido'
};

function itemId(item: MaintenanceItem) {
  return item.kind === 'report' ? `report-${item.report.id}` : `standalone-${item.record.id}`;
}

function itemTitle(item: MaintenanceItem) {
  return item.kind === 'report'
    ? `Manutenção Nº ${item.report.sequenceNumber}`
    : `Manutenção avulsa · ${item.record.equipment.code}`;
}

function itemSubtitle(item: MaintenanceItem) {
  return item.kind === 'report'
    ? `${item.report.project.code} · ${item.report.project.name}`
    : item.record.equipment.name;
}

function itemDate(item: MaintenanceItem) {
  const date = item.kind === 'report' ? item.report.reportDate : item.record.maintenanceDate;
  return formatDateOnlyPtBr(date, date);
}

function itemOwner(item: MaintenanceItem) {
  return item.kind === 'report' ? item.report.createdBy.name : item.record.responsibleNameSnapshot;
}

function itemActivities(item: MaintenanceItem) {
  if (item.kind === 'report') {
    const count = item.report.maintenanceRecords.length;
    return `${count} ${count === 1 ? 'manutenção' : 'manutenções'}`;
  }
  const count = item.record.selectedServices.length;
  return `${count} ${count === 1 ? 'serviço' : 'serviços'}`;
}

function itemTime(item: MaintenanceItem) {
  if (item.kind !== 'report') return null;
  return `${item.report.arrivalTime} às ${item.report.departureTime}`;
}

function ItemStatus({ item }: { item: MaintenanceItem }) {
  const status = item.kind === 'report' ? item.report.status : item.record.status;
  return <StatusPill
    status={status}
    label={statusLabels[status]}
    toneMap={{ pending: 'warning', approved: 'success', returned: 'danger' }}
  />;
}

export function MaintenanceReportListing({
  reports,
  standalone,
  onOpenReport,
  onOpenStandalone
}: {
  reports: readonly OperationalReport[];
  standalone: readonly MaintenanceRecord[];
  onOpenReport: (report: OperationalReport) => void;
  onOpenStandalone: (record: MaintenanceRecord) => void;
}) {
  const items: MaintenanceItem[] = [
    ...reports.map(report => ({ kind: 'report' as const, report })),
    ...standalone.map(record => ({ kind: 'standalone' as const, record }))
  ];

  function openItem(item: MaintenanceItem) {
    if (item.kind === 'report') onOpenReport(item.report);
    else onOpenStandalone(item.record);
  }

  function handleRowClick(event: ReactMouseEvent<HTMLDivElement>) {
    if (!(event.target instanceof Element)) return;
    if (event.target.closest('button, a, input, select, textarea, [role="button"]')) return;
    const rowId = event.target.closest<HTMLElement>('[data-row-id]')?.dataset.rowId;
    const item = items.find(candidate => itemId(candidate) === rowId);
    if (item) openItem(item);
  }

  const columns: readonly DataTableColumn<MaintenanceItem>[] = [
    {
      key: 'report',
      header: 'Relatório',
      rowHeader: true,
      render: item => <div className="maintenance-listing__identity">
        <span className="maintenance-listing__icon" aria-hidden="true"><AppIcon icon={DS_ICONS.fileText} size="md" /></span>
        <span className="maintenance-listing__identity-copy">
          <button type="button" className="maintenance-listing__link" onClick={() => openItem(item)}>{itemTitle(item)}</button>
          <span>{itemSubtitle(item)}</span>
          {itemTime(item) ? <span>{itemTime(item)}</span> : null}
        </span>
      </div>
    },
    { key: 'owner', header: 'Responsável', render: item => itemOwner(item) },
    { key: 'date', header: 'Data', render: item => itemDate(item) },
    { key: 'activities', header: 'Atividades', render: item => itemActivities(item) },
    { key: 'status', header: 'Status', render: item => <ItemStatus item={item} /> }
  ];

  return <DataTable
    className="maintenance-report-listing"
    ariaLabel="Relatórios de manutenção"
    rows={items}
    columns={columns}
    getRowId={itemId}
    density="comfortable"
    mobileBreakpoint="xl"
    onClick={handleRowClick}
    mobile={{
      ariaLabel: 'Relatórios de manutenção',
      renderItem: item => ({
        title: itemTitle(item),
        subtitle: itemSubtitle(item),
        status: <ItemStatus item={item} />,
        metadata: [
          { label: 'Responsável', value: itemOwner(item) },
          { label: 'Data', value: itemDate(item) },
          { label: 'Atividades', value: itemActivities(item) },
          ...(itemTime(item) ? [{ label: 'Horário', value: itemTime(item) }] : [])
        ],
        onClick: () => openItem(item),
        accessibleLabel: `Abrir ${itemTitle(item)}`
      })
    }}
  />;
}
