import type { HistoricalMeasurement, HistoricalServiceReport, HistoricalServiceType } from '../../api/historicalServices';

export const historicalServiceLabels: Record<HistoricalServiceType, string> = {
  limpeza: 'Limpeza química', pressao: 'Teste de pressão', filtragem: 'Filtragem de óleo', flushing: 'Flushing'
};
export interface HistoricalFormItem extends Omit<HistoricalMeasurement, 'quantity'> { quantity: string }
export interface HistoricalReportForm {
  reportType: HistoricalServiceReport['reportType'];
  sequenceNumber: string;
  reportDate: string;
  items: HistoricalFormItem[];
}
export function newHistoricalItem(serviceType: HistoricalServiceType = 'limpeza'): HistoricalFormItem {
  return { serviceType, equipment: '', system: '', diameter: '', quantity: '', unit: serviceType === 'filtragem' ? 'L' : 'm' };
}
export function historicalReportForm(report?: HistoricalServiceReport): HistoricalReportForm {
  return report ? {
    reportType: report.reportType, sequenceNumber: String(report.sequenceNumber), reportDate: report.reportDate.slice(0, 10),
    items: report.items.map(item => ({ ...item, diameter: item.diameterUnit === 'mm' ? `${item.diameter} mm` : item.diameter, quantity: String(item.quantity).replace('.', ',') }))
  } : { reportType: 'RLQ', sequenceNumber: '', reportDate: '', items: [newHistoricalItem()] };
}
const csvCell = (value: string) => `"${value.replaceAll('"', '""')}"`;
export function historicalFormCsv(form: HistoricalReportForm) {
  return 'Relatorio;Numero;Data;Servico;Equipamento do cliente;Sistema;Diametro;Quantidade;Unidade\r\n'
    + form.items.map(item => [form.reportType, form.sequenceNumber, form.reportDate,
      historicalServiceLabels[item.serviceType], item.equipment, item.system, item.diameter, item.quantity, item.unit
    ].map(csvCell).join(';')).join('\r\n');
}
export function historicalTotals(items: HistoricalMeasurement[]) {
  const totals = new Map<string, { serviceType: HistoricalServiceType; unit: string; quantity: number }>();
  items.forEach(item => {
    const unit = item.unit === 'cm' ? 'm' : item.unit === 'mL' ? 'L' : item.unit;
    const key = `${item.serviceType}:${unit}`;
    const current = totals.get(key) ?? { serviceType: item.serviceType, unit, quantity: 0 };
    current.quantity += item.unit === 'cm' ? item.quantity / 100 : item.unit === 'mL' ? item.quantity / 1000 : item.quantity;
    totals.set(key, current);
  });
  return [...totals.values()];
}
