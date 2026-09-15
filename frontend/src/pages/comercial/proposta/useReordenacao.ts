import { useEffect, useRef, useState, type DragEvent, type PointerEvent } from 'react';

import {
  createPointerDragGhost,
  movePointerDragGhost,
  reorderIdFromPoint,
  setReorderDragImage,
  type PointerDragState
} from '../../../utils/reorderDrag';
import {
  comecarArrasto,
  encerrarArrasto,
  moverNoArrasto,
  type SessaoDeArrasto
} from './sessaoDeArrasto';

/**
 * Arrastar para reordenar — a L2, aplicada às listas do módulo (T068–T071).
 *
 * `utils/reorderDrag.ts` foi auditado na T001 e **aprovado sem dívida**
 * ([auditoria-reorder.md](../../../../../specs/009-modulo-comercial/contracts/auditoria-reorder.md)),
 * mas ele é um kit, não o padrão pronto: a auditoria lista **três peças que ele
 * não dá** — alça com `aria-label`, placeholder e cancelamento que restaura.
 * Este hook é essas três peças, montadas uma vez.
 *
 * **Uma vez para todas**, porque o módulo tem listas reordenáveis de itens do
 * escopo, responsabilidades, serviços técnicos e blocos de conteúdo. O `QualityNaturesTab`, que
 * é o uso mais maduro do repositório, monta tudo inline em ~90 linhas; repetir
 * isso três vezes garantiria que as três divergissem, e a que divergisse em
 * silêncio seria o cancelamento, que ninguém exercita sem querer.
 *
 * **O cancelamento restaura a ordem do início do arrasto**, não a do servidor.
 * É a diferença entre este hook e o do Qualidade: lá a lista tem origem remota;
 * aqui ela é o formulário que o vendedor está montando, e "restaurar" só pode
 * significar desfazer este arrasto.
 *
 * Trata **`Escape` além de `pointercancel`**, o que a auditoria pediu
 * explicitamente: quem usa as setas ↑/↓ — que continuam ali, desvio nº 6 — é
 * quem mais provavelmente vai tentar `Escape` no meio de um arrasto.
 */

const CLASSE_DO_FANTASMA = 'app-reorder-touch-ghost';
const CLASSE_ARRASTANDO = 'app-reorder-touching';

type Opcoes<T> = {
  itens: T[];
  /** Aplica a nova ordem. Chamada **durante** o arrasto: a lista se move ao vivo. */
  aoReordenar: (proximos: T[]) => void;
  idDe: (item: T) => string;
  /** Seletor da linha, para achar o alvo sob o ponteiro. Ex.: `.com-escopo-card`. */
  seletorDaLinha: string;
  /** Desliga o arrasto sem esconder a alça — lista de um item só, por exemplo. */
  desligado?: boolean;
};

