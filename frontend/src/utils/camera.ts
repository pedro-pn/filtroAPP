// Utilitários compartilhados pelos fluxos que abrem a câmera do aparelho (leitura de QR code do
// romaneio e foto na hora nos relatórios).

// A câmera ao vivo exige contexto seguro (HTTPS/localhost) e getUserMedia.
export function canUseLiveCamera() {
  return window.isSecureContext && Boolean(navigator.mediaDevices?.getUserMedia);
}

// `action` completa a frase "Permita o acesso à câmera para …".
export function cameraErrorMessage(error: unknown, action = 'escanear o QR code') {
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError' || error.name === 'SecurityError') {
      return `Permita o acesso à câmera para ${action}.`;
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

const pad = (value: number) => String(value).padStart(2, '0');

// Nome do arquivo de uma foto tirada na hora (o relógio do aparelho distingue as fotos em sequência).
export function capturedPhotoFileName(date = new Date()) {
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const time = `${pad(date.getHours())}h${pad(date.getMinutes())}m${pad(date.getSeconds())}s`;
  return `foto-${day}-${time}-${String(date.getMilliseconds()).padStart(3, '0')}.jpg`;
}

// Congela o quadro atual do vídeo em um JPEG, na resolução em que a câmera está transmitindo.
export function captureVideoFrame(video: HTMLVideoElement, quality = 0.9) {
  return new Promise<File>((resolve, reject) => {
    const width = video.videoWidth, height = video.videoHeight;
    if (!width || !height) {
      reject(new Error('A câmera ainda não está pronta.'));
      return;
    }
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) {
      reject(new Error('Não foi possível capturar a foto.'));
      return;
    }
    context.drawImage(video, 0, 0, width, height);
    canvas.toBlob(blob => {
      if (!blob) {
        reject(new Error('Não foi possível capturar a foto.'));
        return;
      }
      resolve(new File([blob], capturedPhotoFileName(), { type: 'image/jpeg', lastModified: Date.now() }));
    }, 'image/jpeg', quality);
  });
}
