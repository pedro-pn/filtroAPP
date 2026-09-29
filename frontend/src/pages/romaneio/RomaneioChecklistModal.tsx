import { useEffect, useMemo, useState } from 'react';

import type { RomaneioChecklistItemStatus } from '../../api/romaneio';
import { Modal } from '../../components/ui/Modal';

interface RomaneioChecklistModalProps {
  open: boolean;
  title: string;
  items: string[];
  statuses: Record<string, RomaneioChecklistItemStatus>;
  onClose: () => void;
  onSave: (statuses: Record<string, RomaneioChecklistItemStatus>) => void;
}

const DEFAULT_STATUS: RomaneioChecklistItemStatus = 'CONFORME';
const STATUS_OPTIONS: Array<{ value: RomaneioChecklistItemStatus; label: string }> = [
  { value: 'CONFORME', label: 'Conforme' },
  { value: 'NAO_CONFORME', label: 'Não conforme' },
  { value: 'NAO_APLICAVEL', label: 'Não aplicável' }
];

function normalizeStatus(value: RomaneioChecklistItemStatus | undefined): RomaneioChecklistItemStatus {
  if (value && STATUS_OPTIONS.some(option => option.value === value)) return value;
  return DEFAULT_STATUS;
}

function buildStatusMap(items: string[], statuses: Record<string, RomaneioChecklistItemStatus>) {
  return items.reduce<Record<string, RomaneioChecklistItemStatus>>((acc, item) => {
    acc[item] = normalizeStatus(statuses[item]);
    return acc;
  }, {});
}

export function RomaneioChecklistModal({
  open,
  title,
  items,
  statuses,
  onClose,
  onSave
}: RomaneioChecklistModalProps) {
  const [statusMap, setStatusMap] = useState<Record<string, RomaneioChecklistItemStatus>>(() => buildStatusMap(items, statuses));
  const total = items.length;
  const counts = useMemo(() => {
    return items.reduce<Record<RomaneioChecklistItemStatus, number>>((acc, item) => {
      const status = normalizeStatus(statusMap[item]);
      acc[status] += 1;
      return acc;
    }, { CONFORME: 0, NAO_CONFORME: 0, NAO_APLICAVEL: 0 });
  }, [items, statusMap]);

  useEffect(() => {
    if (open) setStatusMap(buildStatusMap(items, statuses));
  }, [items, statuses, open]);

  function setItemStatus(text: string, status: RomaneioChecklistItemStatus) {
    setStatusMap(current => ({ ...current, [text]: status }));
  }

  function save() {
    onSave(buildStatusMap(items, statusMap));
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      appearance="design-system"
      title={title}
      size="lg"
      panelClassName="romaneio-dialog"
    >
      <div className="romaneio-checklist-head">
        <div>
          <div className="rel-meta">
            {counts.CONFORME} conforme · {counts.NAO_CONFORME} não conforme · {counts.NAO_APLICAVEL} não aplicável · {total} ponto(s)
          </div>
        </div>
      </div>
      <div className="romaneio-checklist-body">
        {items.map(item => {
          const currentStatus = normalizeStatus(statusMap[item]);
          return (
            <div className="romaneio-checklist-item" key={item}>
              <span>{item}</span>
              <div className="romaneio-checklist-status-group" role="group" aria-label={`Status de ${item}`}>
                {STATUS_OPTIONS.map(option => (
                  <button
                    className={[
                      'romaneio-checklist-status',
                      `status-${option.value.toLowerCase().replace(/_/g, '-')}`,
                      currentStatus === option.value ? 'active' : ''
                    ].filter(Boolean).join(' ')}
                    key={option.value}
                    type="button"
                    aria-pressed={currentStatus === option.value}
                    onClick={() => setItemStatus(item, option.value)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <div className="romaneio-checklist-actions">
        <button className="secondary-button" type="button" onClick={onClose}>Cancelar</button>
        <button className="primary-button" type="button" onClick={save}>Salvar checklist</button>
      </div>
    </Modal>
  );
}
