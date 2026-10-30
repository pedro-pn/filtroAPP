import { SEDE_OMIE_CODES, SEDE_OPERATIONAL_CODES } from '../acompanhamento/sede-cost-centers.js';

const sedeProjectCodes = [...new Set([...SEDE_OMIE_CODES, ...SEDE_OPERATIONAL_CODES])];

// Keep the integration catalog loadable before installing/generating Prisma.
export function efetivoProjectBaseWhere() {
  return { deletedAt: null, code: { notIn: sedeProjectCodes } };
}
