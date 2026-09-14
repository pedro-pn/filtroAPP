import { createHash } from 'node:crypto';

export const HISTORICAL_CSV_MAX_BYTES = 500_000;
export const HISTORICAL_MAX_ROWS = 2000;
export const HISTORICAL_SERVICE_LABELS = {
  limpeza: 'Limpeza química', pressao: 'Teste de pressão',
  filtragem: 'Filtragem de óleo', flushing: 'Flushing'
};
const reportTypes = { limpeza: 'RLQ', pressao: 'RTP', filtragem: 'RCPU', flushing: 'RCPU' };
const columns = ['relatorio', 'numero', 'data', 'servico', 'equipamento', 'sistema', 'diametro', 'quantidade', 'unidade'];
const aliases = {
  tiporelatorio: 'relatorio', numerorelatorio: 'numero', nrelatorio: 'numero',
  datadorelatorio: 'data', datarelatorio: 'data', tiposervico: 'servico',
  equipamentodocliente: 'equipamento', equipamentocliente: 'equipamento',
  diametropol: 'diametro', diametropolegadas: 'diametro', diametromm: 'diametro',
  unidadediametro: 'unidadeDiametro', unidadedodiametro: 'unidadeDiametro', diametrounidade: 'unidadeDiametro'
};
const key = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const historicalReportKey = report => `${report.reportType}:${report.sequenceNumber}`;

export function historicalError(message, statusCode = 400) {
  return Object.assign(new Error(message), { statusCode });
}

// RFC-style quoting, UTF-8 BOM, comma/semicolon delimiters and Excel sep= directive.
export function readHistoricalCsv(input) {
  if (typeof input !== 'string' || !input.trim()) throw historicalError('Selecione um CSV com os quantitativos.');
  if (Buffer.byteLength(input, 'utf8') > HISTORICAL_CSV_MAX_BYTES) throw historicalError('O CSV deve ter no máximo 500 KB.');
  let text = input.replace(/^\uFEFF/, '');
  const directive = /^sep=([;,])\r?\n/i.exec(text);
  if (directive) text = text.slice(directive[0].length);
  let delimiter = directive?.[1];
  if (!delimiter) {
    let quoted = false;
    const counts = { ';': 0, ',': 0 };
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      if (char === '"') {
        if (quoted && text[i + 1] === '"') i++;
        else quoted = !quoted;
      } else if (!quoted && (char === '\n' || char === '\r')) break;
      else if (!quoted && char in counts) counts[char]++;
    }
    delimiter = counts[';'] > counts[','] ? ';' : ',';
  }
  const rows = [];
  let cells = [], field = '', quoted = false, closedQuote = false, line = 1, startLine = 1;
  const pushCell = () => { cells.push(field.trim()); field = ''; closedQuote = false; };
  const pushRow = () => {
    pushCell();
    if (cells.some(Boolean)) rows.push({ line: startLine, cells });
    cells = [];
    if (rows.length > HISTORICAL_MAX_ROWS + 1) throw historicalError(`Use no máximo ${HISTORICAL_MAX_ROWS} linhas por importação.`);
  };
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else { quoted = false; closedQuote = true; }
      } else { field += char; if (char === '\n') line++; }
    } else if (char === delimiter) pushCell();
    else if (char === '\r' || char === '\n') {
      if (char === '\r' && text[i + 1] === '\n') i++;
      pushRow(); line++; startLine = line;
    } else if (char === '"' && !field.trim() && !closedQuote) { field = ''; quoted = true; }
    else {
      if (closedQuote && char.trim()) throw historicalError(`Linha ${line}: texto após o fechamento das aspas.`);
      field += char;
    }
  }
  if (quoted) throw historicalError(`Linha ${startLine}: campo com aspas não fechado.`);
  pushRow();
  return rows;
}

