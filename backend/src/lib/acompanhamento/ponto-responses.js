const monthFields = ['month', 'normalHoras', 'he70Horas', 'he100Horas', 'totalMensal', 'totalMensalBase',
  'fixoMensal', 'variavelMensal', 'custoHora', 'custoHoraBase', 'idle'];
const rateFields = ['collaboratorId', 'name', 'role', 'hasCostProfile', 'normalHoras', 'he70Horas', 'he100Horas',
  'totalHoras', 'folgaHours', 'totalMensalBase', 'totalMensal', 'fixoMensal', 'variavelMensal', 'custoHoraBase', 'custoHora', 'idle'];
const pick = (value, fields) => Object.fromEntries(fields.filter(key => Object.hasOwn(value, key)).map(key => [key, value[key]]));

// Listing/month-filter contract. Audit trails and project allocations remain
// available through the full response and the existing allocation-audit routes.
export function summarizePontoRate(rate) {
  return { ...pick(rate, rateFields), months: (rate.months || []).map(month => pick(month, monthFields)) };
}
