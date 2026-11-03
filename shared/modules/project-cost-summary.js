// Mesmos números na interface do detalhe e na API. Não contém cálculos de folha.
export function projectCostSummary(detail) {
  const consumo = detail.consumo;
  const total = consumo.gasto + (detail.maoDeObra?.custo ?? 0);
  const previsto = consumo.previsto;
  return { total, percent: previsto > 0 ? Math.round(total / previsto * 100) : null,
    categories: [
      { code: 'COMPRAS_OMIE', label: 'Compras (Omie)', value: consumo.omie ?? Math.max(0, consumo.gasto - (consumo.estoque ?? 0) - (consumo.manual ?? 0)) },
      { code: 'ESTOQUE', label: 'Estoque (químicos/filtros)', value: consumo.estoque ?? 0 },
      { code: 'CUSTOS_MANUAIS', label: 'Custos manuais', value: consumo.manual ?? 0 },
      { code: 'MAO_DE_OBRA', label: 'Mão de obra', value: detail.maoDeObra?.custo ?? 0 }
    ] };
}
