import { isSystemCleaning } from './cleaning-measurement.js';

function isNo(value) {
  return String(Array.isArray(value) ? value[0] : value ?? '').normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').trim().toLowerCase() === 'nao';
}

export function assertSystemTypeWhenVisible(service) {
  const type = String(service.serviceType ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z]/g, '');
  const data = service.extraData || {};
  const visible = (['limpeza', 'limpezaquimica'].includes(type) && isSystemCleaning(data))
    || (type === 'flushing' && isNo(data.flushingTubulacao || data['Flushing em tubulação?'] || data['Flushing em tubulacao?']));
  if (!visible) return;
  const value = data.tipoSistema ?? data['Tipo de sistema'];
  if (typeof value === 'string' && value.trim()) return;
  throw Object.assign(new Error('Informe o tipo de sistema para serviços sem tubulação.'), { statusCode: 400 });
}
