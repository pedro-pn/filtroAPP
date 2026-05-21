import env from '../config/env.js';

let cachedApiToken = String(env.zapsignApiToken || '').trim();
let cachedRefreshToken = String(env.zapsignRefreshToken || '').trim();
let loginInFlight = null;
let refreshInFlight = null;

function trimTrailingSlash(value) {
  return String(value || '').replace(/\/+$/, '');
}

function apiUrl(pathName) {
  return `${trimTrailingSlash(env.zapsignApiBaseUrl)}${pathName}`;
}

function currentApiToken() {
  return String(cachedApiToken || env.zapsignApiToken || '').trim();
}

function currentRefreshToken() {
  return String(cachedRefreshToken || env.zapsignRefreshToken || '').trim();
}

function currentZapSignUsername() {
  return String(env.zapsignUsername || '').trim();
}

function currentZapSignPassword() {
  return String(env.zapsignPassword || '').trim();
}

function currentZapSignOrganizationId() {
  return String(env.zapsignOrganizationId || '').trim();
}

function hasCredentialAuth() {
  return !!(currentZapSignUsername() && currentZapSignPassword() && currentZapSignOrganizationId());
}

function credentialAuthMissingError() {
  const error = new Error('Credenciais de download legado ZapSign não configuradas. Defina ZAPSIGN_USERNAME, ZAPSIGN_PASSWORD e ZAPSIGN_ORGANIZATION_ID.');
  error.statusCode = 503;
  return error;
}

async function loginWithCredentials() {
  if (loginInFlight) return loginInFlight;

  const username = currentZapSignUsername();
  const password = currentZapSignPassword();
  const organizationId = currentZapSignOrganizationId();
  if (!username || !password || !organizationId) {
    throw credentialAuthMissingError();
  }

  loginInFlight = (async () => {
    const response = await fetch(apiUrl(`/auth/token/${encodeURIComponent(organizationId)}/`), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ username, password })
    });
    const data = await parseJsonResponse(response);
    const nextToken = String(data?.access || data?.token || data?.access_token || '').trim();
    const nextRefreshToken = String(data?.refresh || data?.refresh_token || '').trim();
    if (!nextToken || !nextRefreshToken) {
      const error = new Error('A ZapSign não retornou access token e refresh token.');
      error.statusCode = 502;
      error.details = data;
      throw error;
    }
    cachedApiToken = nextToken;
    cachedRefreshToken = nextRefreshToken;
    return nextToken;
  })();

  try {
    return await loginInFlight;
  } finally {
    loginInFlight = null;
  }
}

async function refreshApiToken() {
  if (refreshInFlight) return refreshInFlight;

  const refreshToken = currentRefreshToken();
  if (!refreshToken) {
    return loginWithCredentials();
  }

  refreshInFlight = (async () => {
    try {
      const response = await fetch(apiUrl('/auth/token-refresh/'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ refresh: refreshToken })
      });
      const data = await parseJsonResponse(response);
      const nextToken = String(data?.access || data?.token || data?.access_token || '').trim();
      const nextRefreshToken = String(data?.refresh || data?.refresh_token || '').trim();
      if (!nextToken) {
        const error = new Error('A ZapSign não retornou um novo access token.');
        error.statusCode = 502;
        error.details = data;
        throw error;
      }
      cachedApiToken = nextToken;
      if (nextRefreshToken) cachedRefreshToken = nextRefreshToken;
      return nextToken;
    } catch (error) {
      if (hasCredentialAuth() && (error?.statusCode === 401 || error?.statusCode === 503)) {
        return loginWithCredentials();
      }
      throw error;
    }
  })();

  try {
    return await refreshInFlight;
  } finally {
    refreshInFlight = null;
  }
}

async function getAuthHeaders() {
  let token = currentApiToken();
  if (!token && (currentRefreshToken() || hasCredentialAuth())) {
    token = await refreshApiToken();
  }
  if (!token) {
    const error = new Error('Download legado ZapSign não configurado. Defina ZAPSIGN_API_TOKEN ou as credenciais ZAPSIGN_USERNAME, ZAPSIGN_PASSWORD e ZAPSIGN_ORGANIZATION_ID.');
    error.statusCode = 503;
    throw error;
  }
  return {
    Authorization: `Bearer ${token}`
  };
}

async function zapsignFetch(pathOrUrl, options = {}, { absolute = false, retryOnAuth = true } = {}) {
  const headers = {
    ...(options.headers || {}),
    ...(await getAuthHeaders())
  };
  const target = absolute ? String(pathOrUrl || '') : apiUrl(pathOrUrl);
  const response = await fetch(target, {
    ...options,
    headers
  });

  if (response.status === 401 && retryOnAuth && (currentRefreshToken() || hasCredentialAuth())) {
    await refreshApiToken();
    return zapsignFetch(pathOrUrl, options, { absolute, retryOnAuth: false });
  }

  return response;
}

async function parseJsonResponse(response) {
  const text = await response.text();
  let data = null;

  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }
  }

  if (!response.ok) {
    const isAuthTokenError = response.status === 401 && (
      data?.code === 'token_not_valid' ||
      /token is invalid or expired/i.test(String(data?.detail || data?.message || data?.error || ''))
    );
    const message =
      isAuthTokenError ? 'Token da integração ZapSign inválido ou expirado.' :
      data?.message ||
      data?.detail ||
      data?.error ||
      `Falha na API da ZapSign (${response.status}).`;
    const error = new Error(message);
    error.status = isAuthTokenError ? 503 : response.status;
    error.statusCode = error.status;
    error.details = data;
    throw error;
  }

  return data || {};
}

export async function getZapSignDocument(docToken) {
  const token = String(docToken || '').trim();
  if (!token) return null;

  const response = await zapsignFetch(`/docs/${encodeURIComponent(token)}/`);

  const documentData = await parseJsonResponse(response);
  return {
    token: documentData.token || token,
    status: String(documentData.status || documentData.document_status || '').toLowerCase(),
    signedFile: documentData.signed_file || documentData.signed_file_url || documentData.original_file || null,
    extraDocs: Array.isArray(documentData.extra_docs)
      ? documentData.extra_docs.map(item => ({
          token: item?.token || null,
          signedFile: item?.signed_file || item?.original_file || null
        })).filter(item => item.token)
      : [],
    raw: documentData
  };
}

export async function downloadSignedZapSignDocument(fileUrl) {
  const url = String(fileUrl || '').trim();
  if (!url) {
    const error = new Error('URL do documento assinado da ZapSign ausente.');
    error.statusCode = 502;
    throw error;
  }

  const attempts = [
    { useAuth: true },
    {}
  ];
  let lastStatus = 0;

  for (const attempt of attempts) {
    let response;
    try {
      response = attempt.useAuth
        ? await zapsignFetch(url, {}, { absolute: true })
        : await fetch(url);
    } catch (error) {
      if (attempt.useAuth && error?.statusCode === 503) {
        continue;
      }
      throw error;
    }
    if (response.ok) {
      const arrayBuffer = await response.arrayBuffer();
      return Buffer.from(arrayBuffer);
    }
    lastStatus = response.status;
  }

  const error = new Error(`Falha ao baixar documento assinado da ZapSign (${lastStatus}).`);
  error.statusCode = lastStatus || 502;
  throw error;
}
