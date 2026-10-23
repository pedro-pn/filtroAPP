import { MECHANICAL_MEASURES, mechanicalMeasurement } from '../../../../shared/modules/mechanical-measurement.js';
import { cleaningSystemQuantity, isSystemCleaning } from '../reports/cleaning-measurement.js';
import { isPressureHoseUnits, pressureHoseQuantity } from '../reports/pressure-hose-measurement.js';
import { normalizeRdoServiceType } from './service-types.js';
import { diameterKey } from './system-progress.js';

function num(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  let text = String(value).trim().replace(/[^\d,.-]/g, '');
  if (!text) return null;
  text = text.replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.');
  const n = Number.parseFloat(text);
  return Number.isFinite(n) ? n : null;
}

export function realizedFromExtraData(extraData, serviceType) {
  const data = extraData && typeof extraData === 'object' ? extraData : {};
  if (normalizeRdoServiceType(serviceType) === 'LIMPEZA_MECANICA') {
    const measurement = mechanicalMeasurement(data);
    return { tubulacaoM: 0, oleoL: 0, sistemasUn: 0, mangotesUn: 0,
      ...Object.fromEntries(Object.entries(MECHANICAL_MEASURES).map(([type, config]) =>
        [config.metric, measurement?.systemType === type ? measurement.quantity : 0])) };
  }
  const completeSystem = normalizeRdoServiceType(serviceType) === 'LIMPEZA_QUIMICA' && isSystemCleaning(data);
  const hose = normalizeRdoServiceType(serviceType) === 'TESTE_PRESSAO' && isPressureHoseUnits(data);
  let tubulacaoM = 0;
  for (const tube of !completeSystem && !hose && Array.isArray(data.tubes) ? data.tubes : []) {
    const c = num(tube?.c);
    if (c !== null) tubulacaoM += tube?.lengthUnit === 'cm' ? c / 100 : c;
  }
  const vol = num(data.volumeOleo);
  const oleoL = !completeSystem && !hose && vol !== null ? (data.volumeOleoUnit === 'mL' ? vol / 1000 : vol) : 0;
  return { tubulacaoM, oleoL, ...(serviceType ? {
    sistemasUn: completeSystem ? cleaningSystemQuantity(data) ?? 0 : 0,
    mangotesUn: hose ? pressureHoseQuantity(data) ?? 0 : 0
  } : {}) };
}

// A lista e o avanço compartilham a extração: cada tubo, volume ou sistema é uma medição.
export function extractServiceMeasurements(service, canonical = normalizeRdoServiceType(service.serviceType)) {
  if (!canonical) return [];
  const data = service.extraData ?? {}, realized = realizedFromExtraData(data, canonical);
  const context = {
    projectSystemId: data.__projectSystemId || null,
    equipment: data.equipmentId || data['Equipamento(s)'] || '', system: service.system || data.system || data.Sistema || ''
  };
  // O escopo selecionado no RDO identifica a obra mesmo quando o nome do
  // sistema não corresponde ao cadastro atual do cronograma.
  if (typeof data.__scopeName === 'string' || data.__scopeName === null) context.scopeName = data.__scopeName;
  else if (typeof data.__scopeKey === 'string') {
    try {
      const name = JSON.parse(data.__scopeKey);
      if (typeof name === 'string' || name === null) context.scopeName = name;
    } catch { /* Relatórios antigos sem uma seleção válida continuam sem escopo. */ }
  }
  if (canonical === 'LIMPEZA_MECANICA') {
    const measurement = mechanicalMeasurement(data);
    return measurement ? [{ ...context, ...measurement, bitola: '' }] : [];
  }
  const rows = [];
  const completeSystem = canonical === 'LIMPEZA_QUIMICA' && isSystemCleaning(data);
  const hose = canonical === 'TESTE_PRESSAO' && isPressureHoseUnits(data);
  for (const tube of !completeSystem && !hose && Array.isArray(data.tubes) ? data.tubes : []) {
    const quantity = num(tube?.c);
    if (quantity == null || quantity <= 0) continue;
    rows.push({ ...context, systemType: 'TUBULACAO', diameter: tube.d, diameterUnit: tube.unit || 'pol',
      bitola: diameterKey(tube.d, tube.unit), quantity: tube.lengthUnit === 'cm' ? quantity / 100 : quantity });
  }
  if (realized.oleoL > 0) rows.push({ ...context, systemType: 'OLEO', bitola: '', quantity: realized.oleoL });
  if (realized.sistemasUn > 0) rows.push({ ...context, systemType: 'SISTEMA', bitola: '', quantity: realized.sistemasUn });
  if (realized.mangotesUn > 0) rows.push({ ...context, systemType: 'MANGOTE', bitola: '', quantity: realized.mangotesUn });
  return rows;
}
