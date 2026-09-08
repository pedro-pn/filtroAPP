import { SEDE_OMIE_CODES, SEDE_OPERATIONAL_CODES } from '../acompanhamento/sede-cost-centers.js';

const sedeProjectCodes = [...new Set([...SEDE_OMIE_CODES, ...SEDE_OPERATIONAL_CODES])];

export function efetivoProjectWhere() {
  return {
    managerOnly: false,
    code: { notIn: sedeProjectCodes }
  };
}
