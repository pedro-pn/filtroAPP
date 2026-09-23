// Fotos de celular chegam a 5–15 MB (ou mais nos modos de alta resolução) e viajam em base64 dentro
// de JSON. O servidor já reduz toda imagem de relatório (1280 px, JPEG), então mandar o original só
// gasta dados e estoura os limites de corpo. Aqui a foto é reduzida no aparelho antes de enviar.

export const UPLOAD_IMAGE_MAX_DIMENSION = 1920;
export const UPLOAD_IMAGE_QUALITY = 0.85;
// Até este tamanho a foto segue intacta, sem recompressão.
export const UPLOAD_IMAGE_PASSTHROUGH_BYTES = 1024 * 1024;

// Só formatos que o navegador decodifica com segurança. HEIC/HEIF e outros seguem como estão e o
// servidor os converte.
const REENCODABLE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

interface DecodedImage {
  source: CanvasImageSource;
  width: number;
  height: number;
  release: () => void;
}

async function decodeImage(file: File): Promise<DecodedImage> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    return { source: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close() };
  } catch {
    // Navegadores sem as opções de createImageBitmap: o <img> também aplica a orientação EXIF.
    const url = URL.createObjectURL(file);
    try {
      const image = new Image();
      image.decoding = 'async';
      image.src = url;
      await image.decode();
      return { source: image, width: image.naturalWidth, height: image.naturalHeight, release: () => URL.revokeObjectURL(url) };
    } catch (error) {
      URL.revokeObjectURL(url);
      throw error;
    }
  }
}

function jpegName(fileName: string) {
  return `${fileName.replace(/\.[^./\\]+$/, '') || 'foto'}.jpg`;
}

// Devolve a própria foto quando ela já é leve, não é decodificável ou a recompressão não ajuda.
export async function prepareImageForUpload(file: File): Promise<File> {
  if (!REENCODABLE_TYPES.has(file.type) || file.size <= UPLOAD_IMAGE_PASSTHROUGH_BYTES) return file;

  let decoded: DecodedImage | null = null;
  try {
    decoded = await decodeImage(file);
    if (!decoded.width || !decoded.height) return file;
    const scale = Math.min(1, UPLOAD_IMAGE_MAX_DIMENSION / Math.max(decoded.width, decoded.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(decoded.width * scale));
    canvas.height = Math.max(1, Math.round(decoded.height * scale));
    const context = canvas.getContext('2d');
    if (!context) return file;
    // JPEG não tem transparência: PNG com fundo transparente ficaria preto.
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(decoded.source, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', UPLOAD_IMAGE_QUALITY));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], jpegName(file.name), { type: 'image/jpeg', lastModified: file.lastModified });
  } catch {
    return file;
  } finally {
    decoded?.release();
  }
}
