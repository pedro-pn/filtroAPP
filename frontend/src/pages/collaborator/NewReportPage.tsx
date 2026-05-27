import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';


import { useAuth } from '../../auth/AuthContext';
import { accountPageStateFromPath } from '../../auth/moduleNavigation';
import { listReports } from '../../api/reports';
import { ServiceCollaboratorsBlock, ServiceFields, serviceTypeLabels } from '../../components/reports/ServiceFields';
import { Modal } from '../../components/ui/Modal';
import { UploadField } from '../../components/ui/UploadField';
import { useToast } from '../../components/ui/Toast';
import { useCollaborators } from '../../hooks/useCollaborators';
import { useCounters } from '../../hooks/useCounters';
import { useDraftMutations, useDrafts } from '../../hooks/useDrafts';
import { useInhibitionOptions } from '../../hooks/useInhibitionOptions';
import { useManometers } from '../../hooks/useManometers';
import { useProjects } from '../../hooks/useProjects';
import { useReportMutations } from '../../hooks/useReports';
import { useUnits } from '../../hooks/useUnits';
import { Shell } from '../../layout/Shell';
import { TopBar } from '../../layout/TopBar';
import { useRdoStore } from '../../store/rdoStore';
import type { UploadedFile } from '../../api/uploads';
import type { ReportSummary } from '../../types/domain';
import { roleHomePath } from '../../auth/rolePath';
import { buildReportServicePayload, normalizeServiceType } from '../../utils/reportServicePayload';
import { sortProjects } from '../../utils/projectSort';
import { handleHorizontalTabListKeyDown } from '../../utils/tabKeyboard';

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
  remove: 'Remover',
  select: 'Selecione',
  service: 'Serviço',
  services: 'Serviços',
  start: 'Início',
  next: 'Próximo →',
  submit: 'Enviar relatório ✓',
  team: 'Equipe diurna',
  specialConditions: 'Condições especiais',
  identification: 'Identificação',
  schedules: 'Horários',
  serviceOnly: 'Somente serviço',
  serviceOnlyHint: 'Cria apenas relatórios de serviço, liberados diretamente para o cliente.',
};

const serviceTypeModalOptions = [
  { type: 'limpeza',  icon: '🧪', name: 'Limpeza química' },
  { type: 'pressao',  icon: '🔴', name: 'Teste de pressão' },
  { type: 'filtragem', icon: '🔵', name: 'Filtragem' },
  { type: 'flushing', icon: '💧', name: 'Flushing' },
  { type: 'mecanica', icon: '⚙️', name: 'Limpeza mecânica' },
  { type: 'inibicao', icon: '🛡️', name: 'Inibição' },
] as const;

const rdoSteps = [TEXT.header, TEXT.services, TEXT.finalization];
const serviceOnlySteps = [TEXT.header, TEXT.services];
const serviceOnlySupportedTypes = new Set(['limpeza', 'pressao', 'filtragem', 'flushing', 'mecanica']);
type ReportServiceSummary = NonNullable<ReportSummary['services']>[number];

