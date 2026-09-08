import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

import type { SignatureField, SignatureSigner } from '../../../api/assinaturas';
import { clampNormalizedRect, normalizedToPercent } from '../utils/coordinates';

type Interaction = {
  index: number;
  mode: 'move' | 'resize';
  startX: number;
  startY: number;
  original: SignatureField;
};

type PendingPlacement = {
  x: number;
  y: number;
};

const DEFAULT_FIELD_RECT = { width: 0.2, height: 0.055 };

export function PdfPageCanvas({
  imageUrl,
  pageNumber,
  signers,
  fields,
  onFieldsChange
}: {
  imageUrl: string;
  pageNumber: number;
  signers: SignatureSigner[];
  fields: SignatureField[];
  onFieldsChange: (fields: SignatureField[]) => void;
}) {
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const [interaction, setInteraction] = useState<Interaction | null>(null);
  const [pendingPlacement, setPendingPlacement] = useState<PendingPlacement | null>(null);
  const pageFields = fields.map((field, index) => ({ field, index })).filter(item => item.field.pageNumber === pageNumber);

  useEffect(() => setPendingPlacement(null), [pageNumber]);

  function normalizedPointer(event: ReactPointerEvent) {
    const bounds = canvasRef.current?.getBoundingClientRect();
    if (!bounds) return { x: 0, y: 0 };
    return {
      x: (event.clientX - bounds.left) / bounds.width,
      y: (event.clientY - bounds.top) / bounds.height
    };
  }

  function begin(event: ReactPointerEvent, index: number, mode: Interaction['mode']) {
    event.stopPropagation();
    setPendingPlacement(null);
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = normalizedPointer(event);
    setInteraction({ index, mode, startX: point.x, startY: point.y, original: fields[index] });
  }

  function move(event: ReactPointerEvent) {
    if (!interaction) return;
    const point = normalizedPointer(event);
    const dx = point.x - interaction.startX;
    const dy = point.y - interaction.startY;
    const next = [...fields];
    next[interaction.index] = {
      ...interaction.original,
      ...clampNormalizedRect(interaction.mode === 'move' ? {
        x: interaction.original.x + dx,
        y: interaction.original.y + dy,
        width: interaction.original.width,
        height: interaction.original.height
      } : {
        x: interaction.original.x,
        y: interaction.original.y,
        width: interaction.original.width + dx,
        height: interaction.original.height + dy
      })
    };
    onFieldsChange(next);
  }

  function addField(signerId: string, point: PendingPlacement) {
    onFieldsChange([...fields, {
      signerId,
      pageNumber,
      ...clampNormalizedRect({ x: point.x, y: point.y, ...DEFAULT_FIELD_RECT })
    }]);
    setPendingPlacement(null);
  }

  function requestField(event: ReactPointerEvent<HTMLDivElement>) {
    if (interaction || event.target !== event.currentTarget || !signers.length) return;
    const point = normalizedPointer(event);
    if (signers.length === 1) {
      addField(signers[0].id, point);
      return;
    }
    setPendingPlacement(point);
  }

  function cancelInteraction() {
    if (!interaction) return;
    const next = [...fields];
    next[interaction.index] = interaction.original;
    setInteraction(null);
    onFieldsChange(next);
  }

  function keyboardMove(event: React.KeyboardEvent, index: number) {
    const delta = event.shiftKey ? 0.02 : 0.005;
    const offset = { ArrowLeft: [-delta, 0], ArrowRight: [delta, 0], ArrowUp: [0, -delta], ArrowDown: [0, delta] }[event.key];
    if (!offset) return;
    event.preventDefault();
    const next = [...fields];
    next[index] = { ...next[index], ...clampNormalizedRect({ ...next[index], x: next[index].x + offset[0], y: next[index].y + offset[1] }) };
    onFieldsChange(next);
  }

  return (
    <div className="signature-pdf-scroll">
      <div
        ref={canvasRef}
        className="signature-pdf-canvas"
        onPointerDown={requestField}
        onPointerMove={move}
        onPointerUp={() => setInteraction(null)}
        onPointerCancel={cancelInteraction}
      >
        {imageUrl ? <img src={imageUrl} alt={`Página ${pageNumber} do documento`} draggable={false} /> : <div className="signature-page-loading">Carregando página...</div>}
        {pageFields.map(({ field, index }) => {
          const signerIndex = Math.max(0, signers.findIndex(signer => signer.id === field.signerId));
          const signer = signers[signerIndex];
          return (
            <div
              key={field.id || `${field.signerId}-${field.pageNumber}-${index}`}
              className={`signature-field signature-signer-color-${signerIndex % 6}`}
              style={normalizedToPercent(field)}
              role="button"
              tabIndex={0}
              onKeyDown={event => keyboardMove(event, index)}
              onPointerDown={event => begin(event, index, 'move')}
            >
              <span>{signer?.name || 'Assinante'}</span>
              <button
                type="button"
                className="signature-field-remove"
                aria-label="Remover campo"
                onPointerDown={event => event.stopPropagation()}
                onClick={event => { event.stopPropagation(); onFieldsChange(fields.filter((_, itemIndex) => itemIndex !== index)); }}
              >×</button>
              <span className="signature-field-resize" onPointerDown={event => begin(event, index, 'resize')} aria-hidden="true" />
            </div>
          );
        })}
        {pendingPlacement ? (
          <div
            className={`signature-signer-picker ${pendingPlacement.x > .68 ? 'align-right' : ''} ${pendingPlacement.y > .72 ? 'align-bottom' : ''}`}
            style={{ left: `${pendingPlacement.x * 100}%`, top: `${pendingPlacement.y * 100}%` }}
            role="menu"
            aria-label="Escolher assinante para o campo"
            onPointerDown={event => event.stopPropagation()}
            onKeyDown={event => {
              if (event.key === 'Escape') setPendingPlacement(null);
            }}
          >
            <div className="signature-signer-picker-head">
              <strong>Escolha o assinante</strong>
              <button type="button" aria-label="Fechar opções" onClick={() => setPendingPlacement(null)}>×</button>
            </div>
            <div className="signature-signer-picker-options">
              {signers.map((signer, signerIndex) => (
                <button
                  type="button"
                  role="menuitem"
                  className={`signature-signer-picker-option signature-signer-color-${signerIndex % 6}`}
                  key={signer.id}
                  onClick={() => addField(signer.id, pendingPlacement)}
                >
                  <span aria-hidden="true" />
                  {signer.name}
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
