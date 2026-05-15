import axios from 'axios';

const TOKEN_STORAGE_KEY = 'filtrovali-react-token';
const UNAUTHORIZED_EVENT = 'filtrovali:unauthorized';

export class ApiClientError extends Error {
  status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = 'ApiClientError';
    this.status = status;
  }
}

export const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || '/api'
});

export function rdoApiPath(path: string) {
  return `/rdo${path.startsWith('/') ? path : `/${path}`}`;
}

export function adminApiPath(path: string) {
  return `/admin${path.startsWith('/') ? path : `/${path}`}`;
}

function tokenFromAuthorizationHeader(header: unknown) {
  if (typeof header !== 'string') return '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || '';
}

function tokenFromRequestHeaders(headers: unknown) {
  if (!headers) return '';

  const maybeAxiosHeaders = headers as { get?: unknown };
  if (typeof maybeAxiosHeaders.get === 'function') {
    const token = tokenFromAuthorizationHeader((maybeAxiosHeaders.get as (name: string) => unknown)('Authorization'));
    if (token) return token;
  }

  if (typeof headers === 'object') {
    const headerMap = headers as Record<string, unknown>;
    return tokenFromAuthorizationHeader(headerMap.Authorization || headerMap.authorization);
  }

  return '';
}

function extractApiErrorMessage(error: unknown) {
  if (!axios.isAxiosError(error)) return null;
  const payload = error.response?.data;
  if (typeof payload === 'string' && payload.trim()) return payload;
  if (payload && typeof payload === 'object' && 'error' in payload) {
    const message = payload.error;
    if (typeof message === 'string' && message.trim()) return message;
  }
  return error.message || null;
}

apiClient.interceptors.request.use(config => {
  const token = localStorage.getItem(TOKEN_STORAGE_KEY);
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

apiClient.interceptors.response.use(
  response => response,
  error => {
    const status = axios.isAxiosError(error) ? error.response?.status : undefined;

    if (status === 401 && axios.isAxiosError(error)) {
      const requestToken = tokenFromRequestHeaders(error.config?.headers);
      if (requestToken && requestToken === localStorage.getItem(TOKEN_STORAGE_KEY)) {
        window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT, { detail: { token: requestToken } }));
      }
    }

    const message = extractApiErrorMessage(error);
    return Promise.reject(new ApiClientError(message || 'Falha na comunicação com a API.', status));
  }
);

export { TOKEN_STORAGE_KEY, UNAUTHORIZED_EVENT };
