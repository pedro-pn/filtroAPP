import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

import type { SignatureField, SignatureSigner } from '../../../api/assinaturas';
import { Button, IconButton, Skeleton } from '../../../components/ui/ds';
import { DS_ICONS } from '../../../components/ui/ds/icons';
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
  onImageError,
  pageNumber,
  signers,
  fields,
  onFieldsChange
}: {
  imageUrl: string;
  onImageError?: () => void;
  pageNumber: number;
  signers: SignatureSigner[];
  fields: SignatureField[];
  onFieldsChange: (fields: SignatureField[]) => void;
}) {
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const pickerRef = useRef<HTMLDivElement | null>(null);
  const [loadedUrl, setLoadedUrl] = useState('');
  const imageReady = Boolean(imageUrl && loadedUrl === imageUrl);
  const [interaction, setInteraction] = useState<Interaction | null>(null);
  const [pendingPlacement, setPendingPlacement] = useState<PendingPlacement | null>(null);
  const pageFields = fields.map((field, index) => ({ field, index })).filter(item => item.field.pageNumber === pageNumber);

  useEffect(() => { setPendingPlacement(null); setInteraction(null); }, [pageNumber, imageUrl]);
  useEffect(() => {
    if (!pendingPlacement) return;
    const picker = pickerRef.current;
    const canvas = canvasRef.current;
    const scroll = canvas?.closest('.signature-pdf-scroll');
    if (!picker || !canvas || !scroll) return;
    function positionPicker() {
      if (!picker || !scroll) return;
      const bounds = scroll.getBoundingClientRect();
      const left = Math.max(0, bounds.left) + 8;
      const right = Math.min(window.innerWidth, bounds.right) - 8;
      const top = Math.max(0, bounds.top) + 8;
      const bottom = Math.min(window.innerHeight, bounds.bottom) - 8;
      picker.style.width = `${Math.max(0, Math.min(230, right - left))}px`;
      picker.style.maxHeight = `${Math.max(0, bottom - top)}px`;
      picker.style.setProperty('--signature-picker-offset-x', '8px');
      picker.style.setProperty('--signature-picker-offset-y', '8px');
      const rect = picker.getBoundingClientRect();
      picker.style.setProperty('--signature-picker-offset-x', `${8 + Math.max(left, Math.min(rect.left, right - rect.width)) - rect.left}px`);
      picker.style.setProperty('--signature-picker-offset-y', `${8 + Math.max(top, Math.min(rect.top, bottom - rect.height)) - rect.top}px`);
    }
    // Wait for the originating pointer event's default focus before focusing the picker.
    const frame = requestAnimationFrame(() => {
      positionPicker();
      picker.querySelector<HTMLButtonElement>('.signature-signer-picker-option')?.focus({ preventScroll: true });
    });
    window.addEventListener('resize', positionPicker);
    window.addEventListener('scroll', positionPicker, true);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', positionPicker);
      window.removeEventListener('scroll', positionPicker, true);
    };
  }, [pendingPlacement]);

  function closePicker() {
    setPendingPlacement(null);
    canvasRef.current?.focus({ preventScroll: true });
  }

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
    closePicker();
  }

  function requestField(event: ReactPointerEvent<HTMLDivElement>) {
    if (!imageReady || interaction || event.target !== event.currentTarget || !signers.length) return;
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
    <div className="signature-pdf-scroll" role="region" aria-label={`Área de posicionamento, página ${pageNumber}`} tabIndex={0}>
      <div
        ref={canvasRef}
        className={`signature-pdf-canvas ${imageReady ? 'is-ready' : 'is-loading'}`}
        tabIndex={-1}
        onPointerDown={requestField}
        onPointerMove={move}
        onPointerUp={() => setInteraction(null)}
        onPointerCancel={cancelInteraction}
      >
        {imageUrl ? <img src={imageUrl} alt={`Página ${pageNumber} do documento`} draggable={false} onLoad={() => setLoadedUrl(imageUrl)} onError={onImageError} /> : null}
        {!imageReady ? <div className="signature-page-loading"><Skeleton variant="card" label="Carregando página do PDF..." /></div> : null}
        {imageReady && pageFields.map(({ field, index }) => {
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
              <IconButton
                className="signature-field-remove"
                variant="secondary"
                size="sm"
                label={`Remover campo de ${signer?.name || 'assinante'}`}
                icon={DS_ICONS.trash}
                onPointerDown={event => event.stopPropagation()}
                onKeyDown={event => event.stopPropagation()}
                onClick={event => { event.stopPropagation(); onFieldsChange(fields.filter((_, itemIndex) => itemIndex !== index)); }}
              />
              <span className="signature-field-resize" onPointerDown={event => begin(event, index, 'resize')} aria-hidden="true" />
            </div>
          );
        })}
        {pendingPlacement ? (
          <div
            ref={pickerRef}
            className="signature-signer-picker"
            style={{ left: `${pendingPlacement.x * 100}%`, top: `${pendingPlacement.y * 100}%` }}
            role="group"
            aria-label="Escolher assinante para o campo"
            onPointerDown={event => event.stopPropagation()}
            onKeyDown={event => {
              if (event.key === 'Escape') { event.stopPropagation(); closePicker(); }
            }}
          >
            <div className="signature-signer-picker-head">
              <strong>Escolha o assinante</strong>
              <IconButton variant="ghost" size="sm" label="Fechar opções" icon={DS_ICONS.close} onClick={closePicker} />
            </div>
            <div className="signature-signer-picker-options">
              {signers.map((signer, signerIndex) => (
                <Button
                  variant="secondary"
                  size="sm"
                  className={`signature-signer-picker-option signature-signer-color-${signerIndex % 6}`}
                  key={signer.id}
                  onClick={() => addField(signer.id, pendingPlacement)}
                >
                  <span className="assinaturas-setup__signer-dot" aria-hidden="true" />
                  <span>{signerIndex + 1}. {signer.name}</span>
                </Button>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
