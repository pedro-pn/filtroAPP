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

export function romaneioApiPath(path: string) {
  return `/romaneio${path.startsWith('/') ? path : `/${path}`}`;
}

export function epiApiPath(path: string) {
  return `/epi${path.startsWith('/') ? path : `/${path}`}`;
}

export function equipamentosApiPath(path: string) {
  return `/equipamentos${path.startsWith('/') ? path : `/${path}`}`;
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
  return translateAxiosErrorMessage(error.message, error.response?.status);
}

function translateAxiosErrorMessage(message: string | undefined, status?: number) {
  const text = String(message || '').trim();
  if (!text) return null;

  if (/^Network Error$/i.test(text)) return 'Não foi possível conectar ao servidor.';
  if (/^Failed to fetch$/i.test(text)) return 'Não foi possível conectar ao servidor.';
  if (/^Load failed$/i.test(text)) return 'Não foi possível carregar os dados.';
  if (/timeout of \d+ms exceeded/i.test(text)) return 'A solicitação excedeu o tempo limite.';
  if (/Request failed with status code/i.test(text)) {
    if (status === 400) return 'Requisição inválida.';
    if (status === 401) return 'Sessão inválida ou expirada.';
    if (status === 403) return 'Você não tem permissão para executar esta ação.';
    if (status === 404) return 'Recurso não encontrado.';
    if (status === 409) return 'Conflito ao salvar os dados.';
    if (status === 413) return 'Arquivo muito grande.';
    if (status === 429) return 'Muitas tentativas. Tente novamente mais tarde.';
    if (status && status >= 500) return 'Erro interno do servidor.';
    return 'Falha na comunicação com a API.';
  }

  return text;
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
