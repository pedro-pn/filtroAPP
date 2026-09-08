import { randomBytes } from 'node:crypto';

import { createPasswordResetToken } from '../auth.js';
import { hashPassword } from '../password.js';

export const ACCOUNT_PASSWORD_SETUP_HOURS = 24 * 7;
export const ACCOUNT_PASSWORD_SETUP_EXPIRES_LABEL = '7 dias';

export function passwordSetupUrlForToken(appUrl, token) {
  const base = String(appUrl || '').replace(/\/+$/, '');
  const path = `/reset-password?token=${encodeURIComponent(token)}&setup=1`;
  return base ? `${base}${path}` : path;
}

export async function createPendingPasswordHash() {
  const unreachablePassword = randomBytes(48).toString('base64url');
  return hashPassword(unreachablePassword);
}

export async function issueAccountPasswordSetup({
  userId,
  prismaClient,
  envConfig,
  createToken = createPasswordResetToken
}) {
  await prismaClient.passwordResetToken.deleteMany({
    where: {
      userId,
      usedAt: null
    }
  });

  const { token, expiresAt } = await createToken(userId, prismaClient, {
    expiresInHours: ACCOUNT_PASSWORD_SETUP_HOURS,
    tokenPrefix: 'setup_'
  });
  return {
    url: passwordSetupUrlForToken(envConfig.appUrl, token),
    expiresAt
  };
}
