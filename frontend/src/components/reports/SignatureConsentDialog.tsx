import { useEffect, useRef, useState } from 'react';

import { Modal } from '../ui/Modal';

interface SignatureConsentDialogProps {
  open: boolean;
  title: string;
  isSubmitting?: boolean;
  onCancel: () => void;
  onConfirm: (signatureImageDataUrl: string) => void;
}

type SignatureMode = 'draw' | 'upload';

function prepareCanvas(canvas: HTMLCanvasElement) {
  const context = canvas.getContext('2d');
  if (!context) return null;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.lineWidth = 3;
  context.strokeStyle = '#111827';
  return context;
}

function canvasPoint(canvas: HTMLCanvasElement, event: PointerEvent) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: ((event.clientX - rect.left) / rect.width) * canvas.width,
    y: ((event.clientY - rect.top) / rect.height) * canvas.height
  };
}

export function SignatureConsentDialog({
  open,
  title,
  isSubmitting = false,
  onCancel,
  onConfirm
}: SignatureConsentDialogProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [mode, setMode] = useState<SignatureMode>('draw');
  const [uploadedDataUrl, setUploadedDataUrl] = useState('');
  const [hasDrawing, setHasDrawing] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open || mode !== 'draw') return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = prepareCanvas(canvas);
    if (!context) return;
    setHasDrawing(false);
    const activeCanvas = canvas;
    const activeContext = context;
    let drawing = false;

    function pointerDown(event: PointerEvent) {
      event.preventDefault();
      drawing = true;
      const point = canvasPoint(activeCanvas, event);
      activeContext.beginPath();
      activeContext.moveTo(point.x, point.y);
      activeCanvas.setPointerCapture?.(event.pointerId);
    }

    function pointerMove(event: PointerEvent) {
      if (!drawing) return;
      event.preventDefault();
      const point = canvasPoint(activeCanvas, event);
      activeContext.lineTo(point.x, point.y);
      activeContext.stroke();
      setHasDrawing(true);
    }

    function pointerUp(event: PointerEvent) {
      drawing = false;
      activeCanvas.releasePointerCapture?.(event.pointerId);
    }

    activeCanvas.addEventListener('pointerdown', pointerDown);
    activeCanvas.addEventListener('pointermove', pointerMove);
    activeCanvas.addEventListener('pointerup', pointerUp);
    activeCanvas.addEventListener('pointerleave', pointerUp);
    return () => {
      activeCanvas.removeEventListener('pointerdown', pointerDown);
      activeCanvas.removeEventListener('pointermove', pointerMove);
      activeCanvas.removeEventListener('pointerup', pointerUp);
      activeCanvas.removeEventListener('pointerleave', pointerUp);
    };
  }, [open, mode]);

  useEffect(() => {
    if (!open) {
      setMode('draw');
      setUploadedDataUrl('');
      setHasDrawing(false);
      setError('');
    }
  }, [open]);

  function clearDrawing() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    prepareCanvas(canvas);
    setHasDrawing(false);
    setError('');
  }

  function handleFile(file: File | undefined) {
    setError('');
    if (!file) return;
    if (!['image/png', 'image/jpeg'].includes(file.type)) {
      setError('Envie uma imagem PNG ou JPG.');
      return;
    }
    if (file.size > 1.5 * 1024 * 1024) {
      setError('A imagem deve ter até 1,5 MB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setUploadedDataUrl(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => setError('Não foi possível carregar a imagem.');
    reader.readAsDataURL(file);
  }

  function removeUploadedImage() {
    setUploadedDataUrl('');
    setError('');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }

  function confirm() {
    setError('');
    if (mode === 'upload') {
      if (!uploadedDataUrl) {
        setError('Envie uma imagem da assinatura.');
        return;
      }
      onConfirm(uploadedDataUrl);
      return;
    }

    const canvas = canvasRef.current;
    if (!canvas || !hasDrawing) {
      setError('Desenhe a assinatura para continuar.');
      return;
    }
    onConfirm(canvas.toDataURL('image/png'));
  }

  return (
    <Modal open={open} onClose={onCancel} ariaLabelledBy="signature-consent-title" panelClassName="modal-card signature-consent-modal">
      <div className="modal-head">
        <h2 id="signature-consent-title">{title}</h2>
        <button className="icon-button" type="button" aria-label="Fechar" onClick={onCancel}>×</button>
      </div>
      <p className="signature-consent-text">Declaro que revisei e concordo com o conteúdo deste relatório.</p>
      <div className="signature-mode-tabs" role="tablist" aria-label="Modo de assinatura">
        <button className={mode === 'draw' ? 'active' : ''} type="button" onClick={() => setMode('draw')}>Desenhar</button>
        <button className={mode === 'upload' ? 'active' : ''} type="button" onClick={() => setMode('upload')}>Enviar imagem</button>
      </div>
      {mode === 'draw' ? (
        <div className="signature-draw-area">
          <div className="signature-canvas-shell">
            <canvas ref={canvasRef} width={560} height={180} aria-label="Área para desenhar assinatura" />
          </div>
          <div className="signature-inline-actions">
            <button className="secondary-button" type="button" onClick={clearDrawing}>Limpar</button>
          </div>
        </div>
      ) : (
        <div className="signature-upload-area">
          <input
            ref={fileInputRef}
            className="signature-file-input"
            type="file"
            accept="image/png,image/jpeg"
            onChange={event => handleFile(event.target.files?.[0])}
          />
          {uploadedDataUrl ? (
            <div className="signature-upload-drop signature-upload-drop-filled">
              <img src={uploadedDataUrl} alt="Prévia da assinatura" />
              <button className="signature-upload-remove" type="button" onClick={removeUploadedImage}>
                Remover
              </button>
            </div>
          ) : (
            <button
              className="signature-upload-drop signature-upload-trigger"
              type="button"
              onClick={() => fileInputRef.current?.click()}
            >
              adicionar assinatura
            </button>
          )}
        </div>
      )}
      {error ? <div className="form-error">{error}</div> : null}
      <div className="modal-actions">
        <button className="secondary-button" type="button" onClick={onCancel} disabled={isSubmitting}>Cancelar</button>
        <button className="primary-button" type="button" onClick={confirm} disabled={isSubmitting}>
          {isSubmitting ? 'Assinando...' : 'Confirmar assinatura'}
        </button>
      </div>
    </Modal>
  );
}
