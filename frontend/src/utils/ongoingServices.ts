import type { ReportSummary } from '../types/domain';
import { normalizeServiceType } from './reportServicePayload';

type ReportServiceSummary = NonNullable<ReportSummary['services']>[number];

export interface OngoingServiceItem {
  key: string;
  report: ReportSummary;
  service: ReportServiceSummary;
  projectTitle: string;
  projectCode: string;
  serviceType: string;
  equipment: string;
  system: string;
}

export function isServiceFinalized(service: ReportServiceSummary) {
  if (typeof service.finalized === 'boolean') return service.finalized;
  const stored = service.extraData?.['Serviço finalizado?'];
  if (typeof stored === 'string') return ['sim', 'true', 'finalizado'].includes(stored.trim().toLowerCase());
  return false;
}

export function serviceEquipmentLabel(service: ReportServiceSummary) {
  const extra = service.extraData || {};
  const value = extra['Equipamento(s)'] || extra.Equipamentos || extra.Equipamento || extra['Embarcação'] || extra.Embarcacao || extra['ID da embarcação'] || '';
  if (Array.isArray(value)) return value.filter(Boolean).join(', ');
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (Array.isArray(record.labels)) return record.labels.filter(Boolean).join(', ');
    return String(record.name || record.nome || record.code || record.codigo || record.id || '');
  }
  return String(value || service.equipmentId || '');
}

function serviceStepName(service: ReportServiceSummary) {
  if (normalizeServiceType(service.serviceType || '') !== 'inibicao') return '';
  const extra = service.extraData || {};
  const value = extra.Steps || extra.steps || extra.Step || extra.step || '';
  if (Array.isArray(value)) return value.filter(Boolean).join(', ');
  return String(value || '');
}

function stringifyKeyValue(value: unknown): string {
  if (Array.isArray(value)) return value.map(stringifyKeyValue).filter(Boolean).join('|');
  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => {
        const text = stringifyKeyValue(item);
        return text ? `${key}:${text}` : '';
      })
      .filter(Boolean)
      .join('|');
  }
  return String(value || '');
}

function keyPart(value: unknown): string {
  return stringifyKeyValue(value)
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/\s+/g, ' ');
}

function firstKeyPart(extra: Record<string, unknown>, names: string[]): string {
  for (const name of names) {
    const value = extra[name];
    const part = keyPart(value);
    if (part) return part;
  }
  return '';
}

function serviceDisambiguatorParts(service: ReportServiceSummary) {
  const extra = service.extraData || {};
  const type = normalizeServiceType(service.serviceType || '');
  const material = keyPart(service.material) || firstKeyPart(extra, [
    'Material da tubulação',
    'Material da tubulacao',
    'Material do equipamento'
  ]);

  const parts = material ? [`material:${material}`] : [];

  if (type === 'filtragem' || type === 'flushing') {
    const oilType = firstKeyPart(extra, ['Tipo de óleo', 'Tipo de oleo', 'tipoOleo']);
    const oilVolume = firstKeyPart(extra, ['Volume de óleo', 'Volume de oleo', 'volumeOleo']);
    if (oilType) parts.push(`oleo:${oilType}`);
    if (oilVolume) parts.push(`volume:${oilVolume}`);
    if (type === 'flushing') {
      const flushingTubing = firstKeyPart(extra, ['Flushing em tubulação?', 'Flushing em tubulacao?', 'flushingTubulacao']);
      const flushingType = firstKeyPart(extra, ['Tipo de flushing', 'tipoFlushing']);
      if (flushingTubing) parts.push(`tubulacao:${flushingTubing}`);
      if (flushingType) parts.push(`flushing:${flushingType}`);
    }
  }

  if (type === 'pressao') {
    const testedEquipment = firstKeyPart(extra, ['Equipamento testado', 'equipamentoTestado']);
    const testedEquipmentOther = firstKeyPart(extra, ['Outro equipamento testado', 'equipamentoTestadoOutro']);
    const workPressure = firstKeyPart(extra, ['Pressão de trabalho', 'Pressao de trabalho', 'pressaoTrabalho']);
    const testPressure = firstKeyPart(extra, ['Pressão de teste', 'Pressao de teste', 'pressaoTeste']);
    const testFluid = firstKeyPart(extra, ['Fluido de teste', 'fluidoTeste']);
    const testOil = firstKeyPart(extra, ['Qual óleo?', 'Qual oleo?', 'qualOleo']);
    if (testedEquipment) parts.push(`equipamento-testado:${testedEquipment}`);
    if (testedEquipmentOther) parts.push(`equipamento-testado-outro:${testedEquipmentOther}`);
    if (workPressure) parts.push(`ptrabalho:${workPressure}`);
    if (testPressure) parts.push(`pteste:${testPressure}`);
    if (testFluid) parts.push(`fluido:${testFluid}`);
    if (testOil) parts.push(`oleo:${testOil}`);
  }

  if (type === 'limpeza') {
    const tubing = firstKeyPart(extra, ['Limpeza de tubulação?', 'Limpeza de tubulacao?', 'limpezaTubulacao']);
    const method = firstKeyPart(extra, ['Método de limpeza', 'Metodo de limpeza', 'metodos']);
    const location = firstKeyPart(extra, ['Local de limpeza', 'local']);
    const inspection = firstKeyPart(extra, ['Tipo de inspeção', 'Tipo de inspecao', 'tipoInspecao']);
    if (tubing) parts.push(`tubulacao:${tubing}`);
    if (method) parts.push(`metodo:${method}`);
    if (location) parts.push(`local:${location}`);
    if (inspection) parts.push(`inspecao:${inspection}`);
  }

  return parts;
}