export function NewReportPage() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const projectsQuery = useProjects(true);
  const collaboratorsQuery = useCollaborators();
  const unitsQuery = useUnits();
  const manometersQuery = useManometers();
  const countersQuery = useCounters();
  const inhibitionOptionsQuery = useInhibitionOptions();
  const reportMutations = useReportMutations();
  const draftsQuery = useDrafts();
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
    overtimeReason,
    dailyDescription,
    generalUploads,
    services,
    setDraftId,
    setHeaderField,
    setCollaborators,
    setNightCollaborators,
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
  const [collaboratorToAdd, setCollaboratorToAdd] = useState('');
  const [nightCollaboratorToAdd, setNightCollaboratorToAdd] = useState('');
  const [collaboratorsPrefilled, setCollaboratorsPrefilled] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const canCreateServiceOnly = user?.role === 'MANAGER';
  const effectiveServiceOnly = canCreateServiceOnly && serviceOnly;
  const steps = effectiveServiceOnly ? serviceOnlySteps : rdoSteps;

  const projects = useMemo(() => sortProjects(projectsQuery.data || [], 'asc'), [projectsQuery.data]);
  const collaborators = (collaboratorsQuery.data || []).filter(item => item.isActive);
  const units = unitsQuery.data || [];
  const manometers = manometersQuery.data || [];
  const serviceCollaboratorOptions = useMemo(() => {
    const ids = Array.from(new Set([...collaboratorIds, ...nightCollaboratorIds]));
    return ids
      .map(id => {
        const collaborator = collaborators.find(item => item.id === id);
        return collaborator ? { id: collaborator.id, name: collaborator.name } : null;
      })
      .filter((item): item is { id: string; name: string } => Boolean(item));
  }, [collaboratorIds, nightCollaboratorIds, collaborators]);

  const selectedProject = useMemo(
    () => (projectsQuery.data || []).find(project => project.id === projectId) || null,
    [projectId, projectsQuery.data]
  );
  const serviceOptions = useMemo(() => {
    const allowed = effectiveServiceOnly
      ? serviceTypeModalOptions.filter(option => serviceOnlySupportedTypes.has(option.type))
      : serviceTypeModalOptions;
    return allowed.filter(option => option.type !== 'inibicao' || selectedProject?.inhibitionServiceEnabled === true);
  }, [effectiveServiceOnly, selectedProject?.inhibitionServiceEnabled]);
  const backPath = roleHomePath(user?.role);

  function firstIdFromField(value: unknown) {
    if (typeof value === 'string') return value;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
    const record = value as Record<string, unknown>;
    if (Array.isArray(record.ids)) {
      return record.ids.find((id): id is string => typeof id === 'string' && id.trim().length > 0) || '';
    }
    return '';
  }

  // Fetch reports of selected project for pre-fill and continuity
  const lastProjectReportQuery = useQuery({
    queryKey: ['reports', 'last-project', projectId],
    queryFn: () => listReports({ projectId: projectId! }),
    enabled: !!projectId,
    staleTime: 30_000
  });

  const projectReports = useMemo(() => {
    const reports = lastProjectReportQuery.data || [];
    const cutoff = reportDate ? new Date(`${reportDate}T23:59:59`) : new Date();
    const cutoffTime = Number.isNaN(cutoff.getTime()) ? Number.POSITIVE_INFINITY : cutoff.getTime();
    return reports.filter(report => (
      report.reportType === 'RDO'
      && new Date(report.reportDate || report.createdAt || 0).getTime() <= cutoffTime
    )).sort(
      (a, b) => new Date(b.reportDate).getTime() - new Date(a.reportDate).getTime()
    );
  }, [lastProjectReportQuery.data, reportDate]);
  const lastReport = projectReports[0] || null;

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

  const serviceSemanticKey = useCallback((report: ReportSummary, service: ReportServiceSummary) => {
    const extra = service.extraData || {};
    return `${report.projectId || ''}||${service.serviceType || ''}||${serviceEquipmentName(service).trim().toLowerCase()}||${String(service.system || extra.Sistema || '').trim().toLowerCase()}`;
  }, [serviceEquipmentName]);

  const serviceOngoingKey = useCallback((report: ReportSummary, service: ReportServiceSummary) => {
    const extra = service.extraData || {};
    return String(extra.__ongoingKey || extra.__serviceLinkKey || extra.__sourceServiceId || serviceSemanticKey(report, service));
  }, [serviceSemanticKey]);

  const serviceOngoingKeys = useCallback((report: ReportSummary, service: ReportServiceSummary) => {
    const extra = service.extraData || {};
    return Array.from(new Set([
      String(extra.__ongoingKey || '').trim(),
      String(extra.__serviceLinkKey || '').trim(),
      String(extra.__sourceServiceId || '').trim(),
      serviceSemanticKey(report, service)
    ].filter(Boolean)));
  }, [serviceSemanticKey]);

  function markPreviouslyAddedUploads(extra: Record<string, unknown>) {
    const groups = Array.isArray(extra.__uploads__) ? extra.__uploads__ : [];
    if (!groups.length) return extra;

    return {
      ...extra,
      __uploads__: groups.map(group => {
        if (!group || typeof group !== 'object' || Array.isArray(group)) return group;
        const record = group as { label?: unknown; files?: unknown };
        const files = Array.isArray(record.files)
          ? record.files.map(file => (
            file && typeof file === 'object' && !Array.isArray(file)
              ? { ...(file as UploadedFile), __previouslyAdded: true }
              : file
          ))
          : record.files;
        return { ...record, files };
      })
    };
  }

  const pendingProjectServices = useMemo(() => {
    const items = new Map<string, { key: string; keys: string[]; report: ReportSummary; service: ReportServiceSummary }>();
    [...projectReports].reverse().forEach(report => {
      (report.services || []).forEach(service => {
        const keys = serviceOngoingKeys(report, service);
        if (serviceFinalized(service)) {
          for (const [itemKey, item] of items.entries()) {
            if (item.keys.some(key => keys.includes(key))) items.delete(itemKey);
          }
          return;
        }
        for (const [itemKey, item] of items.entries()) {
          if (item.keys.some(key => keys.includes(key))) items.delete(itemKey);
        }
        const key = serviceOngoingKey(report, service);
        items.set(key, { key, keys, report, service });
      });
    });
    return Array.from(items.values()).sort(
      (a, b) => new Date(b.report.reportDate).getTime() - new Date(a.report.reportDate).getTime()
    );
  }, [projectReports, serviceFinalized, serviceOngoingKey, serviceOngoingKeys]);

  const visiblePendingProjectServices = useMemo(() => {
    const activeKeys = new Set(services.map(service => {
      const data = service.data || {};
      return String(data.__ongoingKey || data.__serviceLinkKey || data.__sourceServiceId || '').trim();
    }).filter(Boolean));
    return pendingProjectServices.filter(item => !activeKeys.has(item.key));
  }, [pendingProjectServices, services]);

  useEffect(() => {
    if (!effectiveServiceOnly && !lunchBreak) setHeaderField('lunchBreak', '01:00:00');
  }, [effectiveServiceOnly, lunchBreak, setHeaderField]);

  // Pre-fill collaborators from the most recent report of the selected project
  useEffect(() => {
    if (!projectId || collaboratorIds.length > 0) return;
    if (!lastReport) return;
    const ids = (lastReport.collaborators || []).map(l => l.collaboratorId).filter(Boolean);
    if (ids.length) {
      setCollaborators(ids);
      setCollaboratorsPrefilled(true);
    }
  }, [projectId, lastReport, collaboratorIds.length, setCollaborators]);

  useEffect(() => {
    if (!projectId || !noturno || nightCollaboratorIds.length > 0) return;
    const noturnoDetails = lastReport?.specialConditions?.noturnoDetails;
    if (!noturnoDetails || typeof noturnoDetails !== 'object' || Array.isArray(noturnoDetails)) return;
    const ids = Array.isArray((noturnoDetails as Record<string, unknown>).collaboratorIds)
      ? ((noturnoDetails as Record<string, unknown>).collaboratorIds as unknown[]).filter((id): id is string => typeof id === 'string')
      : [];
    if (ids.length) setNightCollaborators(ids);
  }, [projectId, noturno, nightCollaboratorIds.length, lastReport, setNightCollaborators]);

  function continueService(service: ReportServiceSummary, ongoingKey: string) {
      const extra = markPreviouslyAddedUploads(service.extraData || {});
      const type = normalizeServiceType(service.serviceType);
      const contadorUtilizado = firstIdFromField(extra['Contador utilizado'] || extra.contadorUtilizado);
      const previousDesidratacaoUnit = firstIdFromField(
        extra.desidratacaoUnit
        || extra['Equipamento de desidratação']
        || extra['Equipamento de desidratacao']
        || extra['Equipamento de desidrataÃ§Ã£o']
      );
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
        material: service.material || String(extra['Material da tubulação'] || extra['Material do equipamento'] || ''),
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

  function parseDurationToMinutes(value: string) {
    const parts = String(value || '').split(':').map(part => Number(part));
    if (parts.some(part => Number.isNaN(part))) return 0;
    return (parts[0] || 0) * 60 + (parts[1] || 0);
  }

  function workedMinutes(start: string, end: string, breakValue: string) {
    const startMinutes = parseDurationToMinutes(start);
    const endMinutes = parseDurationToMinutes(end);
    if (!start || !end) return 0;
    const total = endMinutes >= startMinutes ? endMinutes - startMinutes : endMinutes + 24 * 60 - startMinutes;
    return Math.max(0, total - parseDurationToMinutes(breakValue));
  }

  function addDays(date: Date, days: number) {
    const copy = new Date(date.getTime());
    copy.setUTCDate(copy.getUTCDate() + days);
    return copy;
  }

  function dateKey(date: Date) {
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
  }

  function easterDate(year: number) {
    const a = year % 19;
    const b = Math.floor(year / 100);
    const c = year % 100;
    const d = Math.floor(b / 4);
    const e = b % 4;
    const f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4);
    const k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31);
    const day = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(Date.UTC(year, month - 1, day));
  }

  function isHoliday(value: string) {
    const date = new Date(`${value}T00:00:00Z`);
    if (Number.isNaN(date.getTime())) return false;
    const year = date.getUTCFullYear();
    const key = dateKey(date);
    const fixed = new Set(['01-01', '04-21', '05-01', '09-07', '10-12', '11-02', '11-15', '11-20', '12-25'].map(day => `${year}-${day}`));
    const easter = easterDate(year);
    const movable = new Set([-48, -47, -2, 0, 60].map(days => dateKey(addDays(easter, days))));
    return fixed.has(key) || movable.has(key);
  }

  function expectedMinutes() {
    if (!selectedProject) return 0;
    const date = new Date(`${reportDate}T00:00:00Z`);
    if (Number.isNaN(date.getTime())) return parseDurationToMinutes(selectedProject.workdayHours || '09:00');
    if (isHoliday(reportDate)) return 0;
    const dow = date.getUTCDay();
    const weekdayBase = parseDurationToMinutes(selectedProject.workdayHours || '09:00');
    const weekendBase = parseDurationToMinutes(selectedProject.weekendWorkdayHours || '08:00');
    if (dow === 5) return weekendBase;
    if (dow === 6) return selectedProject.includesSaturday ? weekendBase : 0;
    if (dow === 0) return selectedProject.includesSunday ? weekendBase : 0;
    return weekdayBase;
  }

  function formatMinutes(total: number) {
    const hours = Math.floor(total / 60);
    const minutes = total % 60;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
  }

  const overtimeSummary = useMemo(() => {
    const expected = expectedMinutes();
    const daytimeWorkedMinutes = workedMinutes(arrivalTime, departureTime, lunchBreak);
    const nighttimeWorkedMinutes = noturno ? workedMinutes(noturnoStart, noturnoEnd, noturnoInterval) : 0;
    const daytimeOvertimeMinutes = expected === 0
      ? daytimeWorkedMinutes
      : Math.max(0, daytimeWorkedMinutes - expected > 30 ? daytimeWorkedMinutes - expected : 0);
    const nighttimeOvertimeMinutes = expected === 0
      ? nighttimeWorkedMinutes
      : Math.max(0, nighttimeWorkedMinutes - expected > 30 ? nighttimeWorkedMinutes - expected : 0);

    return {
      expectedMinutes: expected,
      daytimeWorkedMinutes,
      nighttimeWorkedMinutes,
      daytimeOvertimeMinutes,
      nighttimeOvertimeMinutes,
      totalOvertimeMinutes: daytimeOvertimeMinutes + nighttimeOvertimeMinutes,
      isHoliday: isHoliday(reportDate)
    };
  }, [arrivalTime, departureTime, lunchBreak, noturno, noturnoEnd, noturnoInterval, noturnoStart, reportDate, selectedProject]);

  const overtimeLines = [
    `Turno diurno: trabalhado ${formatMinutes(overtimeSummary.daytimeWorkedMinutes)} | extra ${formatMinutes(overtimeSummary.daytimeOvertimeMinutes)}`,
    ...(noturno || overtimeSummary.nighttimeWorkedMinutes
      ? [`Turno noturno: trabalhado ${formatMinutes(overtimeSummary.nighttimeWorkedMinutes)} | extra ${formatMinutes(overtimeSummary.nighttimeOvertimeMinutes)}`]
      : []),
    overtimeSummary.expectedMinutes
      ? `Jornada de referência: ${formatMinutes(overtimeSummary.expectedMinutes)}${overtimeSummary.isHoliday ? ' | feriado detectado' : ''}`
      : overtimeSummary.isHoliday
        ? 'Feriado detectado: todo o período trabalhado será considerado hora extra.'
        : 'Data com regime integral de hora extra conforme configuração do projeto.'
  ];

  function addCollaboratorFromSelect(night = false) {
    const id = night ? nightCollaboratorToAdd : collaboratorToAdd;
    if (!id) return;
    if (night) {
      setNightCollaborators(Array.from(new Set([...nightCollaboratorIds, id])));
      setNightCollaboratorToAdd('');
      return;
    }
    setCollaborators(Array.from(new Set([...collaboratorIds, id])));
    setCollaboratorToAdd('');
  }

  function removeCollaboratorFromList(id: string, night = false) {
    if (night) {
      setNightCollaborators(nightCollaboratorIds.filter(item => item !== id));
      return;
    }
    setCollaborators(collaboratorIds.filter(item => item !== id));
  }

  function renderCollaboratorList(ids: string[], night = false) {
    if (!ids.length) {
      return <div className="colab-empty">Nenhum colaborador adicionado.</div>;
    }

    return ids.map(id => {
      const item = collaborators.find(candidate => candidate.id === id);
      return (
        <span className="colab-tag" key={`${night ? 'night' : 'day'}-${id}`}>
          <span>{item?.name || id}</span>
          <button type="button" onClick={() => removeCollaboratorFromList(id, night)}>×</button>
        </span>
      );
    });
  }

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
    setStep(targetStep);
    setInvalidTarget(target);
    showToast(`Preencha o campo obrigatório: ${label}.`, 'error');
    window.setTimeout(() => {
      const [serviceId] = target.split(':');
      const selectors = target.includes(':')
        ? [
            `[data-invalid-target="${target}"]`,
            `[data-service-id="${serviceId}"] .field-invalid input`,
            `[data-service-id="${serviceId}"] .field-invalid select`,
            `[data-service-id="${serviceId}"] .field-invalid textarea`,
            `[data-service-id="${serviceId}"] .field-invalid`,
            `[data-service-id="${serviceId}"]`
          ]
        : [`[data-invalid-target="${target}"]`];
      const element = selectors.map(selector => document.querySelector(selector)).find(Boolean) as HTMLElement | null;
      element?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      if (element && typeof element.focus === 'function') element.focus({ preventScroll: true });
    }, 120);
    return false;
  }

  function hasText(value: unknown) {
    return typeof value === 'string' && value.trim().length > 0;
  }

  function hasStringItem(value: unknown) {
    return Array.isArray(value) && value.some(item => typeof item === 'string' && item.trim());
  }

  function hasTextOrStringItem(value: unknown) {
    return hasText(value) || hasStringItem(value);
  }

  function hasValidTubes(value: unknown) {
    return Array.isArray(value) && value.length > 0 && value.every(item => {
      if (!item || typeof item !== 'object') return false;
      const row = item as Record<string, unknown>;
      return hasText(row.d) && hasText(row.c);
    });
  }

  function isNoValue(value: unknown) {
    if (Array.isArray(value)) value = value[0];
    return String(value || '')
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '') === 'nao';
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
    return type === 'pressao';
  }

  function validateHeader() {
    if (!projectId) return failRequired('Projeto', 'header:projectId', 0);
    if (!reportDate) return failRequired('Data do relatório', 'header:reportDate', 0);
    if (effectiveServiceOnly) {
      if (!collaboratorIds.length) return failRequired('Colaboradores', 'header:collaborators', 0);
      return true;
    }
    if (!arrivalTime) return failRequired('Chegada', 'header:arrivalTime', 0);
    if (!departureTime) return failRequired('Saída', 'header:departureTime', 0);
    if (!lunchBreak) return failRequired('Intervalo de almoço', 'header:lunchBreak', 0);
    if (!collaboratorIds.length) return failRequired('Colaboradores', 'header:collaborators', 0);
    if (standby && !standbyDuration) return failRequired('Tempo total (standby)', 'header:standbyDuration', 0);
    if (standby && !standbyMotivo.trim()) return failRequired('Motivo (standby)', 'header:standbyMotivo', 0);
    if (noturno && !noturnoStart) return failRequired('Início (noturno)', 'header:noturnoStart', 0);
    if (noturno && !noturnoEnd) return failRequired('Término (noturno)', 'header:noturnoEnd', 0);
    if (noturno && !noturnoInterval) return failRequired('Intervalo noturno', 'header:noturnoInterval', 0);
    if (noturno && !nightCollaboratorIds.length) return failRequired('Colaboradores noturnos', 'header:nightCollaborators', 0);
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

      if (['limpeza', 'pressao', 'mecanica', 'inibicao'].includes(type) && !hasText(data.material)) {
        return failRequired(type === 'mecanica' ? 'Material do equipamento' : 'Material da tubulação', target('material'), 1);
      }
      if (serviceRequiresTubes(type, data) && !hasValidTubes(data.tubes)) {
        return failRequired('Diâmetro e comprimento de cada tubulação', target('tubes'), 1);
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
    setStep(current => Math.min(current + 1, steps.length - 1));
  }

  function buildResumoText() {
    const parts: string[] = [];
    if (selectedProject) parts.push(`${selectedProject.code} — ${selectedProject.name}`);
    if (reportDate) {
      const d = new Date(`${reportDate}T00:00:00`);
      const label = d.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
      parts.push(label.charAt(0).toUpperCase() + label.slice(1));
    }
    if (arrivalTime && departureTime) parts.push(`${arrivalTime} às ${departureTime}`);
    if (collaboratorIds.length) {
      parts.push(`${collaboratorIds.length} colaborador${collaboratorIds.length !== 1 ? 'es' : ''}`);
    }
    if (services.length) {
      const types = services.map(s => serviceTypeLabels[normalizeServiceType(s.type)] || s.type);
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
      overtimeReason,
      dailyDescription,
      generalUploads,
      services
    };
  }, [
    projectId,
    effectiveServiceOnly,
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
    overtimeReason,
    dailyDescription,
    generalUploads,
    services
  ]);

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
    return (draftsQuery.data || []).filter(draft => draftProjectDateKey(draft) === key).map(draft => draft.id);
  }, [draftProjectDateKey, draftsQuery.data, effectiveServiceOnly, projectId, reportDate]);

  const saveDraftNow = useCallback(async ({ notifyOnError = false } = {}) => {
    if (!projectId || !reportDate) {
      if (draftId) setDraftId(null);
      return true;
    }

    const payload = {
      projectId,
      reportDate,
      title: selectedProject ? `${selectedProject.code} - ${selectedProject.name}` : 'Relatório em andamento',
      payload: buildDraftPayload()
    };
    const sameProjectDateIds = matchingDraftIds();
    const targetId = draftId && sameProjectDateIds.includes(draftId) ? draftId : sameProjectDateIds[0];
    const signature = JSON.stringify({ targetId: targetId || '', payload });
    if (signature === lastAutoSaveSignatureRef.current) return true;
    lastAutoSaveSignatureRef.current = signature;

    try {
      const saved = targetId
        ? await updateDraftAsync({ id: targetId, payload })
        : await createDraftAsync(payload);
      if (draftId !== saved.id) setDraftId(saved.id);

      await Promise.all(
        sameProjectDateIds
          .filter(id => id !== saved.id)
          .map(id => removeDraftAsync(id).catch(() => undefined))
      );
      return true;
    } catch (error) {
      lastAutoSaveSignatureRef.current = '';
      console.error('Falha ao salvar rascunho de relatório.', error);
      if (notifyOnError) {
        showToast(error instanceof Error ? error.message : 'Não foi possível salvar o rascunho.', 'error');
      }
      return false;
    }
  }, [
    projectId,
    reportDate,
    draftId,
    selectedProject,
    buildDraftPayload,
    matchingDraftIds,
    updateDraftAsync,
    createDraftAsync,
    setDraftId,
    removeDraftAsync,
    showToast
  ]);

  useEffect(() => {
    if (isSubmittingRef.current) return;
    if (draftSaveTimerRef.current) window.clearTimeout(draftSaveTimerRef.current);

    draftSaveTimerRef.current = window.setTimeout(() => {
      void saveDraftNow();
    }, 150);

    return () => {
      if (draftSaveTimerRef.current) window.clearTimeout(draftSaveTimerRef.current);
    };
  }, [saveDraftNow]);

  const handleBack = useCallback(async () => {
    if (draftSaveTimerRef.current) {
      window.clearTimeout(draftSaveTimerRef.current);
      draftSaveTimerRef.current = null;
    }
    const saved = await saveDraftNow({ notifyOnError: true });
    if (saved) navigate(backPath);
  }, [
    backPath,
    navigate,
    saveDraftNow
  ]);

  const handleLogout = useCallback(async () => {
    await logout();
    navigate('/login', { replace: true });
  }, [logout, navigate]);

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
      const servicePayloads = services.map(service => buildReportServicePayload(
        effectiveServiceOnly
          ? { ...service, data: { ...service.data, finalized: true, aprovadoCliente: 'Sim' } }
          : service,
        {
          collaboratorIds: Array.isArray(service.data.serviceCollaboratorIds)
            ? service.data.serviceCollaboratorIds.filter((id): id is string => typeof id === 'string')
            : [],
          collaborators,
          units
        }
      ));

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
            overtimeSummary
          },
          collaboratorIds,
          services: servicePayloads
        });
      }

      await Promise.all(draftIdsToRemove.map(id => removeDraftAsync(id).catch(() => undefined)));
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
            <button className="topbar-chip" type="button" onClick={() => navigate('/conta', { state: accountPageStateFromPath(location.pathname) })}>
              Conta
            </button>
            <button className="topbar-chip" type="button" onClick={handleLogout}>
              Sair
            </button>
          </>
        }
      />
      <main className="page-scroll">
        <section className="page-card rdo-step-panel">
          <div className="rdo-progress-track" aria-hidden="true">
            <div className="rdo-progress-fill" style={{ width: `${((step + 1) / steps.length) * 100}%` }} />
          </div>
          <div className="filter-tabs" role="tablist" aria-label="Etapas do relatório" onKeyDown={handleHorizontalTabListKeyDown}>
            {steps.map((label, index) => (
              <button
                className={`filter-tab ${step === index ? 'active' : ''}`}
                key={label}
                type="button"
                role="tab"
                aria-selected={step === index}
                onClick={() => {
                  if (index <= step) {
                    setStep(index);
                    return;
                  }
                  if (index === step + 1) {
                    handleNextStep();
                  }
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </section>

        {step === 0 ? (
        <>
        {/* Card 1: Identificação */}
        <section className="page-card">
          <div className="section-title">{TEXT.identification}</div>
          {canCreateServiceOnly ? (
            <div className="tog-row" style={{ marginBottom: 12 }}>
              <span className="tog-lbl">
                {TEXT.serviceOnly}
                <span className="placeholder-copy" style={{ display: 'block', marginTop: 2 }}>{TEXT.serviceOnlyHint}</span>
              </span>
              <label className="tog">
                <input
                  type="checkbox"
                  checked={effectiveServiceOnly}
                  onChange={event => {
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
              <label htmlFor="rdo-project">Projeto <span style={{ color: 'var(--rd)' }}>*</span></label>
              <select
                id="rdo-project"
                value={projectId || ''}
                onChange={event => setHeaderField('projectId', event.target.value || null)}
                required
              >
                <option value="">Selecionar projeto...</option>
                {projects.map(project => (
                  <option key={project.id} value={project.id}>
                    {project.code} - {project.name}
                  </option>
                ))}
              </select>
            </div>
            <div className={fieldState('header:reportDate')} data-invalid-target="header:reportDate">
              <label htmlFor="rdo-date">Data do relatório <span style={{ color: 'var(--rd)' }}>*</span></label>
              <input
                id="rdo-date"
                type="date"
                value={reportDate}
                onChange={event => setHeaderField('reportDate', event.target.value)}
                required
              />
            </div>
          </div>
        </section>

        {!effectiveServiceOnly ? (
        <>
        {/* Card 2: Horários */}
        <section className="page-card">
          <div className="section-title">{TEXT.schedules}</div>
          <div className="fg-r2">
            <div className={fieldState('header:arrivalTime')} data-invalid-target="header:arrivalTime">
              <label htmlFor="rdo-arrival">Chegada <span style={{ color: 'var(--rd)' }}>*</span></label>
              <input
                id="rdo-arrival"
                type="time"
                value={arrivalTime}
                onChange={event => setHeaderField('arrivalTime', event.target.value)}
                required
              />
            </div>
            <div className={fieldState('header:departureTime')} data-invalid-target="header:departureTime">
              <label htmlFor="rdo-departure">{TEXT.departure} <span style={{ color: 'var(--rd)' }}>*</span></label>
              <input
                id="rdo-departure"
                type="time"
                value={departureTime}
                onChange={event => setHeaderField('departureTime', event.target.value)}
                required
              />
            </div>
          </div>
          <div className={fieldState('header:lunchBreak')} style={{ marginTop: 10 }} data-invalid-target="header:lunchBreak">
            <label htmlFor="rdo-lunch">Intervalo de almoço <span style={{ color: 'var(--rd)' }}>*</span></label>
            <input
              id="rdo-lunch"
              type="time"
              step={1}
              value={lunchBreak}
              onChange={event => setHeaderField('lunchBreak', event.target.value)}
              required
            />
          </div>
        </section>
        </>
        ) : null}

        {/* Card 3: Equipe diurna */}
        <section className="page-card">
          <div className="section-title">
            {TEXT.team}
            {collaboratorsPrefilled ? <span className="pre-badge">pré-preenchido</span> : null}
          </div>
          <div
            className={`colab-list ${invalidTarget === 'header:collaborators' ? 'field-invalid-panel' : ''}`}
            data-invalid-target="header:collaborators"
          >
            {renderCollaboratorList(collaboratorIds)}
          </div>
          <div className="cadd">
            <select value={collaboratorToAdd} onChange={event => setCollaboratorToAdd(event.target.value)}>
              <option value="">Adicionar...</option>
              {collaborators
                .filter(item => !collaboratorIds.includes(item.id))
                .map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
            <button className="cadd-btn" type="button" onClick={() => addCollaboratorFromSelect()}>
              + Add
            </button>
          </div>
        </section>

        {!effectiveServiceOnly ? (
        <>
        {/* Card 4: Condições especiais */}
        <section className="page-card">
          <div className="section-title">{TEXT.specialConditions}</div>
          <div className="tog-row">
            <span className="tog-lbl">Houve standby?</span>
            <label className="tog">
              <input
                type="checkbox"
                checked={standby}
                onChange={event => setHeaderField('standby', event.target.checked)}
              />
              <span className="tog-sl" />
            </label>
          </div>
          {standby ? (
            <div className="collapse-section">
              <div className="fg-r2">
                <div className={fieldState('header:standbyDuration')} data-invalid-target="header:standbyDuration">
                  <label>Tempo total <span style={{ color: 'var(--rd)' }}>*</span></label>
                  <input
                    type="time"
                    step={60}
                    value={standbyDuration}
                    onChange={event => setHeaderField('standbyDuration', event.target.value)}
                  />
                </div>
                <div className={fieldState('header:standbyMotivo')} data-invalid-target="header:standbyMotivo">
                  <label>Motivo <span style={{ color: 'var(--rd)' }}>*</span></label>
                  <input
                    type="text"
                    placeholder="Motivo..."
                    value={standbyMotivo}
                    onChange={event => setHeaderField('standbyMotivo', event.target.value)}
                  />
                </div>
              </div>
            </div>
          ) : null}
          <div className="tog-row">
            <span className="tog-lbl">Houve turno noturno?</span>
            <label className="tog">
              <input
                type="checkbox"
                checked={noturno}
                onChange={event => setHeaderField('noturno', event.target.checked)}
              />
              <span className="tog-sl" />
            </label>
          </div>
          {noturno ? (
            <div className="collapse-section noturno-section">
              <div className="fg-r2 night-time-grid">
                <div className={fieldState('header:noturnoStart')} data-invalid-target="header:noturnoStart">
                  <label>Início <span style={{ color: 'var(--rd)' }}>*</span></label>
                  <input
                    type="time"
                    value={noturnoStart}
                    onChange={event => setHeaderField('noturnoStart', event.target.value)}
                  />
                </div>
                <div className={fieldState('header:noturnoEnd')} data-invalid-target="header:noturnoEnd">
                  <label>Término <span style={{ color: 'var(--rd)' }}>*</span></label>
                  <input
                    type="time"
                    value={noturnoEnd}
                    onChange={event => setHeaderField('noturnoEnd', event.target.value)}
                  />
                </div>
              </div>
              <div className={fieldState('header:noturnoInterval')} style={{ marginTop: 6 }} data-invalid-target="header:noturnoInterval">
                <label>Intervalo noturno</label>
                <input
                  type="time"
                  step={1}
                  value={noturnoInterval}
                  onChange={event => setHeaderField('noturnoInterval', event.target.value)}
                />
              </div>
              <div className="section-title" style={{ marginTop: 14 }}>{TEXT.nightTeam}</div>
              <div
                className={`colab-list ${invalidTarget === 'header:nightCollaborators' ? 'field-invalid-panel' : ''}`}
                data-invalid-target="header:nightCollaborators"
              >
                {renderCollaboratorList(nightCollaboratorIds, true)}
              </div>
              <div className="cadd">
                <select value={nightCollaboratorToAdd} onChange={event => setNightCollaboratorToAdd(event.target.value)}>
                  <option value="">Adicionar...</option>
                  {collaborators
                    .filter(item => !nightCollaboratorIds.includes(item.id))
                    .map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
                <button className="cadd-btn" type="button" onClick={() => addCollaboratorFromSelect(true)}>
                  + Add
                </button>
              </div>
            </div>
          ) : null}
        </section>
        </>
        ) : null}

        </>
        ) : null}

        {step === 1 ? (
        <>
        {projectId && !effectiveServiceOnly && visiblePendingProjectServices.length > 0 ? (
          <section className="page-card continuity-card">
            <div className="section-title">Serviços em andamento</div>
            <p className="placeholder-copy">
              Selecione individualmente quais serviços deseja continuar neste RDO.
            </p>
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
                          {equipment}{system ? ` · ${system}` : ''} · RDO {report.sequenceNumber || '---'}
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
                      <span className="svc-card-badge">{TEXT.service} {index + 1}</span>
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
                        onChange={event => updateService(service.id, { equipmentId: event.target.value })}
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
                          onChange={event => updateService(service.id, { system: event.target.value })}
                        />
                      </div>
                    ) : null}
                    {normalizeServiceType(service.type) !== 'inibicao' ? (
                      <ServiceCollaboratorsBlock
                        data={service.data}
                        onChange={update => updateService(service.id, update)}
                        invalidKey={invalidTarget === `${service.id}:serviceCollaboratorIds` ? 'serviceCollaboratorIds' : null}
                        collaboratorOptions={serviceCollaboratorOptions}
                      />
                    ) : null}
                    {normalizeServiceType(service.type) !== 'inibicao' ? (
                    <div className="fg-r2 service-time-grid">
                      <div className={serviceFieldState(service.id, 'startTime')}>
                        <label>Hora de início <span style={{ color: 'var(--rd)' }}>*</span></label>
                        <input
                          type="time"
                          value={typeof service.data.startTime === 'string' ? service.data.startTime : ''}
                          onChange={event => updateService(service.id, { startTime: event.target.value })}
                        />
                      </div>
                      <div className={serviceFieldState(service.id, 'endTime')}>
                        <label>Hora de término/pausa <span style={{ color: 'var(--rd)' }}>*</span></label>
                        <input
                          type="time"
                          value={typeof service.data.endTime === 'string' ? service.data.endTime : ''}
                          onChange={event => updateService(service.id, { endTime: event.target.value })}
                        />
                      </div>
                    </div>
                    ) : null}
                    <ServiceFields
                      serviceType={service.type}
                      data={service.data}
                      onChange={update => updateService(service.id, update)}
                      units={units}
                      manometers={manometers}
                      counters={countersQuery.data || []}
                      inhibitionOptions={inhibitionOptionsQuery.data}
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
              style={{ width: '100%', borderStyle: 'dashed', color: 'var(--g)', fontWeight: 700 }}
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
        {/* Card Horas extras */}
        <section className="page-card">
          <div className="section-title">Horas extras</div>
          <div
            style={{
              fontSize: 12,
              color: overtimeSummary.totalOvertimeMinutes > 0 ? 'var(--rd)' : 'var(--mu)',
              lineHeight: 1.7,
              marginBottom: 10
            }}
          >
            {overtimeSummary.totalOvertimeMinutes > 0 ? (
              <>
                <strong>Hora extra identificada: {formatMinutes(overtimeSummary.totalOvertimeMinutes)}</strong>
                {overtimeLines.map(line => <div key={line}>{line}</div>)}
              </>
            ) : (
              <>
                Nenhuma hora extra identificada.
                {overtimeLines.map(line => <div key={line}>{line}</div>)}
              </>
            )}
          </div>
          {overtimeSummary.totalOvertimeMinutes > 0 ? (
            <div className="field-group">
              <label htmlFor="rdo-overtime">Justificativa</label>
              <textarea
                id="rdo-overtime"
                placeholder="Descreva o motivo das horas extras..."
                rows={3}
                value={overtimeReason}
                onChange={event => setHeaderField('overtimeReason', event.target.value)}
              />
            </div>
          ) : null}
        </section>

        {/* Card Atividades do dia */}
        <section className="page-card">
          <div className="section-title">Atividades do dia</div>
          <div className="field-group">
            <label htmlFor="rdo-description">{TEXT.dailyDescription}</label>
            <textarea
              id="rdo-description"
              style={{ minHeight: 100 }}
              placeholder="Descreva as atividades realizadas..."
              rows={5}
              value={dailyDescription}
              onChange={event => setHeaderField('dailyDescription', event.target.value)}
            />
          </div>
        </section>

        {/* Card Fotos */}
        <section className="page-card">
          <div className="section-title">{TEXT.photos}</div>
          <UploadField
            label=""
            value={generalUploads as UploadedFile[]}
            projectId={projectId}
            onChange={setGeneralUploads}
          />
        </section>

        {/* Card Resumo */}
        <section className="page-card resumo-card">
          <div className="resumo-card-title">Resumo</div>
          <div className="resumo-txt">{buildResumoText()}</div>
        </section>
        </>
        ) : null}

        <section className="page-card rdo-bottom-actions">
          <button
            className="secondary-button"
            type="button"
            onClick={step === 0 ? handleBack : () => setStep(current => Math.max(current - 1, 0))}
          >
            {step === 0 ? 'Cancelar' : `← ${TEXT.back}`}
          </button>
          {step < steps.length - 1 ? (
            <button className="primary-button" type="button" onClick={handleNextStep}>
              {TEXT.next}
            </button>
          ) : (
            <button className="primary-button" type="button" disabled={isSubmitting} onClick={handleSubmit}>
              {isSubmitting ? 'Enviando...' : TEXT.submit}
            </button>
          )}
        </section>
      </main>

      <Modal
        open={showServiceModal}
        onClose={() => setShowServiceModal(false)}
        backdropClassName="stype-modal-ov"
        panelClassName="stype-modal-sh"
        ariaLabelledBy="new-report-service-type-title"
      >
            <div className="stype-modal-handle" />
            <div className="stype-modal-title" id="new-report-service-type-title">Tipo de serviço</div>
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
    </Shell>
  );
}
