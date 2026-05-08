import { signerUrlForToken } from './zapsign.js';
import { ZAPSIGN_SIGNERS_KEY } from './zapsign-progress.js';

export function normalizeSignerEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function authSignerEmail(authUser) {
  const email = normalizeSignerEmail(authUser?.email);
  if (email) return email;
  const username = String(authUser?.username || '').trim();
  return username.includes('@') ? normalizeSignerEmail(username) : '';
}

function configuredClientSigner(project, email) {
  const signers = Array.isArray(project?.clientSigners) ? project.clientSigners : [];
  return signers.find(signer => normalizeSignerEmail(signer?.email) === email) || null;
}

export function resolveZapSignSigner(report, authUser) {
  const project = report?.project || {};
  const signerEmail = authSignerEmail(authUser);
  if (!signerEmail) {
    const error = new Error('Usuário sem e-mail para solicitar assinatura digital.');
    error.statusCode = 403;
    throw error;
  }

  const primaryEmail = normalizeSignerEmail(project.clientEmailPrimary);
  if (signerEmail === primaryEmail) {
    return {
      signerName: String(authUser?.name || project.clientName || 'Cliente').trim() || 'Cliente',
      signerEmail
    };
  }

  const signerEntry = configuredClientSigner(project, signerEmail);
  if (signerEntry) {
    return {
      signerName: String(signerEntry.name || authUser?.name || 'Cliente').trim() || 'Cliente',
      signerEmail
    };
  }

  const error = new Error('Apenas o cliente principal ou um assinante configurado pode solicitar assinatura digital.');
  error.statusCode = 403;
  throw error;
}

export function zapsignAdditionalSignersForProject(project, signerEmail) {
  const selectedEmail = normalizeSignerEmail(signerEmail);
  const signers = [];
  const seen = new Set([selectedEmail].filter(Boolean));

  const primaryEmail = normalizeSignerEmail(project?.clientEmailPrimary);
  if (primaryEmail && !seen.has(primaryEmail)) {
    signers.push({
      name: String(project?.clientName || 'Cliente').trim() || 'Cliente',
      email: primaryEmail
    });
    seen.add(primaryEmail);
  }

  const configuredSigners = Array.isArray(project?.clientSigners) ? project.clientSigners : [];
  for (const signer of configuredSigners) {
    const email = normalizeSignerEmail(signer?.email);
    if (!email || seen.has(email)) continue;
    signers.push({
      name: String(signer?.name || 'Assinante').trim() || 'Assinante',
      email
    });
    seen.add(email);
  }

  return signers;
}

export function resolveSignerUrlForUser(report, authUser) {
  const userEmail = authSignerEmail(authUser);
  if (!userEmail) return null;

  const extras = Array.isArray(report?.specialConditions?.[ZAPSIGN_SIGNERS_KEY])
    ? report.specialConditions[ZAPSIGN_SIGNERS_KEY]
    : [];
  const match = extras.find(signer => normalizeSignerEmail(signer?.email) === userEmail);
  if (match) return match.signerUrl || signerUrlForToken(match.signerToken);

  const primaryEmail = normalizeSignerEmail(report?.project?.clientEmailPrimary);
  if (userEmail === primaryEmail) {
    return signerUrlForToken(report?.zapsignSignerToken);
  }

  return null;
}

export function resolveSignerUrlFromZapSignDocument(zapDoc, authUser, project) {
  const userEmail = authSignerEmail(authUser);
  if (!userEmail) return null;

  const zapSigners = Array.isArray(zapDoc?.raw?.signers) ? zapDoc.raw.signers : [];
  const match = zapSigners.find(signer => normalizeSignerEmail(signer?.email) === userEmail);
  if (match) {
    const token = match.token || match.signer_token || match.uuid || null;
    return match.sign_url || match.signer_url || signerUrlForToken(token);
  }

  const primaryEmail = normalizeSignerEmail(project?.clientEmailPrimary);
  if (userEmail === primaryEmail) return zapDoc?.signerUrl || null;
  return null;
}
