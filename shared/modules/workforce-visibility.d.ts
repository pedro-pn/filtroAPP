export type WorkforceVisibilityTarget = 'RDO' | 'EFETIVO' | 'ALLOCATION_REVIEW' | 'PRODUCTIVITY' | 'ACOMPANHAMENTO' | 'EQUIPMENT' | 'ROMANEIO' | 'API' | 'EPI';
export type WorkforceVisibilityClassification = 'OPERATIONAL' | 'NON_OPERATIONAL' | 'PENDING';
export type WorkforceVisibilityRules = Record<WorkforceVisibilityTarget, WorkforceVisibilityClassification[]>;
export const WORKFORCE_VISIBILITY_TARGETS: ReadonlyArray<{ key: WorkforceVisibilityTarget; label: string; description: string }>;
export const WORKFORCE_VISIBILITY_CLASSIFICATIONS: readonly WorkforceVisibilityClassification[];
export function defaultWorkforceVisibilityRules(): WorkforceVisibilityRules;
