import type { Collaborator, Equipment, ReportServiceInput, Unit } from '../types/domain';

export const serviceTypeMap: Record<string, string> = {
  LIMPEZA: 'limpeza',
  PRESSAO: 'pressao',
  FLUSHING: 'flushing',
  FILTRAGEM: 'filtragem',
  MECANICA: 'mecanica',
  INIBICAO: 'inibicao',
  limpeza: 'limpeza',
  pressao: 'pressao',
  flushing: 'flushing',
  filtragem: 'filtragem',
  mecanica: 'mecanica',
  inibicao: 'inibicao'
};

interface ServiceDraftLike {
  type: string;
  data: Record<string, unknown>;
}

interface BuildServicePayloadOptions {
  collaborators?: Collaborator[];
  collaboratorIds?: string[];
  equipment?: Equipment[];
  units?: Unit[];
}

function getString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function getStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function finalizedLabel(value: unknown) {
  if (typeof value !== 'boolean') return '';
  return value ? 'Sim' : 'Não';
}

function isNoValue(value: unknown) {
  if (Array.isArray(value)) value = value[0];
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '') === 'nao';
}

function limpezaTubulacaoLabel(data: Record<string, unknown>) {
  const raw = data.limpezaTubulacao || data['Limpeza de tubulação?'] || data['Limpeza de tubulacao?'];
  return isNoValue(raw) ? 'Não' : 'Sim';
}

function flushingTubulacaoLabel(data: Record<string, unknown>) {
  const raw = data.flushingTubulacao || data['Flushing em tubulação?'] || data['Flushing em tubulacao?'];
  return isNoValue(raw) ? 'Não' : 'Sim';
}

function singleId(value: unknown): string[] {
  const id = getString(value);
  return id ? [id] : [];
}

function ids(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string' && Boolean(item));
  return singleId(value);
}

function labelForEquipment(id: string, equipment: Equipment[] = []) {
  const item = equipment.find(candidate => candidate.id === id);
  return item ? `${item.code} - ${item.name}` : id;
}

function unitIdsToCodes(ids: string[], units: Unit[] = []) {
  return ids
    .map(id => units.find(unit => unit.id === id)?.code || id)
    .filter(Boolean);
}

function formatValueWithUnit(value: unknown, unit: unknown) {
  const text = getString(value);
  if (!text) return '';
  const unitText = getString(unit);
  return unitText ? `${text} ${unitText}` : text;
}

function collaboratorLinks(ids: string[], collaborators: Collaborator[] = []) {
  const known = new Map(collaborators.map(item => [item.id, item]));
  return {
    ids,
    names: ids.map(id => known.get(id)?.name || id).filter(Boolean)
  };
}

function commonExtraData(
  type: string,
  data: Record<string, unknown>,
  options: BuildServicePayloadOptions
): Record<string, unknown> {
  const equipmentId = getString(data.equipmentId);
  const material = getString(data.material);
  const collaboratorIds = options.collaboratorIds || [];
  const tubes = type === 'flushing' && flushingTubulacaoLabel(data) === 'Não'
    ? []
    : (Array.isArray(data.tubes) ? data.tubes : []);

  return {
    ...data,
    'Equipamento(s)': equipmentId ? labelForEquipment(equipmentId, options.equipment) : '',
    Sistema: getString(data.system),
    ...(type === 'flushing'
      ? {}
      : type === 'mecanica'
      ? { 'Material do equipamento': material }
      : { 'Material da tubulação': material }),
    'Hora de início': getString(data.startTime),
    'Hora de término/pausa': getString(data.endTime),
    'Serviço finalizado?': finalizedLabel(data.finalized),
    'Aprovado pelo cliente?': getString(data.aprovadoCliente) || '',
    'Etapas realizadas no dia': getStrings(data.etapas),
    Observações: getString(data.notes),
    'Desenhos / TAGs': getString(data.drawingsTags),
    'Diâmetros e comprimentos': tubes,
    'Colaboradores do serviço': collaboratorLinks(collaboratorIds, options.collaborators)
  };
}

export function normalizeServiceType(type: string) {
  return serviceTypeMap[type] || type;
}

