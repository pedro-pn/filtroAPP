export const MECHANICAL_MEASURES: Record<string, { unit: 'M' | 'UN' | 'KG' | 'T' | 'L'; label: string; metric: string }>;
export function mechanicalMeasureType(unit: unknown): string | null;
export function mechanicalMeasurement(data?: Record<string, unknown>): { systemType: string; unit: string; quantity: number } | null;
