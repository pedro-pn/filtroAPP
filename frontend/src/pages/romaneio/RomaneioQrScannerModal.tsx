import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import type { IScannerControls } from '@zxing/browser';

import { Modal } from '../../components/ui/Modal';
import { parseRomaneioItemQrValue } from '../../utils/romaneioQr';

interface RomaneioQrScannerModalProps {
  open: boolean;
  onClose: () => void;
  onDetectedCatalogItemId: (catalogItemId: string) => void;
}

function cameraErrorMessage(error: unknown) {
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError' || error.name === 'SecurityError') {
      return 'Permita o acesso à câmera para escanear o QR code.';
    }
    if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
      return 'Nenhuma câmera foi encontrada neste dispositivo.';
    }
    if (error.name === 'NotReadableError' || error.name === 'TrackStartError') {
      return 'A câmera está sendo usada por outro aplicativo.';
    }
  }
  return 'Não foi possível iniciar a câmera. Verifique a permissão e tente novamente.';
}

export function RomaneioQrScannerModal({ open, onClose, onDetectedCatalogItemId }: RomaneioQrScannerModalProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const photoInputRef = useRef<HTMLInputElement | null>(null);
  const controlsRef = useRef<IScannerControls | null>(null);
  const onDetectedRef = useRef(onDetectedCatalogItemId);
  const completedRef = useRef(false);
  const [message, setMessage] = useState('Aponte a câmera para o QR code do equipamento.');
  const [hasError, setHasError] = useState(false);
  const [isDecodingPhoto, setIsDecodingPhoto] = useState(false);
  const canUseLiveCamera = window.isSecureContext && Boolean(navigator.mediaDevices?.getUserMedia);

  useEffect(() => {
    onDetectedRef.current = onDetectedCatalogItemId;
  }, [onDetectedCatalogItemId]);

  useEffect(() => {
    if (!open) return;

    const video = videoRef.current;
    let disposed = false;
    completedRef.current = false;
    setIsDecodingPhoto(false);
    setMessage('Aponte a câmera para o QR code do equipamento.');
    setHasError(false);

    if (!window.isSecureContext) {
      setMessage('A câmera ao vivo exige HTTPS. Toque em “Tirar foto do QR code” para usar a câmera neste endereço HTTP.');
      return;
    }

    if (!video || !navigator.mediaDevices?.getUserMedia) {
      setMessage('Este navegador não oferece câmera ao vivo. Você ainda pode tirar uma foto do QR code.');
      return;
    }

    void import('@zxing/browser').then(async ({ BrowserQRCodeReader }) => {
      if (disposed) return;
      const reader = new BrowserQRCodeReader(undefined, {
        delayBetweenScanAttempts: 150,
        delayBetweenScanSuccess: 500
      });
      const controls = await reader.decodeFromConstraints(
        {
          audio: false,
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1280 },
            height: { ideal: 720 }
          }
        },
        video,
        result => {
          if (!result || completedRef.current || disposed) return;
          const catalogItemId = parseRomaneioItemQrValue(result.getText());
          if (!catalogItemId) {
            setMessage('QR code não reconhecido. Use uma etiqueta gerada no romaneio.');
            setHasError(true);
            return;
          }
          completedRef.current = true;
          controlsRef.current?.stop();
          onDetectedRef.current(catalogItemId);
        }
      );
      if (disposed || completedRef.current) {
        controls.stop();
        return;
      }
      controlsRef.current = controls;
    }).catch(error => {
      if (disposed) return;
      setMessage(cameraErrorMessage(error));
      setHasError(true);
    });

    return () => {
      disposed = true;
      controlsRef.current?.stop();
      controlsRef.current = null;
      video.srcObject = null;
    };
  }, [open]);

  async function decodePhoto(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file || completedRef.current) return;

    setIsDecodingPhoto(true);
    setHasError(false);
    setMessage('Lendo o QR code da foto...');
    const imageUrl = URL.createObjectURL(file);

    try {
      const { BrowserQRCodeReader } = await import('@zxing/browser');
      const result = await new BrowserQRCodeReader().decodeFromImageUrl(imageUrl);
      const catalogItemId = parseRomaneioItemQrValue(result.getText());
      if (!catalogItemId) {
        setMessage('A foto contém um QR code que não pertence ao romaneio.');
        setHasError(true);
        return;
      }
      completedRef.current = true;
      controlsRef.current?.stop();
      onDetectedRef.current(catalogItemId);
    } catch {
      setMessage('Não foi possível localizar um QR code na foto. Tente novamente com mais luz e aproximação.');
      setHasError(true);
    } finally {
      URL.revokeObjectURL(imageUrl);
      input.value = '';
      setIsDecodingPhoto(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      ariaLabelledBy="romaneio-qr-scanner-title"
      ariaDescribedBy="romaneio-qr-scanner-status"
      panelClassName="modal-card romaneio-qr-scanner-modal"
    >
      <div className="section-title" id="romaneio-qr-scanner-title">Escanear equipamento</div>
      {canUseLiveCamera ? (
        <div className="romaneio-qr-camera">
          <video ref={videoRef} muted playsInline aria-label="Imagem da câmera para leitura do QR code" />
          <span className="romaneio-qr-camera-frame" aria-hidden="true" />
        </div>
      ) : null}
      <p className={hasError ? 'form-error' : 'placeholder-copy'} id="romaneio-qr-scanner-status" role="status">
        {message}
      </p>
      <div className="admin-form-actions">
        <button className="secondary-button" type="button" onClick={onClose}>Cancelar</button>
        <input
          ref={photoInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          hidden
          onChange={decodePhoto}
        />
        <button
          className="primary-button"
          type="button"
          disabled={isDecodingPhoto}
          onClick={() => photoInputRef.current?.click()}
        >
          {isDecodingPhoto ? 'Lendo foto...' : 'Tirar foto do QR code'}
        </button>
      </div>
    </Modal>
  );
}
