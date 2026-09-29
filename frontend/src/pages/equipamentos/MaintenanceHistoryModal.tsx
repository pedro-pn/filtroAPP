import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { getEquipmentMaintenanceHistory } from '../../api/equipamentos';
import {
  downloadMaintenanceAttachment,
  type MaintenanceAttachment
} from '../../api/operationalReports';
import { Modal } from '../../components/ui/Modal';
import { Skeleton } from '../../components/ui/Skeleton';
import { useToast } from '../../components/ui/ToastContext';
import { Alert, Button, EmptyState } from '../../components/ui/ds';

interface MaintenanceHistoryModalProps {
  equipmentId: string | null;
  onClose: () => void;
}

function dateLabel(value: string) {
  return new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC' }).format(
    new Date(`${value.slice(0, 10)}T00:00:00Z`)
  );
}

export function MaintenanceHistoryModal({
  equipmentId,
  onClose
}: MaintenanceHistoryModalProps) {
  const showToast = useToast();
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const historyQuery = useQuery({
    queryKey: ['equipamentos', 'maintenance-history', equipmentId],
    queryFn: () => getEquipmentMaintenanceHistory(equipmentId!),
    enabled: Boolean(equipmentId)
  });

  async function handleDownload(
    maintenanceId: string,
    document: MaintenanceAttachment
  ) {
    setDownloadingId(maintenanceId);
    try {
      await downloadMaintenanceAttachment(document);
      showToast('PDF da manutenção baixado.', 'success');
    } catch (error) {
      showToast(
        error instanceof Error
          ? error.message
          : 'Não foi possível baixar o PDF da manutenção.',
        'error'
      );
    } finally {
      setDownloadingId(null);
    }
  }

  return (
    <Modal
      open={Boolean(equipmentId)}
      onClose={onClose}
      appearance="design-system"
      title="Histórico de manutenção"
      size="lg"
      panelClassName="equip-maintenance-history-modal"
    >
      {historyQuery.data ? (
        <p className="equip-history-equipment">
          {historyQuery.data.equipment.code} — {historyQuery.data.equipment.name}
        </p>
      ) : null}
      {historyQuery.isLoading ? <Skeleton lines={5} /> : null}
      {historyQuery.isError ? (
        <Alert tone="danger">Não foi possível carregar o histórico.</Alert>
      ) : null}
      {historyQuery.data?.items.map((item) => (
        <article className="equip-maintenance-history-item" key={item.id}>
          <div className="equip-maintenance-history-item__head">
            <div>
              <strong>{dateLabel(item.maintenanceDate)}</strong>
              <div className="form-hint">{item.profileName}</div>
            </div>
            {item.document ? (
              <Button
                variant="secondary"
                size="sm"
                loading={downloadingId === item.id}
                onClick={() => void handleDownload(item.id, item.document!)}
              >
                {downloadingId === item.id ? 'Baixando…' : 'Baixar PDF'}
              </Button>
            ) : null}
          </div>
          <div>Responsável: {item.responsibleName}</div>
          <ol>
            {item.selectedServices.map((service) => (
              <li key={`${service.order}-${service.label}`}>{service.label}</li>
            ))}
          </ol>
          {item.observations ? (
            <p>
              <strong>Observações:</strong> {item.observations}
            </p>
          ) : null}
          {item.thirdPartyServices.length ? (
            <ul>
              {item.thirdPartyServices.map((service) => (
                <li key={service.id}>
                  {dateLabel(service.serviceDate)} · {service.location} ·{' '}
                  {service.description}
                </li>
              ))}
            </ul>
          ) : null}
          <div className="form-hint">Supervisor: {item.supervisorName}</div>
        </article>
      ))}
      {historyQuery.data && !historyQuery.data.items.length ? (
        <EmptyState variant="default" title="Nenhuma manutenção aprovada" description="O histórico deste equipamento aparecerá aqui quando houver uma manutenção aprovada." />
      ) : null}
    </Modal>
  );
}
