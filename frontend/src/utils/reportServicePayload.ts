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

function getBool(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function singleId(value: unknown): string[] {
  const id = getString(value);
  return id ? [id] : [];
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

  return {
    ...data,
    'Equipamento(s)': equipmentId ? labelForEquipment(equipmentId, options.equipment) : '',
    Sistema: getString(data.system),
    ...(type === 'mecanica'
      ? { 'Material do equipamento': material }
      : { 'Material da tubulação': material }),
    'Hora de início': getString(data.startTime),
    'Hora de término/pausa': getString(data.endTime),
    'Serviço finalizado?': getBool(data.finalized, true) ? 'Sim' : 'Não',
    'Aprovado pelo cliente?': getString(data.aprovadoCliente) || '',
    'Etapas realizadas no dia': getStrings(data.etapas),
    Observações: getString(data.notes),
    'Desenhos / TAGs': getString(data.drawingsTags),
    'Diâmetros e comprimentos': Array.isArray(data.tubes) ? data.tubes : [],
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
    const unitIds = singleId(data.ulq);
    extraData['Método de limpeza'] = getStrings(data.metodos);
    extraData['Local de limpeza'] = getStrings(data.local);
    extraData['Tipo de inspeção'] = getStrings(data.tipoInspecao);
    extraData['Unidade de Limpeza Química'] = { ids: unitIds, codes: unitIdsToCodes(unitIds, options.units) };
  }

  if (type === 'pressao') {
    const manometerIds = getStrings(data.manometroIds);
    const uthIds = singleId(data.uth);
    extraData['Pressão de trabalho'] = formatValueWithUnit(data.pressaoTrabalho, data.pressaoTrabalhoUnit);
    extraData['Pressão de teste'] = formatValueWithUnit(data.pressaoTeste, data.pressaoTesteUnit);
    extraData['Fluido de teste'] = getString(data.fluidoTeste) === 'oleo' ? 'Óleo' : 'Água';
    extraData['Qual óleo?'] = getString(data.qualOleo);
    extraData['Manômetros utilizados'] = { ids: manometerIds };
    extraData['Unidade de Teste Hidrostático (UTH)'] = { ids: uthIds, codes: unitIdsToCodes(uthIds, options.units) };
  }

  if (type === 'flushing' || type === 'filtragem') {
    const unitIds = type === 'filtragem' ? singleId(data.ufg) : singleId(data.uf);
    extraData['Tipo de óleo'] = getString(data.tipoOleo);
    extraData['Volume de óleo'] = formatValueWithUnit(data.volumeOleo, data.volumeOleoUnit);
    extraData['Houve contagem de partículas?'] = getString(data.houveParticulas) || 'Não';
    extraData['Contador utilizado'] = getString(data.contadorUtilizado);
    extraData['Contagem inicial NAS'] = getString(data.contagemInicialNas);
    extraData['Contagem final NAS'] = getString(data.contagemFinalNas);
    extraData['Contagem inicial ISO'] = getString(data.contagemInicialIso);
    extraData['Contagem final ISO'] = getString(data.contagemFinalIso);
    extraData['Houve desidratação?'] = getString(data.houveDesidratacao) || 'Não';
    extraData['Equipamento de desidratação'] = {
      ids: singleId(data.desidratacaoUnit),
      codes: unitIdsToCodes(singleId(data.desidratacaoUnit), options.units)
    };
    extraData['Houve análise de umidade?'] = getString(data.houveUmidade) || 'Não';
    extraData['Umidade inicial (ppm)'] = getString(data.umidadeInicial);
    extraData['Umidade final (ppm)'] = getString(data.umidadeFinal);
    if (type === 'flushing') {
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
    material: getString(data.material) || null,
    startTime: getString(data.startTime) || null,
    endTime: getString(data.endTime) || null,
    finalized: getBool(data.finalized, true),
    extraData
  };
}
