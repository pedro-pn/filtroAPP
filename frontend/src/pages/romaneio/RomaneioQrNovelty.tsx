import { useEffect, useRef } from 'react';
import { driver } from 'driver.js';
import type { DriveStep } from 'driver.js';
import 'driver.js/dist/driver.css';

import {
  markRomaneioQrNoveltySeen,
  shouldShowRomaneioQrNovelty
} from '../../auth/moduleNavigation';
import type { AuthUser } from '../../types/auth';

const EQUIPMENT_TAB_SELECTOR = '[data-romaneio-equipment-tab]';
const CATEGORY_QR_TRIGGER_SELECTOR = '[data-romaneio-category-qr-trigger]';
const QR_LABEL_TRIGGER_SELECTOR = '[data-romaneio-qr-label-trigger]';
const CREATE_ROMANEIO_SELECTOR = '[data-romaneio-create-trigger]';
const QR_SCANNER_SELECTOR = '[data-romaneio-qr-scanner-trigger]';

interface RomaneioQrNoveltyProps {
  user?: Pick<AuthUser, 'id'> | null;
  enabled: boolean;
  variant: 'overview' | 'form';
  hasQrLabelTarget?: boolean;
  onShowQrLabels?: () => void;
}

export function RomaneioQrNovelty({
  user,
  enabled,
  variant,
  hasQrLabelTarget = false,
  onShowQrLabels
}: RomaneioQrNoveltyProps) {
  const started = useRef(false);
  const onShowQrLabelsRef = useRef(onShowQrLabels);
  onShowQrLabelsRef.current = onShowQrLabels;
  const userId = user?.id ?? '';

  useEffect(() => {
    if (!enabled || !userId || started.current) return undefined;
    const noveltyUser = { id: userId };
    if (!shouldShowRomaneioQrNovelty(noveltyUser)) return undefined;

    let cancelled = false;
    let retryTimer: number | undefined;
    const startWhenReady = (attempt = 0) => {
      if (cancelled || started.current) return;
      if (document.body.classList.contains('driver-active')) {
        if (attempt < 20) retryTimer = window.setTimeout(() => startWhenReady(attempt + 1), 500);
        return;
      }

      const requiredSelector = variant === 'form' ? QR_SCANNER_SELECTOR : EQUIPMENT_TAB_SELECTOR;
      if (!document.querySelector(requiredSelector)) {
        if (attempt < 20) retryTimer = window.setTimeout(() => startWhenReady(attempt + 1), 500);
        return;
      }

      const steps: DriveStep[] = [
        {
          popover: {
            title: '✨ Novidade: QR codes no romaneio',
            description: 'Agora você pode baixar ou imprimir etiquetas com QR code, inclusive uma categoria inteira de uma vez, e adicionar equipamentos ao romaneio usando a câmera do celular.'
          }
        }
      ];

      if (variant === 'overview') {
        steps.push({
          element: EQUIPMENT_TAB_SELECTOR,
          popover: {
            title: 'Gere as etiquetas',
            description: 'Na aba Equipamentos, cada item pode gerar etiquetas horizontais em três tamanhos. Você também pode combinar vários tamanhos na mesma folha A4.',
            side: 'bottom',
            align: 'start',
            onNextClick: (_element, _step, { driver: driverObj }) => {
              onShowQrLabelsRef.current?.();
              window.setTimeout(() => driverObj.moveNext(), 250);
            }
          }
        });

        if (hasQrLabelTarget) {
          steps.push({
            element: CATEGORY_QR_TRIGGER_SELECTOR,
            popover: {
              title: 'Baixe uma categoria inteira',
              description: 'Use este botão para gerar os QR codes de todos os equipamentos da categoria. Escolha um ou mais tamanhos e salve tudo em um único PDF ou envie para a impressora.',
              side: 'left',
              align: 'center'
            }
          });

          steps.push({
            element: QR_LABEL_TRIGGER_SELECTOR,
            popover: {
              title: 'Imprima e cole no equipamento',
              description: 'Use o botão QR code, escolha os tamanhos desejados e imprima a folha. A etiqueta já inclui logo, código e identificação do equipamento.',
              side: 'left',
              align: 'center'
            }
          });
        }

        steps.push({
          element: CREATE_ROMANEIO_SELECTOR,
          popover: {
            title: 'Escaneie durante o preenchimento',
            description: 'Ao criar um romaneio de saída, use “Escanear QR code”. Equipamentos unitários entram diretamente; conexões e itens variáveis pedem somente a quantidade.',
            side: 'bottom',
            align: 'end'
          }
        });
      } else {
        steps.push({
          element: QR_SCANNER_SELECTOR,
          popover: {
            title: 'Escaneie e adicione',
            description: 'Abra a câmera e aponte para a etiqueta. Equipamentos unitários entram diretamente; conexões e itens variáveis pedem somente a quantidade.',
            side: 'bottom',
            align: 'end'
          }
        });
      }

      started.current = true;
      markRomaneioQrNoveltySeen(noveltyUser);
      driver({
        showProgress: true,
        progressText: '{{current}} de {{total}}',
        nextBtnText: 'Próximo →',
        prevBtnText: '← Voltar',
        doneBtnText: 'Entendi',
        allowClose: true,
        animate: true,
        smoothScroll: true,
        overlayOpacity: 0.6,
        steps
      }).drive();
    };

    const timer = window.setTimeout(startWhenReady, 700);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
    };
  }, [enabled, hasQrLabelTarget, userId, variant]);

  return null;
}
