import { useEffect, useRef, useState } from 'react';

import { cameraErrorMessage, captureVideoFrame } from '../../utils/camera';
import { Modal } from './Modal';

interface Shot {
  id: number;
  file: File;
  url: string;
}

interface CameraCaptureModalProps {
  open: boolean;
  // Quantas fotos ainda cabem no campo; sem valor, não há limite.
  maxPhotos?: number;
  onClose: () => void;
  // Entrega todas as fotos tiradas de uma vez, quando a pessoa confirma.
  onConfirm: (files: File[]) => void;
  // Alternativa quando a câmera ao vivo falha (permissão negada, câmera ocupada…).
  onUseDeviceCamera?: () => void;
}

// Câmera ao vivo para tirar uma ou várias fotos na hora. As fotos ficam só neste modal até
// "Usar fotos", para o campo de origem receber um único lote e enviá-lo de uma vez.
export function CameraCaptureModal({ open, maxPhotos, onClose, onConfirm, onUseDeviceCamera }: CameraCaptureModalProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const shotsRef = useRef<Shot[]>([]);
  const nextShotId = useRef(0);
  const [ready, setReady] = useState(false);
  const [frameRatio, setFrameRatio] = useState('4 / 3');
  const [capturing, setCapturing] = useState(false);
  const [error, setError] = useState('');
  const [shots, setShots] = useState<Shot[]>([]);
  const limitReached = maxPhotos !== undefined && shots.length >= maxPhotos;

  useEffect(() => {
    shotsRef.current = shots;
  }, [shots]);

  // Descarta as fotos não confirmadas (e libera as prévias) ao fechar.
  useEffect(() => {
    if (!open) return;
    return () => {
      shotsRef.current.forEach(shot => URL.revokeObjectURL(shot.url));
      shotsRef.current = [];
      setShots([]);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let disposed = false;
    let stream: MediaStream | null = null;
    const video = videoRef.current;
    setReady(false);
    setError('');

    navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }
    }).then(async mediaStream => {
      if (disposed) {
        mediaStream.getTracks().forEach(track => track.stop());
        return;
      }
      stream = mediaStream;
      if (!video) return;
      video.srcObject = mediaStream;
      await video.play();
      if (disposed) return;
      // O preview mostra o quadro inteiro na proporção real da câmera: é o que será salvo.
      if (video.videoWidth && video.videoHeight) setFrameRatio(`${video.videoWidth} / ${video.videoHeight}`);
      setReady(true);
    }).catch(cause => {
      if (!disposed) setError(cameraErrorMessage(cause, 'tirar a foto'));
    });

    return () => {
      disposed = true;
      stream?.getTracks().forEach(track => track.stop());
      if (video) video.srcObject = null;
    };
  }, [open]);

  async function takePhoto() {
    const video = videoRef.current;
    if (!video || !ready || capturing || limitReached) return;
    setCapturing(true);
    try {
      const file = await captureVideoFrame(video);
      setShots(current => [...current, { id: nextShotId.current++, file, url: URL.createObjectURL(file) }]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível capturar a foto.');
    } finally {
      setCapturing(false);
    }
  }

  function removeShot(id: number) {
    setShots(current => {
      current.filter(shot => shot.id === id).forEach(shot => URL.revokeObjectURL(shot.url));
      return current.filter(shot => shot.id !== id);
    });
  }

  const status = error
    || (limitReached ? 'Limite de fotos atingido. Toque em “Usar fotos” para continuar.' : '')
    || (ready ? 'Enquadre e toque em “Tirar foto”. Você pode tirar várias antes de usar.' : 'Abrindo a câmera…');

  return (
    <Modal
      open={open}
      onClose={onClose}
      ariaLabelledBy="camera-capture-title"
      ariaDescribedBy="camera-capture-status"
      panelClassName="modal-card camera-capture-modal"
    >
      <div className="section-title" id="camera-capture-title">Tirar foto</div>
      <div className="camera-capture-view" style={{ aspectRatio: frameRatio }}>
        <video ref={videoRef} muted playsInline aria-label="Imagem da câmera" />
      </div>
      {shots.length ? (
        <ul className="camera-capture-shots" aria-label="Fotos tiradas">
          {shots.map((shot, index) => (
            <li key={shot.id}>
              <img src={shot.url} alt={`Foto ${index + 1}`} />
              <button type="button" aria-label={`Descartar foto ${index + 1}`} onClick={() => removeShot(shot.id)}>×</button>
            </li>
          ))}
        </ul>
      ) : null}
      <p className={error ? 'form-error' : 'placeholder-copy'} id="camera-capture-status" role="status">{status}</p>
      <div className="admin-form-actions">
        <button className="secondary-button" type="button" onClick={onClose}>Cancelar</button>
        {error && onUseDeviceCamera ? (
          <button className="secondary-button" type="button" onClick={onUseDeviceCamera}>Usar câmera do aparelho</button>
        ) : null}
        <button className="secondary-button" type="button" disabled={!ready || capturing || limitReached} onClick={() => void takePhoto()}>
          {capturing ? 'Capturando…' : 'Tirar foto'}
        </button>
        <button className="primary-button" type="button" disabled={!shots.length} onClick={() => onConfirm(shots.map(shot => shot.file))}>
          {shots.length > 1 ? `Usar ${shots.length} fotos` : 'Usar foto'}
        </button>
      </div>
    </Modal>
  );
}
