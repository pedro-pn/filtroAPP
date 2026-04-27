import axios from 'axios';

const TOKEN_STORAGE_KEY = 'filtrovali-react-token';
const UNAUTHORIZED_EVENT = 'filtrovali:unauthorized';

export const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || '/api'
});

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
    if (error.response?.status === 401) {
      window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT));
    }
    const message = extractApiErrorMessage(error);
    return Promise.reject(new Error(message || 'Falha na comunicação com a API.'));
  }
);

export { TOKEN_STORAGE_KEY, UNAUTHORIZED_EVENT };
