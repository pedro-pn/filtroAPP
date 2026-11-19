import { buildEquipmentCreatedEmailTemplate } from '../email-templates.js';
import { activeRecipientEmails, getEquipmentNotificationConfig } from '../equipment-notifications.js';
import { getMissingMailerConfig, outboundEmailsEnabled, sendMail } from '../mailer.js';
import prisma from '../prisma.js';

export async function notifyEquipmentCreated({
  equipment,
  client = prisma,
  mailer = sendMail,
  missingMailerConfig = getMissingMailerConfig()
} = {}) {
  if (mailer === sendMail && (!outboundEmailsEnabled() || missingMailerConfig.length)) return false;
  const config = await getEquipmentNotificationConfig(client);
  if (!config.notifyOnEquipmentCreated) return false;
  const recipients = await activeRecipientEmails(client, 'notifyEquipmentCreated');
  if (!recipients.length) return false;
  const template = buildEquipmentCreatedEmailTemplate({ equipment });
  for (const email of recipients) await mailer({ to: email, ...template });
  return true;
}

export async function notifyEquipmentCreatedSafely(options = {}) {
  try {
    return await notifyEquipmentCreated(options);
  } catch (error) {
    console.error('Falha ao notificar cadastro de equipamento.', {
      equipmentId: options.equipment?.id,
      error: error?.message || error
    });
    return false;
  }
}
