export function resetUrlForToken(appUrl, token) {
  const base = String(appUrl || '').replace(/\/+$/, '');
  if (!base) return '';
  return `${base}/reset-password?token=${encodeURIComponent(token)}`;
}

export function missingClientAccessResetConfig(envConfig, missingMailerConfig = []) {
  return [
    ...missingMailerConfig.map(item => `SMTP ${item}`),
    ...(!envConfig.appUrl ? ['APP_URL'] : [])
  ];
}

export async function sendClientAccessResetEmail({
  user,
  prismaClient,
  envConfig,
  createToken,
  mailer,
  templateBuilder
}) {
  await prismaClient.passwordResetToken.deleteMany({
    where: {
      userId: user.id,
      usedAt: null
    }
  });

  const { token, expiresAt } = await createToken(user.id);
  const template = templateBuilder({
    userName: user.name || user.username,
    resetUrl: resetUrlForToken(envConfig.appUrl, token),
    expiresLabel: '1 hora'
  });

  try {
    await mailer({
      to: user.email,
      ...template
    });
  } catch (error) {
    await prismaClient.passwordResetToken.deleteMany({
      where: {
        userId: user.id,
        expiresAt,
        usedAt: null
      }
    });
    throw error;
  }
}
