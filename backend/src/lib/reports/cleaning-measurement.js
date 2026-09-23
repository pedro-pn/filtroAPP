// Campos de edição e rótulos persistidos no RLQ compartilham a mesma medição.
export function isSystemCleaning(data = {}) {
  const raw = data?.limpezaTubulacao ?? data?.['Limpeza de tubulação?'] ?? data?.['Limpeza de tubulacao?'];
  return String(Array.isArray(raw) ? raw[0] : raw ?? '').normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').trim().toLowerCase() === 'nao';
}

export function cleaningSystemQuantity(data = {}) {
  const raw = data?.quantidadeSistemas ?? data?.['Quantidade de sistemas (un)'];
  if (!['number', 'string'].includes(typeof raw) || String(raw).trim() === '') return null;
  const value = Number(String(raw).trim().replace(',', '.'));
  return Number.isSafeInteger(value) && value > 0 && value <= 999999999999 ? value : null;
}

export function assertCleaningMeasurement(service) {
  const type = String(service.serviceType ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z]/g, '');
  if (!['limpeza', 'limpezaquimica'].includes(type) || !isSystemCleaning(service.extraData)) return;
  const data = service.extraData;
  const name = String(service.system ?? data.system ?? data.Sistema ?? '').trim();
  if (!name || cleaningSystemQuantity(data) === null) {
    throw Object.assign(new Error('Para limpeza química sem tubulação, informe o nome do sistema e uma quantidade inteira positiva em unidades.'), { statusCode: 400 });
  }
}
