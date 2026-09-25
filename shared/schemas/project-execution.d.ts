export const PROJECT_EXECUTION_REPORT_TYPES: ReadonlyArray<{ key: 'RTP' | 'RLQ' | 'RLR' | 'RCPU' | 'RLM' | 'RLF' | 'RLI'; label: string; source: 'SYSTEM' | 'MANUAL' }>;
export const PROJECT_EXECUTION_DEVIATION_CATEGORIES: ReadonlyArray<{ key: 'PRAZO' | 'ESCOPO' | 'CLIENTE' | 'EQUIPAMENTO' | 'PESSOAL' | 'MATERIAL' | 'SEGURANCA' | 'QUALIDADE' | 'COMERCIAL'; label: string }>;
export const PROJECT_EXECUTION_IMPACTS: readonly ['ALTO', 'MEDIO', 'BAIXO'];
export const PROJECT_EXECUTION_DEVIATION_STATUSES: readonly ['ABERTO', 'EM_TRIAGEM', 'EM_OBSERVACAO', 'EM_ACAO', 'FECHADO', 'DIVULGADO'];
export const PROJECT_EXECUTION_WEEKLY_CHECKS: ReadonlyArray<{ key: 'PROGRESS' | 'SERVICE_FRONTS' | 'DIFFICULTIES' | 'DEVIATIONS_INCIDENTS' | 'REPORT_DELIVERY' | 'REPORT_SIGNATURES'; label: string }>;
export function makeProjectExecutionSchemas(z: typeof import('zod').z): {
  reportTargets: import('zod').ZodType<Record<string, unknown>>;
  deviationCreate: import('zod').ZodType<Record<string, unknown>>;
  deviationStatus: import('zod').ZodType<Record<string, unknown>>;
  weeklyReview: import('zod').ZodType<Record<string, unknown>>;
};
