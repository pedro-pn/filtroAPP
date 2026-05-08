import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { downloadReportDocx, downloadReportPdf } from '../api/reports';
import { useAuth } from '../auth/AuthContext';
import type { UploadedFile } from '../api/uploads';
import { ServiceCollaboratorsBlock, ServiceFields, serviceTypeLabels } from '../components/reports/ServiceFields';
import { SignatureProgress } from '../components/reports/SignatureProgress';
import { useToast } from '../components/ui/Toast';
import { useCollaborators } from '../hooks/useCollaborators';
import { useCounters } from '../hooks/useCounters';
import { useEquipment } from '../hooks/useEquipment';
import { useManometers } from '../hooks/useManometers';
import { useProjects } from '../hooks/useProjects';
import { useReport, useReportMutations, useReports } from '../hooks/useReports';
import { useUnits } from '../hooks/useUnits';
import { Shell } from '../layout/Shell';
import { TopBar } from '../layout/TopBar';
import { Modal } from '../components/ui/Modal';
import { ReasonDialog } from '../components/ui/ReasonDialog';
import { UploadField } from '../components/ui/UploadField';
import type { ReportPayload, ReportStatus, ReportSummary } from '../types/domain';
import { formatDateOnlyPtBr } from '../utils/dateOnly';
import { downloadBlob } from '../utils/download';
import { sortProjects } from '../utils/projectSort';
import { buildReportServicePayload, normalizeServiceType } from '../utils/reportServicePayload';
import { loadUploadAssetUrl } from '../utils/uploadAssetUrl';
import { closeZapSignPendingWindow, openZapSignPendingWindow, redirectZapSignWindow } from '../utils/zapSign';

const TEXT = {
  addService: 'Adicionar serviço',
  approvedAt: 'Aprovado em',
  approve: 'Aprovar',
  back: 'Voltar',
  code: 'Código',
  collaborators: 'Equipe',
  description: 'Descrição do dia',
  details: 'Detalhe do relatório',
  downloadError: 'Não foi possível baixar o relatório.',
  finalization: 'Finalização',
  generalInfo: 'Informações gerais',
  interval: 'Intervalo',
  loadError: 'Falha ao carregar relatório.',
  loading: 'Carregando relatório...',
  missing: 'Relatório não encontrado.',
  nightTeam: 'Equipe noturna',
  noService: 'Nenhum serviço adicionado.',
  project: 'Projeto',
  reject: 'Devolver',
  rejectClient: 'Reprovar',
  rejectClientPrompt: 'Informe o motivo da reprovação do relatório:',
  rejectClientRequired: 'Informe um motivo para reprovar o relatório.',
  rejectPrompt: 'Informe o motivo da devolução do relatório:',
  rejectRequired: 'Informe um motivo para devolver o relatório.',
  reportSummary: 'Resumo',
  requestSignature: 'Assinar',
  requestSignatureError: 'Não foi possível solicitar a assinatura.',
  returnedAt: 'Devolvido em',
  save: 'Salvar',
  saved: 'Relatório atualizado.',
  select: 'Selecione',
  service: 'Serviço',
  services: 'Serviços',
  signedLocked: 'Relatório assinado. Os dados estão bloqueados para edição.',
  signatureRequested: 'Assinatura solicitada. Abra o link para concluir.',
  team: 'Equipe',
  time: 'Horário',
  updateError: 'Não foi possível atualizar o relatório.'
};

const serviceTypeModalOptions = [
  { type: 'limpeza', icon: '🧪', name: 'Limpeza química' },
  { type: 'pressao', icon: '🔴', name: 'Teste de pressão' },
  { type: 'filtragem', icon: '🔵', name: 'Filtragem' },
  { type: 'flushing', icon: '💧', name: 'Flushing' },
  { type: 'mecanica', icon: '⚙️', name: 'Limpeza mecânica' },
  { type: 'inibicao', icon: '🛡️', name: 'Inibição' },
] as const;

interface RdoServiceForm {
  id: string;
  type: string;
  data: Record<string, unknown>;
}

interface RdoFormState {
  projectId: string | null;
  sequenceNumber: string;
  reportDate: string;
  arrivalTime: string;
  departureTime: string;
  lunchBreak: string;
  collaboratorIds: string[];
  nightCollaboratorIds: string[];
  standby: boolean;
  standbyDuration: string;
  standbyMotivo: string;
  noturno: boolean;
  noturnoStart: string;
  noturnoEnd: string;
  overtimeReason: string;
  dailyDescription: string;
  generalUploads: UploadedFile[];
  services: RdoServiceForm[];
}

function formatDate(value?: string | null) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('pt-BR');
}

function toDateInput(value?: string | null) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 10);
  return date.toISOString().slice(0, 10);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

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