function serviceSemanticKey(report: ReportSummary, service: ReportServiceSummary) {
  const extra = service.extraData || {};
  const base = [
    report.projectId || '',
    service.serviceType || '',
    serviceEquipmentLabel(service).trim().toLowerCase(),
    String(service.system || extra.Sistema || '').trim().toLowerCase()
  ];
  const step = serviceStepName(service).trim().toLowerCase();
  return normalizeServiceType(service.serviceType || '') === 'inibicao'
    ? [...base, step].join('||')
    : [...base, ...serviceDisambiguatorParts(service)].join('||');
}

export function serviceOngoingKeys(report: ReportSummary, service: ReportServiceSummary) {
  const extra = service.extraData || {};
  const semanticKey = serviceSemanticKey(report, service);
  const explicitKeys = [
    String(extra.__ongoingKey || '').trim(),
    String(extra.__serviceLinkKey || '').trim(),
    String(extra.__sourceServiceId || '').trim()
  ].filter(Boolean);
  const hasSemanticExplicitKey = explicitKeys.some(key => key.includes('||'));

  return Array.from(new Set([
    ...(hasSemanticExplicitKey ? [semanticKey, ...explicitKeys] : [...explicitKeys, semanticKey])
  ].filter(Boolean)));
}

function reportTime(report: ReportSummary) {
  return new Date(report.reportDate || report.createdAt || 0).getTime() || 0;
}

function endOfDayTime(value: Date | string = new Date()) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(date.getTime())) return Number.POSITIVE_INFINITY;
  date.setHours(23, 59, 59, 999);
  return date.getTime();
}

export function collectOngoingServices(reports: ReportSummary[], cutoffDate: Date | string = new Date()) {
  const items = new Map<string, OngoingServiceItem>();
  const cutoffTime = endOfDayTime(cutoffDate);

  [...reports]
    .filter(report => report.reportType === 'RDO' && report.project?.isActive !== false && reportTime(report) <= cutoffTime)
    .sort((a, b) => reportTime(a) - reportTime(b) || new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime())
    .forEach(report => {
      (report.services || []).forEach(service => {
        const keys = serviceOngoingKeys(report, service);
        if (isServiceFinalized(service)) {
          for (const [itemKey, item] of items.entries()) {
            if (item.key === service.id || item.key === keys[0] || keys.includes(item.key)) items.delete(itemKey);
          }
          return;
        }

        const key = keys[0] || service.id;
        for (const [itemKey, item] of items.entries()) {
          if (keys.includes(item.key) || item.key === service.id) items.delete(itemKey);
        }
        items.set(key, {
          key,
          report,
          service,
          projectTitle: [report.project?.code, report.project?.name].filter(Boolean).join(' - ') || report.project?.name || report.projectId,
          projectCode: report.project?.code || '---',
          serviceType: normalizeServiceType(service.serviceType || ''),
          equipment: serviceEquipmentLabel(service) || 'Equipamento não informado',
          system: service.system || String((service.extraData || {}).Sistema || '')
        });
      });
    });

  return Array.from(items.values()).sort((a, b) =>
    a.projectTitle.localeCompare(b.projectTitle, 'pt-BR', { numeric: true, sensitivity: 'base' })
    || a.serviceType.localeCompare(b.serviceType, 'pt-BR', { numeric: true, sensitivity: 'base' })
  );
}

export interface PendingProjectService {
  key: string;
  keys: string[];
  report: ReportSummary;
  service: ReportServiceSummary;
}

// Serviços ainda não finalizados de um projeto, na ordem cronológica dos RDOs: cada chave de
// continuidade mantém apenas a ocorrência mais recente, e some da lista quando algum RDO a
// finaliza. Usado tanto na criação do RDO quanto na revisão/edição.
export function collectPendingProjectServices(reports: ReportSummary[]): PendingProjectService[] {
  const items = new Map<string, PendingProjectService>();

  [...reports]
    .sort((a, b) => reportTime(a) - reportTime(b) || new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime())
    .forEach(report => {
      (report.services || []).forEach(service => {
        const keys = serviceOngoingKeys(report, service);
        for (const [itemKey, item] of items.entries()) {
          if (item.keys.some(key => keys.includes(key))) items.delete(itemKey);
        }
        if (isServiceFinalized(service)) return;
        const key = keys[0] || service.id;
        items.set(key, { key, keys, report, service });
      });
    });

  return Array.from(items.values()).sort((a, b) => reportTime(b.report) - reportTime(a.report));
}

