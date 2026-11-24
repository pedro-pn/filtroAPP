export const SERVICE_LABELS: Readonly<Record<string, string>>;
export const UNIT_LABELS: Readonly<Record<string, string>>;
export function physicalUnit(systemType: string, unit?: string | null): string | null;
export type CompositionSystem = {
  equipment?: string | null;
  systemName?: string | null;
  systemType: string;
  unit: string | null;
  plannedQty: number | null;
  realizedQty: number | null;
};
export type CompositionService = {
  serviceType: string;
  executionPct: number | null;
  systems: CompositionSystem[];
  totals?: CompositionSystem[];
};
export type CompositionProgress = {
  services: CompositionService[];
  scopeGroups?: { scopeName: string | null; services: CompositionService[] }[];
};
export type ServiceCompositionItem = {
  escopo: string | null;
  servico: string;
  rotuloServico: string;
  equipamento: string | null;
  avancoPct: number | null;
  unidade: string | null;
  rotuloUnidade: string | null;
  previsto: number | null;
  realizado: number | null;
  sistemas: number;
};
export function projectServiceComposition(input?: {
  target?: CompositionProgress | null;
  fallbackProgress?: CompositionProgress | null;
  fallbackServices?: CompositionService[];
}): ServiceCompositionItem[];
