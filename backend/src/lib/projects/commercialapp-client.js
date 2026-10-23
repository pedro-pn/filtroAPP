import env from '../../config/env.js';

function syncError(code) { return Object.assign(new Error(code), { code }); }

export function commercialAppConnection({ apiUrl = env.comercialAppApiUrl, token = env.comercialAppServiceToken,
  production = env.nodeEnv === 'production', appEnv = env.appEnv, allowStagingHttp = env.comercialAppAllowStagingHttp } = {}) {
  if (!apiUrl || !token) throw syncError('COMERCIALAPP_NOT_CONFIGURED');
  let base;
  try { base = new URL(apiUrl); } catch { throw syncError('COMERCIALAPP_URL_INVALID'); }
  const local = !production && base.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname);
  const staging = appEnv === 'staging' && allowStagingHttp === true && base.protocol === 'http:';
  if (base.username || base.password || base.search || base.hash ||
      base.pathname !== '/' || !(base.protocol === 'https:' || local || staging)) throw syncError('COMERCIALAPP_URL_INVALID');
  return { origin: base.origin, token };
}

export async function readLimitedCommercialResponse(response, maximumBytes) {
  if (!response.ok) {
    await response.body?.cancel();
    throw syncError(`COMERCIALAPP_HTTP_${response.status}`);
  }
  if (Number(response.headers.get('content-length')) > maximumBytes) {
    await response.body?.cancel();
    throw syncError('COMERCIALAPP_RESPONSE_TOO_LARGE');
  }
  if (!response.body) throw syncError('COMERCIALAPP_EMPTY_RESPONSE');
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maximumBytes) {
        await reader.cancel();
        throw syncError('COMERCIALAPP_RESPONSE_TOO_LARGE');
      }
      chunks.push(Buffer.from(value));
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks, size);
}