// Chaves de continuidade de um serviço que ainda está no formulário (não persistido).
export function formServiceOngoingKeys(data: Record<string, unknown>): string[] {
  return Array.from(new Set([
    String(data.__ongoingKey || '').trim(),
    String(data.__serviceLinkKey || '').trim(),
    String(data.__sourceServiceId || '').trim()
  ].filter(Boolean)));
}

export function markPreviouslyAddedUploads(extra: Record<string, unknown>) {
  const groups = Array.isArray(extra.__uploads__) ? extra.__uploads__ : [];
  if (!groups.length) return extra;

  return {
    ...extra,
    __uploads__: groups.map(group => {
      if (!group || typeof group !== 'object' || Array.isArray(group)) return group;
      const record = group as { label?: unknown; files?: unknown };
      const files = Array.isArray(record.files)
        ? record.files.map(file => (file && typeof file === 'object' && !Array.isArray(file) ? { ...(file as Record<string, unknown>), __previouslyAdded: true } : file))
        : record.files;
      return { ...record, files };
    })
  };
}

function firstIdFromField(value: unknown) {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
  const record = value as Record<string, unknown>;
  if (Array.isArray(record.ids)) {
    return record.ids.find((id): id is string => typeof id === 'string' && id.trim().length > 0) || '';
  }
  return '';
}

function continuedPressureTestedEquipment(data: Record<string, unknown>) {
  const raw = String(data.equipamentoTestado || data['Equipamento testado'] || '').trim();
  if (raw === 'mangueira' || raw === 'Mangueiras') return 'mangueira';
  if (raw === 'outro' || raw === 'Outro') return 'outro';
  return 'tubulacao';
}

// Dados de formulário para continuar um serviço pendente: herda o cadastro do serviço anterior e
// zera o que é específico do dia (horários, etapas, medições, observações e finalização).
// `baseData` permite passar os dados já normalizados para o formulário em questão.
export function buildContinuedServiceData(
  service: ReportServiceSummary,
  ongoingKey: string,
  baseData?: Record<string, unknown>
): Record<string, unknown> {
  const extra = markPreviouslyAddedUploads(baseData || service.extraData || {});
  const type = normalizeServiceType(service.serviceType || '');
  const contadorUtilizado = firstIdFromField(extra['Contador utilizado'] || extra.contadorUtilizado);
  const previousDesidratacaoUnit = firstIdFromField(
    extra.desidratacaoUnit || extra['Equipamento de desidratação'] || extra['Equipamento de desidratacao'] || extra['Equipamento de desidrataÃ§Ã£o']
  );
  const previousPressureTestedEquipment = type === 'pressao' ? continuedPressureTestedEquipment(extra) : '';

  return {
    ...extra,
    __ongoingKey: ongoingKey,
    __serviceLinkKey: String(extra.__serviceLinkKey || ongoingKey),
    etapas: [],
    customEtapa: '',
    aprovadoCliente: type === 'inibicao' ? String(extra.aprovadoCliente || extra['Aprovado pelo cliente?'] || 'Sim') : 'Sim',
    houveParticulas: contadorUtilizado ? 'Sim' : String(extra['Houve contagem de partículas?'] || extra.houveParticulas || 'Não'),
    contadorUtilizado,
    contagemInicialNas: type === 'inibicao' ? String(extra.contagemInicialNas || extra['Contagem inicial NAS'] || '') : '',
    contagemFinalNas: type === 'inibicao' ? String(extra.contagemFinalNas || extra['Contagem final NAS'] || '') : '',
    contagemInicialIso: type === 'inibicao' ? String(extra.contagemInicialIso || extra['Contagem inicial ISO'] || '') : '',
    contagemFinalIso: type === 'inibicao' ? String(extra.contagemFinalIso || extra['Contagem final ISO'] || '') : '',
    houveDesidratacao: type === 'inibicao' ? String(extra.houveDesidratacao || extra['Houve desidratação?'] || 'Não') : 'Não',
    desidratacaoUnit: previousDesidratacaoUnit,
    houveUmidade: String(extra['Houve análise de umidade?'] || extra.houveUmidade || 'Não'),
    umidadeInicial: type === 'inibicao' ? String(extra.umidadeInicial || extra['Umidade inicial (ppm)'] || '') : '',
    umidadeFinal: type === 'inibicao' ? String(extra.umidadeFinal || extra['Umidade final (ppm)'] || '') : '',
    equipmentId: service.equipmentId || serviceEquipmentLabel(service),
    system: service.system || String(extra.Sistema || ''),
    equipamentoTestado: previousPressureTestedEquipment || extra.equipamentoTestado,
    equipamentoTestadoOutro: String(extra.equipamentoTestadoOutro || extra['Outro equipamento testado'] || ''),
    material:
      previousPressureTestedEquipment && previousPressureTestedEquipment !== 'tubulacao'
        ? ''
        : service.material || String(extra['Material da tubulação'] || extra['Material do equipamento'] || ''),
    startTime: '',
    endTime: '',
    notes: '',
    finalized: undefined,
    _prefilled: true
  };
}
