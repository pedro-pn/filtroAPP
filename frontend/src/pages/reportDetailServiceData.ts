import type { ReportSummary } from '../types/domain';
import { normalizeServiceType } from '../utils/reportServicePayload';

type ReportService = NonNullable<ReportSummary['services']>[number];

// Normalização dos serviços persistidos para o formato que o editor do RDO usa. O extraData
// acumulou chaves de várias épocas (rótulos em português, com e sem acento, e camelCase), então
// cada campo é lido por uma lista de nomes equivalentes.

function getString(value: unknown) {
  return typeof value === 'string' ? value : '';
}

function getIdsFromField(value: unknown) {
  if (Array.isArray(value)) return value.filter((id): id is string => typeof id === 'string');
  if (typeof value === 'string' && value) return [value];
  if (!value || typeof value !== 'object') return [];
  const record = value as Record<string, unknown>;
  return Array.isArray(record.ids) ? record.ids.filter((id): id is string => typeof id === 'string') : [];
}

function isEmptyLegacyValue(value: unknown) {
  if (value === undefined || value === null) return true;
  if (typeof value === 'string') return !value.trim();
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') return Object.keys(value).length === 0;
  return false;
}

function getLegacyValue(extra: Record<string, unknown>, names: string[]) {
  for (const name of names) {
    if (Object.prototype.hasOwnProperty.call(extra, name) && !isEmptyLegacyValue(extra[name])) return extra[name];
  }
  return undefined;
}

function getLegacyString(extra: Record<string, unknown>, names: string[]) {
  const value = getLegacyValue(extra, names);
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.find((item): item is string => typeof item === 'string') || '';
  return '';
}

function getLegacyStrings(extra: Record<string, unknown>, names: string[]) {
  const value = getLegacyValue(extra, names);
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string');
  if (typeof value === 'string' && value.trim()) return [value.trim()];
  return [];
}

function getLegacyChoice(extra: Record<string, unknown>, names: string[]) {
  return getLegacyStrings(extra, names)[0] || getLegacyString(extra, names);
}

function normalizeYesNo(value: string, fallback = 'Não') {
  const normalized = value.trim().toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');
  if (normalized === 'sim' || normalized === 'true') return 'Sim';
  if (normalized === 'nao' || normalized === 'false') return 'Não';
  return fallback;
}

function normalizeChoiceText(value: string) {
  return value.trim().toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');
}

function parseValueWithUnit(value: unknown, units: string[], fallbackUnit: string) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) return { value: '', unit: fallbackUnit };
  const escapedUnits = [...units]
    .sort((a, b) => b.length - a.length)
    .map(unit => unit.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|');
  const match = text.match(new RegExp(`^(.+?)\\s*(${escapedUnits})$`, 'i'));
  if (!match) return { value: text, unit: fallbackUnit };
  const unit = units.find(item => item.toLowerCase() === match[2].toLowerCase()) || match[2];
  return { value: match[1].trim(), unit };
}

function firstIdFromLegacy(value: unknown) {
  return getIdsFromField(value)[0] || '';
}

function normalizeUnitField(extra: Record<string, unknown>, names: string[]) {
  const value = getLegacyValue(extra, names);
  const ids = getIdsFromField(value);
  return ids.length ? ids : getLegacyStrings(extra, names);
}

function serviceCollaboratorField(extra: Record<string, unknown>) {
  const names = ['Colaboradores do serviço', 'Colaboradores do serviÃ§o', 'Colaboradores do servico'];
  for (const name of names) {
    if (Object.prototype.hasOwnProperty.call(extra, name)) return extra[name];
  }
  return undefined;
}

export function serviceFinalizedValue(service: ReportService) {
  if (typeof service.finalized === 'boolean') return service.finalized;
  const extra = service.extraData || {};
  const stored = extra['Serviço finalizado?'] || extra['Serviço finalizado'] || extra['Servico finalizado?'] || extra['Servico finalizado'];
  if (typeof stored === 'string') {
    const normalized = stored.trim().toLowerCase();
    if (['sim', 'true', 'finalizado'].includes(normalized)) return true;
    if (['não', 'nao', 'false', 'em andamento'].includes(normalized)) return false;
  }
  return undefined;
}

