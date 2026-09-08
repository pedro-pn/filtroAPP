export const EFETIVO_MONTHLY_REFERENCE_KEY = 'efetivo.referenciaMensalHH';
export const EFETIVO_MONTHLY_REFERENCE_DEFAULT = 161;

async function resolveDatabase(database) {
  if (database) return database;
  const { default: prisma } = await import('../prisma.js');
  return prisma;
}

function normalizeReference(value) {
  const normalized = Number(value);
  if (!Number.isFinite(normalized) || normalized <= 0) {
    throw new Error('Referência mensal de HH inválida.');
  }
  return normalized;
}

function publicSetting(row) {
  const storedValue = row?.numberValue;
  return {
    referenciaMensalHH: typeof storedValue === 'number' && Number.isFinite(storedValue)
      ? storedValue
      : EFETIVO_MONTHLY_REFERENCE_DEFAULT,
    atualizadoEm: row?.updatedAt ?? null,
    atualizadoPor: row?.updatedByUserId ?? null
  };
}

export async function getEfetivoReferenceSetting(database = null) {
  const db = await resolveDatabase(database);
  const row = await db.efetivoSetting.findUnique({
    where: { key: EFETIVO_MONTHLY_REFERENCE_KEY }
  });
  return publicSetting(row);
}

export async function setEfetivoReferenceSetting(value, updatedByUserId = null, database = null) {
  const db = await resolveDatabase(database);
  const numberValue = normalizeReference(value);
  const row = await db.efetivoSetting.upsert({
    where: { key: EFETIVO_MONTHLY_REFERENCE_KEY },
    create: {
      key: EFETIVO_MONTHLY_REFERENCE_KEY,
      numberValue,
      updatedByUserId
    },
    update: { numberValue, updatedByUserId }
  });
  return publicSetting(row);
}
