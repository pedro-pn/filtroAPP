import asyncHandler from '../lib/async-handler.js';
import { hashToken, publicUser } from '../lib/auth.js';
import { hasModuleRole } from '../lib/module-roles.js';
import prisma from '../lib/prisma.js';

export const RDO_INTERNAL_ROLES = ['rdo:manager', 'rdo:coordinator', 'rdo:collaborator'];
export const RDO_ACCESS_ROLES = [...RDO_INTERNAL_ROLES, 'rdo:client'];
export const INTERNAL_ACCOUNT_ROLES = [
  ...RDO_INTERNAL_ROLES,
  'romaneio:manager',
  'romaneio:operator',
  'epi:technician',
  'epi:collaborator'
];
export const ROMANEIO_ACCESS_ROLES = INTERNAL_ACCOUNT_ROLES;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function findSessionWithRetry(tokenHash, options = {}) {
  const attempts = options.attempts || 3;
  const delayMs = options.delayMs || 25;
  let lastError = null;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await prisma.userSession.findUnique({
        where: { tokenHash },
        include: {
          user: {
            include: {
              collaborator: true,
              moduleRoles: true
            }
          }
        }
      });
    } catch (error) {
      lastError = error;
      if (attempt < attempts - 1) {
        await sleep(delayMs);
      }
    }
  }

  throw lastError;
}

function bearerToken(req) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) return '';
  return header.slice(7).trim();
}

export const requireAuth = asyncHandler(async (req, res, next) => {
  const token = bearerToken(req);
  if (!token) {
    return res.status(401).json({ error: 'Sessao ausente.' });
  }

  const session = await findSessionWithRetry(hashToken(token));

  if (!session || session.expiresAt <= new Date() || !session.user.isActive) {
    return res.status(401).json({ error: 'Sessão inválida ou expirada.' });
  }

  req.auth = {
    token,
    sessionId: session.id,
    user: publicUser(session.user),
    rawUser: session.user
  };

  next();
});

export function requireManager(req, res, next) {
  if (!req.auth || req.auth.user.accountType !== 'ADMIN' || !hasModuleRole(req.auth.user, 'rdo:manager')) {
    return res.status(403).json({ error: 'Acesso restrito ao gestor.' });
  }

  next();
}

export function requireHubAdmin(req, res, next) {
  if (!req.auth || req.auth.user.accountType !== 'ADMIN') {
    return res.status(403).json({ error: 'Acesso restrito ao administrador.' });
  }

  next();
}

export function requireInternalUser(req, res, next) {
  if (!req.auth || !hasModuleRole(req.auth.user, RDO_INTERNAL_ROLES)) {
    return res.status(403).json({ error: 'Acesso restrito a usuários internos.' });
  }

  next();
}

export function requireAnyInternalAccount(req, res, next) {
  if (!req.auth || req.auth.user.accountType === 'CLIENT') {
    return res.status(403).json({ error: 'Acesso restrito a contas internas.' });
  }

  next();
}

export function requireModuleRole(...roles) {
  return (req, res, next) => {
    if (!req.auth || !hasModuleRole(req.auth.user, roles)) {
      return res.status(403).json({ error: 'Acesso restrito ao módulo.' });
    }

    next();
  };
}
