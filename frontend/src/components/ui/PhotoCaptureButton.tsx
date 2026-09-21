import { useRef, useState, type ChangeEvent } from 'react';

import { canUseLiveCamera } from '../../utils/camera';
import { CameraCaptureModal } from './CameraCaptureModal';

interface PhotoCaptureButtonProps {
  // Recebe as fotos tiradas (um lote por vez), como se tivessem sido escolhidas no seletor de arquivos.
  onFiles: (files: File[]) => void;
  disabled?: boolean;
  // Quantas fotos ainda cabem no campo; sem valor, não há limite.
  maxPhotos?: number;
  label?: string;
}

// "Tirar foto": abre a câmera ao vivo do aparelho quando o navegador permite (HTTPS) e, senão — ou se
// a pessoa preferir —, o app de câmera do sistema via <input capture>, que também funciona em HTTP.
export function PhotoCaptureButton({ onFiles, disabled = false, maxPhotos, label = 'Tirar foto' }: PhotoCaptureButtonProps) {
  const deviceCameraRef = useRef<HTMLInputElement | null>(null);
  const [open, setOpen] = useState(false);

  function start() {
    if (canUseLiveCamera()) setOpen(true);
    else deviceCameraRef.current?.click();
  }

  function useDeviceCamera() {
    setOpen(false);
    deviceCameraRef.current?.click();
  }

  function handleDeviceCamera(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    if (files.length) onFiles(files);
  }

  return (
    <>
      <button
        className="secondary-button photo-capture-button"
        data-photo-capture
        type="button"
        disabled={disabled || maxPhotos === 0}
        onClick={start}
      >
        <svg className="photo-capture-icon" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false">
          <path fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" d="M4 8h3l2-3h6l2 3h3v11H4z" />
          <circle cx="12" cy="13" r="3.5" fill="none" stroke="currentColor" strokeWidth="2" />
        </svg>
        {label}
      </button>
      <input
        ref={deviceCameraRef}
        className="visually-hidden"
        type="file"
        accept="image/*"
        capture="environment"
        tabIndex={-1}
        aria-hidden="true"
        onChange={handleDeviceCamera}
      />
      <CameraCaptureModal
        open={open}
        maxPhotos={maxPhotos}
        onClose={() => setOpen(false)}
        onConfirm={files => { setOpen(false); onFiles(files); }}
        onUseDeviceCamera={useDeviceCamera}
      />
    </>
  );
}