export function buildReportServicePayload(
  service: ServiceDraftLike,
  options: BuildServicePayloadOptions = {}
): ReportServiceInput {
  const type = normalizeServiceType(service.type);
  const data = service.data || {};
  const extraData = commonExtraData(type, data, options);

  if (type === 'limpeza') {
    const unitIds = ids(data.ulq);
    extraData['Limpeza de tubulação?'] = limpezaTubulacaoLabel(data);
    extraData['Método de limpeza'] = getStrings(data.metodos);
    extraData['Local de limpeza'] = getStrings(data.local);
    extraData['Tipo de inspeção'] = getStrings(data.tipoInspecao);
    extraData['Unidade de Limpeza Química'] = { ids: unitIds, codes: unitIdsToCodes(unitIds, options.units) };
  }

  if (type === 'pressao') {
    const manometerIds = getStrings(data.manometroIds);
    const uthIds = ids(data.uth);
    extraData['Pressão de trabalho'] = formatValueWithUnit(data.pressaoTrabalho, data.pressaoTrabalhoUnit);
    extraData['Pressão de teste'] = formatValueWithUnit(data.pressaoTeste, data.pressaoTesteUnit);
    extraData['Fluido de teste'] = getString(data.fluidoTeste) === 'oleo' ? 'Óleo' : 'Água';
    extraData['Qual óleo?'] = getString(data.qualOleo);
    extraData['Manômetros utilizados'] = { ids: manometerIds };
    extraData['Unidade de Teste Hidrostático (UTH)'] = { ids: uthIds, codes: unitIdsToCodes(uthIds, options.units) };
  }

  if (type === 'flushing' || type === 'filtragem') {
    const unitIds = type === 'filtragem' ? ids(data.ufg) : ids(data.uf);
    const houveParticulas = getString(data.houveParticulas) || 'Não';
    const houveDesidratacao = getString(data.houveDesidratacao) || 'Não';
    const houveUmidade = getString(data.houveUmidade) || 'Não';
    const hasParticulas = houveParticulas === 'Sim';
    const hasDesidratacao = houveDesidratacao === 'Sim';
    const hasUmidade = houveUmidade === 'Sim';
    const desidratacaoIds = hasDesidratacao ? singleId(data.desidratacaoUnit) : [];
    extraData['Tipo de óleo'] = getString(data.tipoOleo);
    extraData['Volume de óleo'] = formatValueWithUnit(data.volumeOleo, data.volumeOleoUnit);
    extraData['Houve contagem de partículas?'] = houveParticulas;
    extraData['Contador utilizado'] = hasParticulas ? getString(data.contadorUtilizado) : '';
    extraData['Contagem inicial NAS'] = hasParticulas ? getString(data.contagemInicialNas) : '';
    extraData['Contagem final NAS'] = hasParticulas ? getString(data.contagemFinalNas) : '';
    extraData['Contagem inicial ISO'] = hasParticulas ? getString(data.contagemInicialIso) : '';
    extraData['Contagem final ISO'] = hasParticulas ? getString(data.contagemFinalIso) : '';
    extraData['Houve desidratação?'] = houveDesidratacao;
    extraData['Equipamento de desidratação'] = {
      ids: desidratacaoIds,
      codes: unitIdsToCodes(desidratacaoIds, options.units)
    };
    extraData['Houve análise de umidade?'] = houveUmidade;
    extraData['Umidade inicial (ppm)'] = hasUmidade ? getString(data.umidadeInicial) : '';
    extraData['Umidade final (ppm)'] = hasUmidade ? getString(data.umidadeFinal) : '';
    if (type === 'flushing') {
      extraData['Flushing em tubulação?'] = flushingTubulacaoLabel(data);
      extraData['Tipo de flushing'] = getString(data.tipoFlushing) === 'secundario' ? 'Secundário' : 'Primário';
      extraData['Unidade de Flushing'] = { ids: unitIds, codes: unitIdsToCodes(unitIds, options.units) };
    } else {
      extraData['Unidade de filtragem'] = { ids: unitIds, codes: unitIdsToCodes(unitIds, options.units) };
    }
  }

  if (type === 'inibicao') {
    extraData['ID da embarcação'] = getString(data.embarcacaoId);
    extraData.Linhas = getString(data.linhas);
    extraData.Steps = getString(data.steps);
    extraData['Tipo de relatório'] = getStrings(data.tipoRelatorio);
  }

  return {
    serviceType: type,
    equipmentId: null,
    system: getString(data.system) || null,
    material: type === 'flushing' ? null : getString(data.material) || null,
    startTime: getString(data.startTime) || null,
    endTime: getString(data.endTime) || null,
    finalized: typeof data.finalized === 'boolean' ? data.finalized : null,
    extraData
  };
}
