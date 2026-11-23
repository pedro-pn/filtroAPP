import { useState } from 'react';

import { AppIcon } from '../icons/AppIcon';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/ds';
import type { DS_ICONS } from '../ui/ds/icons';
import { serviceTypeLabels } from './serviceTypes';
import { normalizeServiceType } from '../../utils/reportServicePayload';
import { isPendingServiceFromLaterDay, serviceEquipmentLabel, type PendingProjectService } from '../../utils/ongoingServices';
import { formatDateOnlyPtBr } from '../../utils/dateOnly';

export interface RdoServiceTypeOption {
  type: string;
  icon: (typeof DS_ICONS)[keyof typeof DS_ICONS];
  name: string;
}

export type RdoServicePromptMode = 'ongoing' | 'types';

interface RdoServicePromptModalProps {
  open: boolean;
  initialMode: RdoServicePromptMode;
  // Aberto automaticamente ao entrar na etapa Serviços: mostra a explicação e a saída
  // "Não houve serviço hoje". Aberto pelo botão "Adicionar serviço", é só o seletor.
  prompted: boolean;
  pendingItems: PendingProjectService[];
  reportDate: string;
  serviceOptions: readonly RdoServiceTypeOption[];
  onClose: () => void;
  onContinue: (items: PendingProjectService[]) => void;
  onPickType: (type: string) => void;
  // Ausente no modo "Somente serviço", em que um serviço é obrigatório.
  onNoService?: () => void;
}

// Seletor de serviço do RDO. No modo "ongoing" lista os serviços em andamento do projeto para o
// usuário escolher quais continuar, ou partir para um serviço novo; no modo "types" é a grade
// de tipos de serviço. O componente é remontado (via `key`) a cada abertura, então o modo e a
// seleção começam sempre do estado inicial.
export function RdoServicePromptModal({
  open,
  initialMode,
  prompted,
  pendingItems,
  reportDate,
  serviceOptions,
  onClose,
  onContinue,
  onPickType,
  onNoService
}: RdoServicePromptModalProps) {
  const [mode, setMode] = useState<RdoServicePromptMode>(initialMode === 'ongoing' && pendingItems.length ? 'ongoing' : 'types');
  // Nada vem marcado: o usuário confirma explicitamente cada serviço que a equipe continuou hoje.
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(() => new Set());
  const selectedItems = pendingItems.filter(item => selectedKeys.has(item.key));
  const canGoBackToOngoing = initialMode === 'ongoing' && pendingItems.length > 0;

  function toggle(key: string) {
    setSelectedKeys(current => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  // Saída explícita para dias sem serviço técnico (standby, mobilização, só montagem...). Fica no
  // corpo, abaixo das opções, para não competir com as ações principais do rodapé.
  const noServiceNote = prompted && onNoService ? (
    <p className="rdo-service-prompt__no-service">
      Hoje a equipe não executou nenhum serviço técnico?{' '}
      <Button variant="link" type="button" onClick={onNoService}>
        Não houve serviço hoje
      </Button>
    </p>
  ) : null;

  if (mode === 'ongoing') {
    return (
      <Modal
        open={open}
        onClose={onClose}
        appearance="design-system"
        title="Serviços em andamento"
        size="md"
        fullscreenOnMobile={false}
        backdropClassName="rdo-service-picker-backdrop"
        panelClassName="rdo-service-picker rdo-service-prompt"
        footer={(
          <div className="rdo-service-prompt__footer">
            <Button variant="secondary" type="button" onClick={() => setMode('types')}>
              Iniciar outro serviço
            </Button>
            <Button
              variant="primary"
              type="button"
              disabled={!selectedItems.length}
              onClick={() => onContinue(selectedItems)}
            >
              {selectedItems.length > 1 ? `Continuar ${selectedItems.length} serviços` : 'Continuar serviço'}
            </Button>
          </div>
        )}
      >
        <p className="rdo-service-prompt__intro">
          {pendingItems.length > 1
            ? `Este projeto tem ${pendingItems.length} serviços que ainda não foram finalizados. A equipe continuou algum deles hoje?`
            : 'Este projeto tem um serviço que ainda não foi finalizado. A equipe continuou esse serviço hoje?'}
        </p>
        <div className="rdo-service-prompt__list" role="group" aria-label="Serviços em andamento">
          {pendingItems.map(item => {
            const { key, report, service, startedReport } = item;
            const type = normalizeServiceType(service.serviceType);
            const equipment = serviceEquipmentLabel(service) || 'Equipamento não informado';
            const system = service.system || String((service.extraData || {}).Sistema || '');
            const startedLater = isPendingServiceFromLaterDay(item, reportDate);
            const checked = selectedKeys.has(key);
            return (
              <label key={key} className={`rdo-service-prompt__item${checked ? ' is-selected' : ''}`}>
                <input type="checkbox" checked={checked} onChange={() => toggle(key)} />
                <span className="rdo-service-prompt__item-main">
                  <span className="rdo-service-prompt__item-title">{serviceTypeLabels[type] || type}</span>
                  <span className="rdo-service-prompt__item-sub">
                    {equipment}{system ? ` · ${system}` : ''}
                  </span>
                  <span className="rdo-service-prompt__item-meta">
                    {startedLater
                      ? `Iniciado em dia posterior: ${formatDateOnlyPtBr(startedReport.reportDate)} (RDO ${startedReport.sequenceNumber || '---'})`
                      : `Iniciado em ${formatDateOnlyPtBr(startedReport.reportDate)} · último registro no RDO ${report.sequenceNumber || '---'}`}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
        {noServiceNote}
      </Modal>
    );
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      appearance="design-system"
      title={prompted ? 'Qual serviço foi executado hoje?' : 'Tipo de serviço'}
      size="md"
      fullscreenOnMobile={false}
      closeOnBackdrop={!prompted}
      backdropClassName="rdo-service-picker-backdrop"
      panelClassName="rdo-service-picker rdo-service-prompt"
      footer={canGoBackToOngoing ? (
        <div className="rdo-service-prompt__footer">
          <Button variant="secondary" type="button" onClick={() => setMode('ongoing')}>
            Voltar aos serviços em andamento
          </Button>
        </div>
      ) : undefined}
    >
      {prompted ? (
        <p className="rdo-service-prompt__intro">
          Cada serviço gera o próprio relatório técnico (medições, gráficos e fotos) enviado ao cliente.
          Escrever apenas em "Atividades do dia" não substitui o registro do serviço.
        </p>
      ) : null}
      <div className="stype-grid">
        {serviceOptions.map(({ type, icon, name }) => (
          <button key={type} className="stype-btn" type="button" onClick={() => onPickType(type)}>
            <div className="stype-icon"><AppIcon icon={icon} /></div>
            <div className="stype-name">{name}</div>
          </button>
        ))}
      </div>
      {noServiceNote}
    </Modal>
  );
}
