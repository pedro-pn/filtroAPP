import axios from 'axios';
import { notifyDataWrite } from './dataUpdates';

// Sessão em cookie HttpOnly (spec 041): o token não fica mais no localStorage.
// A chave antiga só é lida uma vez no boot, para migrar quem já estava logado.
const TOKEN_STORAGE_KEY = 'filtrovali-react-token';
const UNAUTHORIZED_EVENT = 'filtrovali:unauthorized';
// Toda chamada do app leva este cabeçalho; o backend exige nas escritas por cookie (CSRF).
const CSRF_HEADER = 'X-Filtrovali-Request';
// Respostas 401 destas rotas não significam "sessão caiu" (credencial errada, boot).
const UNAUTHORIZED_EXEMPT_PATHS = ['/auth/login', '/auth/2fa/verify', '/auth/2fa/resend', '/auth/me'];

export class ApiClientError extends Error {
  status?: number;
  code?: string;
  conflicts?: unknown[];
  issues?: string[];
  requestId?: string;
  fields?: Array<{ path: string; message: string }>;

  constructor(message: string, status?: number, details?: { code?: string; conflicts?: unknown[]; issues?: string[]; requestId?: string; fields?: Array<{ path: string; message: string }> }) {
    super(message);
    this.name = 'ApiClientError';
    this.status = status;
    this.code = details?.code;
    this.conflicts = details?.conflicts;
    this.issues = details?.issues;
    this.requestId = details?.requestId;
    this.fields = details?.fields;
  }
}

export const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || '/api',
  headers: { [CSRF_HEADER]: '1' }
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

export function estoqueApiPath(path: string) {
  return `/estoque${path.startsWith('/') ? path : `/${path}`}`;
}

export function qualidadeApiPath(path: string) {
  return `/qualidade${path.startsWith('/') ? path : `/${path}`}`;
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

apiClient.interceptors.response.use(
  response => {
    notifyDataWrite(response.config.method, response.config.url);
    return response;
  },
  error => {
    if (axios.isCancel(error)) return Promise.reject(error);
    const status = axios.isAxiosError(error) ? error.response?.status : undefined;

    if (status === 401 && axios.isAxiosError(error)) {
      const url = String(error.config?.url || '');
      if (!UNAUTHORIZED_EXEMPT_PATHS.some(path => url.startsWith(path))) {
        const code = (error.response?.data as { code?: string } | undefined)?.code;
        window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT, { detail: { code } }));
      }
    }

    const message = extractApiErrorMessage(error);
    const payload = axios.isAxiosError(error) && error.response?.data && typeof error.response.data === 'object'
      ? error.response.data as { code?: string; conflicts?: unknown[]; issues?: string[] }
      : undefined;
    return Promise.reject(new ApiClientError(message || 'Falha na comunicação com a API.', status, payload));
  }
);

export { CSRF_HEADER, TOKEN_STORAGE_KEY, UNAUTHORIZED_EVENT };
