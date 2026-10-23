export function parseDecimal(val) {
  const str = String(val).trim();
  if (!str) return null;
  const hasComma = str.includes(',');
  const hasDot = str.includes('.');
  let normalized;
  if (hasComma && hasDot) {
    // pt-BR: ponto = separador de milhar, vírgula = separador decimal (ex.: "1.500,5").
    normalized = str.replace(/\./g, '').replace(',', '.');
  } else if (hasComma) {
    // Apenas vírgula: separador decimal (ex.: "2,5").
    normalized = str.replace(',', '.');
  } else if (hasDot) {
    // Apenas ponto é ambíguo: pode ser milhar pt-BR ("1.000" = 1000) ou decimal ("1.5").
    // Tratamos como separador de milhar quando há mais de um ponto ("1.000.000") ou
    // quando o ponto separa exatamente 3 dígitos finais ("1.000", "10.000"); caso
    // contrário é decimal ("1.5", "1.50", "12.34").
    const dotCount = (str.match(/\./g) || []).length;
    const afterLastDot = str.slice(str.lastIndexOf('.') + 1);
    normalized = dotCount > 1 || afterLastDot.length === 3
      ? str.replace(/\./g, '')
      : str;
  } else {
    normalized = str;
  }
  const num = parseFloat(normalized);
  return Number.isNaN(num) ? null : num;
}

export function parseVolumeOleo(service) {
  // extraData may have volumeOleo + volumeOleoUnit or a combined 'Volume de óleo'
  const extra = service.extraData || {};

  // New format: separate fields
  const vol = extra.volumeOleo ?? extra['Volume de óleo'];
  let unit = extra.volumeOleoUnit ?? extra['Unidade de volume de óleo'];

  if (vol === undefined || vol === null || vol === '') return { liters: null, ignored: true };

  let numericValue = vol;
  const combined = String(vol).trim().match(/^([+-]?\d+(?:[.,]\d+)?)\s*([a-zA-Z³]+)?$/u);
  if (combined) {
    numericValue = combined[1];
    unit = unit ?? combined[2];
  }

  const num = parseDecimal(numericValue);
  if (num == null) return { liters: null, ignored: true };

  const unitStr = String(unit || 'L').trim().toLowerCase();
  if (unitStr === 'ml') return { liters: num / 1000, ignored: false };
  if (unitStr === 'm³' || unitStr === 'm3') return { liters: num * 1000, ignored: false };
  // L, litro, litros, l
  return { liters: num, ignored: false };
}

export function parseTubulacoes(service) {
  const extra = service.extraData || {};
  const raw = extra['Diâmetros e comprimentos'] || extra['Diametros e comprimentos'] || extra.diametros || extra.tubes || [];
  if (!Array.isArray(raw)) return { byDiameter: {}, ignoredCount: 0 };

  const byDiameter = {};
  let ignoredCount = 0;

  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      ignoredCount++;
      continue;
    }
    const d = item.d || item.diametro;
    const dUnit = String(item.unit || item.dUnit || '').trim(); // "pol" | "mm" | ""
    const c = item.c ?? item.comprimento;
    const cUnit = String(item.lengthUnit || item.comprimentoUnit || 'm').toLowerCase();

    if (!d || c === undefined || c === null) { ignoredCount++; continue; }

    const meters = parseDecimal(c);
    if (meters == null) { ignoredCount++; continue; }

    const normalizedMeters = cUnit === 'cm' ? meters / 100 : cUnit === 'mm' ? meters / 1000 : meters;
    const key = dUnit ? `${String(d).trim()} ${dUnit}` : String(d).trim();
    byDiameter[key] = (byDiameter[key] || 0) + normalizedMeters;
  }

  return { byDiameter, ignoredCount };
}
