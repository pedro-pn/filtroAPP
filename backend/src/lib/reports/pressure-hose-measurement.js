export function isPressureHoseUnits(data = {}) {
  const raw = data?.equipamentoTestado || data?.['Equipamento testado'];
  return ['mangueira', 'mangueiras', 'mangote', 'mangotes'].includes(String(raw ?? '').trim().toLowerCase())
    && (data?.medicaoMangotes ?? data?.['Medição de mangueiras']) === 'UN';
}

export function pressureHoseQuantity(data = {}) {
  const raw = data?.quantidadeMangotes ?? data?.['Quantidade de mangotes (un)'];
  if (!['number', 'string'].includes(typeof raw) || String(raw).trim() === '') return null;
  const value = Number(String(raw).trim().replace(',', '.'));
  return Number.isSafeInteger(value) && value > 0 && value <= 999999999999 ? value : null;
}

export function assertPressureHoseMeasurement(service) {
  const type = String(service.serviceType ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z]/g, '');
  if (!['pressao', 'testepressao', 'testedepressao'].includes(type) || !isPressureHoseUnits(service.extraData)) return;
  if (pressureHoseQuantity(service.extraData) === null) {
    throw Object.assign(new Error('Para teste de pressão de mangotes por unidade, informe uma quantidade inteira positiva de mangotes.'), { statusCode: 400 });
  }
}
