import asyncHandler from '../lib/async-handler.js';
import { hashToken, publicUser } from '../lib/auth.js';
import prisma from '../lib/prisma.js';

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
              collaborator: true
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
    return res.status(401).json({ error: 'Sessao invalida ou expirada.' });
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
  if (!req.auth || req.auth.user.role !== 'MANAGER') {
    return res.status(403).json({ error: 'Acesso restrito ao gestor.' });
  }

  next();
}

export function requireInternalUser(req, res, next) {
  if (!req.auth || !['MANAGER', 'COLLABORATOR', 'COORDINATOR'].includes(req.auth.user.role)) {
    return res.status(403).json({ error: 'Acesso restrito a usuarios internos.' });
  }

  next();
}
