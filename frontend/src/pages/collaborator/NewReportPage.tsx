import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';

import { useAuth } from '../../auth/AuthContext';
import { accountPageStateFromPath } from '../../auth/moduleNavigation';
import { listDdsThemes } from '../../api/ddsThemes';
import { listReports } from '../../api/reports';
import { DraftSaveStatus, type DraftSaveStatusValue } from '../../components/reports/DraftSaveStatus';
import { NewReportSpecialConditions } from '../../components/reports/NewReportSpecialConditions';
import { ReportActivitiesCard, ReportCollaboratorsCard, ReportDateField, ReportFormActions, ReportFormStepper, ReportOvertimeCard, ReportScheduleCard, ReportSummaryCard } from '../../components/reports/ReportCoreFields';
import { RdoDdsNovelty } from '../../components/reports/RdoDdsNovelty';
import { ReportWorkforceNotices } from '../../components/reports/ReportWorkforceNotices';
import { ServiceCollaboratorsBlock, ServiceFields } from '../../components/reports/ServiceFields';
import { serviceTypeLabels } from '../../components/reports/serviceTypes';
import { Modal } from '../../components/ui/Modal';
import { UploadField } from '../../components/ui/UploadField';
import { clearStagedUploadDeletions, flushStagedUploadDeletions } from '../../components/ui/photoDeletionStaging';
import { useToast } from '../../components/ui/ToastContext';
import { useNewReportBootstrap } from '../../hooks/useBootstrap';
import { useDraftMutations, useDrafts } from '../../hooks/useDrafts';
import { useReportMutations } from '../../hooks/useReports';
import { useReportWorkforcePrefill } from '../../hooks/useReportWorkforcePrefill';
import { Shell } from '../../layout/Shell';
import { TopBar } from '../../layout/TopBar';
import { useRdoStore } from '../../store/rdoStore';
import type { UploadedFile } from '../../api/uploads';
import type { ReportSummary } from '../../types/domain';
import { roleHomePath } from '../../auth/rolePath';
import { buildReportServicePayload, normalizeServiceType } from '../../utils/reportServicePayload';
import { sortProjects } from '../../utils/projectSort';
import { autosaveDraftTargetId } from '../../utils/draftAutosave';
import { rdoWorkforceJustificationSchema } from '../../utils/rdoPlanningPrefill';
import { calculateReportOvertimeSummary } from '../../utils/reportOvertime';
import { canAccessReportSelection, normalizeReportSelection, resolveSiteReportSelection } from '../../auth/reportPermissions';
import { OperationalReportFormPage } from './OperationalReportFormPage';

const TEXT = {
  addService: 'Adicionar serviço',
  atLeastOneCollaborator: 'Selecione ao menos um colaborador do turno diurno.',
  back: 'Voltar',
  dailyDescription: 'Descrição geral',
  departure: 'Saída',
  end: 'Fim',
  errorCreate: 'Não foi possível criar o relatório.',
  finalization: 'Finalização',
  header: 'Cabeçalho',
  invalidSession: 'Sessão inválida.',
  newReport: 'Novo relatório',
  nightTeam: 'Equipe noturna',
  noService: 'Nenhum serviço adicionado.',
  photos: 'Fotos de registro',
  projectTimeRequired: 'Preencha projeto, data e horários antes de enviar.',
  projectWithoutLeader: 'Este projeto não possui líder cadastrado. O relatório ficará sem assinatura do líder.',
  duplicateReportDate: 'Já existe um RDO deste projeto para esta data. Escolha outra data para continuar.',
  duplicateReportDateChecking: 'Verificando se já existe RDO para esta data...',
  remove: 'Remover',
  select: 'Selecione',
  service: 'Serviço',
  services: 'Serviços',
  start: 'Início',
  next: 'Próximo →',
  submit: 'Enviar relatório ✓',
  specialConditions: 'Condições especiais',
  identification: 'Identificação',
  schedules: 'Horários',
  serviceOnly: 'Somente serviço',
  serviceOnlyHint: 'Cria apenas relatórios de serviço, liberados diretamente para o cliente.'
};

const serviceTypeModalOptions = [
  { type: 'limpeza', icon: '🧪', name: 'Limpeza química' },
  { type: 'pressao', icon: '🔴', name: 'Teste de pressão' },
  { type: 'filtragem', icon: '🔵', name: 'Filtragem' },
  { type: 'flushing', icon: '💧', name: 'Flushing' },
  { type: 'mecanica', icon: '⚙️', name: 'Limpeza mecânica' },
  { type: 'inibicao', icon: '🛡️', name: 'Inibição' }
] as const;

const rdoSteps = [TEXT.header, TEXT.services, TEXT.finalization];
const serviceOnlySteps = [TEXT.header, TEXT.services];
const serviceOnlySupportedTypes = new Set(['limpeza', 'pressao', 'filtragem', 'flushing', 'mecanica']);
type ReportServiceSummary = NonNullable<ReportSummary['services']>[number];

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && Boolean(item)) : [];
}

function sameStringSet(a: string[], b: string[]) {
  if (a.length !== b.length) return false;
  const bSet = new Set(b);
  return a.every((item) => bSet.has(item));
}

function stringifyServiceKeyValue(value: unknown): string {
  if (Array.isArray(value)) return value.map(stringifyServiceKeyValue).filter(Boolean).join('|');
  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => {
        const text = stringifyServiceKeyValue(item);
        return text ? `${key}:${text}` : '';
      })
      .filter(Boolean)
      .join('|');
  }
  return String(value || '');
}

function serviceKeyPart(value: unknown): string {
  return stringifyServiceKeyValue(value)
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/\s+/g, ' ');
}

function firstServiceKeyPart(extra: Record<string, unknown>, names: string[]): string {
  for (const name of names) {
    const value = extra[name];
    const part = serviceKeyPart(value);
    if (part) return part;
  }
  return '';
}

function serviceDisambiguatorParts(service: ReportServiceSummary) {
  const extra = service.extraData || {};
  const type = normalizeServiceType(service.serviceType || '');
  const material = serviceKeyPart(service.material) || firstServiceKeyPart(extra, ['Material da tubulação', 'Material da tubulacao', 'Material do equipamento']);
  const parts = material ? [`material:${material}`] : [];

  if (type === 'filtragem' || type === 'flushing') {
    const oilType = firstServiceKeyPart(extra, ['Tipo de óleo', 'Tipo de oleo', 'tipoOleo']);
    const oilVolume = firstServiceKeyPart(extra, ['Volume de óleo', 'Volume de oleo', 'volumeOleo']);
    if (oilType) parts.push(`oleo:${oilType}`);
    if (oilVolume) parts.push(`volume:${oilVolume}`);
    if (type === 'flushing') {
      const flushingTubing = firstServiceKeyPart(extra, ['Flushing em tubulação?', 'Flushing em tubulacao?', 'flushingTubulacao']);
      const flushingType = firstServiceKeyPart(extra, ['Tipo de flushing', 'tipoFlushing']);
      if (flushingTubing) parts.push(`tubulacao:${flushingTubing}`);
      if (flushingType) parts.push(`flushing:${flushingType}`);
    }
  }

  if (type === 'pressao') {
    const testedEquipment = firstServiceKeyPart(extra, ['Equipamento testado', 'equipamentoTestado']);
    const testedEquipmentOther = firstServiceKeyPart(extra, ['Outro equipamento testado', 'equipamentoTestadoOutro']);
    const workPressure = firstServiceKeyPart(extra, ['Pressão de trabalho', 'Pressao de trabalho', 'pressaoTrabalho']);
    const testPressure = firstServiceKeyPart(extra, ['Pressão de teste', 'Pressao de teste', 'pressaoTeste']);
    const testFluid = firstServiceKeyPart(extra, ['Fluido de teste', 'fluidoTeste']);
    const testOil = firstServiceKeyPart(extra, ['Qual óleo?', 'Qual oleo?', 'qualOleo']);
    if (testedEquipment) parts.push(`equipamento-testado:${testedEquipment}`);
    if (testedEquipmentOther) parts.push(`equipamento-testado-outro:${testedEquipmentOther}`);
    if (workPressure) parts.push(`ptrabalho:${workPressure}`);
    if (testPressure) parts.push(`pteste:${testPressure}`);
    if (testFluid) parts.push(`fluido:${testFluid}`);
    if (testOil) parts.push(`oleo:${testOil}`);
  }

  if (type === 'limpeza') {
    const tubing = firstServiceKeyPart(extra, ['Limpeza de tubulação?', 'Limpeza de tubulacao?', 'limpezaTubulacao']);
    const method = firstServiceKeyPart(extra, ['Método de limpeza', 'Metodo de limpeza', 'metodos']);
    const location = firstServiceKeyPart(extra, ['Local de limpeza', 'local']);
    const inspection = firstServiceKeyPart(extra, ['Tipo de inspeção', 'Tipo de inspecao', 'tipoInspecao']);
    if (tubing) parts.push(`tubulacao:${tubing}`);
    if (method) parts.push(`metodo:${method}`);
    if (location) parts.push(`local:${location}`);
    if (inspection) parts.push(`inspecao:${inspection}`);
  }

  return parts;
}

function SiteRdoFormPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout } = useAuth();
  const bootstrapQuery = useNewReportBootstrap();
  const reportMutations = useReportMutations();
  const draftsQuery = useDrafts(bootstrapQuery.data?.drafts, bootstrapQuery.isError);
  const draftMutations = useDraftMutations();
  const createDraftAsync = draftMutations.createDraft.mutateAsync;
  const updateDraftAsync = draftMutations.updateDraft.mutateAsync;
  const removeDraftAsync = draftMutations.removeDraft.mutateAsync;
  const draftSaveTimerRef = useRef<number | null>(null);
  const lastAutoSaveSignatureRef = useRef('');
  const isSubmittingRef = useRef(false);

  const {
    draftId,
    serviceOnly,
    projectId,
    reportDate,
    arrivalTime,
    departureTime,
    lunchBreak,
    collaboratorIds,
    nightCollaboratorIds,
    standby,
    noturno,
    standbyDuration,
    standbyMotivo,
    noturnoStart,
    noturnoEnd,
    noturnoInterval,
    ddsDay,
    ddsDayStart,
    ddsDayEnd,
    ddsDayThemes,
    ddsNight,
    ddsNightStart,
    ddsNightEnd,
    ddsNightThemes,
    overtimeReason,
    dailyDescription,
    generalUploads,
    services,
    setDraftId,
    setHeaderField,
    setCollaborators,
    setNightCollaborators,
    addDdsTheme,
    removeDdsTheme,
    setGeneralUploads,
    addService,
    updateService,
    removeService,
    reset
  } = useRdoStore();

  const showToast = useToast();
  const [step, setStep] = useState(0);
  const [showServiceModal, setShowServiceModal] = useState(false);
  const [invalidTarget, setInvalidTarget] = useState<string | null>(null);
  const [ddsNoveltyActive, setDdsNoveltyActive] = useState(true);
  const [workforceJustification, setWorkforceJustification] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [draftSaveStatus, setDraftSaveStatus] = useState<DraftSaveStatusValue>('idle');
  const canCreateServiceOnly = user?.role === 'MANAGER';
  const canCreateReportWithoutLeader = user?.role === 'MANAGER' || user?.role === 'COORDINATOR';
  const effectiveServiceOnly = canCreateServiceOnly && serviceOnly;
  const steps = effectiveServiceOnly ? serviceOnlySteps : rdoSteps;

  const projects = useMemo(() => sortProjects(bootstrapQuery.data?.projects || [], 'asc'), [bootstrapQuery.data?.projects]);
  const collaborators = (bootstrapQuery.data?.collaborators || []).filter((item) => item.isActive);
  const ddsThemesQuery = useQuery({
    queryKey: ['dds-themes'],
    queryFn: () => listDdsThemes(),
    staleTime: 60_000
  });
  const ddsThemes = ddsThemesQuery.data || [];
  const units = bootstrapQuery.data?.units || [];
  const manometers = bootstrapQuery.data?.manometers || [];
  const serviceCollaboratorOptions = useMemo(() => {
    const ids = Array.from(new Set([...collaboratorIds, ...nightCollaboratorIds]));
    return ids
      .map((id) => {
        const collaborator = collaborators.find((item) => item.id === id);
        return collaborator ? { id: collaborator.id, name: collaborator.name } : null;
      })
      .filter((item): item is { id: string; name: string } => Boolean(item));
  }, [collaboratorIds, nightCollaboratorIds, collaborators]);
  const serviceCollaboratorOptionIds = useMemo(() => serviceCollaboratorOptions.map((item) => item.id), [serviceCollaboratorOptions]);
  const previousServiceCollaboratorOptionIdsRef = useRef<string[]>([]);

  const selectedProject = useMemo(() => (bootstrapQuery.data?.projects || []).find((project) => project.id === projectId) || null, [projectId, bootstrapQuery.data?.projects]);
  const selectedProjectHasLeader = Boolean(selectedProject?.operatorId || selectedProject?.operator);
  const showProjectWithoutLeaderWarning = canCreateReportWithoutLeader && Boolean(selectedProject) && !selectedProjectHasLeader;
  const serviceOptions = useMemo(() => {
    const allowed = effectiveServiceOnly ? serviceTypeModalOptions.filter((option) => serviceOnlySupportedTypes.has(option.type)) : serviceTypeModalOptions;
    return allowed.filter((option) => option.type !== 'inibicao' || selectedProject?.inhibitionServiceEnabled === true);
  }, [effectiveServiceOnly, selectedProject?.inhibitionServiceEnabled]);
  const backPath = roleHomePath(user?.role);

  function handleProjectChange(nextProjectId: string) {
    const nextProject = projects.find((project) => project.id === nextProjectId) || null;
    if ((projectId || '') !== nextProjectId) {
      setCollaborators([]);
      setNightCollaborators([]);
      setWorkforceJustification('');
      previousServiceCollaboratorOptionIdsRef.current = [];
      for (const service of services) {
        if (normalizeServiceType(service.type) === 'inibicao') continue;
        if (stringArray(service.data.serviceCollaboratorIds).length) {
          updateService(service.id, { serviceCollaboratorIds: [] });
        }
      }
    }
    setHeaderField('projectId', nextProjectId || null);
    if (canCreateReportWithoutLeader && nextProject && !nextProject.operatorId && !nextProject.operator) {
      showToast(TEXT.projectWithoutLeader, 'info');
    }
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

  // Fetch the summarized project history for service continuity and duplicate checks.
  const lastProjectReportQuery = useQuery({
    queryKey: ['reports', 'last-project', projectId],
    queryFn: () => listReports({ projectId: projectId!, summary: true }),
    enabled: !!projectId,
    staleTime: 30_000
  });

  const projectReports = useMemo(() => {
    const reports = lastProjectReportQuery.data || [];
    const cutoff = reportDate ? new Date(`${reportDate}T23:59:59`) : new Date();
    const cutoffTime = Number.isNaN(cutoff.getTime()) ? Number.POSITIVE_INFINITY : cutoff.getTime();
    return reports.filter((report) => report.reportType === 'RDO' && report.projectId === projectId && !report.deletedAt && new Date(report.reportDate || report.createdAt || 0).getTime() <= cutoffTime).sort((a, b) => new Date(b.reportDate).getTime() - new Date(a.reportDate).getTime());
  }, [lastProjectReportQuery.data, projectId, reportDate]);
  const lastReport = projectReports[0] || null;
  const { planningContext, absenceConflicts, serverHoliday, collaboratorPrefillSource, missionSuggestionCollaboratorIds, canApplyMissionSuggestion, markCollaboratorsTouched, applyMissionSuggestion, dismissMissionSuggestion } = useReportWorkforcePrefill({
    projectId,
    reportDate,
    collaboratorIds,
    effectiveServiceOnly,
    historicalLastReport: lastReport,
    historyLoaded: lastProjectReportQuery.isSuccess,
    setCollaborators
  });
  const collaboratorsPrefilled = Boolean(collaboratorPrefillSource);
  const duplicateReportForDate = useMemo(() => {
    if (effectiveServiceOnly || !projectId || !reportDate) return null;
    const selectedDate = reportDate.slice(0, 10);
    return (lastProjectReportQuery.data || []).find((report) => report.reportType === 'RDO' && report.projectId === projectId && !report.deletedAt && String(report.reportDate || '').slice(0, 10) === selectedDate) || null;
  }, [effectiveServiceOnly, lastProjectReportQuery.data, projectId, reportDate]);
  const isCheckingDuplicateReportDate = !effectiveServiceOnly && !!projectId && !!reportDate && lastProjectReportQuery.isLoading;

  const serviceFinalized = useCallback((service: ReportServiceSummary) => {
    if (typeof service.finalized === 'boolean') return service.finalized;
    const extra = service.extraData || {};
    const stored = extra['Serviço finalizado?'];
    if (typeof stored === 'string') return ['sim', 'true', 'finalizado'].includes(stored.trim().toLowerCase());
    return false;
  }, []);

  const serviceEquipmentName = useCallback((service: ReportServiceSummary) => {
    const extra = service.extraData || {};
    const value = extra['Equipamento(s)'] || extra.Equipamentos || extra.Equipamento || extra['Embarcação'] || extra.Embarcacao || extra['ID da embarcação'] || '';
    if (Array.isArray(value)) return value.filter(Boolean).join(', ');
    if (value && typeof value === 'object') {
      const record = value as Record<string, unknown>;
      if (Array.isArray(record.labels)) return record.labels.filter(Boolean).join(', ');
      return String(record.name || record.nome || record.code || record.codigo || record.id || '');
    }
    return String(value || service.equipmentId || '');
  }, []);

  const serviceStepName = useCallback((service: ReportServiceSummary) => {
    if (normalizeServiceType(service.serviceType || '') !== 'inibicao') return '';
    const extra = service.extraData || {};
    const value = extra.Steps || extra.steps || extra.Step || extra.step || '';
    if (Array.isArray(value)) return value.filter(Boolean).join(', ');
    return String(value || '');
  }, []);

  const serviceSemanticKey = useCallback(
    (report: ReportSummary, service: ReportServiceSummary) => {
      const extra = service.extraData || {};
      const base = [
        report.projectId || '',
        service.serviceType || '',
        serviceEquipmentName(service).trim().toLowerCase(),
        String(service.system || extra.Sistema || '')
          .trim()
          .toLowerCase()
      ];
      const step = serviceStepName(service).trim().toLowerCase();
      return normalizeServiceType(service.serviceType || '') === 'inibicao' ? [...base, step].join('||') : [...base, ...serviceDisambiguatorParts(service)].join('||');
    },
    [serviceEquipmentName, serviceStepName]
  );

  const serviceOngoingKeys = useCallback(
    (report: ReportSummary, service: ReportServiceSummary) => {
      const extra = service.extraData || {};
      const semanticKey = serviceSemanticKey(report, service);
      const explicitKeys = [String(extra.__ongoingKey || '').trim(), String(extra.__serviceLinkKey || '').trim(), String(extra.__sourceServiceId || '').trim()].filter(Boolean);
      const hasSemanticExplicitKey = explicitKeys.some((key) => key.includes('||'));

      return Array.from(new Set([...(hasSemanticExplicitKey ? [semanticKey, ...explicitKeys] : [...explicitKeys, semanticKey])].filter(Boolean)));
    },
    [serviceSemanticKey]
  );

  const serviceOngoingKey = useCallback(
    (report: ReportSummary, service: ReportServiceSummary) => {
      return serviceOngoingKeys(report, service)[0] || service.id;
    },
    [serviceOngoingKeys]
  );

  function markPreviouslyAddedUploads(extra: Record<string, unknown>) {
    const groups = Array.isArray(extra.__uploads__) ? extra.__uploads__ : [];
    if (!groups.length) return extra;

    return {
      ...extra,
      __uploads__: groups.map((group) => {
        if (!group || typeof group !== 'object' || Array.isArray(group)) return group;
        const record = group as { label?: unknown; files?: unknown };
        const files = Array.isArray(record.files) ? record.files.map((file) => (file && typeof file === 'object' && !Array.isArray(file) ? { ...(file as UploadedFile), __previouslyAdded: true } : file)) : record.files;
        return { ...record, files };
      })
    };
  }

  const pendingProjectServices = useMemo(() => {
    const items = new Map<
      string,
      {
        key: string;
        keys: string[];
        report: ReportSummary;
        service: ReportServiceSummary;
      }
    >();
    [...projectReports].reverse().forEach((report) => {
      (report.services || []).forEach((service) => {
        const keys = serviceOngoingKeys(report, service);
        if (serviceFinalized(service)) {
          for (const [itemKey, item] of items.entries()) {
            if (item.keys.some((key) => keys.includes(key))) items.delete(itemKey);
          }
          return;
        }
        for (const [itemKey, item] of items.entries()) {
          if (item.keys.some((key) => keys.includes(key))) items.delete(itemKey);
        }
        const key = serviceOngoingKey(report, service);
        items.set(key, { key, keys, report, service });
      });
    });
    return Array.from(items.values()).sort((a, b) => new Date(b.report.reportDate).getTime() - new Date(a.report.reportDate).getTime());
  }, [projectReports, serviceFinalized, serviceOngoingKey, serviceOngoingKeys]);

  const visiblePendingProjectServices = useMemo(() => {
    const activeKeys = new Set(
      services
        .map((service) => {
          const data = service.data || {};
          return String(data.__ongoingKey || data.__serviceLinkKey || data.__sourceServiceId || '').trim();
        })
        .filter(Boolean)
    );
    return pendingProjectServices.filter((item) => !activeKeys.has(item.key));
  }, [pendingProjectServices, services]);

  useEffect(() => {
    if (!effectiveServiceOnly && !lunchBreak) setHeaderField('lunchBreak', '01:00:00');
  }, [effectiveServiceOnly, lunchBreak, setHeaderField]);

  useEffect(() => {
    if (!projectId || !noturno || nightCollaboratorIds.length > 0) return;
    const noturnoDetails = lastReport?.specialConditions?.noturnoDetails;
    if (!noturnoDetails || typeof noturnoDetails !== 'object' || Array.isArray(noturnoDetails)) return;
    const ids = Array.isArray((noturnoDetails as Record<string, unknown>).collaboratorIds) ? ((noturnoDetails as Record<string, unknown>).collaboratorIds as unknown[]).filter((id): id is string => typeof id === 'string') : [];
    if (ids.length) setNightCollaborators(ids);
  }, [projectId, noturno, nightCollaboratorIds.length, lastReport, setNightCollaborators]);

  useEffect(() => {
    const previousIds = previousServiceCollaboratorOptionIdsRef.current;
    previousServiceCollaboratorOptionIdsRef.current = serviceCollaboratorOptionIds;
    if (!serviceCollaboratorOptionIds.length || sameStringSet(previousIds, serviceCollaboratorOptionIds)) return;

    const available = new Set(serviceCollaboratorOptionIds);
    for (const service of services) {
      if (normalizeServiceType(service.type) === 'inibicao') continue;
      const selected = stringArray(service.data.serviceCollaboratorIds);
      const selectedHadRemovedCollaborator = selected.some((id) => !available.has(id));
      const selectedFollowedPreviousShift = previousIds.length > 0 && sameStringSet(selected, previousIds);
      const nextSelected = !selected.length || selectedFollowedPreviousShift ? serviceCollaboratorOptionIds : selectedHadRemovedCollaborator ? selected.filter((id) => available.has(id)) : selected;
      const fallbackSelected = nextSelected.length ? nextSelected : serviceCollaboratorOptionIds;
      if (!sameStringSet(selected, fallbackSelected)) {
        updateService(service.id, { serviceCollaboratorIds: fallbackSelected });
      }
    }
  }, [serviceCollaboratorOptionIds, services, updateService]);

  function continueService(service: ReportServiceSummary, ongoingKey: string) {
    const extra = markPreviouslyAddedUploads(service.extraData || {});
    const type = normalizeServiceType(service.serviceType);
    const contadorUtilizado = firstIdFromField(extra['Contador utilizado'] || extra.contadorUtilizado);
    const previousDesidratacaoUnit = firstIdFromField(extra.desidratacaoUnit || extra['Equipamento de desidratação'] || extra['Equipamento de desidratacao'] || extra['Equipamento de desidrataÃ§Ã£o']);
    const previousPressureTestedEquipment = type === 'pressao' ? pressureTestedEquipmentValue(extra) : '';
    addService(type, {
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
      equipmentId: service.equipmentId || serviceEquipmentName(service),
      system: service.system || String(extra.Sistema || ''),
      equipamentoTestado: previousPressureTestedEquipment || extra.equipamentoTestado,
      equipamentoTestadoOutro: String(extra.equipamentoTestadoOutro || extra['Outro equipamento testado'] || ''),
      material: previousPressureTestedEquipment && previousPressureTestedEquipment !== 'tubulacao' ? '' : service.material || String(extra['Material da tubulação'] || extra['Material do equipamento'] || ''),
      startTime: '',
      endTime: '',
      notes: '',
      finalized: undefined,
      _prefilled: true
    });
  }

  function handleContinueServices() {
    if (!pendingProjectServices.length) return;
    visiblePendingProjectServices.forEach(({ service, key }) => continueService(service, key));
  }

  const overtimeSummary = useMemo(
    () =>
      calculateReportOvertimeSummary({
        policy: selectedProject,
        reportDate,
        arrivalTime,
        departureTime,
        lunchBreak,
        nightEnabled: noturno,
        nightArrivalTime: noturnoStart,
        nightDepartureTime: noturnoEnd,
        nightBreak: noturnoInterval,
        isHoliday: serverHoliday
      }),
    [arrivalTime, departureTime, lunchBreak, noturno, noturnoEnd, noturnoInterval, noturnoStart, reportDate, selectedProject, serverHoliday]
  );

  function fieldState(target: string) {
    return invalidTarget === target ? 'field-group field-invalid' : 'field-group';
  }

  function serviceInvalidKey(serviceId: string) {
    if (!invalidTarget?.startsWith(`${serviceId}:`)) return null;
    return invalidTarget.slice(serviceId.length + 1);
  }

  function serviceFieldState(serviceId: string, key: string) {
    return invalidTarget === `${serviceId}:${key}` ? 'field-group field-invalid' : 'field-group';
  }

  function failRequired(label: string, target: string, targetStep: number) {
    return failValidation(`Preencha o campo obrigatório: ${label}.`, target, targetStep);
  }

  function failValidation(message: string, target: string, targetStep: number) {
    setStep(targetStep);
    setInvalidTarget(target);
    showToast(message, 'error');
    window.setTimeout(() => {
      const [serviceId] = target.split(':');
      const selectors = target.includes(':') ? [`[data-invalid-target="${target}"]`, `[data-service-id="${serviceId}"] .field-invalid input`, `[data-service-id="${serviceId}"] .field-invalid select`, `[data-service-id="${serviceId}"] .field-invalid textarea`, `[data-service-id="${serviceId}"] .field-invalid`, `[data-service-id="${serviceId}"]`] : [`[data-invalid-target="${target}"]`];
      const element = selectors.map((selector) => document.querySelector(selector)).find(Boolean) as HTMLElement | null;
      element?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      if (element && typeof element.focus === 'function') element.focus({ preventScroll: true });
    }, 120);
    return false;
  }

  function hasText(value: unknown) {
    return typeof value === 'string' && value.trim().length > 0;
  }

  function hasStringItem(value: unknown) {
    return Array.isArray(value) && value.some((item) => typeof item === 'string' && item.trim());
  }

  function hasTextOrStringItem(value: unknown) {
    return hasText(value) || hasStringItem(value);
  }

  function hasValidTubes(value: unknown) {
    return (
      Array.isArray(value) &&
      value.length > 0 &&
      value.every((item) => {
        if (!item || typeof item !== 'object') return false;
        const row = item as Record<string, unknown>;
        return hasText(row.d) && hasText(row.c);
      })
    );
  }

  function isNoValue(value: unknown) {
    if (Array.isArray(value)) value = value[0];
    return (
      String(value || '')
        .trim()
        .toLowerCase()
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '') === 'nao'
    );
  }

  function serviceRequiresTubes(type: string, data: Record<string, unknown>) {
    if (type === 'limpeza') {
      const raw = data.limpezaTubulacao || data['Limpeza de tubulação?'] || data['Limpeza de tubulacao?'];
      return !isNoValue(raw);
    }
    if (type === 'flushing') {
      const raw = data.flushingTubulacao || data['Flushing em tubulação?'] || data['Flushing em tubulacao?'];
      return !isNoValue(raw);
    }
    if (type === 'pressao') return pressureTestedEquipmentValue(data) !== 'outro';
    return false;
  }

  function pressureTestedEquipmentValue(data: Record<string, unknown>) {
    const raw = String(data.equipamentoTestado || data['Equipamento testado'] || '').trim();
    if (raw === 'mangueira' || raw === 'Mangueiras') return 'mangueira';
    if (raw === 'outro' || raw === 'Outro') return 'outro';
    return 'tubulacao';
  }

  function pressureTubeItemLabel(data: Record<string, unknown>) {
    const value = pressureTestedEquipmentValue(data);
    if (value === 'mangueira') return 'mangueira';
    if (value === 'outro') return 'item testado';
    return 'tubulação';
  }

  function validateHeader() {
    if (!projectId) return failRequired('Projeto', 'header:projectId', 0);
    if (!reportDate) return failRequired('Data do relatório', 'header:reportDate', 0);
    if (isCheckingDuplicateReportDate) return failValidation(TEXT.duplicateReportDateChecking, 'header:reportDate', 0);
    if (duplicateReportForDate) return failValidation(TEXT.duplicateReportDate, 'header:reportDate', 0);
    if (effectiveServiceOnly) {
      if (!collaboratorIds.length) return failRequired('Colaboradores', 'header:collaborators', 0);
      return true;
    }
    if (!arrivalTime) return failRequired('Chegada', 'header:arrivalTime', 0);
    if (!departureTime) return failRequired('Saída', 'header:departureTime', 0);
    if (!lunchBreak) return failRequired('Intervalo de almoço', 'header:lunchBreak', 0);
    if (!collaboratorIds.length) return failRequired('Colaboradores', 'header:collaborators', 0);
    if (
      !rdoWorkforceJustificationSchema.safeParse({
        requiresJustification: absenceConflicts.length > 0,
        workforceJustification
      }).success
    ) {
      return failRequired('Justificativa de trabalho durante afastamento', 'header:workforceJustification', 0);
    }
    if (standby && !standbyDuration) return failRequired('Tempo total (standby)', 'header:standbyDuration', 0);
    if (standby && !standbyMotivo.trim()) return failRequired('Motivo (standby)', 'header:standbyMotivo', 0);
    if (noturno && !noturnoStart) return failRequired('Início (noturno)', 'header:noturnoStart', 0);
    if (noturno && !noturnoEnd) return failRequired('Término (noturno)', 'header:noturnoEnd', 0);
    if (noturno && !noturnoInterval) return failRequired('Intervalo noturno', 'header:noturnoInterval', 0);
    if (noturno && !nightCollaboratorIds.length) return failRequired('Colaboradores noturnos', 'header:nightCollaborators', 0);
    if (ddsDay && !ddsDayStart) return failRequired('Início (DDS)', 'header:ddsDayStart', 0);
    if (ddsDay && !ddsDayEnd) return failRequired('Término (DDS)', 'header:ddsDayEnd', 0);
    if (ddsDay && !ddsDayThemes.length) return failRequired('Temas do DDS', 'header:ddsDayThemes', 0);
    if (noturno && ddsNight && !ddsNightStart) return failRequired('Início (DDS noturno)', 'header:ddsNightStart', 0);
    if (noturno && ddsNight && !ddsNightEnd) return failRequired('Término (DDS noturno)', 'header:ddsNightEnd', 0);
    if (noturno && ddsNight && !ddsNightThemes.length) return failRequired('Temas do DDS noturno', 'header:ddsNightThemes', 0);
    return true;
  }

  function validateServices() {
    if (!services.length) {
      if (effectiveServiceOnly) return failRequired('Serviço', 'services:empty', 1);
      return true;
    }

    for (const service of services) {
      const data = service.data || {};
      const type = normalizeServiceType(service.type);
      const target = (key: string) => `${service.id}:${key}`;

      if (effectiveServiceOnly && !serviceOnlySupportedTypes.has(type)) {
        return failRequired('Tipo de serviço com relatório independente disponível', target('serviceType'), 1);
      }
      if (!hasText(data.equipmentId)) return failRequired(type === 'inibicao' ? 'Embarcação' : 'Equipamento(s)', target('equipmentId'), 1);
      if (!hasText(data.system)) return failRequired('Sistema', target('system'), 1);
      if (!hasText(data.startTime)) return failRequired('Hora de início', target('startTime'), 1);
      if (!hasText(data.endTime)) return failRequired('Hora de término/pausa', target('endTime'), 1);
      if (type !== 'inibicao' && !hasStringItem(data.serviceCollaboratorIds)) return failRequired('Colaboradores do serviço', target('serviceCollaboratorIds'), 1);
      if (!effectiveServiceOnly && typeof data.finalized !== 'boolean') return failRequired('Serviço finalizado', target('finalized'), 1);
      if (!hasStringItem(data.etapas)) return failRequired('Etapas realizadas no dia', target('etapas'), 1);
      if (type === 'inibicao' && !hasText(data.steps)) return failRequired('Steps', target('steps'), 1);
      if (type === 'inibicao' && !hasStringItem(data.tipoRelatorio)) return failRequired('Tipo de relatório', target('tipoRelatorio'), 1);

      const pressureTestedEquipment = type === 'pressao' ? pressureTestedEquipmentValue(data) : '';
      if (type === 'pressao' && pressureTestedEquipment === 'outro' && !hasText(data.equipamentoTestadoOutro)) {
        return failRequired('Outro equipamento testado', target('equipamentoTestadoOutro'), 1);
      }
      const requiresMaterial = ['limpeza', 'mecanica', 'inibicao'].includes(type) || (type === 'pressao' && pressureTestedEquipment === 'tubulacao');
      if (requiresMaterial && !hasText(data.material)) {
        return failRequired(type === 'mecanica' ? 'Material do equipamento' : 'Material da tubulação', target('material'), 1);
      }
      if (serviceRequiresTubes(type, data) && !hasValidTubes(data.tubes)) {
        return failRequired(`Diâmetro e comprimento de cada ${type === 'pressao' ? pressureTubeItemLabel(data) : 'tubulação'}`, target('tubes'), 1);
      }

      if (type === 'limpeza') {
        if (!hasStringItem(data.metodos)) return failRequired('Método de limpeza', target('metodos'), 1);
        if (!hasTextOrStringItem(data.ulq)) return failRequired('Unidade de Limpeza Química', target('ulq'), 1);
        if (!hasStringItem(data.local)) return failRequired('Local de limpeza', target('local'), 1);
        if (!hasStringItem(data.tipoInspecao)) return failRequired('Tipo de inspeção', target('tipoInspecao'), 1);
      }

      if (type === 'pressao') {
        if (!hasTextOrStringItem(data.uth)) return failRequired('Unidade de Teste Hidrostático (UTH)', target('uth'), 1);
        if (!hasText(data.pressaoTrabalho)) return failRequired('Pressão de trabalho', target('pressaoTrabalho'), 1);
        if (!hasText(data.pressaoTeste)) return failRequired('Pressão de teste', target('pressaoTeste'), 1);
        if (!hasStringItem(data.manometroIds)) return failRequired('Manômetros utilizados', target('manometroIds'), 1);
      }

      if (type === 'flushing') {
        if (!hasText(data.tipoOleo)) return failRequired('Tipo de óleo', target('tipoOleo'), 1);
        if (!hasText(data.volumeOleo)) return failRequired('Volume de óleo', target('volumeOleo'), 1);
        if (!hasTextOrStringItem(data.uf)) return failRequired('Unidade de Flushing', target('uf'), 1);
      }

      if (type === 'filtragem') {
        if (!hasText(data.tipoOleo)) return failRequired('Tipo de óleo', target('tipoOleo'), 1);
        if (!hasText(data.volumeOleo)) return failRequired('Volume de óleo', target('volumeOleo'), 1);
        if (!hasTextOrStringItem(data.ufg)) return failRequired('Unidade de filtragem', target('ufg'), 1);
      }

      if ((type === 'flushing' || type === 'filtragem') && data.houveParticulas === 'Sim' && !hasText(data.contadorUtilizado)) {
        return failRequired('Contador utilizado', target('contadorUtilizado'), 1);
      }
      if ((type === 'flushing' || type === 'filtragem') && data.houveDesidratacao === 'Sim' && !hasText(data.desidratacaoUnit)) {
        return failRequired('Equipamento de desidratação', target('desidratacaoUnit'), 1);
      }
    }

    return true;
  }

  function handleNextStep() {
    if (step === 0) {
      if (!validateHeader()) return;
    }

    if (step === 1) {
      if (!validateServices()) return;
    }

    setInvalidTarget(null);
    setStep((current) => Math.min(current + 1, steps.length - 1));
  }

  function buildResumoText() {
    const parts: string[] = [];
    if (selectedProject) parts.push(`${selectedProject.code} — ${selectedProject.name}`);
    if (reportDate) {
      const d = new Date(`${reportDate}T00:00:00`);
      const label = d.toLocaleDateString('pt-BR', {
        weekday: 'long',
        day: 'numeric',
        month: 'long'
      });
      parts.push(label.charAt(0).toUpperCase() + label.slice(1));
    }
    if (arrivalTime && departureTime) parts.push(`${arrivalTime} às ${departureTime}`);
    if (collaboratorIds.length) {
      parts.push(`${collaboratorIds.length} colaborador${collaboratorIds.length !== 1 ? 'es' : ''}`);
    }
    if (services.length) {
      const types = services.map((s) => serviceTypeLabels[normalizeServiceType(s.type)] || s.type);
      parts.push(types.join(', '));
    }
    return parts.join(' · ') || '—';
  }

  const buildDraftPayload = useCallback(() => {
    return {
      projectId,
      serviceOnly: effectiveServiceOnly,
      reportDate,
      arrivalTime,
      departureTime,
      lunchBreak,
      collaboratorIds,
      nightCollaboratorIds,
      standby,
      noturno,
      standbyDuration,
      standbyMotivo,
      noturnoStart,
      noturnoEnd,
      noturnoInterval,
      ddsDay,
      ddsDayStart,
      ddsDayEnd,
      ddsDayThemes,
      ddsNight,
      ddsNightStart,
      ddsNightEnd,
      ddsNightThemes,
      overtimeReason,
      dailyDescription,
      generalUploads,
      services
    };
  }, [projectId, effectiveServiceOnly, reportDate, arrivalTime, departureTime, lunchBreak, collaboratorIds, nightCollaboratorIds, standby, noturno, standbyDuration, standbyMotivo, noturnoStart, noturnoEnd, noturnoInterval, ddsDay, ddsDayStart, ddsDayEnd, ddsDayThemes, ddsNight, ddsNightStart, ddsNightEnd, ddsNightThemes, overtimeReason, dailyDescription, generalUploads, services]);

  const draftProjectDateKey = useCallback((draft: { projectId?: string | null; reportDate?: string | null; payload?: Record<string, unknown> }) => {
    const payload = draft.payload || {};
    const draftProjectId = draft.projectId || (typeof payload.projectId === 'string' ? payload.projectId : '');
    const draftReportDate = draft.reportDate || (typeof payload.reportDate === 'string' ? payload.reportDate : '');
    const draftServiceOnly = payload.serviceOnly === true;
    return draftProjectId && draftReportDate ? `${draftProjectId}|${draftReportDate.slice(0, 10)}|${draftServiceOnly ? 'service' : 'rdo'}` : '';
  }, []);

  const matchingDraftIds = useCallback(() => {
    const key = projectId && reportDate ? `${projectId}|${reportDate.slice(0, 10)}|${effectiveServiceOnly ? 'service' : 'rdo'}` : '';
    if (!key) return [];
    return (draftsQuery.data || []).filter((draft) => draftProjectDateKey(draft) === key).map((draft) => draft.id);
  }, [draftProjectDateKey, draftsQuery.data, effectiveServiceOnly, projectId, reportDate]);

  const saveDraftNow = useCallback(
    async ({ notifyOnError = false } = {}) => {
      if (!projectId || !reportDate) {
        return true;
      }

      const payload = {
        projectId,
        reportDate,
        title: selectedProject ? `${selectedProject.code} - ${selectedProject.name}` : 'Relatório em andamento',
        payload: buildDraftPayload()
      };
      const sameProjectDateIds = matchingDraftIds();
      const targetId = autosaveDraftTargetId(draftId, sameProjectDateIds);
      const signature = JSON.stringify({ targetId: targetId || '', payload });
      if (signature === lastAutoSaveSignatureRef.current) {
        setDraftSaveStatus('saved');
        return true;
      }
      lastAutoSaveSignatureRef.current = signature;
      setDraftSaveStatus('saving');

      try {
        const saved = targetId ? await updateDraftAsync({ id: targetId, payload }) : await createDraftAsync(payload);
        if (draftId !== saved.id) setDraftId(saved.id);

        await Promise.all(sameProjectDateIds.filter((id) => id !== saved.id).map((id) => removeDraftAsync(id).catch(() => undefined)));
        setDraftSaveStatus('saved');
        return true;
      } catch (error) {
        lastAutoSaveSignatureRef.current = '';
        setDraftSaveStatus('error');
        console.error('Falha ao salvar rascunho de relatório.', error);
        if (notifyOnError) {
          showToast(error instanceof Error ? error.message : 'Não foi possível salvar o rascunho.', 'error');
        }
        return false;
      }
    },
    [projectId, reportDate, draftId, selectedProject, buildDraftPayload, matchingDraftIds, updateDraftAsync, createDraftAsync, setDraftId, removeDraftAsync, showToast]
  );

  useEffect(() => {
    if (isSubmittingRef.current) return;
    if (draftSaveTimerRef.current) window.clearTimeout(draftSaveTimerRef.current);

    if (!projectId || !reportDate) {
      setDraftSaveStatus('idle');
      return;
    }

    setDraftSaveStatus('saving');

    draftSaveTimerRef.current = window.setTimeout(() => {
      void saveDraftNow();
    }, 150);

    return () => {
      if (draftSaveTimerRef.current) window.clearTimeout(draftSaveTimerRef.current);
    };
  }, [projectId, reportDate, saveDraftNow]);

  const handleBack = useCallback(async () => {
    if (draftSaveTimerRef.current) {
      window.clearTimeout(draftSaveTimerRef.current);
      draftSaveTimerRef.current = null;
    }
    const saved = await saveDraftNow({ notifyOnError: true });
    if (saved) navigate(backPath);
  }, [backPath, navigate, saveDraftNow]);

  const handleLogout = useCallback(async () => {
    await logout();
    navigate('/login', { replace: true });
  }, [logout, navigate]);

  useEffect(() => {
    // Descarta exclusões de fotos encenadas e não salvas ao abrir o formulário.
    clearStagedUploadDeletions();
  }, []);

  async function handleSubmit() {
    if (isSubmitting || isSubmittingRef.current) return;
    if (!user?.id) {
      showToast(TEXT.invalidSession, 'error');
      return;
    }
    if (!validateHeader()) return;
    if (!validateServices()) return;

    isSubmittingRef.current = true;
    setIsSubmitting(true);
    if (draftSaveTimerRef.current) {
      window.clearTimeout(draftSaveTimerRef.current);
      draftSaveTimerRef.current = null;
    }

    try {
      const draftIdsToRemove = matchingDraftIds();
      if (draftId && !draftIdsToRemove.includes(draftId)) draftIdsToRemove.push(draftId);
      const servicePayloads = services.map((service) =>
        buildReportServicePayload(
          effectiveServiceOnly
            ? {
                ...service,
                data: {
                  ...service.data,
                  finalized: true,
                  aprovadoCliente: 'Sim'
                }
              }
            : service,
          {
            collaboratorIds: Array.isArray(service.data.serviceCollaboratorIds) ? service.data.serviceCollaboratorIds.filter((id): id is string => typeof id === 'string') : [],
            collaborators,
            units
          }
        )
      );

      if (effectiveServiceOnly) {
        await reportMutations.createServiceOnlyReports.mutateAsync({
          projectId: projectId!,
          createdByUserId: user.id,
          reportDate,
          collaboratorIds,
          services: servicePayloads
        });
      } else {
        await reportMutations.createReport.mutateAsync({
          projectId: projectId!,
          createdByUserId: user.id,
          reportType: 'RDO',
          status: user.role === 'MANAGER' ? 'APPROVED' : 'PENDING',
          reportDate,
          arrivalTime,
          departureTime,
          lunchBreak,
          daytimeCount: collaboratorIds.length,
          overtimeReason: overtimeSummary.totalOvertimeMinutes > 0 ? overtimeReason || null : null,
          dailyDescription: dailyDescription || null,
          specialConditions: {
            standby,
            standbyDetails: {
              total: standbyDuration,
              motivo: standbyMotivo
            },
            generalUploads,
            noturnoDetails: {
              enabled: noturno,
              inicio: noturnoStart,
              termino: noturnoEnd,
              intervalo: noturnoInterval,
              collaboratorIds: nightCollaboratorIds
            },
            dds: {
              diurno: {
                enabled: ddsDay,
                inicio: ddsDayStart,
                termino: ddsDayEnd,
                temas: ddsDayThemes
              },
              noturno: {
                enabled: noturno && ddsNight,
                inicio: ddsNightStart,
                termino: ddsNightEnd,
                temas: ddsNightThemes
              }
            },
            overtimeSummary,
            workforceJustification: workforceJustification.trim() || null,
            efetivoPlanningContext: planningContext
              ? {
                  missionId: planningContext.missionId,
                  missionVersion: planningContext.missionVersion,
                  planRevision: planningContext.planRevision,
                  calendarRevision: planningContext.calendarRevision
                }
              : null
          },
          collaboratorIds,
          services: servicePayloads
        });
      }

      // Relatório criado: efetiva a exclusão global das fotos removidas no editor.
      await flushStagedUploadDeletions();
      await Promise.all(draftIdsToRemove.map((id) => removeDraftAsync(id).catch(() => undefined)));
      setDraftId(null);
      lastAutoSaveSignatureRef.current = '';

      reset();
      navigate(roleHomePath(user.role));
    } catch (err) {
      isSubmittingRef.current = false;
      setIsSubmitting(false);
      showToast(err instanceof Error ? err.message : TEXT.errorCreate, 'error');
    }
  }

  return (
    <Shell>
      <TopBar
        title={TEXT.newReport}
        subtitle={steps[step]}
        step={`${step + 1} / ${steps.length}`}
        actions={
          <>
            <button className="topbar-chip" type="button" onClick={handleBack}>
              {TEXT.back}
            </button>
            <button
              className="topbar-chip"
              type="button"
              onClick={() =>
                navigate('/conta', {
                  state: accountPageStateFromPath(location)
                })
              }
            >
              Conta
            </button>
            <button className="topbar-chip" type="button" onClick={handleLogout}>
              Sair
            </button>
          </>
        }
      />
      <main className="page-scroll">
        <ReportFormStepper
          steps={steps}
          currentStep={step}
          onSelect={(index) => {
            if (index <= step) {
              setStep(index);
              return;
            }
            if (index === step + 1) handleNextStep();
          }}
        >
          <DraftSaveStatus status={draftSaveStatus} visible={Boolean(projectId && reportDate)} />
        </ReportFormStepper>

        {step === 0 ? (
          <>
            {/* Card 1: Identificação */}
            <section className="page-card">
              <div className="section-title">{TEXT.identification}</div>
              {canCreateServiceOnly ? (
                <div className="tog-row" style={{ marginBottom: 12 }}>
                  <span className="tog-lbl">
                    {TEXT.serviceOnly}
                    <span className="placeholder-copy" style={{ display: 'block', marginTop: 2 }}>
                      {TEXT.serviceOnlyHint}
                    </span>
                  </span>
                  <label className="tog">
                    <input
                      type="checkbox"
                      checked={effectiveServiceOnly}
                      onChange={(event) => {
                        setHeaderField('serviceOnly', event.target.checked);
                        setStep(0);
                      }}
                    />
                    <span className="tog-sl" />
                  </label>
                </div>
              ) : null}
              <div className="admin-form-grid">
                <div className={fieldState('header:projectId')} data-invalid-target="header:projectId">
                  <label htmlFor="rdo-project">
                    Projeto <span style={{ color: 'var(--rd)' }}>*</span>
                  </label>
                  <select id="rdo-project" value={projectId || ''} onChange={(event) => handleProjectChange(event.target.value)} required>
                    <option value="">Selecionar projeto...</option>
                    {projects.map((project) => (
                      <option key={project.id} value={project.id}>
                        {project.code} - {project.name}
                      </option>
                    ))}
                  </select>
                  {showProjectWithoutLeaderWarning ? (
                    <div className="form-hint" role="status">
                      {TEXT.projectWithoutLeader}
                    </div>
                  ) : null}
                </div>
                <ReportDateField id="rdo-date" value={reportDate} onChange={(value) => setHeaderField('reportDate', value)} invalid={invalidTarget === 'header:reportDate'} invalidTarget="header:reportDate">
                  {isCheckingDuplicateReportDate ? (
                    <div className="form-hint" role="status">
                      {TEXT.duplicateReportDateChecking}
                    </div>
                  ) : duplicateReportForDate ? (
                    <div className="form-hint" role="alert">
                      {TEXT.duplicateReportDate}
                    </div>
                  ) : null}
                </ReportDateField>
              </div>
            </section>

            {!effectiveServiceOnly ? (
              <>
                <ReportScheduleCard
                  idPrefix="rdo"
                  arrivalTime={arrivalTime}
                  departureTime={departureTime}
                  lunchBreak={lunchBreak}
                  onArrivalTimeChange={(value) => setHeaderField('arrivalTime', value)}
                  onDepartureTimeChange={(value) => setHeaderField('departureTime', value)}
                  onLunchBreakChange={(value) => setHeaderField('lunchBreak', value)}
                  arrivalError={invalidTarget === 'header:arrivalTime' ? 'Informe o horário.' : undefined}
                  departureError={invalidTarget === 'header:departureTime' ? 'Informe o horário.' : undefined}
                  lunchBreakError={invalidTarget === 'header:lunchBreak' ? 'Informe o intervalo.' : undefined}
                  arrivalInvalidTarget="header:arrivalTime"
                  departureInvalidTarget="header:departureTime"
                  lunchBreakInvalidTarget="header:lunchBreak"
                />
              </>
            ) : null}

            {/* Card 3: Equipe diurna */}
            <ReportCollaboratorsCard
              collaborators={collaborators}
              selectedIds={collaboratorIds}
              onChange={(ids) => {
                markCollaboratorsTouched();
                setCollaborators(ids);
              }}
              invalid={invalidTarget === 'header:collaborators'}
              error={invalidTarget === 'header:collaborators' ? TEXT.atLeastOneCollaborator : undefined}
              invalidTarget="header:collaborators"
              showTitle={false}
            >
              <ReportWorkforceNotices
                planningContext={planningContext}
                prefilledFromLastReport={collaboratorsPrefilled}
                missionSuggestionCollaboratorIds={missionSuggestionCollaboratorIds}
                canApplyMissionSuggestion={canApplyMissionSuggestion}
                absenceConflictCount={absenceConflicts.length}
                workforceJustification={workforceJustification}
                invalid={invalidTarget === 'header:workforceJustification'}
                onApplyMissionSuggestion={applyMissionSuggestion}
                onDismissMissionSuggestion={dismissMissionSuggestion}
                onJustificationChange={setWorkforceJustification}
              />
            </ReportCollaboratorsCard>

            {!effectiveServiceOnly ? (
              <>
                {/* Card 4: Condições especiais */}
                <NewReportSpecialConditions
                  collaborators={collaborators}
                  ddsThemes={ddsThemes}
                  invalidTarget={invalidTarget}
                  standby={standby}
                  standbyDuration={standbyDuration}
                  standbyMotivo={standbyMotivo}
                  noturno={noturno}
                  noturnoStart={noturnoStart}
                  noturnoEnd={noturnoEnd}
                  noturnoInterval={noturnoInterval}
                  nightCollaboratorIds={nightCollaboratorIds}
                  ddsDay={ddsDay}
                  ddsDayStart={ddsDayStart}
                  ddsDayEnd={ddsDayEnd}
                  ddsDayThemes={ddsDayThemes}
                  ddsNight={ddsNight}
                  ddsNightStart={ddsNightStart}
                  ddsNightEnd={ddsNightEnd}
                  ddsNightThemes={ddsNightThemes}
                  setHeaderField={setHeaderField}
                  setNightCollaborators={setNightCollaborators}
                  addDdsTheme={addDdsTheme}
                  removeDdsTheme={removeDdsTheme}
                  fieldState={fieldState}
                />
              </>
            ) : null}
          </>
        ) : null}

        {step === 1 ? (
          <>
            {projectId && !effectiveServiceOnly && visiblePendingProjectServices.length > 0 ? (
              <section className="page-card continuity-card">
                <div className="section-title">Serviços em andamento</div>
                <p className="placeholder-copy">Selecione individualmente quais serviços deseja continuar neste RDO.</p>
                <div className="admin-list" style={{ marginTop: 10 }}>
                  {visiblePendingProjectServices.map(({ key, report, service }) => {
                    const type = normalizeServiceType(service.serviceType);
                    const equipment = serviceEquipmentName(service) || 'Equipamento não informado';
                    const system = service.system || String((service.extraData || {}).Sistema || '');
                    return (
                      <article className="ongoing-item-react" key={`${report.id}-${service.id}`}>
                        <div className="admin-item-row">
                          <div className="admin-item-main">
                            <div className="admin-item-title">{serviceTypeLabels[type] || type}</div>
                            <div className="admin-item-sub">
                              {equipment}
                              {system ? ` · ${system}` : ''} · RDO {report.sequenceNumber || '---'}
                            </div>
                          </div>
                          <button className="ongoing-badge-react" type="button" onClick={() => continueService(service, key)}>
                            Continuar
                          </button>
                        </div>
                      </article>
                    );
                  })}
                </div>
                {visiblePendingProjectServices.length > 1 ? (
                  <div className="admin-form-actions" style={{ marginTop: 10 }}>
                    <button className="secondary-button" type="button" onClick={handleContinueServices}>
                      Continuar todos
                    </button>
                  </div>
                ) : null}
              </section>
            ) : null}
            <section className="page-card report-services-step" data-invalid-target="services:empty">
              <div className="section-title">{TEXT.services}</div>
              {services.length ? (
                <div className="admin-stack" style={{ marginTop: 12 }}>
                  {services.map((service, index) => (
                    <article className="admin-card-react" key={service.id} data-service-id={service.id}>
                      <div className="svc-card-header">
                        <div className="svc-card-title">
                          <span>{serviceTypeLabels[normalizeServiceType(service.type)] || service.type}</span>
                          <span className="svc-card-badge">
                            {TEXT.service} {index + 1}
                          </span>
                        </div>
                        <div className="admin-card-actions">
                          <button className="svc-remove" type="button" onClick={() => removeService(service.id)}>
                            {TEXT.remove}
                          </button>
                        </div>
                      </div>
                      <div className="admin-form-grid">
                        {normalizeServiceType(service.type) !== 'inibicao' ? (
                          <div className={serviceFieldState(service.id, 'equipmentId')}>
                            <label>
                              Equipamento(s) <span style={{ color: 'var(--rd)' }}>*</span>
                              {service.data._prefilled && service.data.equipmentId ? <span className="pre-badge">pré-preenchido</span> : null}
                            </label>
                            <input
                              className={service.data._prefilled && service.data.equipmentId ? 'pre' : ''}
                              value={typeof service.data.equipmentId === 'string' ? service.data.equipmentId : ''}
                              placeholder="Informar equipamento do cliente..."
                              onChange={(event) =>
                                updateService(service.id, {
                                  equipmentId: event.target.value
                                })
                              }
                            />
                          </div>
                        ) : null}
                        {normalizeServiceType(service.type) !== 'inibicao' ? (
                          <div className={serviceFieldState(service.id, 'system')}>
                            <label>
                              Sistema <span style={{ color: 'var(--rd)' }}>*</span>
                              {service.data._prefilled && service.data.system ? <span className="pre-badge">pré-preenchido</span> : null}
                            </label>
                            <input
                              className={service.data._prefilled && service.data.system ? 'pre' : ''}
                              value={typeof service.data.system === 'string' ? service.data.system : ''}
                              onChange={(event) =>
                                updateService(service.id, {
                                  system: event.target.value
                                })
                              }
                            />
                          </div>
                        ) : null}
                        {normalizeServiceType(service.type) !== 'inibicao' ? <ServiceCollaboratorsBlock data={service.data} onChange={(update) => updateService(service.id, update)} invalidKey={invalidTarget === `${service.id}:serviceCollaboratorIds` ? 'serviceCollaboratorIds' : null} collaboratorOptions={serviceCollaboratorOptions} /> : null}
                        {normalizeServiceType(service.type) !== 'inibicao' ? (
                          <div className="fg-r2 service-time-grid">
                            <div className={serviceFieldState(service.id, 'startTime')}>
                              <label>
                                Hora de início <span style={{ color: 'var(--rd)' }}>*</span>
                              </label>
                              <input
                                type="time"
                                required
                                value={typeof service.data.startTime === 'string' ? service.data.startTime : ''}
                                onChange={(event) =>
                                  updateService(service.id, {
                                    startTime: event.target.value
                                  })
                                }
                              />
                            </div>
                            <div className={serviceFieldState(service.id, 'endTime')}>
                              <label>
                                Hora de término/pausa <span style={{ color: 'var(--rd)' }}>*</span>
                              </label>
                              <input
                                type="time"
                                required
                                value={typeof service.data.endTime === 'string' ? service.data.endTime : ''}
                                onChange={(event) =>
                                  updateService(service.id, {
                                    endTime: event.target.value
                                  })
                                }
                              />
                            </div>
                          </div>
                        ) : null}
                        <ServiceFields
                          serviceType={service.type}
                          data={service.data}
                          onChange={(update) => updateService(service.id, update)}
                          units={units}
                          manometers={manometers}
                          counters={bootstrapQuery.data?.counters || []}
                          equipments={bootstrapQuery.data?.equipments || []}
                          rdoSlotMap={bootstrapQuery.data?.rdoSlotMap}
                          inhibitionOptions={bootstrapQuery.data?.inhibitionOptions}
                          collaboratorOptions={serviceCollaboratorOptions}
                          groupKey={service.id}
                          projectId={projectId}
                          invalidKey={serviceInvalidKey(service.id)}
                          hideFinalization={effectiveServiceOnly}
                        />
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <p className="placeholder-copy">{TEXT.noService}</p>
              )}
              <div className="admin-form-actions" style={{ marginTop: 12 }}>
                <button
                  className="secondary-button"
                  type="button"
                  style={{
                    width: '100%',
                    borderStyle: 'dashed',
                    color: 'var(--g)',
                    fontWeight: 700
                  }}
                  onClick={() => setShowServiceModal(true)}
                >
                  ＋ {TEXT.addService}
                </button>
              </div>
            </section>
          </>
        ) : null}

        {step === 2 ? (
          <>
            <ReportOvertimeCard summary={overtimeSummary} nightEnabled={noturno} reason={overtimeReason} onReasonChange={(value) => setHeaderField('overtimeReason', value)} />

            {/* Card Atividades do dia */}
            <ReportActivitiesCard value={dailyDescription} onChange={(value) => setHeaderField('dailyDescription', value)} />

            {/* Card Fotos */}
            <section className="page-card">
              <div className="section-title">{TEXT.photos}</div>
              <UploadField label="" value={generalUploads as UploadedFile[]} projectId={projectId} onChange={setGeneralUploads} />
            </section>

            {/* Card Resumo */}
            <ReportSummaryCard>{buildResumoText()}</ReportSummaryCard>
          </>
        ) : null}

        <ReportFormActions currentStep={step} totalSteps={steps.length} onBack={step === 0 ? handleBack : () => setStep((current) => Math.max(current - 1, 0))} onNext={handleNextStep} onSubmit={handleSubmit} submitting={isSubmitting} submitLabel={TEXT.submit} />
      </main>

      <Modal open={showServiceModal} onClose={() => setShowServiceModal(false)} backdropClassName="stype-modal-ov" panelClassName="stype-modal-sh" ariaLabelledBy="new-report-service-type-title">
        <div className="stype-modal-handle" />
        <div className="stype-modal-title" id="new-report-service-type-title">
          Tipo de serviço
        </div>
        <div className="stype-grid">
          {serviceOptions.map(({ type, icon, name }) => (
            <button
              key={type}
              className="stype-btn"
              type="button"
              onClick={() => {
                addService(type);
                setShowServiceModal(false);
              }}
            >
              <div className="stype-icon">{icon}</div>
              <div className="stype-name">{name}</div>
            </button>
          ))}
        </div>
      </Modal>

      {user ? <RdoDdsNovelty user={user} enabled={ddsNoveltyActive && step === 0 && !effectiveServiceOnly} onSeen={() => setDdsNoveltyActive(false)} /> : null}
    </Shell>
  );
}

export function NewReportPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const permissions = user?.reportEmissionPermissions || [];
  const requested = searchParams.get('tipo');
  const requestedSelection = normalizeReportSelection(requested);
  const operationalSelection = requestedSelection && requestedSelection !== 'obra'
    && canAccessReportSelection(permissions, requestedSelection)
      ? requestedSelection
      : null;
  const selection = resolveSiteReportSelection(permissions);

  if (!user) return null;
  if (operationalSelection) {
    return <OperationalReportFormPage mode={operationalSelection} />;
  }
  if (selection === 'obra') return <SiteRdoFormPage />;

  return (
    <Shell>
      <TopBar title="Novo relatório" subtitle={user.name} showLogo />
      <main className="page-scroll operational-empty-state">
        <section className="page-card">
          <div className="section-title">Emissão não autorizada</div>
          <p className="placeholder-copy">
            Sua conta não possui a permissão necessária para este relatório.
          </p>
          <button className="secondary-button" type="button" onClick={() => navigate('/modulos')}>
            Voltar aos módulos
          </button>
        </section>
      </main>
    </Shell>
  );
}
