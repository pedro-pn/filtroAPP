export const ZAPSIGN_SIGNERS_KEY = '__zapSignSigners';
export const ZAPSIGN_SIGNATURE_PROGRESS_KEY = '__zapSignSignatureProgress';
export const ZAPSIGN_BATCH_DOC_TOKENS_KEY = '__zapSignBatchDocTokens';
export const ZAPSIGN_BATCH_MAIN_DOC_TOKEN_KEY = '__zapSignBatchMainDocToken';

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function firstString(...values) {
  for (const value of values) {
    const text = String(value || '').trim();
    if (text) return text;
  }
  return '';
}

function normalizedDate(value) {
  const raw = firstString(value);
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function signerToken(signer) {
  return firstString(signer?.token, signer?.signer_token, signer?.signerToken, signer?.token_signer, signer?.uuid);
}

function signerEmail(signer) {
  return firstString(signer?.email, signer?.user?.email, signer?.email_user).toLowerCase();
}

function signerName(signer) {
  return firstString(signer?.name, signer?.full_name, signer?.user?.name, signer?.email, signer?.user?.email, signer?.email_user);
}

function signerSignedAt(signer) {
  return normalizedDate(signer?.signed_at || signer?.last_signed_at || signer?.signedAt || signer?.signature_date);
}

function signerIsSigned(signer) {
  const status = firstString(signer?.status, signer?.sign_status, signer?.signature_status).toLowerCase();
  return Boolean(signer?.signed || signer?.has_signed || signer?.is_signed) ||
    Boolean(signerSignedAt(signer)) ||
    ['signed', 'assinado', 'assinou', 'completed', 'complete'].includes(status);
}

function normalizeSigner(signer) {
  const signedAt = signerSignedAt(signer);
  const signed = signerIsSigned(signer);
  return {
    token: signerToken(signer) || null,
    name: signerName(signer) || 'Assinante',
    email: signerEmail(signer) || null,
    status: signed ? 'SIGNED' : 'PENDING',
    signedAt: signedAt || null
  };
}

function sameSigner(a, b) {
  const aToken = signerToken(a);
  const bToken = signerToken(b);
  if (aToken && bToken && aToken === bToken) return true;
  const aEmail = signerEmail(a);
  const bEmail = signerEmail(b);
  if (aEmail && bEmail && aEmail === bEmail) return true;
  const aName = signerName(a).toLowerCase();
  const bName = signerName(b).toLowerCase();
  return Boolean(aName && bName && aName === bName);
}

function signerWhoSigned(body) {
  return body?.signer_who_signed || body?.signer || body?.document?.signer_who_signed || null;
}

function webhookSigners(body) {
  return asArray(body?.signers || body?.document?.signers);
}

function detailSigners(details, raw) {
  return asArray(raw.signers || details?.signers);
}

export function buildZapSignSignatureProgress(details, body = {}) {
  const raw = details?.raw || details || {};
  const signers = webhookSigners(body).length ? webhookSigners(body) : detailSigners(details, raw);
  const signedByWebhook = signerWhoSigned(body);
  let matchedWebhookSigner = false;
  const normalized = signers.map(signer => {
    if (signedByWebhook && sameSigner(signer, signedByWebhook)) {
      matchedWebhookSigner = true;
      return normalizeSigner({
        ...signer,
        status: 'signed',
        signed_at: signer?.signed_at || signedByWebhook?.signed_at || body?.signed_at || new Date().toISOString()
      });
    }
    return normalizeSigner(signer);
  });

  if (signedByWebhook && !matchedWebhookSigner) {
    const signedSigner = normalizeSigner({
      ...signedByWebhook,
      status: 'signed',
      signed_at: signedByWebhook?.signed_at || body?.signed_at || new Date().toISOString()
    });
    if (normalized.length) {
      const replaceIndex = normalized.findIndex(signer => signer.status !== 'SIGNED');
      normalized[replaceIndex >= 0 ? replaceIndex : 0] = signedSigner;
    } else {
      normalized.push(signedSigner);
    }
  }

  const signed = normalized.filter(item => item.status === 'SIGNED').length;
  return {
    total: normalized.length,
    signed,
    pending: Math.max(normalized.length - signed, 0),
    signers: normalized,
    updatedAt: new Date().toISOString()
  };
}
