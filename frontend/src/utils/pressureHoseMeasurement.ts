export function isPressureHoseEquipment(data: Record<string, unknown>) {
  const raw = data.equipamentoTestado || data['Equipamento testado'];
  return ['mangueira', 'mangueiras', 'mangote', 'mangotes'].includes(String(raw ?? '').trim().toLowerCase());
}

export function isPressureHoseUnits(data: Record<string, unknown>) {
  return isPressureHoseEquipment(data) && (data.medicaoMangotes ?? data['Medição de mangueiras']) === 'UN';
}

export function pressureHoseQuantity(data: Record<string, unknown>) {
  const raw = data.quantidadeMangotes ?? data['Quantidade de mangotes (un)'];
  if (!['number', 'string'].includes(typeof raw) || String(raw).trim() === '') return null;
  const value = Number(String(raw).trim().replace(',', '.'));
  return Number.isSafeInteger(value) && value > 0 && value <= 999999999999 ? value : null;
}

export function pressureHoseModePatch(units: boolean): Record<string, unknown> {
  return {
    equipamentoTestado: 'mangueira', 'Equipamento testado': 'Mangueiras',
    medicaoMangotes: units ? 'UN' : 'M', 'Medição de mangueiras': units ? 'UN' : 'M',
    equipamentoTestadoOutro: '', 'Outro equipamento testado': '',
    tubes: [], 'Diâmetros e comprimentos': [],
    quantidadeMangotes: '', 'Quantidade de mangotes (un)': ''
  };
}