function serviceEquipmentValue(service: ReportService) {
  const extra = service.extraData || {};
  const value = extra['Equipamento(s)'] || extra.Equipamentos || extra.Equipamento || extra['Embarcação'] || extra.Embarcacao || extra['ID da embarcação'] || extra['ID da embarcacao'];
  if (Array.isArray(value)) return value.filter(Boolean).join(', ');
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (Array.isArray(record.labels)) return record.labels.filter(Boolean).join(', ');
    return getString(record.name) || getString(record.nome) || getString(record.code) || getString(record.codigo) || getString(record.id);
  }
  return getString(value) || service.equipmentId || '';
}

export function legacyServiceData(service: ReportService) {
  const extra = service.extraData || {};
  const type = normalizeServiceType(service.serviceType || '');
  const collaboratorField = serviceCollaboratorField(extra);
  const pressureWork = parseValueWithUnit(getLegacyValue(extra, ['pressaoTrabalho', 'Pressão de trabalho', 'Pressao de trabalho']), ['bar', 'psi', 'kg/cm²', 'MPa', 'kPa'], 'bar');
  const pressureTest = parseValueWithUnit(getLegacyValue(extra, ['pressaoTeste', 'Pressão de teste', 'Pressao de teste']), ['bar', 'psi', 'kg/cm²', 'MPa', 'kPa'], 'bar');
  const volume = parseValueWithUnit(getLegacyValue(extra, ['volumeOleo', 'Volume de óleo', 'Volume de oleo']), ['L', 'mL'], 'L');
  const fluidoTeste = getLegacyChoice(extra, ['fluidoTeste', 'Fluido de teste']);
  const equipamentoTestado = getLegacyChoice(extra, ['equipamentoTestado', 'Equipamento testado']);
  const tipoFlushing = getLegacyChoice(extra, ['tipoFlushing', 'Tipo de flushing']);
  const houveParticulas = getLegacyChoice(extra, ['houveParticulas', 'Houve contagem de partículas?', 'Houve contagem de particulas?']);
  const houveDesidratacao = getLegacyChoice(extra, ['houveDesidratacao', 'Houve desidratação?', 'Houve desidratacao?']);
  const houveUmidade = getLegacyChoice(extra, ['houveUmidade', 'Houve análise de umidade?', 'Houve analise de umidade?']);

  const data: Record<string, unknown> = {
    ...extra,
    ...(collaboratorField !== undefined ? { serviceCollaboratorIds: getIdsFromField(collaboratorField) } : {}),
    equipmentId: serviceEquipmentValue(service),
    system: service.system || getLegacyString(extra, ['system', 'Sistema']),
    material: service.material || getLegacyString(extra, ['material', 'Material da tubulação', 'Material da tubulacao', 'Material do equipamento']),
    startTime: service.startTime || getLegacyString(extra, ['startTime', 'Hora de início', 'Hora de inicio']),
    endTime: service.endTime || getLegacyString(extra, ['endTime', 'Hora de término/pausa', 'Hora de termino/pausa']),
    finalized: serviceFinalizedValue(service),
    aprovadoCliente: getLegacyChoice(extra, ['aprovadoCliente', 'Aprovado pelo cliente?']) || 'Sim',
    etapas: getLegacyStrings(extra, ['etapas', 'Etapas realizadas no dia']),
    notes: getLegacyString(extra, ['notes', 'Observações', 'Observacoes']),
    drawingsTags: getLegacyString(extra, ['drawingsTags', 'Desenhos / TAGs']),
    tubes: Array.isArray(extra.tubes)
      ? extra.tubes
      : (Array.isArray(extra['Diâmetros e comprimentos']) ? extra['Diâmetros e comprimentos'] : [])
  };

  if (type === 'limpeza') {
    data.metodos = getLegacyStrings(extra, ['metodos', 'Método de limpeza', 'Metodo de limpeza']);
    data.ulq = normalizeUnitField(extra, ['ulq', 'Unidade de Limpeza Química', 'Unidade de Limpeza Quimica']);
    data.local = getLegacyStrings(extra, ['local', 'Local de limpeza']);
    data.limpezaTubulacao = normalizeYesNo(getLegacyChoice(extra, ['limpezaTubulacao', 'Limpeza de tubulação?', 'Limpeza de tubulacao?']), 'Sim');
    data.tipoInspecao = getLegacyStrings(extra, ['tipoInspecao', 'Tipo de inspeção', 'Tipo de inspecao']);
  }

  if (type === 'pressao') {
    const normalizedChoice = normalizeChoiceText(equipamentoTestado);
    const normalizedTestedEquipment = normalizedChoice === 'mangueira' || normalizedChoice === 'mangueiras'
      ? 'mangueira'
      : normalizedChoice === 'outro'
      ? 'outro'
      : 'tubulacao';
    data.equipamentoTestado = normalizedTestedEquipment;
    data.equipamentoTestadoOutro = getLegacyString(extra, ['equipamentoTestadoOutro', 'Outro equipamento testado']);
    if (normalizedTestedEquipment !== 'tubulacao') data.material = '';
    data.uth = normalizeUnitField(extra, ['uth', 'Unidade de Teste Hidrostático (UTH)', 'Unidade de Teste Hidrostatico (UTH)']);
    data.pressaoTrabalho = getLegacyString(extra, ['pressaoTrabalho']) || pressureWork.value;
    data.pressaoTrabalhoUnit = getLegacyString(extra, ['pressaoTrabalhoUnit']) || pressureWork.unit;
    data.pressaoTeste = getLegacyString(extra, ['pressaoTeste']) || pressureTest.value;
    data.pressaoTesteUnit = getLegacyString(extra, ['pressaoTesteUnit']) || pressureTest.unit;
    data.fluidoTeste = fluidoTeste.toLowerCase().includes('óleo') || fluidoTeste.toLowerCase().includes('oleo') ? 'oleo' : 'agua';
    data.qualOleo = getLegacyString(extra, ['qualOleo', 'Qual óleo?', 'Qual oleo?']);
    data.manometroIds = normalizeUnitField(extra, ['manometroIds', 'Manômetros utilizados', 'Manometros utilizados']);
  }

  if (type === 'flushing' || type === 'filtragem') {
    data.tipoOleo = getLegacyString(extra, ['tipoOleo', 'Tipo de óleo', 'Tipo de oleo']);
    data.volumeOleo = getLegacyString(extra, ['volumeOleo']) || volume.value;
    data.volumeOleoUnit = getLegacyString(extra, ['volumeOleoUnit']) || volume.unit;
    data.houveParticulas = normalizeYesNo(houveParticulas);
    data.contadorUtilizado = getLegacyString(extra, ['contadorUtilizado', 'Contador utilizado']);
    data.contagemInicialNas = getLegacyString(extra, ['contagemInicialNas', 'Contagem inicial NAS']);
    data.contagemFinalNas = getLegacyString(extra, ['contagemFinalNas', 'Contagem final NAS']);
    data.contagemInicialIso = getLegacyString(extra, ['contagemInicialIso', 'Contagem inicial ISO']);
    data.contagemFinalIso = getLegacyString(extra, ['contagemFinalIso', 'Contagem final ISO']);
    data.houveDesidratacao = normalizeYesNo(houveDesidratacao);
    data.desidratacaoUnit = firstIdFromLegacy(getLegacyValue(extra, ['desidratacaoUnit', 'Equipamento de desidratação', 'Equipamento de desidratacao']));
    data.houveUmidade = normalizeYesNo(houveUmidade);
    data.umidadeInicial = getLegacyString(extra, ['umidadeInicial', 'Umidade inicial (ppm)']);
    data.umidadeFinal = getLegacyString(extra, ['umidadeFinal', 'Umidade final (ppm)']);
    if (type === 'flushing') {
      data.flushingTubulacao = normalizeYesNo(getLegacyChoice(extra, ['flushingTubulacao', 'Flushing em tubulação?', 'Flushing em tubulacao?']), 'Sim');
      data.tipoFlushing = tipoFlushing.toLowerCase().includes('secund') ? 'secundario' : 'primario';
      data.uf = normalizeUnitField(extra, ['uf', 'Unidade de Flushing', 'Unidade de filtragem']);
    } else {
      data.ufg = normalizeUnitField(extra, ['ufg', 'Unidade de filtragem']);
    }
  }

  if (type === 'inibicao') {
    data.equipmentId = getLegacyString(extra, ['equipmentId', 'Embarcação', 'Embarcacao', 'embarcacaoId', 'ID da embarcação', 'ID da embarcacao']);
    data.linhas = getLegacyString(extra, ['linhas', 'Linhas']);
    data.steps = getLegacyString(extra, ['steps', 'Steps']);
    data.tipoRelatorio = getLegacyStrings(extra, ['tipoRelatorio', 'Tipo de relatório', 'Tipo de relatorio']);
  }

  return data;
}
