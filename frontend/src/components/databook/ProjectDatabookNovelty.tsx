import { useEffect, useRef } from 'react';
import { driver } from 'driver.js';
import 'driver.js/dist/driver.css';

import type { AuthUser } from '../../types/auth';
import { deveMostrarNovidadeDatabook, marcarNovidadeDatabookVista } from '../../utils/databook';

const BOTAO = '[data-databook-button]:not([disabled])';

interface ProjectDatabookNoveltyProps {
  user?: Pick<AuthUser, 'id' | 'moduleRoles'> | null;
}

/** Novidade temporária do Data Book para gestor e coordenador do RDO, apontando o botão real. */
export function ProjectDatabookNovelty({ user }: ProjectDatabookNoveltyProps) {
  const iniciado = useRef(false);
  const userId = user?.id ?? '';
  const publico = Boolean(user?.moduleRoles?.some(role => role === 'rdo:manager' || role === 'rdo:coordinator'));

  useEffect(() => {
    if (!publico || !userId || iniciado.current || !deveMostrarNovidadeDatabook(userId)) return undefined;
    let cancelado = false;
    let timer: number | undefined;
    const iniciarQuandoPronto = (tentativa = 0) => {
      if (cancelado) return;
      const botao = document.querySelector(BOTAO);
      if (document.body.classList.contains('driver-active') || !botao) {
        if (tentativa < 40) timer = window.setTimeout(() => iniciarQuandoPronto(tentativa + 1), 750);
        return;
      }
      if (!deveMostrarNovidadeDatabook(userId)) return;
      iniciado.current = true;
      marcarNovidadeDatabookVista(userId);
      driver({
        showProgress: true,
        nextBtnText: 'Próximo',
        prevBtnText: 'Voltar',
        doneBtnText: 'Entendi',
        allowClose: true,
        animate: true,
        smoothScroll: true,
        overlayOpacity: 0.6,
        steps: [
          {
            popover: {
              title: '✨ Data Book do projeto',
              description: 'Agora o app monta o Data Book em PDF com RDOs, RLQ, RCPU, RTP, RLM, fotos, FDS e certificados de calibração, no layout aprovado.'
            }
          },
          {
            element: BOTAO,
            popover: {
              title: 'Gerar Data Book',
              description: 'Escolha o intervalo de dias, revise os textos, responsáveis e anexos e gere. O PDF fica salvo no projeto com o histórico de revisões.',
              side: 'left',
              align: 'start'
            }
          }
        ]
      }).drive();
    };
    iniciarQuandoPronto();
    return () => {
      cancelado = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [publico, userId]);

  return null;
}
