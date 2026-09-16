import { cleaningSystemQuantity, isSystemCleaning } from '../reports/cleaning-measurement.js';
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
  const completeSystem = normalizeRdoServiceType(serviceType) === 'LIMPEZA_QUIMICA' && isSystemCleaning(data);
  let tubulacaoM = 0;
  for (const tube of !completeSystem && Array.isArray(data.tubes) ? data.tubes : []) {
    const c = num(tube?.c);
    if (c !== null) tubulacaoM += tube?.lengthUnit === 'cm' ? c / 100 : c;
  }
  const vol = num(data.volumeOleo);
  const oleoL = !completeSystem && vol !== null ? (data.volumeOleoUnit === 'mL' ? vol / 1000 : vol) : 0;
  return { tubulacaoM, oleoL, ...(serviceType ? { sistemasUn: completeSystem ? cleaningSystemQuantity(data) ?? 0 : 0 } : {}) };
}

// A lista e o avanço compartilham a extração: cada tubo, volume ou sistema é uma medição.
export function extractServiceMeasurements(service, canonical = normalizeRdoServiceType(service.serviceType)) {
  if (!canonical) return [];
  const data = service.extraData ?? {}, realized = realizedFromExtraData(data, canonical);
  const context = {
    projectSystemId: data.__projectSystemId || null,
    equipment: data.equipmentId || data['Equipamento(s)'] || '', system: service.system || data.system || data.Sistema || ''
  };
  const rows = [];
  const completeSystem = canonical === 'LIMPEZA_QUIMICA' && isSystemCleaning(data);
  for (const tube of !completeSystem && Array.isArray(data.tubes) ? data.tubes : []) {
    const quantity = num(tube?.c);
    if (quantity == null || quantity <= 0) continue;
    rows.push({ ...context, systemType: 'TUBULACAO', diameter: tube.d, diameterUnit: tube.unit || 'pol',
      bitola: diameterKey(tube.d, tube.unit), quantity: tube.lengthUnit === 'cm' ? quantity / 100 : quantity });
  }
  if (realized.oleoL > 0) rows.push({ ...context, systemType: 'OLEO', bitola: '', quantity: realized.oleoL });
  if (realized.sistemasUn > 0) rows.push({ ...context, systemType: 'SISTEMA', bitola: '', quantity: realized.sistemasUn });
  return rows;
}
