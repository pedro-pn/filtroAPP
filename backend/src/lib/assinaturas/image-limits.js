export const MAX_SIGNATURE_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_SIGNATURE_IMAGE_DATA_URL_LENGTH = 'data:image/jpeg;base64,'.length
  + (4 * Math.ceil(MAX_SIGNATURE_IMAGE_BYTES / 3));
