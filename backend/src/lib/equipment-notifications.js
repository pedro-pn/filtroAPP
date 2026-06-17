// Config (singleton) e destinatários das notificações de calibração do módulo
// Equipamentos. Substitui a lista fixa de gestores/coordenadores por uma lista
// configurável (contas internas + e-mails avulsos) e marcos ajustáveis.

import prisma from './prisma.js';

const CONFIG_ID = 'default';

export const DEFAULT_NOTIFICATION_CONFIG = {
  enabled: true,
  milestoneDays: [30, 15, 7],
  notifyOnDueDay: true,
  repeatExpired: true,
  repeatGapDays: 5
};

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

export function sanitizeMilestoneDays(value) {
  const list = Array.isArray(value) ? value : [];
  const cleaned = Array.from(new Set(
    list
      .map(item => Math.trunc(Number(item)))
      .filter(item => Number.isFinite(item) && item > 0 && item <= 365)
  )).sort((a, b) => b - a);
  return cleaned.slice(0, 10);
}

export function normalizeNotificationConfig(row) {
  if (!row) return { ...DEFAULT_NOTIFICATION_CONFIG };
  const milestoneDays = sanitizeMilestoneDays(row.milestoneDays);
  return {
    enabled: row.enabled !== false,
    milestoneDays: milestoneDays.length ? milestoneDays : [...DEFAULT_NOTIFICATION_CONFIG.milestoneDays],
    notifyOnDueDay: row.notifyOnDueDay !== false,
    repeatExpired: row.repeatExpired !== false,
    repeatGapDays: Number.isFinite(row.repeatGapDays) && row.repeatGapDays > 0 ? Math.trunc(row.repeatGapDays) : DEFAULT_NOTIFICATION_CONFIG.repeatGapDays
  };
}

export async function getEquipmentNotificationConfig(client = prisma) {
  if (!client.equipmentNotificationConfig?.findFirst) return { ...DEFAULT_NOTIFICATION_CONFIG };
  const row = await client.equipmentNotificationConfig.findFirst();
  return normalizeNotificationConfig(row);
}

export async function updateEquipmentNotificationConfig(client, data) {
  const next = normalizeNotificationConfig({ ...DEFAULT_NOTIFICATION_CONFIG, ...data });
  const existing = await client.equipmentNotificationConfig.findFirst({ select: { id: true } });
  const payload = {
    enabled: next.enabled,
    milestoneDays: next.milestoneDays,
    notifyOnDueDay: next.notifyOnDueDay,
    repeatExpired: next.repeatExpired,
    repeatGapDays: next.repeatGapDays
  };
  if (existing) {
    await client.equipmentNotificationConfig.update({ where: { id: existing.id }, data: payload });
  } else {
    await client.equipmentNotificationConfig.create({ data: { id: CONFIG_ID, ...payload } });
  }
  return next;
}

export async function listEquipmentNotificationRecipients(client = prisma) {
  return client.equipmentNotificationRecipient.findMany({ orderBy: { email: 'asc' } });
}

// E-mails ativos (deduplicados) que devem receber as notificações.
export async function activeRecipientEmails(client = prisma) {
  if (!client.equipmentNotificationRecipient?.findMany) return [];
  const rows = await client.equipmentNotificationRecipient.findMany({ where: { isActive: true } });
  return Array.from(new Set(rows.map(row => normalizeEmail(row.email)).filter(Boolean)));
}

export { normalizeEmail };
