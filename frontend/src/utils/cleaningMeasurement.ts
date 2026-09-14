export function isSystemCleaning(data: Record<string, unknown>) {
  const raw = data.limpezaTubulacao ?? data['Limpeza de tubulação?'] ?? data['Limpeza de tubulacao?'];
  return String(Array.isArray(raw) ? raw[0] : raw ?? '').normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').trim().toLowerCase() === 'nao';
}

export function cleaningSystemQuantity(data: Record<string, unknown>) {
  const raw = data.quantidadeSistemas ?? data['Quantidade de sistemas (un)'];
  if (!['number', 'string'].includes(typeof raw) || String(raw).trim() === '') return null;
  const value = Number(String(raw).trim().replace(',', '.'));
  return Number.isSafeInteger(value) && value > 0 && value <= 999999999999 ? value : null;
}

// Mudança de modalidade não reaproveita medições ocultas de outra modalidade.
export function cleaningModePatch(mode: 'Sim' | 'Não'): Record<string, unknown> {
  return { limpezaTubulacao: mode, 'Limpeza de tubulação?': mode,
    tubes: [], 'Diâmetros e comprimentos': [], quantidadeSistemas: '', 'Quantidade de sistemas (un)': '' };
}