function dateValue(value) {
  let text = String(value ?? '').trim();
  const br = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text);
  if (br) text = `${br[3]}-${br[2]}-${br[1]}`;
  const date = new Date(`${text}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text) {
    throw historicalError('Informe uma data válida em DD/MM/AAAA ou AAAA-MM-DD.');
  }
  return text;
}

function positiveNumber(value) {
  let text = String(value ?? '').trim();
  if (text.includes(',')) {
    if (!/^(?:\d+|\d{1,3}(?:\.\d{3})+),\d+$/.test(text)) throw historicalError('Quantidade inválida. Exemplo: 35,5.');
    text = text.replaceAll('.', '').replace(',', '.');
  }
  if (!/^\d+(?:\.\d+)?$/.test(text)) throw historicalError('Quantidade inválida. Use apenas o número, sem a unidade.');
  const quantity = Number(text);
  if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 1e12) throw historicalError('A quantidade deve ser maior que zero e no máximo 1 trilhão.');
  return quantity;
}

export function normalizeHistoricalRow(row) {
  const serviceKey = key(row.servico);
  const serviceType = ({ limpezaquimica: 'limpeza', limpeza: 'limpeza', testedepressao: 'pressao', pressao: 'pressao', filtragemdeoleo: 'filtragem', filtragem: 'filtragem', flushing: 'flushing' })[serviceKey];
  if (!serviceType) throw historicalError('Serviço inválido. Use limpeza química, teste de pressão, filtragem de óleo ou flushing.');
  const reportType = String(row.relatorio ?? '').trim().toUpperCase();
  if (reportType !== reportTypes[serviceType]) throw historicalError(`Use ${reportTypes[serviceType]} para ${HISTORICAL_SERVICE_LABELS[serviceType]}.`);
  const numberText = String(row.numero ?? '').trim();
  const sequenceNumber = Number(numberText);
  if (!/^\d+$/.test(numberText) || !Number.isSafeInteger(sequenceNumber) || sequenceNumber < 1 || sequenceNumber > 2147483647) throw historicalError('Informe um número inteiro positivo para o relatório.');
  const equipment = String(row.equipamento ?? '').trim();
  const system = String(row.sistema ?? '').trim();
  if (!equipment || !system || equipment.length > 180 || system.length > 180) throw historicalError('Informe equipamento do cliente e sistema, com até 180 caracteres cada.');
  const unitKey = String(row.unidade ?? '').trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const unit = ({ m: 'm', metro: 'm', metros: 'm', cm: 'cm', centimetro: 'cm', centimetros: 'cm', l: 'L', litro: 'L', litros: 'L', ml: 'mL', mililitro: 'mL', mililitros: 'mL', un: 'UN', unidade: 'UN', unidades: 'UN' })[unitKey];
  const isLength = unit === 'm' || unit === 'cm';
  const allowedUnits = { limpeza: ['m', 'cm', 'UN'], pressao: ['m', 'cm'], filtragem: ['L', 'mL'], flushing: ['m', 'cm', 'L', 'mL'] };
  if (!allowedUnits[serviceType].includes(unit)) throw historicalError('Unidade incompatível: use cm ou m para tubulação, L ou mL para óleo e UN para limpeza química de sistemas completos.');
  const quantity = positiveNumber(row.quantidade);
  if (unit === 'UN' && (!Number.isSafeInteger(quantity) || quantity > 999999999999)) throw historicalError('A quantidade em unidades deve ser um número inteiro positivo de até 999999999999.');
  const diameterUnit = String(row.unidadeDiametro ?? '').trim();
  if (diameterUnit && !/^(?:mm|pol|polegadas?|["'″′”“’]{1,2})$/i.test(diameterUnit)) throw historicalError('Unidade de diâmetro inválida. Use mm, pol ou apóstrofo (\').');
  const rawDiameter = String(row.diametro ?? '').trim();
  const suffix = /(?:mm|pol(?:egadas?)?|["'″′”“’]{1,2})$/i.exec(rawDiameter)?.[0];
  const suffixUnit = suffix ? (suffix.toLowerCase() === 'mm' ? 'mm' : 'pol') : null;
  const explicitUnit = diameterUnit ? (diameterUnit.toLowerCase() === 'mm' ? 'mm' : 'pol') : null;
  if (explicitUnit && suffixUnit && explicitUnit !== suffixUnit) throw historicalError('A unidade do diâmetro diverge da unidade escrita na medida.');
  const normalizedDiameterUnit = explicitUnit || suffixUnit || 'pol';
  if (isLength && row.diameterHeaderUnit && (explicitUnit || suffixUnit) && row.diameterHeaderUnit !== normalizedDiameterUnit) {
    throw historicalError('O diâmetro diverge da unidade indicada no cabeçalho. Use Diametro e uma unidade explícita para misturar pol e mm.');
  }
  const effectiveDiameterUnit = explicitUnit || suffixUnit || row.diameterHeaderUnit || 'pol';
  let diameter = rawDiameter.replace(/(?:["'″′”“’]{1,2}|\s*(?:pol(?:egadas?)?|mm))$/i, '').trim().replace(/\s+/g, ' ');
  if (isLength) {
    if (diameter.length > 30 || !/^(?:\d+(?:[.,]\d+)?|(?:\d+ )?\d+\/\d+)$/.test(diameter)) throw historicalError('Informe um diâmetro válido, como 2 pol, 1 1/2 pol ou 50 mm.');
    if (effectiveDiameterUnit === 'mm' && diameter.includes('/')) throw historicalError('Em mm, informe o diâmetro decimal, sem fração.');
    if (diameter.includes('/')) {
      const parts = /^(?:(\d+) )?(\d+)\/(\d+)$/.exec(diameter);
      if (Number(parts[3]) === 0 || Number(parts[2]) === 0) throw historicalError('Fração de diâmetro inválida.');
    } else if (Number(diameter.replace(',', '.')) <= 0) throw historicalError('O diâmetro deve ser maior que zero.');
    diameter = diameter.replace(',', '.');
  } else if (diameter || diameterUnit) throw historicalError('Deixe o diâmetro e sua unidade vazios para óleo ou sistemas completos.');
  return {
    reportType, sequenceNumber, reportDate: dateValue(row.data),
    item: { serviceType, equipment, system, diameter, ...(isLength && effectiveDiameterUnit === 'mm' ? { diameterUnit: 'mm' } : {}), quantity, unit }
  };
}

export function historicalFingerprint(report) {
  const items = report.items.map(item => ({
    serviceType: item.serviceType, equipment: item.equipment, system: item.system,
    diameter: item.diameter,
    ...(item.diameterUnit === 'mm' ? { diameterUnit: 'mm' } : {}),
    quantity: item.unit === 'cm' ? item.quantity / 100 : item.unit === 'mL' ? item.quantity / 1000 : item.quantity,
    unit: item.unit === 'cm' ? 'm' : item.unit === 'mL' ? 'L' : item.unit
  })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return hash({ reportType: report.reportType, sequenceNumber: report.sequenceNumber, reportDate: String(report.reportDate).slice(0, 10), items });
}

export function parseHistoricalServicesCsv(csv) {
  const [header, ...rows] = readHistoricalCsv(csv);
  if (!header || !rows.length) throw historicalError('O CSV deve conter cabeçalho e ao menos uma medição.');
  const headers = header.cells.map(value => aliases[key(value)] ?? key(value));
  const diameterHeaderUnit = header.cells.some(value => key(value) === 'diametromm') ? 'mm'
    : header.cells.some(value => ['diametropol', 'diametropolegadas'].includes(key(value))) ? 'pol' : null;
  if (new Set(headers).size !== headers.length) throw historicalError('Há colunas repetidas no cabeçalho.');
  const missing = columns.filter(column => !headers.includes(column));
  if (missing.length) throw historicalError(`Colunas ausentes: ${missing.join(', ')}. Baixe o modelo CSV.`);
  const reports = new Map(), errors = [], seenItems = new Set();
  for (const { line, cells } of rows) {
    try {
      if (cells.length !== headers.length) throw historicalError('Quantidade de colunas diferente do cabeçalho. Confira o separador e as aspas.');
      const row = normalizeHistoricalRow({ ...Object.fromEntries(headers.map((header, index) => [header, cells[index]])), diameterHeaderUnit });
      const reportKey = historicalReportKey(row);
      let report = reports.get(reportKey);
      if (report && report.reportDate !== row.reportDate) throw historicalError(`${reportKey}: todas as linhas do relatório devem ter a mesma data.`);
      const baseUnit = ['m', 'cm'].includes(row.item.unit) ? 'm' : row.item.unit === 'UN' ? 'UN' : 'L';
      const itemKey = JSON.stringify([reportKey, row.item.serviceType, row.item.equipment, row.item.system, row.item.diameter, row.item.diameterUnit || 'pol', baseUnit]);
      if (seenItems.has(itemKey)) throw historicalError('Medição repetida no mesmo relatório. Consolide a quantidade em uma única linha.');
      seenItems.add(itemKey);
      if (!report) {
        report = { reportType: row.reportType, sequenceNumber: row.sequenceNumber, reportDate: row.reportDate, items: [], lines: [] };
        reports.set(reportKey, report);
      }
      report.items.push(row.item); report.lines.push(line);
    } catch (error) { errors.push({ line, message: error.message }); }
  }
  if (reports.size > 500) throw historicalError('Use no máximo 500 relatórios por importação.');
  return { reports: [...reports.values()].map(report => ({ ...report, fingerprint: historicalFingerprint(report) })), errors, rowCount: rows.length };
}

export function sourceReportConflict(source, report) {
  if (!source) return null;
  if (source.specialConditions?.parentRdoId || source.services?.length) return 'Este relatório já possui serviços no app. Use o registro existente para evitar dupla contabilização.';
  const date = new Date(source.reportDate).toISOString().slice(0, 10);
  if (date !== report.reportDate) return `A data diverge do relatório cadastrado (${date.split('-').reverse().join('/')}).`;
  return null;
}

export function buildHistoricalPreview(parsed, existing, sources) {
  const existingByKey = new Map(existing.map(report => [historicalReportKey(report), report]));
  const sourceByKey = new Map(sources.map(report => [historicalReportKey(report), report]));
  const reports = parsed.reports.map(report => {
    const current = existingByKey.get(historicalReportKey(report));
    const source = sourceByKey.get(historicalReportKey(report));
    let error = sourceReportConflict(source, report);
    let action = error ? 'CONFLICT' : 'CREATE';
    if (current && !error) {
      action = current.fingerprint === report.fingerprint ? 'SKIP' : 'CONFLICT';
      if (action === 'CONFLICT') error = 'Já importado com dados diferentes. Corrija pelo botão Editar no histórico.';
    }
    return { ...report, action, error, sourceReportId: source?.id ?? null, existingId: current?.id ?? null, revision: current?.revision ?? null };
  });
  return {
    reports, errors: parsed.errors, rowCount: parsed.rowCount,
    canImport: !parsed.errors.length && reports.some(report => report.action === 'CREATE') && !reports.some(report => report.action === 'CONFLICT'),
    token: hash(reports.map(report => [report.fingerprint, report.action, report.sourceReportId, report.existingId, report.revision]))
  };
}

// Adapt history to the same measurements used by progress, without inventing an RDO,
// operational hours, equipment links or a PDF. Native records take precedence.
export function historicalReportsAsServices(history, sources = []) {
  const sourceMap = new Map(sources.map(source => [`${source.projectId}:${historicalReportKey(source)}`, source]));
  return history.filter(report => !sourceReportConflict(sourceMap.get(`${report.projectId}:${historicalReportKey(report)}`), {
    ...report, reportDate: new Date(report.reportDate).toISOString().slice(0, 10)
  })).flatMap(report => {
    const groups = new Map();
    for (const item of report.items) {
      const groupKey = JSON.stringify([item.serviceType, item.equipment, item.system, item.projectSystemId || null, item.unit === 'UN']);
      if (!groups.has(groupKey)) groups.set(groupKey, {
        serviceType: item.serviceType, finalized: true, system: item.system,
        extraData: { equipmentId: item.equipment, system: item.system, ...(item.projectSystemId ? { __projectSystemId: item.projectSystemId } : {}), tubes: [], volumeOleo: 0, volumeOleoUnit: 'L' },
        report: { projectId: report.projectId, reportType: report.reportType, reportDate: report.reportDate, specialConditions: {} }
      });
      const service = groups.get(groupKey);
      if (item.unit === 'UN') {
        service.extraData.limpezaTubulacao = 'Não';
        service.extraData.quantidadeSistemas = (service.extraData.quantidadeSistemas ?? 0) + item.quantity;
      } else if (item.unit === 'm' || item.unit === 'cm') service.extraData.tubes.push({ d: item.diameter, unit: item.diameterUnit || 'pol', c: item.quantity, lengthUnit: item.unit });
      else service.extraData.volumeOleo += item.unit === 'mL' ? item.quantity / 1000 : item.quantity;
    }
    return [...groups.values()];
  });
}

export const HISTORICAL_CSV_TEMPLATE = '\uFEFFRelatorio;Numero;Data;Servico;Equipamento do cliente;Sistema;Diametro;Quantidade;Unidade\r\n'
  + 'RLQ;001;01/01/2026;Limpeza química;Unidade Geradora 01;Kaplan;2;35;m\r\n'
  + 'RLQ;001;01/01/2026;Limpeza química;Unidade Geradora 01;Kaplan;3;45;m\r\n'
  + 'RLQ;002;02/01/2026;Limpeza química;Unidade Geradora 01;Mancal escora;;1;UN\r\n'
  + 'RCPU;001;02/01/2026;Filtragem de óleo;Unidade Geradora 01;Kaplan;;5000;L\r\n'
  + 'RTP;001;03/01/2026;Teste de pressão;Unidade Geradora 01;Kaplan;2;35;m\r\n'
  + 'RCPU;002;04/01/2026;Flushing;Unidade Geradora 01;Kaplan;3;45;m\r\n';
