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
  const error = new Error('Credenciais ZapSign não configuradas. Defina ZAPSIGN_USERNAME, ZAPSIGN_PASSWORD e ZAPSIGN_ORGANIZATION_ID.');
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
    const error = new Error('Integração ZapSign não configurada. Defina ZAPSIGN_API_TOKEN ou as credenciais ZAPSIGN_USERNAME, ZAPSIGN_PASSWORD e ZAPSIGN_ORGANIZATION_ID.');
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

function extractSignerInfo(documentData) {
  const signers = Array.isArray(documentData?.signers) ? documentData.signers : [];
  const signer = signers[0] || {};
  const signerToken = signer.token || signer.signer_token || signer.uuid || null;
  const signerUrl =
    signer.sign_url ||
    signer.signer_url ||
    documentData?.sign_url ||
    documentData?.url ||
    signerUrlForToken(signerToken);

  return { signerToken, signerUrl };
}

function buildUploadPayload({ pdfBuffer, fileName }) {
  return {
    name: String(fileName || 'relatorio.pdf'),
    base64_pdf: Buffer.from(pdfBuffer).toString('base64')
  };
}

export function signerUrlForToken(token) {
  const signerToken = String(token || '').trim();
  if (!signerToken) return null;
  return `https://app.zapsign.com.br/verificar/${encodeURIComponent(signerToken)}`;
}

export function isZapSignEnabled() {
  return !!(currentApiToken() || currentRefreshToken() || hasCredentialAuth());
}

export function assertZapSignEnabled() {
  if (!isZapSignEnabled()) {
    const error = new Error('Integração ZapSign não configurada.');
    error.statusCode = 503;
    throw error;
  }
}

export async function sendToZapSign({
  pdfBuffer,
  fileName,
  signerName,
  signerEmail,
  additionalSigners = [],
  externalId,
  webhookUrl
}) {
  assertZapSignEnabled();

  const payload = {
    ...buildUploadPayload({ pdfBuffer, fileName }),
    external_id: externalId || undefined,
    url_webhook: webhookUrl || undefined,
    locale: 'pt-br',
    sandbox: !!env.zapsignSandbox,
    signers: [
      {
        name: signerName,
        email: signerEmail,
        lock_email: true,
        send_automatic_email: false
      },
      ...additionalSigners.map(s => ({
        name: String(s.name || '').trim() || 'Assinante',
        email: String(s.email || '').trim(),
        lock_email: true,
        send_automatic_email: true
      }))
    ]
  };

  const response = await zapsignFetch('/docs/', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  const documentData = await parseJsonResponse(response);
  const { signerToken, signerUrl } = extractSignerInfo(documentData);

  const rawSigners = Array.isArray(documentData?.signers) ? documentData.signers : [];
  const allSigners = rawSigners.slice(1).map((s, i) => ({
    email: additionalSigners[i]?.email || String(s.email || '').trim(),
    signerToken: s.token || s.signer_token || s.uuid || null,
    signerUrl: s.sign_url || s.signer_url || null
  })).filter(s => s.email && (s.signerToken || s.signerUrl));

  return {
    docToken: documentData.token || documentData.doc_token || null,
    signerToken,
    signerUrl,
    allSigners,
    raw: documentData
  };
}

export async function addExtraDocToZapSign(originalDocToken, { pdfBuffer, fileName }) {
  assertZapSignEnabled();
  const token = String(originalDocToken || '').trim();
  if (!token) {
    const error = new Error('Token do documento principal ZapSign ausente.');
    error.statusCode = 400;
    throw error;
  }

  const response = await zapsignFetch(`/docs/${encodeURIComponent(token)}/upload-extra-doc/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(buildUploadPayload({ pdfBuffer, fileName }))
  });

  const data = await parseJsonResponse(response);
  return {
    docToken: data.token || null,
    signedFile: data.signed_file || null,
    raw: data
  };
}

export async function getZapSignDocument(docToken) {
  assertZapSignEnabled();
  const token = String(docToken || '').trim();
  if (!token) return null;

  const response = await zapsignFetch(`/docs/${encodeURIComponent(token)}/`);

  const documentData = await parseJsonResponse(response);
  const { signerToken, signerUrl } = extractSignerInfo(documentData);
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
    signerToken,
    signerUrl,
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
    const response = attempt.useAuth
      ? await zapsignFetch(url, {}, { absolute: true })
      : await fetch(url);
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

export function verifyWebhookSignature(headers) {
  const expected = String(env.zapsignWebhookSecret || '').trim();
  if (!expected) {
    const error = new Error('ZAPSIGN_WEBHOOK_SECRET não configurado.');
    error.statusCode = 503;
    throw error;
  }

  const headerName = String(env.zapsignWebhookHeader || 'x-zapsign-webhook-secret').trim().toLowerCase();
  const received = String(headers?.[headerName] || '').trim();
  if (!received || received !== expected) {
    const error = new Error('Webhook ZapSign inválido.');
    error.statusCode = 401;
    throw error;
  }
}
