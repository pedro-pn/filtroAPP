import { NOTIFICATION_EMAIL_PURPOSES } from '../../../../shared/schemas/notification-email-settings.js';

const SETTING_KEY_PREFIX = 'notificationEmail.';

function settingKey(purpose) {
  return `${SETTING_KEY_PREFIX}${purpose}`;
}

async function resolveDatabase(database) {
  if (database) return database;
  const { default: prisma } = await import('../prisma.js');
  return prisma;
}

/** E-mail configurado hoje para a finalidade, ou `null` se nunca foi definido. */
export async function getNotificationEmailSetting(purpose, database = null) {
  const db = await resolveDatabase(database);
  const row = await db.efetivoSetting.findUnique({ where: { key: settingKey(purpose) } });
  return row?.textValue || null;
}

export async function setNotificationEmailSetting(purpose, email, actorUserId = null, database = null) {
  const db = await resolveDatabase(database);
  const normalized = String(email || '').trim();
  if (!normalized) throw new Error('Informe um e-mail válido.');
  const row = await db.efetivoSetting.upsert({
    where: { key: settingKey(purpose) },
    create: { key: settingKey(purpose), textValue: normalized, updatedByUserId: actorUserId },
    update: { textValue: normalized, updatedByUserId: actorUserId }
  });
  return { email: row.textValue, updatedAt: row.updatedAt, updatedByUserId: row.updatedByUserId };
}

/** Lista todas as finalidades cadastradas no código, com o e-mail atual (ou `null`) de cada uma — para a tela
 * de Administração mostrar todas de uma vez, inclusive as que ainda não foram configuradas. */
export async function listNotificationEmailSettings(database = null) {
  const db = await resolveDatabase(database);
  const rows = await db.efetivoSetting.findMany({
    where: { key: { in: NOTIFICATION_EMAIL_PURPOSES.map(item => settingKey(item.key)) } }
  });
  const byPurpose = new Map(rows.map(row => [row.key.slice(SETTING_KEY_PREFIX.length), row]));
  return NOTIFICATION_EMAIL_PURPOSES.map(purpose => {
    const row = byPurpose.get(purpose.key);
    return {
      ...purpose,
      email: row?.textValue || null,
      updatedAt: row?.updatedAt || null,
      updatedByUserId: row?.updatedByUserId || null
    };
  });
}
