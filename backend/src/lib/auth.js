import { createHash, randomBytes } from 'node:crypto';

import prisma from './prisma.js';

const SESSION_DAYS = 7;
const PASSWORD_RESET_HOURS = 1;

export function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

export async function createSession(userId) {
  const token = randomBytes(32).toString('hex');
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);

  await prisma.userSession.create({
    data: {
      tokenHash,
      userId,
      expiresAt
    }
  });

  return { token, expiresAt };
}

export async function createPasswordResetToken(userId) {
  const token = randomBytes(32).toString('hex');
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + PASSWORD_RESET_HOURS * 60 * 60 * 1000);

  await prisma.passwordResetToken.create({
    data: {
      tokenHash,
      userId,
      expiresAt
    }
  });

  return { token, expiresAt };
}

export function publicUser(user) {
  if (!user) return null;

  return {
    id: user.id,
    username: user.username,
    name: user.name,
    email: user.email || null,
    role: user.role,
    isActive: user.isActive,
    collaboratorId: user.collaboratorId || null,
    collaborator: user.collaborator
      ? {
          id: user.collaborator.id,
          code: user.collaborator.code,
          name: user.collaborator.name,
          role: user.collaborator.role
        }
      : null
  };
}
