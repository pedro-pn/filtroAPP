type UuidCrypto = Partial<Pick<Crypto, 'randomUUID' | 'getRandomValues'>>;

// Alguns navegadores expõem getRandomValues em HTTP, mas reservam randomUUID a HTTPS.
export function createUuid(cryptoApi: UuidCrypto | undefined = globalThis.crypto): string {
  if (typeof cryptoApi?.randomUUID === 'function') return cryptoApi.randomUUID();
  if (typeof cryptoApi?.getRandomValues !== 'function') {
    throw new Error('Este navegador não oferece geração segura de identificadores. Atualize o navegador e tente novamente.');
  }
  const bytes = new Uint8Array(16);
  cryptoApi.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
