export type ProjectCostDetail = {
  consumo: { gasto: number; previsto: number | null; omie?: number; estoque?: number; manual?: number };
  maoDeObra?: { custo: number | null } | null;
};
export function projectCostSummary(detail: ProjectCostDetail): {
  total: number; percent: number | null;
  categories: { code: string; label: string; value: number }[];
};