export function useReordenacao<T>({
  itens,
  aoReordenar,
  idDe,
  seletorDaLinha,
  desligado = false
}: Opcoes<T>) {
  const [idArrastado, setIdArrastado] = useState<string | null>(null);
  const [idSobreposto, setIdSobreposto] = useState<string | null>(null);

  // Refs, não estado: os handlers de arrasto leem estes valores dentro de
  // eventos que acontecem entre renders, e estado leria o valor do render que
  // registrou o handler — a lista se moveria uma posição atrás do ponteiro.
  const itensRef = useRef(itens);
  itensRef.current = itens;

  const sessao = useRef<SessaoDeArrasto<T> | null>(null);
  const soltou = useRef(false);
  const ponteiro = useRef<PointerDragState | null>(null);

  function limpar() {
    setIdArrastado(null);
    setIdSobreposto(null);
    sessao.current = null;
  }

  /** Desfaz o arrasto inteiro. É o cancelamento que a constitution exige. */
  function restaurar() {
    const anterior = encerrarArrasto(sessao.current, itensRef.current, false);
    if (anterior !== itensRef.current) aoReordenar(anterior);
    limpar();
  }

  function comecar(id: string) {
    sessao.current = comecarArrasto(itensRef.current, id);
    setIdArrastado(id);
    soltou.current = false;
  }

  function moverPara(alvo: string) {
    if (!sessao.current || desligado) return;
    setIdSobreposto(alvo);
    const proximos = moverNoArrasto(sessao.current, itensRef.current, alvo, idDe);
    if (proximos !== itensRef.current) aoReordenar(proximos);
  }

  // `Escape` no meio do arrasto. Registrado só enquanto há arrasto: um listener
  // permanente no documento capturaria o Escape de qualquer diálogo da tela.
  useEffect(() => {
    if (!idArrastado) return;
    const aoTeclar = (evento: KeyboardEvent) => {
      if (evento.key !== 'Escape') return;
      evento.preventDefault();
      soltou.current = true; // impede o `dragend` de restaurar de novo
      restaurar();
      ponteiro.current?.ghost.remove();
      ponteiro.current = null;
      document.body.classList.remove(CLASSE_ARRASTANDO);
    };
    document.addEventListener('keydown', aoTeclar);
    return () => document.removeEventListener('keydown', aoTeclar);
    // `restaurar` fecha sobre refs, que não mudam de identidade entre renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idArrastado]);

  /** Props da LINHA: o alvo do arrasto e o endereço que o ponteiro procura. */
  function propsDaLinha(id: string) {
    return {
      'data-reorder-id': id,
      onDragOver: (evento: DragEvent<HTMLElement>) => {
        if (desligado || !sessao.current) return;
        evento.preventDefault();
        moverPara(id);
      },
      onDrop: (evento: DragEvent<HTMLElement>) => {
        evento.preventDefault();
        soltou.current = true;
        // A ordem já está aplicada — o arrasto a foi movendo. Soltar só encerra.
        limpar();
      }
    };
  }

  /**
   * Props da ALÇA. O `aria-label` descreve **o quê** se move, não "arrastar":
   * um leitor de tela anunciando seis alças iguais não diz qual é qual.
   */
  function propsDaAlca(id: string, rotulo: string) {
    return {
      draggable: !desligado,
      'aria-label': `Arrastar ${rotulo} para reordenar`,
      title: 'Arraste para reordenar',
      onDragStart: (evento: DragEvent<HTMLElement>) => {
        if (desligado) {
          evento.preventDefault();
          return;
        }
        evento.dataTransfer.effectAllowed = 'move';
        // Firefox não inicia o arrasto sem dado no `dataTransfer`.
        evento.dataTransfer.setData('text/plain', id);
        setReorderDragImage(evento, seletorDaLinha, CLASSE_DO_FANTASMA);
        comecar(id);
      },
      onDragEnd: () => {
        // Soltar fora de qualquer linha é cancelamento: `drop` não acontece.
        if (!soltou.current) restaurar();
        else limpar();
        soltou.current = false;
      },
      onPointerDown: (evento: PointerEvent<HTMLElement>) => {
        // Mouse continua no arrasto nativo, que já traz a imagem de arraste.
        // Este caminho é o do toque (T069) — e é o único que existe no celular.
        if (evento.pointerType === 'mouse' || desligado) return;
        const linha = evento.currentTarget.closest(seletorDaLinha);
        if (!(linha instanceof HTMLElement)) return;

        evento.preventDefault();
        evento.currentTarget.setPointerCapture(evento.pointerId);
        comecar(id);
        document.body.classList.add(CLASSE_ARRASTANDO);

        const estado = createPointerDragGhost(
          linha,
          evento.clientX,
          evento.clientY,
          CLASSE_DO_FANTASMA
        );
        estado.pointerId = evento.pointerId;
        ponteiro.current = estado;
      },
      onPointerMove: (evento: PointerEvent<HTMLElement>) => {
        const estado = ponteiro.current;
        if (!estado || estado.pointerId !== evento.pointerId || !sessao.current) return;

        evento.preventDefault();
        movePointerDragGhost(estado, evento.clientX, evento.clientY);
        const alvo = reorderIdFromPoint(evento.clientX, evento.clientY, seletorDaLinha);
        if (alvo) moverPara(alvo);
      },
      onPointerUp: (evento: PointerEvent<HTMLElement>) => encerrarPonteiro(evento, true),
      onPointerCancel: (evento: PointerEvent<HTMLElement>) => encerrarPonteiro(evento, false)
    };
  }

  function encerrarPonteiro(evento: PointerEvent<HTMLElement>, manter: boolean) {
    const estado = ponteiro.current;
    if (!estado || estado.pointerId !== evento.pointerId) return;

    if (evento.currentTarget.hasPointerCapture(evento.pointerId)) {
      evento.currentTarget.releasePointerCapture(evento.pointerId);
    }
    estado.ghost.remove();
    ponteiro.current = null;
    document.body.classList.remove(CLASSE_ARRASTANDO);

    if (manter) limpar();
    else restaurar();
  }

  return {
    /** Para marcar a linha em movimento com `.drag-placeholder`. */
    idArrastado,
    /** Para destacar o destino enquanto o ponteiro passa por cima. */
    idSobreposto,
    propsDaLinha,
    propsDaAlca
  };
}
