export const ADDITIONAL_PROPOSAL_METRICS = [
  { key: 'plannedDays', label: 'Dias corridos previstos (totais)', unit: 'dias' },
  { key: 'workedDays', label: 'Dias de trabalho previstos', unit: 'dias' },
  { key: 'plannedCost', label: 'Orçamento previsto', unit: 'BRL' },
  { key: 'salePrice', label: 'Receita prevista', unit: 'BRL' },
  { key: 'expectedProfit', label: 'Lucro previsto', unit: 'BRL' },
  { key: 'taxes', label: 'Impostos previstos', unit: 'BRL' },
  { key: 'hours', label: 'Horas previstas (normais e extras)', unit: 'h' }
];

// Ausência de configuração mantém o comportamento das seleções já existentes.
export function normalizeAdditionalMetricInclusion(value) {
  return Object.fromEntries(ADDITIONAL_PROPOSAL_METRICS.map(({ key }) => [key, value?.[key] !== false]));
}

export function applyAdditionalMetricInclusion(proposal, value = proposal.metricInclusion) {
  const metricInclusion = normalizeAdditionalMetricInclusion(value);
  const result = { ...proposal, metricInclusion };
  for (const { key } of ADDITIONAL_PROPOSAL_METRICS) {
    if (key !== 'hours' && !metricInclusion[key]) result[key] = null;
  }
  // O detalhamento por categoria acompanha o orçamento que ele compõe.
  if (!metricInclusion.plannedCost) result.components = {};
  if (!metricInclusion.salePrice || !metricInclusion.expectedProfit) result.expectedMargin = null;
  return result;
}
