import asyncHandler from '../lib/async-handler.js';
import { hashToken, publicUser } from '../lib/auth.js';
import prisma from '../lib/prisma.js';

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

  const session = await prisma.userSession.findUnique({
    where: { tokenHash: hashToken(token) },
    include: {
      user: {
        include: {
          collaborator: true
        }
      }
    }
  });

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
  if (!req.auth || (req.auth.user.role !== 'MANAGER' && req.auth.user.role !== 'COLLABORATOR')) {
    return res.status(403).json({ error: 'Acesso restrito a usuarios internos.' });
  }

  next();
}
