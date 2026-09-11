import type { ApiPlaygroundInput, ApiPlaygroundResult } from '../../../api/apiCredentials';

export function formatSafeCurl(path: string, download = false) {
  const url = '$FILTRO_API_BASE_URL' + path;
  if (download) return `curl --fail -H "Authorization: Bearer $FILTRO_API_TOKEN" --output "arquivo-baixado.bin" "${url}"`;
  return `curl --fail-with-body -H "Authorization: Bearer $FILTRO_API_TOKEN" -H "Accept: application/json" "${url}"`;
}

export function redactedRequestPreview(result: ApiPlaygroundResult | null, pending?: ApiPlaygroundInput) {
  if (result?.request) return { ...result.request, authorization: result.request.authorization, curl: formatSafeCurl(result.request.path, isDownloadCheckResult(result)) };
  return pending ? { method: 'GET', path: '(gerado pelo catálogo)', authorization: 'Bearer ••••', curl: formatSafeCurl('(caminho gerado pelo catálogo)') } : null;
}

export function isDownloadCheckResult(result: ApiPlaygroundResult) {
  return Boolean(result.response.status && result.response.status >= 200 && result.response.status < 300 && result.response.body && typeof result.response.body === 'object' && 'kind' in result.response.body && result.response.body.kind === 'DOWNLOAD_CHECK');
}

export function failedPlaygroundResult(error: unknown, durationMs: number): ApiPlaygroundResult {
  const value = (error && typeof error === 'object' ? error : {}) as { status?: number; code?: string; requestId?: string; message?: string };
  const status = Number.isInteger(value.status) && value.status! >= 400 && value.status! <= 599 ? value.status! : null;
  const requestId = typeof value.requestId === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(value.requestId) ? value.requestId : null;
  const code = typeof value.code === 'string' && /^[A-Z0-9_]{1,80}$/.test(value.code) ? value.code : status ? 'REQUEST_FAILED' : 'NETWORK_ERROR';
  const unsafe = /fva_|\bBearer\s|\b(secret|password|authorization|hmac)\b|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|\/home\/|\/var\/|\/tmp\/|[a-f0-9]{64}/i;
  const message = status && status < 500 && typeof value.message === 'string' && !unsafe.test(value.message)
    ? value.message.slice(0, 500) : status ? 'Não foi possível concluir a consulta.' : 'Não foi possível conectar ao servidor.';
  return { request: null, response: { status, requestId, durationMs: Math.max(0, Math.round(durationMs)), truncated: false, body: { code, message, requestId } } };
}