function serviceFinalizedValue(service: NonNullable<ReportSummary['services']>[number]) {
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

function toPositiveInteger(value: string) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function hasActiveClientRejection(report: ReportSummary) {
  const special = report.specialConditions || {};
  const rejectedAt = typeof special.__clientRejectedAt === 'string' ? special.__clientRejectedAt : '';
  const resolvedAt = typeof special.__clientRejectionResolvedAt === 'string' ? special.__clientRejectionResolvedAt : '';
  if (!rejectedAt) return false;
  return !resolvedAt || new Date(rejectedAt).getTime() > new Date(resolvedAt).getTime();
}

function asUploadedFiles(value: unknown): UploadedFile[] {
  return Array.isArray(value)
    ? value
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
      .map(item => ({
        label: getString(item.label) || 'Arquivo',
        fileName: getString(item.fileName) || getString(item.name) || getString(item.url) || getString(item.path) || getString(item.storagePath) || 'arquivo',
        mimeType: getString(item.mimeType) || getString(item.type) || 'image/jpeg',
        url: getString(item.url) || getString(item.path) || getString(item.storagePath) || getString(item.dataUrl)
      }))
      .filter((item): item is UploadedFile => Boolean(item.url))
    : [];
}

function GeneralUploadThumb({ file }: { file: UploadedFile }) {
  const [href, setHref] = useState('');

  useEffect(() => {
    let cancelled = false;
    let objectUrl = '';

    loadUploadAssetUrl(file.url)
      .then(nextHref => {
        if (cancelled) {
          if (nextHref.startsWith('blob:')) URL.revokeObjectURL(nextHref);
          return;
        }
        objectUrl = nextHref.startsWith('blob:') ? nextHref : '';
        setHref(nextHref);
      })
      .catch(() => {
        if (!cancelled) setHref('');
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [file.url]);

  if (!href) return null;

  return (
    <a href={href} target="_blank" rel="noopener noreferrer">
      <img src={href} alt={file.fileName || 'foto'} className="upload-thumb" />
    </a>
  );
}

function serviceEquipmentValue(service: NonNullable<ReportSummary['services']>[number]) {
  const extra = service.extraData || {};
  const value = extra['Equipamento(s)'] || extra.Equipamentos || extra.Equipamento || extra['ID da embarcação'] || extra['ID da embarcacao'];
  if (Array.isArray(value)) return value.filter(Boolean).join(', ');
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (Array.isArray(record.labels)) return record.labels.filter(Boolean).join(', ');
    return getString(record.name) || getString(record.nome) || getString(record.code) || getString(record.codigo) || getString(record.id);
  }
  return getString(value) || service.equipmentId || '';
}

function serviceId() {
  return `svc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function legacyServiceData(service: NonNullable<ReportSummary['services']>[number]) {
  const extra = service.extraData || {};
  const type = normalizeServiceType(service.serviceType || '');
  const collaboratorField = serviceCollaboratorField(extra);
  const pressureWork = parseValueWithUnit(getLegacyValue(extra, ['pressaoTrabalho', 'Pressão de trabalho', 'Pressao de trabalho']), ['bar', 'psi', 'kg/cm²', 'MPa', 'kPa'], 'bar');
  const pressureTest = parseValueWithUnit(getLegacyValue(extra, ['pressaoTeste', 'Pressão de teste', 'Pressao de teste']), ['bar', 'psi', 'kg/cm²', 'MPa', 'kPa'], 'bar');
  const volume = parseValueWithUnit(getLegacyValue(extra, ['volumeOleo', 'Volume de óleo', 'Volume de oleo']), ['L', 'mL'], 'L');
  const fluidoTeste = getLegacyChoice(extra, ['fluidoTeste', 'Fluido de teste']);
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
      data.tipoFlushing = tipoFlushing.toLowerCase().includes('secund') ? 'secundario' : 'primario';
      data.uf = normalizeUnitField(extra, ['uf', 'Unidade de Flushing', 'Unidade de filtragem']);
    } else {
      data.ufg = normalizeUnitField(extra, ['ufg', 'Unidade de filtragem']);
    }
  }

  if (type === 'inibicao') {
    data.embarcacaoId = getLegacyString(extra, ['embarcacaoId', 'ID da embarcação', 'ID da embarcacao']);
    data.linhas = getLegacyString(extra, ['linhas', 'Linhas']);
    data.steps = getLegacyString(extra, ['steps', 'Steps']);
    data.tipoRelatorio = getLegacyStrings(extra, ['tipoRelatorio', 'Tipo de relatório', 'Tipo de relatorio']);
  }

  return data;
}

function reportToForm(report: ReportSummary): RdoFormState {
  const specialConditions = asRecord(report.specialConditions);
  const standbyDetails = asRecord(specialConditions.standbyDetails);
  const noturnoDetails = asRecord(specialConditions.noturnoDetails);
  const nightCollaboratorIds = Array.isArray(noturnoDetails.collaboratorIds)
    ? noturnoDetails.collaboratorIds.filter((id): id is string => typeof id === 'string')
    : [];

  return {
    projectId: report.projectId,
    sequenceNumber: report.sequenceNumber ? String(report.sequenceNumber) : '',
    reportDate: toDateInput(report.reportDate),
    arrivalTime: report.arrivalTime || '',
    departureTime: report.departureTime || '',
    lunchBreak: report.lunchBreak || '',
    collaboratorIds: (report.collaborators || []).map(link => link.collaboratorId).filter(Boolean),
    nightCollaboratorIds,
    standby: Boolean(specialConditions.standby),
    standbyDuration: getString(standbyDetails.total),
    standbyMotivo: getString(standbyDetails.motivo),
    noturno: Boolean(specialConditions.noturno || noturnoDetails.enabled || nightCollaboratorIds.length),
    noturnoStart: getString(noturnoDetails.inicio),
    noturnoEnd: getString(noturnoDetails.termino),
    overtimeReason: report.overtimeReason || '',
    dailyDescription: report.dailyDescription || '',
    generalUploads: asUploadedFiles(specialConditions.generalUploads),
    services: (report.services || []).map(service => {
      return {
        id: service.id || serviceId(),
        type: service.serviceType,
        data: legacyServiceData(service)
      };
    })
  };
}

function buildPayload(
  report: ReportSummary,
  form: RdoFormState,
  resources: {
    collaborators: ReturnType<typeof useCollaborators>['data'];
    equipment: ReturnType<typeof useEquipment>['data'];
    units: ReturnType<typeof useUnits>['data'];
  }
): Omit<ReportPayload, 'createdByUserId' | 'status'> {
  return {
    projectId: form.projectId || report.projectId,
    reportType: report.reportType,
    sequenceNumber: toPositiveInteger(form.sequenceNumber),
    reportDate: form.reportDate,
    arrivalTime: form.arrivalTime,
    departureTime: form.departureTime,
    lunchBreak: form.lunchBreak,
    daytimeCount: form.collaboratorIds.length,
    overtimeReason: form.overtimeReason || null,
    dailyDescription: form.dailyDescription || null,
    specialConditions: {
      ...asRecord(report.specialConditions),
      standby: form.standby,
      noturno: form.noturno,
      standbyDetails: {
        total: form.standbyDuration,
        motivo: form.standbyMotivo
      },
      generalUploads: form.generalUploads,
      noturnoDetails: {
        enabled: form.noturno,
        inicio: form.noturnoStart,
        termino: form.noturnoEnd,
        intervalo: getString(asRecord(asRecord(report.specialConditions).noturnoDetails).intervalo) || '01:00:00',
        collaboratorIds: form.nightCollaboratorIds,
        colaboradores: form.nightCollaboratorIds
          .map(id => resources.collaborators?.find(collaborator => collaborator.id === id)?.name || id)
      }
    },
    collaboratorIds: form.collaboratorIds,
    services: form.services.map(service => {
      const explicitServiceCollaborators = Object.prototype.hasOwnProperty.call(service.data, 'serviceCollaboratorIds');
      return buildReportServicePayload(service, {
        collaboratorIds: explicitServiceCollaborators && Array.isArray(service.data.serviceCollaboratorIds)
          ? service.data.serviceCollaboratorIds.filter((id): id is string => typeof id === 'string')
          : Array.from(new Set([...form.collaboratorIds, ...form.nightCollaboratorIds])),
        collaborators: resources.collaborators || [],
        equipment: resources.equipment || [],
        units: resources.units || []
      });
    })
  };
}

function ManagerRdoEditor({ report }: { report: ReportSummary }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const projectsQuery = useProjects(true);
  const reportsQuery = useReports();
  const collaboratorsQuery = useCollaborators();
  const equipmentQuery = useEquipment();
  const unitsQuery = useUnits();
  const manometersQuery = useManometers();
  const countersQuery = useCounters();
  const reportMutations = useReportMutations();
  const showToast = useToast();
  const [form, setForm] = useState<RdoFormState>(() => reportToForm(report));
  const [returnDialogOpen, setReturnDialogOpen] = useState(false);
  const [collaboratorToAdd, setCollaboratorToAdd] = useState('');
  const [nightCollaboratorToAdd, setNightCollaboratorToAdd] = useState('');
  const [showServiceModal, setShowServiceModal] = useState(false);
  const readOnly = report.status === 'SIGNED';
  const isManager = user?.role === 'MANAGER';
  const canEditSequence = isManager && !readOnly;
  const canApproveInEditor = report.status === 'PENDING' || report.status === 'RETURNED' || hasActiveClientRejection(report);

  useEffect(() => {
    setForm(reportToForm(report));
  }, [report]);

  const projects = useMemo(() => sortProjects(projectsQuery.data || [], 'asc'), [projectsQuery.data]);
  const selectedProject = projects.find(project => project.id === (form.projectId || report.projectId))
    || (form.projectId === report.projectId ? report.project : null);
  const projectLeaderHint = selectedProject?.operator?.name
    ? `Líder do projeto: ${selectedProject.operator.name}`
    : 'Projeto sem líder definido.';
  const parsedSequenceNumber = toPositiveInteger(form.sequenceNumber);
  const sequenceConflict = useMemo(() => {
    if (!form.projectId || !parsedSequenceNumber) return null;
    return (reportsQuery.data || []).find(item => (
      item.id !== report.id
      && item.projectId === form.projectId
      && item.reportType === report.reportType
      && Number(item.sequenceNumber) === parsedSequenceNumber
    )) || null;
  }, [form.projectId, parsedSequenceNumber, report.id, report.reportType, reportsQuery.data]);
  const sequenceHint = sequenceConflict
    ? `Número já usado no relatório ${sequenceConflict.reportType} ${sequenceConflict.sequenceNumber}.`
    : 'Usado para manter a sequência do projeto e dos relatórios derivados.';
  const selectedCollaboratorIds = useMemo(
    () => new Set([...form.collaboratorIds, ...form.nightCollaboratorIds]),
    [form.collaboratorIds, form.nightCollaboratorIds]
  );
  const collaborators = (collaboratorsQuery.data || []).filter(item => item.isActive || selectedCollaboratorIds.has(item.id));
  const serviceCollaboratorOptions = useMemo(() => {
    const ids = Array.from(new Set([...form.collaboratorIds, ...form.nightCollaboratorIds]));
    return ids
      .map(id => {
        const collaborator = collaborators.find(item => item.id === id);
        return collaborator ? { id: collaborator.id, name: collaborator.name } : null;
      })
      .filter((item): item is { id: string; name: string } => Boolean(item));
  }, [form.collaboratorIds, form.nightCollaboratorIds, collaborators]);
  const equipment = equipmentQuery.data || [];
  const units = unitsQuery.data || [];
  const manometers = manometersQuery.data || [];
  const counters = countersQuery.data || [];

  function setField<K extends keyof RdoFormState>(field: K, value: RdoFormState[K]) {
    setForm(current => ({ ...current, [field]: value }));
  }

  function addCollaboratorFromSelect(night = false) {
    const id = night ? nightCollaboratorToAdd : collaboratorToAdd;
    if (!id) return;
    const field = night ? 'nightCollaboratorIds' : 'collaboratorIds';
    setField(field, Array.from(new Set([...form[field], id])));
    if (night) {
      setNightCollaboratorToAdd('');
    } else {
      setCollaboratorToAdd('');
    }
  }

  function removeCollaboratorFromList(id: string, night = false) {
    const field = night ? 'nightCollaboratorIds' : 'collaboratorIds';
    setField(field, form[field].filter(item => item !== id));
  }

  function renderCollaboratorList(ids: string[], night = false) {
    if (!ids.length) return <div className="colab-empty">Nenhum colaborador adicionado.</div>;
    return ids.map(id => {
      const item = collaborators.find(candidate => candidate.id === id);
      return (
        <span className="colab-tag" key={`${night ? 'night' : 'day'}-${id}`}>
          <span>{item?.name || id}</span>
          <button type="button" disabled={readOnly} onClick={() => removeCollaboratorFromList(id, night)}>x</button>
        </span>
      );
    });
  }

  function addService(type = 'limpeza') {
    const id = serviceId();
    setForm(current => ({
      ...current,
      services: [...current.services, { id, type, data: {} }]
    }));
    setShowServiceModal(false);
    window.setTimeout(() => {
      document.querySelector(`[data-service-id="${id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 80);
  }

  function updateService(id: string, data: Partial<RdoServiceForm>) {
    setForm(current => ({
      ...current,
      services: current.services.map(service => (
        service.id === id
          ? { ...service, ...data, data: { ...service.data, ...(data.data || {}) } }
          : service
      ))
    }));
  }

  function removeService(id: string) {
    setForm(current => ({ ...current, services: current.services.filter(service => service.id !== id) }));
  }

  function validateSequence() {
    if (!toPositiveInteger(form.sequenceNumber)) {
      showToast('Informe um número de relatório válido.', 'error');
      return false;
    }
    if (sequenceConflict) {
      showToast('O número informado já está em uso no projeto selecionado.', 'error');
      return false;
    }
    return true;
  }

  async function handleSave(options: { navigateAfter?: boolean; showSuccess?: boolean } = {}) {
    if (readOnly) return false;
    if (!validateSequence()) return false;

    const { navigateAfter = true, showSuccess = true } = options;

    try {
      await reportMutations.updateReport.mutateAsync({
        id: report.id,
        payload: buildPayload(report, form, {
          collaborators,
          equipment,
          units
        })
      });
      if (showSuccess) showToast(TEXT.saved, 'success');
      if (navigateAfter) navigate(user?.role === 'MANAGER' ? '/gestor' : '/home');
      return true;
    } catch (err) {
      showToast(err instanceof Error ? err.message : TEXT.updateError, 'error');
      return false;
    }
  }

  async function handleStatus(status: Extract<ReportStatus, 'APPROVED' | 'RETURNED'>, reviewNotes?: string | null) {
    if (readOnly) return;

    try {
      await reportMutations.updateStatus.mutateAsync({ id: report.id, payload: { status, reviewNotes } });
      if (status === 'RETURNED') setReturnDialogOpen(false);
      showToast(status === 'APPROVED' ? 'Relatório aprovado.' : 'Relatório devolvido.', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : TEXT.updateError, 'error');
    }
  }

  async function handleSaveAndStatus(status: Extract<ReportStatus, 'APPROVED' | 'RETURNED'>, reviewNotes?: string | null) {
    const saved = await handleSave({ navigateAfter: false, showSuccess: false });
    if (!saved) return;
    await handleStatus(status, reviewNotes);
  }

  async function handleDownload(format: 'pdf' | 'docx') {
    showToast(format === 'pdf' ? 'Gerando PDF...' : 'Gerando DOCX...', 'info');
    try {
      const blob = format === 'pdf' ? await downloadReportPdf(report.id) : await downloadReportDocx(report.id);
      downloadBlob(blob, `${report.reportType}_${report.sequenceNumber || report.id}.${format}`);
      showToast(format === 'pdf' ? 'PDF gerado com sucesso.' : 'DOCX baixado com sucesso.', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : TEXT.downloadError, 'error');
    }
  }

  return (
    <>
      {readOnly ? <div className="page-card inline-success">{TEXT.signedLocked}</div> : null}

      <section className="page-card">
        <div className="section-title">{TEXT.generalInfo}</div>
        <div className="admin-inline-grid manager-header-grid">
          <div className="field-group">
            <label htmlFor="rdo-project">{TEXT.project}</label>
            <select
              id="rdo-project"
              value={form.projectId || ''}
              disabled={readOnly}
              onChange={event => setField('projectId', event.target.value || null)}
              required
            >
              <option value="">{TEXT.select}</option>
              {projects.map(project => (
                <option key={project.id} value={project.id}>
                  {project.code} - {project.name}
                </option>
              ))}
            </select>
            <span className="placeholder-copy" style={{ marginTop: 4 }}>{projectLeaderHint}</span>
          </div>
          <div className="field-group">
            <label htmlFor="rdo-sequence">Número do relatório</label>
            <input
              id="rdo-sequence"
              type="number"
              min={1}
              step={1}
              value={form.sequenceNumber}
              disabled={!canEditSequence}
              onChange={event => setField('sequenceNumber', event.target.value)}
              required
            />
            {isManager ? (
              <span
                className={sequenceConflict ? 'inline-error' : 'placeholder-copy'}
                style={{ marginTop: 4 }}
              >
                {sequenceHint}
              </span>
            ) : null}
          </div>
          <div className="field-group">
            <label htmlFor="rdo-date">Data do relatório</label>
            <input
              id="rdo-date"
              type="date"
              value={form.reportDate}
              disabled={readOnly}
              onChange={event => setField('reportDate', event.target.value)}
              required
            />
          </div>
          <div className="field-group">
            <label htmlFor="rdo-arrival">Chegada</label>
            <input
              id="rdo-arrival"
              type="time"
              value={form.arrivalTime}
              disabled={readOnly}
              onChange={event => setField('arrivalTime', event.target.value)}
              required
            />
          </div>
          <div className="field-group">
            <label htmlFor="rdo-departure">Saída</label>
            <input
              id="rdo-departure"
              type="time"
              value={form.departureTime}
              disabled={readOnly}
              onChange={event => setField('departureTime', event.target.value)}
              required
            />
          </div>
          <div className="field-group">
            <label htmlFor="rdo-lunch">{TEXT.interval}</label>
            <input
              id="rdo-lunch"
              type="time"
              step={1}
              value={form.lunchBreak}
              disabled={readOnly}
              onChange={event => setField('lunchBreak', event.target.value)}
              required
            />
          </div>
        </div>
      </section>

      <section className="page-card">
        <div className="section-title">Equipe diurna</div>
        <div className="colab-list">
          {renderCollaboratorList(form.collaboratorIds)}
        </div>
        {!readOnly ? (
          <div className="cadd">
            <select value={collaboratorToAdd} onChange={event => setCollaboratorToAdd(event.target.value)}>
              <option value="">Adicionar...</option>
              {collaborators
                .filter(item => !form.collaboratorIds.includes(item.id))
                .map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
            <button className="cadd-btn" type="button" onClick={() => addCollaboratorFromSelect()}>
              + Add
            </button>
          </div>
        ) : null}
      </section>

      <section className="page-card">
        <div className="section-title">Condições especiais</div>
        <div className="tog-row">
          <span className="tog-lbl">Houve standby?</span>
          <label className="tog">
            <input
              type="checkbox"
              checked={form.standby}
              disabled={readOnly}
              onChange={event => setField('standby', event.target.checked)}
            />
            <span className="tog-sl" />
          </label>
        </div>
        <div className={`manager-collapse ${form.standby ? 'open' : ''}`}>
          <div className="fg-r2">
            <div className="field-group">
              <label htmlFor="rdo-standby-total">Tempo total</label>
              <input
                id="rdo-standby-total"
                type="time"
                step={60}
                min="00:00"
                max="23:59"
                value={form.standbyDuration}
                disabled={readOnly}
                onChange={event => setField('standbyDuration', event.target.value)}
              />
            </div>
            <div className="field-group">
              <label htmlFor="rdo-standby-motivo">Motivo</label>
              <input
                id="rdo-standby-motivo"
                type="text"
                value={form.standbyMotivo}
                disabled={readOnly}
                onChange={event => setField('standbyMotivo', event.target.value)}
              />
            </div>
          </div>
        </div>
        <div className="tog-row">
          <span className="tog-lbl">Houve turno noturno?</span>
          <label className="tog">
            <input
              type="checkbox"
              checked={form.noturno}
              disabled={readOnly}
              onChange={event => setField('noturno', event.target.checked)}
            />
            <span className="tog-sl" />
          </label>
        </div>
        <div className={`manager-collapse ${form.noturno ? 'open' : ''}`}>
          <div className="fg-r2">
            <div className="field-group">
              <label htmlFor="rdo-noturno-inicio">Início</label>
              <input
                id="rdo-noturno-inicio"
                type="time"
                value={form.noturnoStart}
                disabled={readOnly}
                onChange={event => setField('noturnoStart', event.target.value)}
              />
            </div>
            <div className="field-group">
              <label htmlFor="rdo-noturno-termino">Término</label>
              <input
                id="rdo-noturno-termino"
                type="time"
                value={form.noturnoEnd}
                disabled={readOnly}
                onChange={event => setField('noturnoEnd', event.target.value)}
              />
            </div>
          </div>
          <div className="field-group" style={{ marginTop: 10 }}>
            <label>Colaboradores noturnos</label>
            <div className="colab-list">
              {renderCollaboratorList(form.nightCollaboratorIds, true)}
            </div>
            {!readOnly ? (
              <div className="cadd">
                <select value={nightCollaboratorToAdd} onChange={event => setNightCollaboratorToAdd(event.target.value)}>
                  <option value="">Adicionar...</option>
                  {collaborators
                    .filter(item => !form.nightCollaboratorIds.includes(item.id))
                    .map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
                <button className="cadd-btn" type="button" onClick={() => addCollaboratorFromSelect(true)}>
                  + Add
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </section>

      <section className="page-card report-services-step">
        <div className="section-title">{TEXT.services}</div>
        {form.services.length ? (
          <div className="admin-stack" style={{ marginTop: 12 }}>
            {form.services.map((service, index) => (
              <article className="admin-card-react" key={service.id} data-service-id={service.id}>
                <div className="svc-card-header">
                  <div className="svc-card-title">
                    <span>{serviceTypeLabels[normalizeServiceType(service.type)] || service.type}</span>
                    <span className="svc-card-badge">{TEXT.service} {index + 1}</span>
                  </div>
                  {!readOnly ? (
                    <div className="admin-card-actions">
                      <button className="svc-remove" type="button" onClick={() => removeService(service.id)}>
                        Remover
                      </button>
                    </div>
                  ) : null}
                </div>
                <div className="admin-form-grid">
                  <div className="field-group">
                    <label>Equipamento(s)</label>
                    <input
                      value={getString(service.data.equipmentId)}
                      disabled={readOnly}
                      placeholder="Informar equipamento do cliente..."
                      onChange={event => updateService(service.id, { data: { equipmentId: event.target.value } })}
                    />
                  </div>
                  {normalizeServiceType(service.type) !== 'inibicao' ? (
                    <div className="field-group">
                      <label>Sistema</label>
                      <input
                        value={getString(service.data.system)}
                        disabled={readOnly}
                        onChange={event => updateService(service.id, { data: { system: event.target.value } })}
                      />
                    </div>
                  ) : null}
                  {normalizeServiceType(service.type) !== 'inibicao' ? (
                    <ServiceCollaboratorsBlock
                      data={service.data}
                      onChange={update => updateService(service.id, { data: update })}
                      disabled={readOnly}
                      collaboratorOptions={serviceCollaboratorOptions}
                    />
                  ) : null}
                  <div className="fg-r2 service-time-grid">
                    <div className="field-group">
                      <label>Hora de início</label>
                      <input
                        type="time"
                        value={getString(service.data.startTime)}
                        disabled={readOnly}
                        onChange={event => updateService(service.id, { data: { startTime: event.target.value } })}
                      />
                    </div>
                    <div className="field-group">
                      <label>Hora de término/pausa</label>
                      <input
                        type="time"
                        value={getString(service.data.endTime)}
                        disabled={readOnly}
                        onChange={event => updateService(service.id, { data: { endTime: event.target.value } })}
                      />
                    </div>
                  </div>
                  <ServiceFields
                    serviceType={service.type}
                    data={service.data}
                    onChange={update => updateService(service.id, { data: update })}
                    disabled={readOnly}
                    units={units}
                    manometers={manometers}
                    counters={counters}
                    collaboratorOptions={serviceCollaboratorOptions}
                    groupKey={service.id}
                    projectId={form.projectId}
                  />
                </div>
              </article>
            ))}
          </div>
        ) : (
          <p className="placeholder-copy">{TEXT.noService}</p>
        )}
        {!readOnly ? (
          <div className="admin-form-actions" style={{ marginTop: 12 }}>
            <button
              className="secondary-button"
              type="button"
              style={{ width: '100%', borderStyle: 'dashed', color: 'var(--g)', fontWeight: 700 }}
              onClick={() => setShowServiceModal(true)}
            >
              ＋ {TEXT.addService}
            </button>
          </div>
        ) : null}
      </section>

      <section className="page-card">
        <div className="section-title">{TEXT.finalization}</div>
        <div className="admin-form-grid">
          <div className="field-group">
            <label htmlFor="rdo-overtime">Motivo da hora extra</label>
            <input
              id="rdo-overtime"
              value={form.overtimeReason}
              disabled={readOnly}
              onChange={event => setField('overtimeReason', event.target.value)}
            />
          </div>
          <div className="field-group">
            <label htmlFor="rdo-description">{TEXT.description}</label>
            <textarea
              id="rdo-description"
              rows={5}
              value={form.dailyDescription}
              disabled={readOnly}
              onChange={event => setField('dailyDescription', event.target.value)}
            />
          </div>
          <UploadField
            label="Fotos de registro"
            value={form.generalUploads}
            projectId={form.projectId}
            disabled={readOnly}
            onChange={files => setField('generalUploads', files)}
          />
        </div>
        <ReasonDialog
          open={returnDialogOpen}
          title={TEXT.reject}
          description={TEXT.rejectPrompt}
          label="Motivo"
          confirmLabel={TEXT.reject}
          requiredMessage={TEXT.rejectRequired}
          isSubmitting={reportMutations.updateReport.isPending || reportMutations.updateStatus.isPending}
          onCancel={() => setReturnDialogOpen(false)}
          onConfirm={reason => void handleSaveAndStatus('RETURNED', reason)}
        />
      </section>

      {!readOnly ? (
        <div className="detail-action-bar detail-manager-action-bar">
          <button
            className="primary-button"
            type="button"
            disabled={reportMutations.updateReport.isPending}
            onClick={() => void handleSave()}
          >
            {TEXT.save}
          </button>
          <button className="secondary-button" type="button" onClick={() => void handleDownload('pdf')}>
            PDF
          </button>
          {isManager ? (
            <button className="secondary-button" type="button" onClick={() => void handleDownload('docx')}>
              DOCX
            </button>
          ) : null}
          {isManager && canApproveInEditor ? (
            <button
              className="primary-button"
              type="button"
              disabled={reportMutations.updateReport.isPending || reportMutations.updateStatus.isPending}
              onClick={() => void handleSaveAndStatus('APPROVED')}
            >
              {hasActiveClientRejection(report) ? 'Salvar e Reenviar' : 'Salvar e Aprovar'}
            </button>
          ) : null}
          {isManager ? (
            <button
              className="danger-button"
              type="button"
              disabled={reportMutations.updateReport.isPending || reportMutations.updateStatus.isPending}
              onClick={() => setReturnDialogOpen(true)}
            >
              Salvar e Devolver
            </button>
          ) : null}
        </div>
      ) : null}

      <Modal
        open={showServiceModal}
        onClose={() => setShowServiceModal(false)}
        backdropClassName="stype-modal-ov"
        panelClassName="stype-modal-sh"
        ariaLabelledBy="detail-service-type-title"
      >
            <div className="stype-modal-handle" />
            <div className="stype-modal-title" id="detail-service-type-title">Tipo de serviço</div>
            <div className="stype-grid">
              {serviceTypeModalOptions.map(({ type, icon, name }) => (
                <button
                  className="stype-btn"
                  key={type}
                  type="button"
                  onClick={() => addService(type)}
                >
                  <div className="stype-icon">{icon}</div>
                  <div className="stype-name">{name}</div>
                </button>
              ))}
            </div>
      </Modal>
    </>
  );
}

function ReportDetailActions({ report, role }: { report: ReportSummary; role?: string }) {
  const reportMutations = useReportMutations();
  const showToast = useToast();
  const [clientRejectOpen, setClientRejectOpen] = useState(false);
  const [clientComment, setClientComment] = useState('');
  const canDownloadDocx = role === 'MANAGER';
  const canClientSign = role === 'CLIENT' && report.reportType === 'RDO' && report.status === 'APPROVED' && !hasActiveClientRejection(report);

  async function handleDownload(format: 'pdf' | 'docx') {
    showToast(format === 'pdf' ? 'Gerando PDF...' : 'Gerando DOCX...', 'info');
    try {
      const blob = format === 'pdf' ? await downloadReportPdf(report.id) : await downloadReportDocx(report.id);
      downloadBlob(blob, `${report.reportType}_${report.sequenceNumber || report.id}.${format}`);
      showToast(format === 'pdf' ? 'PDF gerado com sucesso.' : 'DOCX baixado com sucesso.', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : TEXT.downloadError, 'error');
    }
  }

  async function handleRequestSignature() {
    const confirmText = `Você será redirecionado para a ZapSign para assinar digitalmente o ${report.reportType || 'RDO'} nº ${report.sequenceNumber ?? '---'}. Deseja continuar?`;
    if (!window.confirm(confirmText)) return;

    const signWindow = openZapSignPendingWindow();
    try {
      const response = await reportMutations.requestSignature.mutateAsync({
        id: report.id,
        comment: clientComment.trim() || null
      });
      if (response.signUrl) {
        redirectZapSignWindow(signWindow, response.signUrl);
        showToast('Link de assinatura aberto na ZapSign.', 'success');
        return;
      }
      closeZapSignPendingWindow(signWindow);
      throw new Error('Link de assinatura não retornado.');
    } catch (err) {
      closeZapSignPendingWindow(signWindow);
      showToast(err instanceof Error ? err.message : TEXT.requestSignatureError, 'error');
    }
  }

  async function handleClientReject(comment: string) {
    try {
      await reportMutations.clientReview.mutateAsync({
        id: report.id,
        payload: { action: 'REJECTED', comment }
      });
      setClientRejectOpen(false);
      showToast('Avaliação registrada.', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : TEXT.updateError, 'error');
    }
  }

  return (
    <>
      <div className="detail-action-bar">
        <button className="primary-button" type="button" onClick={() => void handleDownload('pdf')}>
          PDF
        </button>
        {canDownloadDocx ? (
          <button className="secondary-button" type="button" onClick={() => void handleDownload('docx')}>
            DOCX
          </button>
        ) : null}
        {canClientSign ? (
          <>
            <div className="field-group client-report-comment detail-client-comment">
              <label htmlFor={`detail-client-review-comment-${report.id}`}>Comentário do cliente</label>
              <textarea
                id={`detail-client-review-comment-${report.id}`}
                rows={3}
                placeholder="Comentário opcional que será exibido no relatório final"
                value={clientComment}
                onChange={event => setClientComment(event.target.value)}
              />
            </div>
            <button className="primary-button" type="button" onClick={() => void handleRequestSignature()}>
              {report.zapsignRequestedAt && !report.zapsignSignedAt ? 'Continuar assinatura digital' : 'Aprovar e assinar digitalmente'}
            </button>
            <button className="secondary-button" type="button" onClick={() => setClientRejectOpen(true)}>
              {TEXT.rejectClient}
            </button>
          </>
        ) : null}
      </div>
      <ReasonDialog
        open={clientRejectOpen}
        title={TEXT.rejectClient}
        description={TEXT.rejectClientPrompt}
        label="Motivo"
        confirmLabel={TEXT.rejectClient}
        requiredMessage={TEXT.rejectClientRequired}
        isSubmitting={reportMutations.clientReview.isPending}
        onCancel={() => setClientRejectOpen(false)}
        onConfirm={reason => void handleClientReject(reason)}
      />
    </>
  );
}

const statusLabels: Record<string, string> = {
  PENDING: 'Pendente',
  RETURNED: 'Devolvido',
  APPROVED: 'Aprovado',
  SIGNED: 'Assinado'
};

function ServiceSummaryRow({ service, index }: { service: NonNullable<ReportSummary['services']>[number]; index: number }) {
  const type = normalizeServiceType(service.serviceType || '');
  const label = serviceTypeLabels[type] || type;
  const data = legacyServiceData(service);
  const rows: { label: string; value: string }[] = [];

  if (service.equipment) {
    rows.push({ label: 'Equipamento', value: `${service.equipment.code} - ${service.equipment.name}` });
  } else if (data.equipmentId) {
    rows.push({ label: 'Equipamento', value: String(data.equipmentId) });
  }
  if (data.system) rows.push({ label: 'Sistema', value: String(data.system) });
  if (type !== 'flushing' && data.material) rows.push({ label: 'Material', value: String(data.material) });
  if (data.startTime || data.endTime) {
    rows.push({ label: 'Horário', value: `${data.startTime || '--'} às ${data.endTime || '--'}` });
  }

  if (type === 'limpeza') {
    const metodos = formatDetailValue(data.metodos);
    const local = formatDetailValue(data.local);
    const inspecao = formatDetailValue(data.tipoInspecao);
    if (metodos) rows.push({ label: 'Método', value: metodos });
    if (local) rows.push({ label: 'Local', value: local });
    if (inspecao) rows.push({ label: 'Inspeção', value: inspecao });
  }

  if (type === 'pressao') {
    if (data.pressaoTrabalho) rows.push({ label: 'P. trabalho', value: `${data.pressaoTrabalho} ${data.pressaoTrabalhoUnit || ''}`.trim() });
    if (data.pressaoTeste) rows.push({ label: 'P. teste', value: `${data.pressaoTeste} ${data.pressaoTesteUnit || ''}`.trim() });
    if (data.fluidoTeste) rows.push({ label: 'Fluido', value: data.fluidoTeste === 'agua' ? 'Água' : 'Óleo' });
  }

  if (type === 'flushing' || type === 'filtragem') {
    if (data.tipoOleo) rows.push({ label: 'Tipo de óleo', value: String(data.tipoOleo) });
    if (data.volumeOleo) rows.push({ label: 'Volume', value: `${data.volumeOleo} ${data.volumeOleoUnit || ''}`.trim() });
    if (type === 'flushing' && data.tipoFlushing) {
      rows.push({ label: 'Tipo flushing', value: data.tipoFlushing === 'primario' ? 'Primário' : 'Secundário' });
    }
  }

  const notes = typeof data.notes === 'string' ? data.notes : '';
  if (notes) rows.push({ label: 'Observações', value: notes });

  return (
    <article className="admin-card-react">
      <div className="admin-card-title">{index + 1}. {label}</div>
      {rows.length ? (
        <div className="detail-grid" style={{ marginTop: 8 }}>
          {rows.map(row => (
            <div key={row.label}>
              <span className="detail-label">{row.label}</span>
              <span className="detail-value">{row.value}</span>
            </div>
          ))}
        </div>
      ) : null}
    </article>
  );
}

function formatMinutes(value: unknown) {
  const minutes = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(minutes) || minutes <= 0) return '';
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}

function formatDetailValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(formatDetailValue).filter(Boolean).join(', ');
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (Array.isArray(record.names)) return record.names.map(formatDetailValue).filter(Boolean).join(', ');
    if (Array.isArray(record.codes)) return record.codes.map(formatDetailValue).filter(Boolean).join(', ');
    if (typeof record.code === 'string' && typeof record.serialNumber === 'string') return `${record.code} - ${record.serialNumber}`;
    if (typeof record.name === 'string' && typeof record.role === 'string') return `${record.name} - ${record.role}`;
    if (typeof record.name === 'string') return record.name;
    if (typeof record.code === 'string') return record.code;
  }
  return '';
}

function buildDerivedRows(report: ReportSummary) {
  const specialConditions = asRecord(report.specialConditions);
  const serviceData = asRecord(specialConditions.serviceData);
  const rows: { label: string; value: string }[] = [];
  const fieldsByType: Record<string, string[]> = {
    RTP: [
      'Equipamento(s)', 'Sistema', 'Unidade de Teste Hidrostático (UTH)', 'Pressão de trabalho',
      'Pressão de teste', 'Fluido de teste', 'Qual óleo?', 'Manômetros utilizados',
      'Hora de início', 'Hora de término/pausa', 'Aprovado pelo cliente?', 'Desenhos / TAGs', 'Observações'
    ],
    RLQ: [
      'Equipamento(s)', 'Sistema', 'Material da tubulação', 'Método de limpeza',
      'Unidade de Limpeza Química', 'Local de limpeza', 'Tipo de inspeção',
      'Etapas realizadas no dia', 'Hora de início', 'Hora de término/pausa',
      'Aprovado pelo cliente?', 'Desenhos / TAGs', 'Observações'
    ],
    RCPU: [
      'Equipamento(s)', 'Sistema', 'Tipo de óleo', 'Volume de óleo', 'Tipo de flushing',
      'Unidade de Flushing', 'Unidade de filtragem', 'Houve contagem de partículas?',
      'Contagem inicial NAS', 'Contagem final NAS', 'Contagem inicial ISO', 'Contagem final ISO',
      'Houve análise de umidade?', 'Umidade inicial (ppm)', 'Umidade final (ppm)',
      'Hora de início', 'Hora de término/pausa', 'Aprovado pelo cliente?', 'Desenhos / TAGs', 'Observações'
    ],
    RLM: [
      'Equipamento(s)', 'Sistema', 'Material do equipamento', 'Etapas realizadas no dia',
      'Hora de início', 'Hora de término/pausa', 'Aprovado pelo cliente?', 'Observações'
    ],
    RLF: ['Equipamento(s)', 'Sistema', 'Material da tubulação', 'Etapas realizadas no dia', 'Observações'],
    RLI: ['Equipamento(s)', 'Sistema', 'Material da tubulação', 'Etapas realizadas no dia', 'Observações']
  };

  for (const label of fieldsByType[report.reportType] || []) {
    const value = formatDetailValue(serviceData[label]);
    if (value) rows.push({ label, value });
  }

  const resolvedCollaborators = formatDetailValue(specialConditions.resolvedCollaborators);
  const resolvedUnits = formatDetailValue(specialConditions.resolvedUnits);
  const resolvedThermoUnit = formatDetailValue(specialConditions.resolvedThermoUnit);
  const resolvedCounter = formatDetailValue(specialConditions.resolvedCounter);
  const totalTime = formatMinutes(specialConditions.totalMinutes);

  if (resolvedCollaborators) rows.push({ label: 'Equipe do serviço', value: resolvedCollaborators });
  if (resolvedUnits) rows.push({ label: 'Unidades resolvidas', value: resolvedUnits });
  if (resolvedThermoUnit) rows.push({ label: 'Equipamento de desidratação', value: resolvedThermoUnit });
  if (resolvedCounter) rows.push({ label: 'Contador utilizado', value: resolvedCounter });
  if (totalTime) rows.push({ label: 'Tempo acumulado', value: totalTime });

  return rows;
}

function DerivedReportDetails({ report }: { report: ReportSummary }) {
  if (report.reportType === 'RDO') return null;
  const rows = buildDerivedRows(report);
  if (!rows.length) return null;

  return (
    <section className="page-card">
      <div className="section-title">Dados do {report.reportType}</div>
      <div className="detail-grid">
        {rows.map(row => (
          <div key={row.label}>
            <span className="detail-label">{row.label}</span>
            <span className="detail-value">{row.value}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function ReportSummaryView({ report }: { report: ReportSummary }) {
  const specialConditions = asRecord(report.specialConditions);
  const noturnoDetails = asRecord(specialConditions.noturnoDetails);
  const nightCollaboratorIds = Array.isArray(noturnoDetails.collaboratorIds)
    ? noturnoDetails.collaboratorIds.filter((id): id is string => typeof id === 'string')
    : [];

  const daytimeCollaborators = (report.collaborators || [])
    .filter(link => !nightCollaboratorIds.includes(link.collaboratorId))
    .map(link => link.collaborator?.name || link.collaboratorId);

  const nightCollaborators = (report.collaborators || [])
    .filter(link => nightCollaboratorIds.includes(link.collaboratorId))
    .map(link => link.collaborator?.name || link.collaboratorId);

  const generalUploads = asUploadedFiles(specialConditions.generalUploads);
  const isStandby = Boolean(specialConditions.standby);
  const isNoturno = Boolean(noturnoDetails.enabled || nightCollaboratorIds.length);

  return (
    <>
      <section className="page-card">
        <div className="section-title">{TEXT.generalInfo}</div>
        <div className="detail-grid">
          <div><span className="detail-label">{TEXT.project}</span><span className="detail-value">{report.project.name}</span></div>
          <div><span className="detail-label">{TEXT.code}</span><span className="detail-value">{report.project.code}</span></div>
          <div><span className="detail-label">Data</span><span className="detail-value">{formatDateOnlyPtBr(report.reportDate)}</span></div>
          <div><span className="detail-label">{TEXT.time}</span><span className="detail-value">{report.arrivalTime} às {report.departureTime}</span></div>
          <div><span className="detail-label">{TEXT.interval}</span><span className="detail-value">{report.lunchBreak || '-'}</span></div>
          <div><span className="detail-label">Status</span><span className="detail-value">{statusLabels[report.status] || report.status}</span></div>
          {isStandby ? <div><span className="detail-label">Standby</span><span className="detail-value">Sim</span></div> : null}
          {isNoturno ? <div><span className="detail-label">Turno noturno</span><span className="detail-value">Sim</span></div> : null}
        </div>
        <SignatureProgress report={report} />
      </section>

      <section className="page-card">
        <div className="section-title">{TEXT.collaborators}</div>
        {daytimeCollaborators.length ? (
          <ul className="detail-list">
            {daytimeCollaborators.map(name => <li key={name}>{name}</li>)}
          </ul>
        ) : <p className="placeholder-copy">Nenhum colaborador registrado.</p>}
        {nightCollaborators.length ? (
          <>
            <div className="section-subtitle" style={{ marginTop: 12 }}>{TEXT.nightTeam}</div>
            <ul className="detail-list">
              {nightCollaborators.map(name => <li key={name}>{name}</li>)}
            </ul>
          </>
        ) : null}
      </section>

      {(report.services?.length ?? 0) > 0 ? (
        <section className="page-card">
          <div className="section-title">{TEXT.services}</div>
          <div className="admin-stack" style={{ marginTop: 8 }}>
            {(report.services || []).map((service, i) => (
              <ServiceSummaryRow key={service.id} service={service} index={i} />
            ))}
          </div>
        </section>
      ) : null}

      <DerivedReportDetails report={report} />

      <section className="page-card">
        <div className="section-title">{TEXT.reportSummary}</div>
        <div className="detail-grid">
          <div><span className="detail-label">Motivo hora extra</span><span className="detail-value">{report.overtimeReason || '-'}</span></div>
          <div><span className="detail-label">{TEXT.description}</span><span className="detail-value">{report.dailyDescription || '-'}</span></div>
          <div><span className="detail-label">{TEXT.approvedAt}</span><span className="detail-value">{formatDate(report.approvedAt)}</span></div>
          <div><span className="detail-label">{TEXT.returnedAt}</span><span className="detail-value">{formatDate(report.returnedAt)}</span></div>
        </div>
        {report.reviewNotes ? <p className="report-note">{report.reviewNotes}</p> : null}
        {generalUploads.length > 0 ? (
          <div style={{ marginTop: 12 }}>
            <div className="detail-label">Fotos de registro</div>
            <div className="upload-thumbs">
              {generalUploads.map(file => (
                <GeneralUploadThumb key={file.url} file={file} />
              ))}
            </div>
          </div>
        ) : null}
      </section>

      {report.clientReviews?.length ? (
        <section className="page-card">
          <div className="section-title">Retorno do cliente</div>
          <div className="det-section">
            {report.clientReviews.slice(0, 3).map(review => (
              <div className="det-row" key={review.id}>
                <span className="det-label">{review.action === 'APPROVED' ? 'Aprovado' : 'Reprovado'}</span>
                <span className="det-val">{review.comment || 'Sem comentário'}</span>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </>
  );
}

export function ReportDetailPage() {
  const navigate = useNavigate();
  const { id = '' } = useParams();
  const { user, logout } = useAuth();
  const reportQuery = useReport(id, !!id);

  async function handleLogout() {
    await logout();
    navigate('/', { replace: true });
  }

  const report = reportQuery.data;
  const showRdoEditor =
    report?.reportType === 'RDO'
    && report.status !== 'SIGNED'
    && (user?.role === 'MANAGER' || user?.role === 'COLLABORATOR');

  return (
    <Shell>
      <TopBar
        title={TEXT.details}
        subtitle={report ? `${report.reportType}${report.sequenceNumber ? ` ${report.sequenceNumber}` : ''}` : user?.name}
        actions={
          <>
            <button className="topbar-chip" type="button" onClick={() => navigate(-1)}>
              {TEXT.back}
            </button>
            <button className="topbar-chip" type="button" onClick={() => navigate('/conta')}>
              Conta
            </button>
            <button className="topbar-chip" type="button" onClick={handleLogout}>
              Sair
            </button>
          </>
        }
      />

      <main className="page-scroll">
        {reportQuery.isLoading ? <div className="page-card placeholder-copy">{TEXT.loading}</div> : null}
        {reportQuery.isError ? (
          <div className="page-card inline-error">
            {reportQuery.error instanceof Error ? reportQuery.error.message : TEXT.loadError}
          </div>
        ) : null}

        {report ? (
          <>
            {showRdoEditor ? <ManagerRdoEditor report={report} /> : <ReportSummaryView report={report} />}
            {!showRdoEditor ? <ReportDetailActions report={report} role={user?.role} /> : null}
          </>
        ) : null}

        {!reportQuery.isLoading && !reportQuery.isError && !report ? (
          <div className="page-card placeholder-copy">
            {TEXT.missing}
          </div>
        ) : null}
      </main>
    </Shell>
  );
}
