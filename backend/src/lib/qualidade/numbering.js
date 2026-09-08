import { QUALITY_TYPE_LETTERS } from '../../../../shared/schemas/qualidade.js';

export function qualityRecordYear(registeredAt) {
  const date = registeredAt instanceof Date ? registeredAt : new Date(registeredAt);
  if (Number.isNaN(date.getTime())) throw new Error('Data do registro inválida.');
  return date.getUTCFullYear();
}

export function formatQualityRecordNumber(type, seq, year) {
  const letter = QUALITY_TYPE_LETTERS[type];
  if (!letter) throw new Error('Tipo de registro inválido.');
  return `${letter}-${String(seq).padStart(3, '0')}/${String(year).slice(-2)}`;
}

export async function nextQualityRecordNumber(client, { type, registeredAt }) {
  const year = qualityRecordYear(registeredAt);
  const row = await client.qualityRecordSeq.upsert({
    where: { type_year: { type, year } },
    create: { type, year, lastSeq: 1 },
    update: { lastSeq: { increment: 1 } }
  });
  const seq = row.lastSeq;
  return {
    seq,
    year,
    number: formatQualityRecordNumber(type, seq, year)
  };
}
