import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { getEquipmentMaintenanceHistory } from '../../api/equipamentos';
import {
  downloadMaintenanceAttachment,
  type MaintenanceAttachment
} from '../../api/operationalReports';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { Skeleton } from '../../components/ui/Skeleton';
import { useToast } from '../../components/ui/ToastContext';

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
      ariaLabelledBy="equipment-maintenance-history-title"
      panelClassName="modal-card operational-history-modal"
    >
      <div className="operational-card-head">
        <div>
          <h2 id="equipment-maintenance-history-title">
            Histórico de manutenção
          </h2>
          {historyQuery.data ? (
            <div className="form-hint">
              {historyQuery.data.equipment.code} —{' '}
              {historyQuery.data.equipment.name}
            </div>
          ) : null}
        </div>
        <Button variant="mini" onClick={onClose}>
          Fechar
        </Button>
      </div>
      {historyQuery.isLoading ? <Skeleton lines={5} /> : null}
      {historyQuery.isError ? (
        <div className="inline-error">
          Não foi possível carregar o histórico.
        </div>
      ) : null}
      {historyQuery.data?.items.map((item) => (
        <article className="operational-history-card" key={item.id}>
          <div className="operational-card-head">
            <div>
              <strong>{dateLabel(item.maintenanceDate)}</strong>
              <div className="form-hint">{item.profileName}</div>
            </div>
            {item.document ? (
              <Button
                variant="mini"
                disabled={downloadingId === item.id}
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
        <p className="placeholder-copy">
          Nenhuma manutenção aprovada para este equipamento.
        </p>
      ) : null}
    </Modal>
  );
}
