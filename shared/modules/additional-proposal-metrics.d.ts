export type AdditionalProposalMetric = 'plannedDays' | 'workedDays' | 'plannedCost'
  | 'salePrice' | 'expectedProfit' | 'taxes' | 'hours';
export type AdditionalMetricInclusion = Record<AdditionalProposalMetric, boolean>;
export const ADDITIONAL_PROPOSAL_METRICS: ReadonlyArray<{
  key: AdditionalProposalMetric; label: string; unit: 'dias' | 'BRL' | 'h';
}>;
export function normalizeAdditionalMetricInclusion(value?: Partial<AdditionalMetricInclusion> | null): AdditionalMetricInclusion;
export function applyAdditionalMetricInclusion<T extends object>(proposal: T, value?: Partial<AdditionalMetricInclusion> | null): T & { metricInclusion: AdditionalMetricInclusion };
