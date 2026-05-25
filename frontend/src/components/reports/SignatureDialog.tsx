import { type ReactNode, useEffect, useRef, useState } from 'react';

import { Modal } from '../ui/Modal';

interface SignatureDialogProps {
  open: boolean;
  title: string;
  initialSignerName?: string | null;
  cacheIdentity?: string | null;
  isSubmitting?: boolean;
  confirmDisabled?: boolean;
  confirmDisabledMessage?: string;
  notice?: ReactNode;
  onCancel: () => void;
  onConfirm: (payload: { signerName: string; signatureImageDataUrl: string }) => void;
}

type SignatureMode = 'draw' | 'upload';
type SignatureCache = {
  signerName?: string;
};

const SIGNATURE_CACHE_PREFIX = 'filtrovali.signature.v1';

function cacheKey(identity?: string | null) {
  const normalized = String(identity || '').trim().toLowerCase();
  if (!normalized) return '';
  return `${SIGNATURE_CACHE_PREFIX}:${normalized}`;
}

function readSignatureCache(identity?: string | null): SignatureCache | null {
  const key = cacheKey(identity);
  if (!key || typeof window === 'undefined') return null;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(key) || 'null');
    if (!parsed || typeof parsed !== 'object') return null;
    if (typeof parsed.drawnSignatureDataUrl === 'string') {
      window.localStorage.setItem(key, JSON.stringify({
        signerName: typeof parsed.signerName === 'string' ? parsed.signerName : ''
      }));
    }
    return {
      signerName: typeof parsed.signerName === 'string' ? parsed.signerName : ''
    };
  } catch {
    return null;
  }
}

function writeSignatureCache(identity: string | null | undefined, cache: SignatureCache) {
  const key = cacheKey(identity);
  if (!key || typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, JSON.stringify(cache));
  } catch {
    // Ignore storage quota or privacy-mode failures. The signature flow itself must continue.
  }
}

function removeSignatureCache(identity?: string | null) {
  const key = cacheKey(identity);
  if (!key || typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Ignore unavailable localStorage.
  }
}

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

export function SignatureDialog({
  open,
  title,
  initialSignerName = '',
  cacheIdentity = '',
  isSubmitting = false,
  confirmDisabled = false,
  confirmDisabledMessage = 'Confirme os termos para continuar.',
  notice = null,
  onCancel,
  onConfirm
}: SignatureDialogProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [mode, setMode] = useState<SignatureMode>('draw');
  const [signerName, setSignerName] = useState('');
  const [rememberSignature, setRememberSignature] = useState(false);
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
    if (open) {
      const cached = readSignatureCache(cacheIdentity);
      setSignerName(String(cached?.signerName || initialSignerName || '').trim());
      setRememberSignature(!!cached);
    } else {
      setMode('draw');
      setSignerName('');
      setRememberSignature(false);
      setUploadedDataUrl('');
      setHasDrawing(false);
      setError('');
    }
  }, [cacheIdentity, initialSignerName, open]);

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

  function removeSavedSignature() {
    removeSignatureCache(cacheIdentity);
    setRememberSignature(false);
    setError('');
  }

  function confirm() {
    setError('');
    if (confirmDisabled) {
      setError(confirmDisabledMessage);
      return;
    }
    const trimmedSignerName = signerName.trim();
    if (trimmedSignerName.length < 2) {
      setError('Informe o nome do signatário.');
      return;
    }
    if (mode === 'upload') {
      if (!uploadedDataUrl) {
        setError('Envie uma imagem da assinatura.');
        return;
      }
      if (cacheKey(cacheIdentity)) {
        const existing = readSignatureCache(cacheIdentity) || {};
        if (rememberSignature) {
          writeSignatureCache(cacheIdentity, { ...existing, signerName: trimmedSignerName });
        } else {
          removeSignatureCache(cacheIdentity);
        }
      }
      onConfirm({ signerName: trimmedSignerName, signatureImageDataUrl: uploadedDataUrl });
      return;
    }

    const canvas = canvasRef.current;
    if (!canvas || !hasDrawing) {
      setError('Desenhe a assinatura para continuar.');
      return;
    }
    const drawnSignatureDataUrl = canvas.toDataURL('image/png');
    if (cacheKey(cacheIdentity)) {
      if (rememberSignature) {
        writeSignatureCache(cacheIdentity, { signerName: trimmedSignerName });
      } else {
        removeSignatureCache(cacheIdentity);
      }
    }
    onConfirm({ signerName: trimmedSignerName, signatureImageDataUrl: drawnSignatureDataUrl });
  }

  return (
    <Modal open={open} onClose={onCancel} ariaLabelledBy="signature-dialog-title" panelClassName="modal-card signature-modal">
      <div className="modal-head">
        <h2 id="signature-dialog-title">{title}</h2>
        <button className="icon-button" type="button" aria-label="Fechar" onClick={onCancel}>×</button>
      </div>
      <div className="field-group signature-name-field">
        <label htmlFor="signature-signer-name">Nome do signatário</label>
        <input
          id="signature-signer-name"
          type="text"
          value={signerName}
          maxLength={160}
          placeholder="Informe seu nome completo"
          onChange={event => setSignerName(event.target.value)}
        />
      </div>
      <p className="signature-statement-text">Declaro que revisei e concordo com o conteúdo deste documento.</p>
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
      {cacheKey(cacheIdentity) ? (
        <div className="signature-remember-option">
          <label>
            <input
              type="checkbox"
              checked={rememberSignature}
              onChange={event => setRememberSignature(event.target.checked)}
            />
            <span>Lembrar nome neste dispositivo</span>
          </label>
          {rememberSignature ? (
            <button className="signature-saved-remove" type="button" onClick={removeSavedSignature}>
              Esquecer nome
            </button>
          ) : null}
        </div>
      ) : null}
      {notice}
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
