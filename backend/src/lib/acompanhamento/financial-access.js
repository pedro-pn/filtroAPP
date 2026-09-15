import { canViewProjectFinancials } from '../../../../shared/modules/acompanhamento-permissions.js';

export function requireProjectFinancials(req, res, next) {
  if (!canViewProjectFinancials(req.auth?.user)) {
    return res.status(403).json({ error: 'Sem permissão para visualizar impostos e faturamentos do projeto.' });
  }
  next();
}

// Apply after grouping/calculation, at the API boundary, so the same restriction covers
// individual projects, grouped missions and dashboard/card summaries without changing costs.
export function projectFinancialsForUser(data, user) {
  if (Array.isArray(data)) return data.map(item => projectFinancialsForUser(item, user));
  if (!data) return data;
  const result = { ...data, canViewProjectFinancials: canViewProjectFinancials(user) };
  if (result.canViewProjectFinancials) return result;

  delete result.invoicedRevenue;
  delete result.invoicedIss;
  delete result.invoiceCount;
  delete result.presumedProfitTaxes;
  if (result.faturamento) {
    result.faturamento = { ...result.faturamento };
    delete result.faturamento.realizado;
    delete result.faturamento.notas;
  }
  return result;
}
