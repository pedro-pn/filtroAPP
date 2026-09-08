export const SEDE_COST_CENTERS = [
  { code: '5002', label: 'Sede 5002', shortLabel: 'Sede' },
  { code: '5003', label: 'Galpão 5003', shortLabel: 'Galpão' },
  { code: '5000', label: 'Sede 5000', shortLabel: 'Sede' }
];

export const SEDE_OMIE_CODES = SEDE_COST_CENTERS.map(center => center.code);
export const SEDE_OPERATIONAL_CODES = ['5002', '5004'];

export function isSedeCostCenterCode(value) {
  return SEDE_OMIE_CODES.includes(String(value ?? '').trim());
}
