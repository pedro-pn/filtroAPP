import { projectScopeOptions, projectWorkLocations } from '../../../shared/modules/rdo-project-context.js';
import { ReportServiceScopeField, ReportWorkLocationField } from '../components/reports/ReportProjectFields';
import { ProjectSystemInput } from '../components/projects/ProjectSystemInput';
import { legacyServiceData, serviceFinalizedValue } from './reportDetailServiceData';
import { GeneralUploadThumb } from '../components/reports/GeneralUploadThumb';
import { BrandLoading } from '../components/brand/BrandLoading';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { listDdsThemes } from '../api/ddsThemes';
import { downloadReportDocx, downloadReportPdf, listReports } from '../api/reports';

import { useAuth } from '../auth/AuthContext';
import { accountPageStateFromPath, backPathFromState, hasBackPathInState } from '../auth/moduleNavigation';
import { roleHomePath } from '../auth/rolePath';
import type { UploadedFile } from '../api/uploads';
import { ManualReportOperationalFields, type ManualReportOperationalFieldsValue } from '../components/reports/ManualReportOperationalFields';
import { DdsCustomThemeReviewAlert } from '../components/reports/DdsCustomThemeReviewAlert';
import { useConfirmDialog } from '../components/ui/useConfirmDialog';
import { PhotoCaptureNovelty } from '../components/reports/PhotoCaptureNovelty';
import { ReportDdsSummarySection } from '../components/reports/ReportDdsSummarySection';
import { ReportDetailActions } from '../components/reports/ReportDetailActions';
import { ReportReissueDialog } from '../components/reports/ReportReissueDialog';
import { canRegenerateReport, reportRegenerationMessage } from '../utils/reportRegeneration';
import { AppIcon } from '../components/icons/AppIcon';
import {
  buildManualReportOperationalData,
  validateManualReportOperationalFields
} from '../components/reports/manualReportOperationalData';
import { ServiceCollaboratorsBlock, ServiceFields } from '../components/reports/ServiceFields';
import { serviceTypeLabels } from '../components/reports/serviceTypes';
import { SignatureProgress } from '../components/reports/SignatureProgress';
import { useToast } from '../components/ui/ToastContext';
import { useReportDetailBootstrap } from '../hooks/useBootstrap';
import { useReportWorkforceAvailability } from '../hooks/useReportWorkforcePlanning';
import { pageScrollRestoreStateFromNavigation } from '../hooks/usePageScrollRestoration';
import { useReport, useReportAudit, useReportMutations } from '../hooks/useReports';
import { AppShell } from '../layout/AppShell';
import { createNavigationModel } from '../layout/navigationModel';
import { PageHeader } from '../layout/PageHeader';
import { Modal } from '../components/ui/Modal';
import { RemoveIconButton } from '../components/ui/RemoveIconButton';
import { ReasonDialog } from '../components/ui/ReasonDialog';
import { UploadField } from '../components/ui/UploadField';
import {
  Alert,
  Badge,
  Button,
  Card,
  Input,
  Select,
  StatusPill,
  Switch,
  Textarea,
  type StatusToneMap
} from '../components/ui/ds';
import { DS_ICONS } from '../components/ui/ds/icons';
import { clearStagedUploadDeletions, flushStagedUploadDeletions } from '../components/ui/photoDeletionStaging';
import type { Collaborator, Equipment, ReportAuditLog, ReportPayload, ReportStatus, ReportSummary, Unit } from '../types/domain';
import { formatDateOnlyPtBr } from '../utils/dateOnly';
import { downloadBlob } from '../utils/download';
import { sortProjects } from '../utils/projectSort';
import { reportDownloadFileName } from '../utils/reportFileName';
import { calculateReportOvertimeSummary } from '../utils/reportOvertime';
import { isReportManuallyReleased } from '../utils/reportClientRelease';
import { buildReportServicePayload, normalizeServiceType } from '../utils/reportServicePayload';
import { requiresSystemType, systemTypeValue } from '../utils/cleaningMeasurement';
import { buildContinuedServiceData, formServiceOngoingKeys, isPendingServiceFromLaterDay, pendingProjectServicesForDate, serviceEquipmentLabel } from '../utils/ongoingServices';
import { canReviewRdoReports } from '../../../shared/modules/rdo-permissions.js';
import type { AuthUser } from '../types/auth';
import { firstMissingRequiredServiceTime } from '../utils/reportServiceTimes';
import { normalizeLocalUploadUrl } from '../utils/uploadAssetUrl';
import { reportEditorOperationalMode } from './reportEditorOperationalMode';
import { REPORT_DETAIL_TEXT as TEXT } from './reportDetailText';
import { hubModulesForUser } from './hubModules';
import './collaborator/NewReportPage.css';
import './ReportDetailPage.css';

const serviceTypeModalOptions = [
  { type: 'limpeza', icon: DS_ICONS.serviceChemical, name: 'Limpeza química' },
  { type: 'pressao', icon: DS_ICONS.servicePressure, name: 'Teste de pressão' },
  { type: 'filtragem', icon: DS_ICONS.serviceFilter, name: 'Filtragem' },
  { type: 'flushing', icon: DS_ICONS.serviceFlushing, name: 'Flushing' },
  { type: 'mecanica', icon: DS_ICONS.serviceMechanical, name: 'Limpeza mecânica' },
  { type: 'inibicao', icon: DS_ICONS.serviceInhibition, name: 'Inibição' },
] as const;
const serviceOnlySupportedTypes = new Set(['limpeza', 'pressao', 'filtragem', 'flushing', 'mecanica']);
const derivedServiceReportTypes = new Set(['RTP', 'RLQ', 'RCPU', 'RLM', 'RLF', 'RLI']);

interface RdoServiceForm {
  id: string;
  type: string;
  data: Record<string, unknown>;
}

interface RdoFormState {
  projectId: string | null;
  sequenceNumber: string;
  reportDate: string;
  workLocation: string;
  arrivalTime: string;
  departureTime: string;
  lunchBreak: string;
  serviceEquipment: string;
  serviceSystem: string;
  collaboratorIds: string[];
  nightCollaboratorIds: string[];
  standby: boolean;
  standbyDuration: string;
  standbyMotivo: string;
  noturno: boolean;
  noturnoStart: string;
  noturnoEnd: string;
  noturnoInterval: string;
  ddsDay: boolean;
  ddsDayStart: string;
  ddsDayEnd: string;
  ddsDayThemes: { id: string; name: string; custom?: boolean }[];
  ddsNight: boolean;
  ddsNightStart: string;
  ddsNightEnd: string;
  ddsNightThemes: { id: string; name: string; custom?: boolean }[];
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

function formatDateTime(value?: string | null) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('pt-BR');
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

function manualReportUploadMeta(report: ReportSummary | null | undefined) {
  return asRecord(asRecord(report?.specialConditions).__manualUpload);
}

function isManualUploadedReport(report: ReportSummary | null | undefined) {
  return Boolean(manualReportUploadMeta(report).uploadedAt);
}

function reportServiceData(report: ReportSummary | null | undefined) {
  return asRecord(asRecord(report?.specialConditions).serviceData);
}

function reportServiceField(report: ReportSummary | null | undefined, keys: string[]) {
  const data = reportServiceData(report);
  for (const key of keys) {
    const value = data[key];
    if (typeof value === 'string' || typeof value === 'number') return String(value);
  }
  return '';
}

function manualServiceDataFromForm(report: ReportSummary, form: RdoFormState) {
  if (!isManualUploadedReport(report) || report.reportType === 'RDO') return {};
  const serviceData = { ...reportServiceData(report) };
  const equipment = form.serviceEquipment.trim();
  const system = form.serviceSystem.trim();

  if (equipment) serviceData.Equipamento = equipment;
  else delete serviceData.Equipamento;
  delete serviceData['Equipamento(s)'];

  if (system) serviceData.Sistema = system;
  else delete serviceData.Sistema;

  return { serviceData };
}

const derivedReportServiceTypes = new Set(['limpeza', 'pressao', 'filtragem', 'flushing', 'mecanica', 'inibicao']);

function hasFinalizedServiceDemotion(report: ReportSummary, form: RdoFormState) {
  if (report.reportType !== 'RDO' || report.status !== 'APPROVED') return false;
  const previousById = new Map((report.services || []).map(service => [service.id, service]));

  return form.services.some(service => {
    const previous = previousById.get(service.id);
    if (!previous || !derivedReportServiceTypes.has(normalizeServiceType(previous.serviceType || ''))) return false;
    return serviceFinalizedValue(previous) === true && service.data.finalized !== true;
  });
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

function isServiceOnlyReport(report: ReportSummary) {
  return report.specialConditions?.serviceOnly === true;
}

function isDerivedServiceReport(report: ReportSummary) {
  return derivedServiceReportTypes.has(report.reportType)
    && report.specialConditions?.serviceOnly !== true
    && typeof report.specialConditions?.parentRdoId === 'string'
    && Boolean(report.specialConditions.parentRdoId);
}

function canEditDerivedServiceReport(report: ReportSummary, user?: AuthUser | null) {
  return canReviewRdoReports(user)
    && isDerivedServiceReport(report)
    && report.status !== 'SIGNED'
    && report.parentRdoStatus === 'SIGNED';
}

function reportAcceptsOvertime(report: ReportSummary) {
  return asRecord(report.specialConditions).overtimeAccepted !== false;
}

function minutesValue(value: unknown) {
  const minutes = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(minutes) && minutes > 0 ? minutes : 0;
}

function overtimeMinutesFromReport(report: ReportSummary) {
  const overtimeSummary = asRecord(asRecord(report.specialConditions).overtimeSummary);
  const daytime = minutesValue(report.daytimeOvertimeMinutes ?? overtimeSummary.daytimeOvertimeMinutes);
  const nighttime = minutesValue(report.nighttimeOvertimeMinutes ?? overtimeSummary.nighttimeOvertimeMinutes);
  const total = minutesValue(report.totalOvertimeMinutes ?? overtimeSummary.totalOvertimeMinutes) || daytime + nighttime;
  return { daytime, nighttime, total };
}

function asUploadedFiles(value: unknown): UploadedFile[] {
  return Array.isArray(value)
    ? value
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
      .map(item => {
        const url = getString(item.url)
          || getString(item.path)
          || getString(item.storagePath)
          || getString(item.dataUrl)
          || getString(item.source)
          || getString(item.src)
          || getString(item.href)
          || getString(item.publicUrl)
          || getString(item.fileName);
        return {
          label: getString(item.label) || 'Arquivo',
          fileName: getString(item.fileName) || getString(item.name) || url || 'arquivo',
          mimeType: getString(item.mimeType) || getString(item.type) || 'image/jpeg',
          url: normalizeLocalUploadUrl(url)
        };
      })
      .filter((item): item is UploadedFile => Boolean(item.url))
    : [];
}

function serviceId() {
  return `svc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function asDdsThemeSnapshots(value: unknown): { id: string; name: string; custom?: boolean }[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
    .map(item => ({ id: getString(item.id), name: getString(item.name), ...(item.custom === true ? { custom: true } : {}) }))
    .filter(item => item.id && item.name);
}

function reportToForm(report: ReportSummary): RdoFormState {
  const specialConditions = asRecord(report.specialConditions);
  const standbyDetails = asRecord(specialConditions.standbyDetails);
  const noturnoDetails = asRecord(specialConditions.noturnoDetails);
  const dds = asRecord(specialConditions.dds);
  const ddsDiurno = asRecord(dds.diurno);
  const ddsNoturno = asRecord(dds.noturno);
  const serviceOnly = isServiceOnlyReport(report);
  const serviceReportMode = serviceOnly || isDerivedServiceReport(report);
  const serviceData = asRecord(specialConditions.serviceData);
  const nightCollaboratorIds = Array.isArray(noturnoDetails.collaboratorIds)
    ? noturnoDetails.collaboratorIds.filter((id): id is string => typeof id === 'string')
    : [];

  return {
    projectId: report.projectId,
    sequenceNumber: report.sequenceNumber ? String(report.sequenceNumber) : '',
    reportDate: toDateInput(report.reportDate),
    workLocation: getString(specialConditions.workLocation) || (projectWorkLocations(report.project).length <= 1 ? report.project.location || '' : ''),
    arrivalTime: report.arrivalTime || '',
    departureTime: report.departureTime || '',
    lunchBreak: report.lunchBreak || '',
    serviceEquipment: reportServiceField(report, ['Equipamento', 'Equipamento(s)']),
    serviceSystem: reportServiceField(report, ['Sistema']),
    collaboratorIds: (report.collaborators || []).map(link => link.collaboratorId).filter(Boolean),
    nightCollaboratorIds,
    standby: Boolean(specialConditions.standby),
    standbyDuration: getString(standbyDetails.total),
    standbyMotivo: getString(standbyDetails.motivo),
    noturno: Boolean(specialConditions.noturno || noturnoDetails.enabled || nightCollaboratorIds.length),
    noturnoStart: getString(noturnoDetails.inicio),
    noturnoEnd: getString(noturnoDetails.termino),
    noturnoInterval: getString(noturnoDetails.intervalo) || getString(noturnoDetails.jantaIntervalo) || '01:00:00',
    ddsDay: Boolean(ddsDiurno.enabled),
    ddsDayStart: getString(ddsDiurno.inicio),
    ddsDayEnd: getString(ddsDiurno.termino),
    ddsDayThemes: asDdsThemeSnapshots(ddsDiurno.temas),
    ddsNight: Boolean(ddsNoturno.enabled),
    ddsNightStart: getString(ddsNoturno.inicio),
    ddsNightEnd: getString(ddsNoturno.termino),
    ddsNightThemes: asDdsThemeSnapshots(ddsNoturno.temas),
    overtimeReason: report.overtimeReason || '',
    dailyDescription: report.dailyDescription || '',
    generalUploads: asUploadedFiles(specialConditions.generalUploads),
    services: (report.services || []).map(service => {
      const serviceForForm = serviceReportMode
        ? {
            ...service,
            extraData: {
              ...(service.extraData || {}),
              ...serviceData
            }
          }
        : service;
      return {
        id: service.id || serviceId(),
        type: service.serviceType,
        data: legacyServiceData(serviceForForm)
      };
    })
  };
}

function buildPayload(
  report: ReportSummary,
  form: RdoFormState,
  resources: {
    collaborators: Collaborator[] | undefined;
    equipment: Equipment[] | undefined;
    units: Unit[] | undefined;
  },
  options: {
    acceptOvertime?: boolean;
  } = {}
): Omit<ReportPayload, 'createdByUserId' | 'status'> {
  const serviceOnly = isServiceOnlyReport(report);
  const derivedServiceReport = isDerivedServiceReport(report);
  const serviceReportMode = serviceOnly || derivedServiceReport;
  const manualReport = isManualUploadedReport(report);
  const firstService = form.services[0];
  const effectiveArrivalTime = serviceReportMode ? getString(firstService?.data.startTime) || form.arrivalTime || '00:00' : form.arrivalTime;
  const effectiveDepartureTime = serviceReportMode ? getString(firstService?.data.endTime) || form.departureTime || '00:00' : form.departureTime;
  const effectiveLunchBreak = serviceReportMode ? '00:00:00' : form.lunchBreak;
  const overtimeAccepted = options.acceptOvertime !== false;
  const manualServiceData = manualServiceDataFromForm(report, form);
  const services = form.services.map(service => {
    const explicitServiceCollaborators = Object.prototype.hasOwnProperty.call(service.data, 'serviceCollaboratorIds');
    return buildReportServicePayload(serviceReportMode ? { ...service, data: { ...service.data, finalized: true, aprovadoCliente: 'Sim' } } : service, {
      collaboratorIds: manualReport
        ? []
        : explicitServiceCollaborators && Array.isArray(service.data.serviceCollaboratorIds)
        ? service.data.serviceCollaboratorIds.filter((id): id is string => typeof id === 'string')
        : serviceReportMode ? form.collaboratorIds : Array.from(new Set([...form.collaboratorIds, ...form.nightCollaboratorIds])),
      collaborators: resources.collaborators || [],
      equipment: resources.equipment || [],
      units: resources.units || []
    });
  });

  return {
    projectId: form.projectId || report.projectId,
    reportType: report.reportType,
    sequenceNumber: toPositiveInteger(form.sequenceNumber),
    reportDate: form.reportDate,
    arrivalTime: effectiveArrivalTime,
    departureTime: effectiveDepartureTime,
    lunchBreak: effectiveLunchBreak,
    daytimeCount: manualReport ? 0 : form.collaboratorIds.length,
    overtimeReason: form.overtimeReason || null,
    dailyDescription: form.dailyDescription || null,
    specialConditions: serviceOnly
      ? {
          ...asRecord(report.specialConditions),
          ...manualServiceData
        }
      : derivedServiceReport
      ? {
          ...asRecord(report.specialConditions),
          serviceData: asRecord(services[0]?.extraData)
        }
      : {
          ...asRecord(report.specialConditions),
          ...manualServiceData,
          workLocation: form.workLocation,
          standby: form.standby,
          noturno: form.noturno,
          standbyDetails: {
            total: form.standbyDuration,
            motivo: form.standbyMotivo
          },
          generalUploads: form.generalUploads,
          overtimeAccepted,
          noturnoDetails: {
            enabled: form.noturno,
            inicio: form.noturnoStart,
            termino: form.noturnoEnd,
            intervalo: form.noturnoInterval || getString(asRecord(asRecord(report.specialConditions).noturnoDetails).intervalo) || '01:00:00',
            collaboratorIds: manualReport ? [] : form.nightCollaboratorIds,
            colaboradores: (manualReport ? [] : form.nightCollaboratorIds)
              .map(id => resources.collaborators?.find(collaborator => collaborator.id === id)?.name || id)
          },
          // Sempre sobrescrito por inteiro: o spread de specialConditions acima não pode ressuscitar um bloco antigo.
          dds: {
            diurno: {
              enabled: form.ddsDay,
              inicio: form.ddsDayStart,
              termino: form.ddsDayEnd,
              temas: form.ddsDayThemes
            },
            noturno: {
              enabled: form.noturno && form.ddsNight,
              inicio: form.ddsNightStart,
              termino: form.ddsNightEnd,
              temas: form.ddsNightThemes
            }
          }
        },
    collaboratorIds: manualReport ? [] : form.collaboratorIds,
    services
  };
}

function ManagerRdoEditor({ report }: { report: ReportSummary }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const reportBackPath = backPathFromState(location.state, roleHomePath(user?.role));
  const reportBackState = pageScrollRestoreStateFromNavigation(location.state);
  const bootstrapQuery = useReportDetailBootstrap(report.id);
  const reportMutations = useReportMutations();
  const { confirm, confirmDialog } = useConfirmDialog();
  const showToast = useToast();
  const [form, setForm] = useState<RdoFormState>(() => reportToForm(report));
  const [invalidFinalizationServiceId, setInvalidFinalizationServiceId] = useState<string | null>(null);
  const [invalidSystemTypeServiceId, setInvalidSystemTypeServiceId] = useState<string | null>(null);
  const [returnDialogOpen, setReturnDialogOpen] = useState(false);
  const [reissueOpen, setReissueOpen] = useState(false);
  const [showServiceModal, setShowServiceModal] = useState(false);
  const [derivedDeletionPromptOpen, setDerivedDeletionPromptOpen] = useState(false);
  const [acceptOvertime, setAcceptOvertime] = useState(() => reportAcceptsOvertime(report));
  const currentReportIdRef = useRef(report.id);
  const derivedDeletionResolverRef = useRef<((deleteReports: boolean | null) => void) | null>(null);
  const readOnly = report.status === 'SIGNED';
  const serviceOnly = isServiceOnlyReport(report);
  const derivedServiceReport = isDerivedServiceReport(report);
  const serviceReportMode = serviceOnly || derivedServiceReport;
  const manualReport = isManualUploadedReport(report);
  const manualServiceReport = manualReport && report.reportType !== 'RDO';
  const operationalMode = reportEditorOperationalMode({ manualReport, serviceOnly, derivedServiceReport });
  const canReview = canReviewRdoReports(user);
  const canEditSequence = canReview && !readOnly && !manualReport;
  const canApproveInEditor = report.status === 'PENDING' || report.status === 'RETURNED' || hasActiveClientRejection(report);

  async function handleReissue() {
    const result = await reportMutations.regenerateReports.mutateAsync({ ids: [report.id] });
    setReissueOpen(false);
    showToast(reportRegenerationMessage(result), result.errors.length || result.warnings.length ? 'error' : 'success');
  }

  useEffect(() => {
    setForm(reportToForm(report));
    // Descarta exclusões de fotos encenadas e não salvas ao (re)carregar o relatório.
    clearStagedUploadDeletions();
    if (currentReportIdRef.current !== report.id) {
      currentReportIdRef.current = report.id;
      setAcceptOvertime(reportAcceptsOvertime(report));
    }
  }, [report]);

  const projects = useMemo(() => sortProjects(bootstrapQuery.data?.projects || [], 'asc'), [bootstrapQuery.data?.projects]);
  const selectedProject = projects.find(project => project.id === (form.projectId || report.projectId))
    || (form.projectId === report.projectId ? report.project : null);
  const isCollaboratorRdo = user?.role === 'COLLABORATOR' && report.reportType === 'RDO';
  const holidayQuery = useReportWorkforceAvailability({
    reportDate: form.reportDate,
    collaboratorIds: form.collaboratorIds,
    enabled: isCollaboratorRdo && !manualReport && !serviceReportMode
  });
  const collaboratorOvertimeSummary = isCollaboratorRdo
    ? calculateReportOvertimeSummary({
        policy: selectedProject,
        reportDate: form.reportDate,
        arrivalTime: form.arrivalTime,
        departureTime: form.departureTime,
        lunchBreak: form.lunchBreak,
        nightEnabled: form.noturno,
        nightArrivalTime: form.noturnoStart,
        nightDepartureTime: form.noturnoEnd,
        nightBreak: form.noturnoInterval,
        isHoliday: Boolean(holidayQuery.data?.holidays?.some(holiday => holiday.date === form.reportDate))
      })
    : null;
  const showOvertimeReason = !collaboratorOvertimeSummary || collaboratorOvertimeSummary.totalOvertimeMinutes > 0;
  const scopeOptions = projectScopeOptions(selectedProject);
  const workLocations = projectWorkLocations(selectedProject);
  const [invalidScopeServiceId, setInvalidScopeServiceId] = useState<string | null>(null);
  const [invalidWorkLocation, setInvalidWorkLocation] = useState(false);
  const projectLeaderHint = selectedProject?.operator?.name
    ? `Líder do projeto: ${selectedProject.operator.name}`
    : 'Projeto sem líder definido.';
  const parsedSequenceNumber = toPositiveInteger(form.sequenceNumber);
  const sequenceConflict = useMemo(() => {
    if (!form.projectId || !parsedSequenceNumber) return null;
    return (bootstrapQuery.data?.sequenceReports || []).find(item => (
      item.id !== report.id
      && item.projectId === form.projectId
      && item.reportType === report.reportType
      && Number(item.sequenceNumber) === parsedSequenceNumber
    )) || null;
  }, [bootstrapQuery.data?.sequenceReports, form.projectId, parsedSequenceNumber, report.id, report.reportType]);
  const sequenceHint = sequenceConflict
    ? `Número já usado no relatório ${sequenceConflict.reportType} ${sequenceConflict.sequenceNumber}.`
    : 'Usado para manter a sequência do projeto e dos relatórios derivados.';
  const serviceOptions = useMemo(() => {
    const allowed = serviceReportMode
      ? serviceTypeModalOptions.filter(option => serviceOnlySupportedTypes.has(option.type))
      : serviceTypeModalOptions;
    return allowed.filter(option => option.type !== 'inibicao' || selectedProject?.inhibitionServiceEnabled === true);
  }, [serviceReportMode, selectedProject?.inhibitionServiceEnabled]);
  const selectedCollaboratorIds = useMemo(
    () => new Set(serviceReportMode && !manualReport ? form.collaboratorIds : [...form.collaboratorIds, ...form.nightCollaboratorIds]),
    [manualReport, serviceReportMode, form.collaboratorIds, form.nightCollaboratorIds]
  );
  const collaborators = (bootstrapQuery.data?.collaborators || []).filter(item => manualReport || item.isActive || selectedCollaboratorIds.has(item.id));
  const serviceCollaboratorOptions = useMemo(() => {
    if (manualReport) return [];
    const ids = serviceReportMode ? form.collaboratorIds : Array.from(new Set([...form.collaboratorIds, ...form.nightCollaboratorIds]));
    return ids
      .map(id => {
        const collaborator = collaborators.find(item => item.id === id);
        return collaborator ? { id: collaborator.id, name: collaborator.name } : null;
      })
      .filter((item): item is { id: string; name: string } => Boolean(item));
  }, [manualReport, serviceReportMode, form.collaboratorIds, form.nightCollaboratorIds, collaborators]);
  const equipment = bootstrapQuery.data?.equipment || [];
  const units = bootstrapQuery.data?.units || [];
  const manometers = bootstrapQuery.data?.manometers || [];
  const counters = bootstrapQuery.data?.counters || [];
  const equipments = bootstrapQuery.data?.equipments || [];
  const rdoSlotMap = bootstrapQuery.data?.rdoSlotMap;
  const inhibitionOptions = bootstrapQuery.data?.inhibitionOptions;
  const overtimeApproval = overtimeMinutesFromReport(report);
  const showOvertimeApproval = canReview && canApproveInEditor && !serviceReportMode && overtimeApproval.total > 0;
  const showDdsFields = report.reportType === 'RDO' && !manualReport && !serviceReportMode;
  const ddsThemesQuery = useQuery({ queryKey: ['dds-themes'], queryFn: () => listDdsThemes(), enabled: showDdsFields, staleTime: 60_000 });
  const continuityProjectId = form.projectId || report.projectId;
  const showServiceContinuity = !readOnly && !serviceReportMode && !manualReport && report.reportType === 'RDO';
  const projectHistoryQuery = useQuery({
    queryKey: ['reports', 'last-project', continuityProjectId],
    queryFn: () => listReports({ projectId: continuityProjectId, summary: true }),
    enabled: showServiceContinuity && !!continuityProjectId,
    staleTime: 30_000
  });
  const pendingProjectServices = useMemo(() => {
    if (!showServiceContinuity || !continuityProjectId) return [];
    const otherReports = (projectHistoryQuery.data || []).filter(item => (
      item.id !== report.id && item.reportType === 'RDO' && item.projectId === continuityProjectId
      && !item.deletedAt
    ));
    return pendingProjectServicesForDate(otherReports, form.reportDate || report.reportDate, canReview);
  }, [canReview, continuityProjectId, form.reportDate, projectHistoryQuery.data, report.id, report.reportDate, showServiceContinuity]);
  const visiblePendingProjectServices = useMemo(() => {
    const activeKeys = new Set(form.services.flatMap(service => formServiceOngoingKeys(service.data || {})));
    return pendingProjectServices.filter(item => !activeKeys.has(item.key));
  }, [form.services, pendingProjectServices]);

  function linkCustomDdsTheme(theme: { id: string; name: string }) {
    const replace = (list: RdoFormState['ddsDayThemes']) => list.map(item => (
      item.custom && item.name.trim().toLowerCase() === theme.name.trim().toLowerCase()
        ? { id: theme.id, name: theme.name }
        : item
    ));
    setForm(current => ({
      ...current,
      ddsDayThemes: replace(current.ddsDayThemes),
      ddsNightThemes: replace(current.ddsNightThemes)
    }));
  }
  const manualOperationalFormValue: ManualReportOperationalFieldsValue = {
    arrivalTime: form.arrivalTime,
    departureTime: form.departureTime,
    lunchBreak: form.lunchBreak || '01:00:00',
    collaboratorIds: form.collaboratorIds,
    noturno: form.noturno,
    noturnoStart: form.noturnoStart,
    noturnoEnd: form.noturnoEnd,
    noturnoInterval: form.noturnoInterval || '01:00:00',
    noturnoCollaboratorIds: form.nightCollaboratorIds,
    standby: form.standby,
    standbyDuration: form.standbyDuration,
    standbyMotivo: form.standbyMotivo,
    ddsDay: form.ddsDay,
    ddsDayStart: form.ddsDayStart,
    ddsDayEnd: form.ddsDayEnd,
    ddsDayThemes: form.ddsDayThemes,
    ddsNight: form.ddsNight,
    ddsNightStart: form.ddsNightStart,
    ddsNightEnd: form.ddsNightEnd,
    ddsNightThemes: form.ddsNightThemes
  };

  function setField<K extends keyof RdoFormState>(field: K, value: RdoFormState[K]) {
    setForm(current => ({ ...current, [field]: value }));
  }

  function updateManualOperationalFields(patch: Partial<ManualReportOperationalFieldsValue>) {
    const { noturnoCollaboratorIds, ...rest } = patch;
    setForm(current => ({
      ...current,
      ...rest,
      ...(noturnoCollaboratorIds !== undefined ? { nightCollaboratorIds: noturnoCollaboratorIds } : {})
    }));
  }

  async function handleManualInlineSave(options: { navigateAfter?: boolean; showSuccess?: boolean } = {}) {
    const validationMessage = validateManualReportOperationalFields(manualOperationalFormValue, { reportType: report.reportType });
    if (validationMessage) {
      showToast(validationMessage, 'error');
      return false;
    }
    if (!form.reportDate) {
      showToast('Informe a data do relatório.', 'error');
      return false;
    }

    const { navigateAfter = false, showSuccess = true } = options;
    try {
      await reportMutations.updateManualReportData.mutateAsync({
        id: report.id,
        payload: buildManualReportOperationalData(manualOperationalFormValue, report.reportType, {
          reportDate: form.reportDate,
          includeStandbyClear: true
        }) || {}
      });
      if (showSuccess) showToast(TEXT.saved, 'success');
      if (navigateAfter) navigate(reportBackPath, { replace: true, state: reportBackState });
      return true;
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Não foi possível atualizar os dados operacionais.', 'error');
      return false;
    }
  }

  function addService(type = 'limpeza', data: Record<string, unknown> = {}) {
    if (manualReport) return;
    const id = serviceId();
    setForm(current => ({
      ...current,
      services: [...current.services, { id, type, data }]
    }));
    setShowServiceModal(false);
    window.setTimeout(() => {
      document.querySelector(`[data-service-id="${id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 80);
  }

  function continueService(service: NonNullable<ReportSummary['services']>[number], ongoingKey: string) {
    addService(normalizeServiceType(service.serviceType || ''), buildContinuedServiceData(service, ongoingKey, legacyServiceData(service)));
  }

  async function handleDeletePendingService(sourceReport: ReportSummary, service: NonNullable<ReportSummary['services']>[number]) {
    if (user?.role !== 'MANAGER') return;
    const confirmed = await confirm({
      title: 'Excluir serviço em andamento?',
      description: 'O serviço é removido do RDO de origem e deixa de aparecer como pendente para todos os usuários do projeto.',
      highlight: `${serviceTypeLabels[normalizeServiceType(service.serviceType || '')] || service.serviceType} · RDO ${sourceReport.sequenceNumber || '---'}`,
      confirmLabel: 'Excluir serviço'
    });
    if (!confirmed) return;
    try {
      await reportMutations.deleteService.mutateAsync({ reportId: sourceReport.id, serviceId: service.id });
      showToast('Serviço excluído.', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Não foi possível excluir o serviço.', 'error');
    }
  }

  function updateService(id: string, data: Partial<RdoServiceForm>) {
    if (id === invalidFinalizationServiceId && typeof data.data?.finalized === 'boolean') setInvalidFinalizationServiceId(null);
    if (id === invalidSystemTypeServiceId && (data.data?.tipoSistema !== undefined || data.data?.limpezaTubulacao !== undefined || data.data?.flushingTubulacao !== undefined)) {
      setInvalidSystemTypeServiceId(null);
    }
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
    if (id === invalidFinalizationServiceId) setInvalidFinalizationServiceId(null);
    if (id === invalidSystemTypeServiceId) setInvalidSystemTypeServiceId(null);
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

  function requestDerivedDeletionChoice() {
    return new Promise<boolean | null>(resolve => {
      derivedDeletionResolverRef.current = resolve;
      setDerivedDeletionPromptOpen(true);
    });
  }

  function resolveDerivedDeletionPrompt(deleteReports: boolean | null) {
    setDerivedDeletionPromptOpen(false);
    const resolve = derivedDeletionResolverRef.current;
    derivedDeletionResolverRef.current = null;
    resolve?.(deleteReports);
  }

  async function handleSave(options: { navigateAfter?: boolean; showSuccess?: boolean } = {}) {
    if (readOnly) return false;
    if (manualReport) return handleManualInlineSave(options);
    if (report.reportType === 'RDO') {
      if (workLocations.length > 1 && !workLocations.includes(form.workLocation)) {
        setInvalidWorkLocation(true);
        showToast('Selecione o local da obra.', 'error');
        document.getElementById('rdo-work-location')?.focus();
        return false;
      }
      const missingScope = scopeOptions.length > 1 ? form.services.find(service => !scopeOptions.some(option => option.value === service.data.__scopeKey)) : null;
      if (missingScope) {
        setInvalidScopeServiceId(missingScope.id);
        showToast('Selecione o escopo de cada serviço.', 'error');
        document.getElementById(`service-scope-${missingScope.id}`)?.focus();
        return false;
      }
    }
    const missingServiceTime = firstMissingRequiredServiceTime(form.services);
    if (missingServiceTime) {
      const label = missingServiceTime.field === 'startTime' ? 'hora de início' : 'hora de término/pausa';
      showToast(`Informe a ${label} do serviço ${missingServiceTime.serviceIndex + 1}.`, 'error');
      return false;
    }
    const missingSystemTypeIndex = form.services.findIndex(service => {
      const value = systemTypeValue(service.data);
      return requiresSystemType(normalizeServiceType(service.type), service.data)
        && !(typeof value === 'string' && value.trim());
    });
    if (missingSystemTypeIndex >= 0) {
      const serviceId = form.services[missingSystemTypeIndex].id;
      setInvalidSystemTypeServiceId(serviceId);
      showToast(`Informe o tipo de sistema do serviço ${missingSystemTypeIndex + 1}.`, 'error');
      window.setTimeout(() => document.getElementById(`svc-${serviceId}-tipoSistema`)?.focus(), 120);
      return false;
    }
    setInvalidSystemTypeServiceId(null);
    if (!serviceReportMode) {
      const missingFinalizationIndex = form.services.findIndex(service => typeof service.data.finalized !== 'boolean');
      if (missingFinalizationIndex >= 0) {
        const serviceId = form.services[missingFinalizationIndex].id;
        setInvalidFinalizationServiceId(serviceId);
        showToast(`Selecione se o serviço ${missingFinalizationIndex + 1} foi finalizado.`, 'error');
        window.setTimeout(() => {
          const input = Array.from(document.querySelectorAll<HTMLInputElement>('[data-invalid-target]'))
            .find(element => element.dataset.invalidTarget === `${serviceId}:finalized`);
          (input?.closest('.service-finalized-field') || input)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
          input?.focus({ preventScroll: true });
        }, 120);
        return false;
      }
    }
    setInvalidFinalizationServiceId(null);
    if (!validateSequence()) return false;
    if (showDdsFields) {
      if (form.ddsDay && (!form.ddsDayStart.trim() || !form.ddsDayEnd.trim())) {
        showToast('Informe início e término do DDS.', 'error');
        return false;
      }
      if (form.ddsDay && !form.ddsDayThemes.length) {
        showToast('Adicione ao menos um tema do DDS.', 'error');
        return false;
      }
      if (form.noturno && form.ddsNight && (!form.ddsNightStart.trim() || !form.ddsNightEnd.trim())) {
        showToast('Informe início e término do DDS noturno.', 'error');
        return false;
      }
      if (form.noturno && form.ddsNight && !form.ddsNightThemes.length) {
        showToast('Adicione ao menos um tema do DDS noturno.', 'error');
        return false;
      }
    }

    const { navigateAfter = false, showSuccess = true } = options;

    try {
      const shouldAskDerivedDeletion = hasFinalizedServiceDemotion(report, form);
      const deleteUnfinalizedDerivedReports = shouldAskDerivedDeletion
        ? await requestDerivedDeletionChoice()
        : false;
      if (deleteUnfinalizedDerivedReports === null) return false;
      const payload = buildPayload(report, form, {
        collaborators,
        equipment,
        units
      }, {
        acceptOvertime
      });
      if (shouldAskDerivedDeletion) {
        payload.deleteUnfinalizedDerivedReports = deleteUnfinalizedDerivedReports;
      }

      await reportMutations.updateReport.mutateAsync({
        id: report.id,
        payload
      });
      // Relatório salvo: efetiva a exclusão global das fotos removidas no editor.
      await flushStagedUploadDeletions();
      if (showSuccess) showToast(TEXT.saved, 'success');
      if (navigateAfter) navigate(reportBackPath, { replace: true, state: reportBackState });
      return true;
    } catch (err) {
      showToast(err instanceof Error ? err.message : TEXT.updateError, 'error');
      return false;
    }
  }

  async function handleStatus(status: Extract<ReportStatus, 'APPROVED' | 'RETURNED'>, reviewNotes?: string | null) {
    if (readOnly) return false;

    try {
      await reportMutations.updateStatus.mutateAsync({
        id: report.id,
        payload: {
          status,
          reviewNotes,
          ...(status === 'APPROVED' ? { acceptOvertime } : {})
        }
      });
      if (status === 'RETURNED') setReturnDialogOpen(false);
      showToast(status === 'APPROVED' ? 'Relatório aprovado.' : 'Relatório devolvido.', 'success');
      return true;
    } catch (err) {
      showToast(err instanceof Error ? err.message : TEXT.updateError, 'error');
      return false;
    }
  }

  async function handleSaveAndStatus(status: Extract<ReportStatus, 'APPROVED' | 'RETURNED'>, reviewNotes?: string | null) {
    const saved = await handleSave({ navigateAfter: false, showSuccess: false });
    if (!saved) return;
    const updated = await handleStatus(status, reviewNotes);
    if (updated && status === 'APPROVED' && canReview) {
      navigate(reportBackPath, { replace: true, state: reportBackState });
    }
  }

  async function handleDownload(format: 'pdf' | 'docx') {
    showToast(format === 'pdf' ? 'Gerando PDF...' : 'Gerando DOCX...', 'info');
    try {
      const blob = format === 'pdf' ? await downloadReportPdf(report.id) : await downloadReportDocx(report.id);
      downloadBlob(blob, reportDownloadFileName(report, format));
      showToast(format === 'pdf' ? 'PDF gerado com sucesso.' : 'DOCX baixado com sucesso.', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : TEXT.downloadError, 'error');
    }
  }

  return (
    <div className="rdo-form-stage rdo-edit-form">
      {readOnly ? <Alert tone="warning">{TEXT.signedLocked}</Alert> : null}

      <Card className="rdo-form-card rdo-form-card--identification" title={TEXT.generalInfo}>
        <div className="rdo-field-grid rdo-field-grid--identification rdo-edit-general-grid">
          <div className="field-group">
            <label htmlFor="rdo-project">{TEXT.project}</label>
            <Select
              id="rdo-project"
              value={form.projectId || ''}
              disabled={readOnly || derivedServiceReport || manualReport}
              onChange={event => {
                const nextProjectId = event.target.value || null;
                const locations = projectWorkLocations(projects.find(project => project.id === nextProjectId));
                setForm(current => ({ ...current, projectId: nextProjectId, workLocation: locations.length === 1 ? locations[0] : '',
                  services: current.services.map(service => ({ ...service, data: { ...service.data, __scopeKey: '', __scopeName: null } })) }));
                setInvalidWorkLocation(false);
                setInvalidScopeServiceId(null);
              }}
              required
            >
              <option value="">{TEXT.select}</option>
              {projects.map(project => (
                <option key={project.id} value={project.id}>
                  {project.code} - {project.name}
                </option>
              ))}
            </Select>
            <span className="placeholder-copy rdo-edit-field-hint">{projectLeaderHint}</span>
          </div>
          <div className="field-group">
            <label htmlFor="rdo-sequence">Número do relatório</label>
            <Input
              id="rdo-sequence"
              type="number"
              min={1}
              step={1}
              value={form.sequenceNumber}
              disabled={!canEditSequence}
              onChange={event => setField('sequenceNumber', event.target.value)}
              required
            />
            {canReview ? (
              <span
                className={sequenceConflict ? 'inline-error' : 'placeholder-copy'}
              >
                {sequenceHint}
              </span>
            ) : null}
          </div>
          <div className="field-group">
            <label htmlFor="rdo-date">Data do relatório</label>
            <Input
              id="rdo-date"
              type="date"
              value={form.reportDate}
              disabled={readOnly}
              onChange={event => setField('reportDate', event.target.value)}
              required
            />
          </div>
          {report.reportType === 'RDO' ? <ReportWorkLocationField locations={workLocations} value={form.workLocation}
            disabled={readOnly || manualReport} invalid={invalidWorkLocation}
            onChange={value => { setField('workLocation', value); setInvalidWorkLocation(false); }} /> : null}
          {manualServiceReport ? (
            <>
              <div className="field-group">
                <label htmlFor="manual-service-equipment">Equipamento</label>
                <Input
                  id="manual-service-equipment"
                  value={form.serviceEquipment}
                  disabled
                  placeholder="Equipamento do cliente"
                  onChange={event => setField('serviceEquipment', event.target.value)}
                />
              </div>
              <div className="field-group">
                <label htmlFor="manual-service-system">Sistema</label>
                <Input
                  id="manual-service-system"
                  value={form.serviceSystem}
                  disabled
                  placeholder="Sistema do serviço"
                  onChange={event => setField('serviceSystem', event.target.value)}
                />
              </div>
            </>
          ) : null}
        </div>
      </Card>

      {operationalMode !== 'hidden' ? (
        <Card
          className="rdo-form-card rdo-edit-operational-card"
          title={operationalMode === 'team-only' ? 'Equipe' : 'Horários e equipe'}
        >
          <ManualReportOperationalFields
            value={manualOperationalFormValue}
            collaborators={collaborators}
            ddsThemes={ddsThemesQuery.data || []}
            disabled={readOnly}
            includeInactiveCollaborators={manualReport}
            embedded
            showTimes={operationalMode === 'full'}
            showNightShift={operationalMode === 'full'}
            showStandby={operationalMode === 'full' && report.reportType === 'RDO'}
            showDds={operationalMode === 'full' && showDdsFields}
            summaryLabel={operationalMode === 'team-only' ? 'Equipe do relatório' : undefined}
            teamLabel={operationalMode === 'team-only' ? 'Colaboradores' : undefined}
            ddsAlert={
              <DdsCustomThemeReviewAlert
                dayThemes={form.ddsDayThemes}
                nightThemes={form.ddsNightThemes}
                officialThemes={ddsThemesQuery.data || []}
                canRegister={user?.role === 'MANAGER' || user?.role === 'COORDINATOR'}
                readOnly={readOnly}
                onLinkTheme={linkCustomDdsTheme}
              />
            }
            onChange={updateManualOperationalFields}
          />
        </Card>
      ) : null}

      {showServiceContinuity && visiblePendingProjectServices.length > 0 ? (
        <Card className="rdo-form-card continuity-card" title="Serviços em andamento">
          <p className="placeholder-copy">Serviços não finalizados deste projeto que ainda não foram continuados neste relatório.</p>
          <div className="admin-list">
            {visiblePendingProjectServices.map(item => {
              const { key, report: sourceReport, service, startedReport } = item;
              const startedLater = isPendingServiceFromLaterDay(item, form.reportDate || report.reportDate);
              const type = normalizeServiceType(service.serviceType || '');
              const equipment = serviceEquipmentLabel(service) || 'Equipamento não informado';
              const system = service.system || getString((service.extraData || {}).Sistema);
              return <article className={`ongoing-item-react${startedLater ? ' ongoing-item-react--future' : ''}`} key={`${sourceReport.id}-${service.id}`}>
                <div className="admin-item-row">
                  <div className="admin-item-main">
                    <strong>{serviceTypeLabels[type] || type}</strong>
                    <p>{equipment}{system ? ` · ${system}` : ''} · RDO {sourceReport.sequenceNumber || '---'}</p>
                    {startedLater ? <p className="ongoing-future-note">Iniciado em dia posterior: {formatDateOnlyPtBr(startedReport.reportDate)} (RDO {startedReport.sequenceNumber || '---'}).</p> : null}
                  </div>
                  <div className="admin-card-actions">
                    <Button variant="secondary" size="sm" type="button" onClick={() => continueService(service, key)}>Continuar</Button>
                    {user?.role === 'MANAGER' ? <Button variant="danger" size="sm" type="button"
                      disabled={reportMutations.deleteService.isPending}
                      onClick={() => void handleDeletePendingService(sourceReport, service)}>Excluir</Button> : null}
                  </div>
                </div>
              </article>;
            })}
          </div>
          {visiblePendingProjectServices.length > 1 ? <Button variant="secondary" size="sm" type="button"
            onClick={() => visiblePendingProjectServices.forEach(({ service, key }) => continueService(service, key))}>Continuar todos</Button> : null}
        </Card>
      ) : null}

      <section className="report-services-step" aria-label={TEXT.services}>
        <h2 className="rdo-services-title">{TEXT.services}</h2>
        {form.services.length ? (
          <div className="admin-stack">
            {form.services.map((service, index) => (
              <Card
                className="rdo-service-card"
                key={service.id}
                data-service-id={service.id}
                title={
                  <div className="svc-card-title">
                    <span>{serviceTypeLabels[normalizeServiceType(service.type)] || service.type}</span>
                    <Badge tone="brand">{TEXT.service} {index + 1}</Badge>
                  </div>
                }
                actions={!readOnly && !serviceReportMode && !manualReport ? (
                  <RemoveIconButton
                    label={`Remover serviço ${index + 1}`}
                    onClick={() => removeService(service.id)}
                  />
                ) : undefined}
              >
                <div className="admin-form-grid">
                  {report.reportType === 'RDO' && !manualReport ? <ReportServiceScopeField options={scopeOptions} serviceId={service.id}
                    value={getString(service.data.__scopeKey)} disabled={readOnly} invalid={invalidScopeServiceId === service.id}
                    onChange={update => { updateService(service.id, { data: update }); setInvalidScopeServiceId(null); }} /> : null}
                  {normalizeServiceType(service.type) !== 'inibicao' ? (
                    <>
                      <section className="rdo-service-section" aria-label="Equipamento e sistema">
                        <h4 className="rdo-service-section__title">Equipamento e sistema</h4>
                        <div className="rdo-service-section__grid">
                          <div className="field-group">
                            <label htmlFor={`service-equipment-${service.id}`}>Equipamento(s)</label>
                            <ProjectSystemInput
                              projectId={form.projectId}
                              data={service.data}
                              serviceType={service.type}
                              field="equipmentId"
                              id={`service-equipment-${service.id}`}
                              disabled={readOnly || manualReport}
                              onChange={patch => updateService(service.id, { data: patch })}
                            />
                          </div>
                          <div className="field-group">
                            <label htmlFor={`service-system-${service.id}`}>Sistema</label>
                            <ProjectSystemInput
                              projectId={form.projectId}
                              data={service.data}
                              serviceType={service.type}
                              field="system"
                              id={`service-system-${service.id}`}
                              disabled={readOnly || manualReport}
                              onChange={patch => updateService(service.id, { data: patch })}
                            />
                          </div>
                        </div>
                      </section>
                      {!manualReport ? (
                        <section className="rdo-service-section" aria-label="Equipe do serviço">
                          <h4 className="rdo-service-section__title">Equipe do serviço</h4>
                          <div className="rdo-service-section__grid">
                            <ServiceCollaboratorsBlock
                              data={service.data}
                              onChange={update => updateService(service.id, { data: update })}
                              disabled={readOnly}
                              collaboratorOptions={serviceCollaboratorOptions}
                            />
                          </div>
                        </section>
                      ) : null}
                      <section className="rdo-service-section" aria-label="Horários do serviço">
                        <h4 className="rdo-service-section__title">Horários do serviço</h4>
                        <div className="rdo-service-section__grid">
                          <div className="fg-r2 service-time-grid">
                            <div className="field-group">
                              <label htmlFor={`service-start-${service.id}`}>Hora de início <span style={{ color: 'var(--rd)' }}>*</span></label>
                              <Input
                                id={`service-start-${service.id}`}
                                type="time"
                                required
                                value={getString(service.data.startTime)}
                                disabled={readOnly || manualReport}
                                onChange={event => updateService(service.id, { data: { startTime: event.target.value } })}
                              />
                            </div>
                            <div className="field-group">
                              <label htmlFor={`service-end-${service.id}`}>Hora de término/pausa <span style={{ color: 'var(--rd)' }}>*</span></label>
                              <Input
                                id={`service-end-${service.id}`}
                                type="time"
                                required
                                value={getString(service.data.endTime)}
                                disabled={readOnly || manualReport}
                                onChange={event => updateService(service.id, { data: { endTime: event.target.value } })}
                              />
                            </div>
                          </div>
                        </div>
                      </section>
                    </>
                  ) : null}
                  <ServiceFields
                    serviceType={service.type}
                    data={service.data}
                    onChange={update => updateService(service.id, { data: update })}
                    disabled={readOnly || manualReport}
                    units={units}
                    manometers={manometers}
                    counters={counters}
                    equipments={equipments}
                    rdoSlotMap={rdoSlotMap}
                    inhibitionOptions={inhibitionOptions}
                    collaboratorOptions={serviceCollaboratorOptions}
                    groupKey={service.id}
                    projectId={form.projectId}
                    invalidKey={invalidSystemTypeServiceId === service.id ? 'tipoSistema' : invalidFinalizationServiceId === service.id ? 'finalized' : null}
                    hideFinalization={serviceReportMode}
                    hideUploads={manualReport}
                    hideNotes={manualReport}
                    appearance="design-system"
                  />
                </div>
              </Card>
            ))}
          </div>
        ) : (
          <p className="placeholder-copy">{TEXT.noService}</p>
        )}
        {!readOnly && !serviceReportMode && !manualReport ? (
          <div className="admin-form-actions rdo-add-service-action">
            <Button
              variant="secondary"
              type="button"
              fullWidth
              iconLeft={<AppIcon icon={DS_ICONS.plus} size="sm" />}
              onClick={() => setShowServiceModal(true)}
            >
              {TEXT.addService}
            </Button>
          </div>
        ) : null}
      </section>

      {!serviceReportMode && !manualReport ? (
      <div className="rdo-form-grid rdo-form-grid--finalization rdo-edit-finalization">
        <Card className="rdo-form-card rdo-form-card--overtime" title="Horas extras" actions={showOvertimeApproval ? (
          <Switch
            containerClassName="overtime-review-toggle"
            label={acceptOvertime ? 'Aceitar hora extra' : 'Não aceitar hora extra'}
            checked={acceptOvertime}
            disabled={reportMutations.updateReport.isPending || reportMutations.updateStatus.isPending}
            onChange={event => setAcceptOvertime(event.target.checked)}
          />
        ) : undefined}>
          {collaboratorOvertimeSummary ? (
            <Alert
              tone={collaboratorOvertimeSummary.totalOvertimeMinutes > 0 ? 'warning' : 'info'}
              title={collaboratorOvertimeSummary.totalOvertimeMinutes > 0
                ? `Hora extra identificada: ${formatMinutes(collaboratorOvertimeSummary.totalOvertimeMinutes)}`
                : 'Nenhuma hora extra identificada'}
            />
          ) : null}
          {showOvertimeApproval ? (
            <div className="overtime-review-inline">
              <div className="overtime-review-main">
                <Alert tone="warning" title={`Hora extra identificada: ${formatMinutes(overtimeApproval.total)}`} />
              </div>
              {!acceptOvertime ? (
                <Alert tone="danger" className="overtime-review-warning">
                  A hora extra e a justificativa não serão exibidas no relatório aprovado.
                </Alert>
              ) : null}
            </div>
          ) : null}
          {showOvertimeReason ? (
            <div className="field-group">
              <label htmlFor="rdo-overtime">Motivo da hora extra</label>
              <Textarea
                id="rdo-overtime"
                rows={3}
                value={form.overtimeReason}
                disabled={readOnly || (showOvertimeApproval && !acceptOvertime)}
                onChange={event => setField('overtimeReason', event.target.value)}
              />
            </div>
          ) : null}
        </Card>

        <Card className="rdo-form-card rdo-form-card--activities" title="Atividades do dia">
          <div className="field-group">
            <label htmlFor="rdo-description">{TEXT.description}</label>
            <Textarea
              id="rdo-description"
              className="rdo-activities-textarea"
              rows={5}
              value={form.dailyDescription}
              disabled={readOnly}
              onChange={event => setField('dailyDescription', event.target.value)}
            />
          </div>
        </Card>

        <Card className="rdo-form-card rdo-form-card--photos" title="Fotos de registro">
          <div className="upload-final-note">
            Não é necessário adicionar novamente as fotos já adicionadas nos serviços na página anterior.
          </div>
          <UploadField
            label="Fotos de registro"
            value={form.generalUploads}
            projectId={form.projectId}
            disabled={readOnly}
            appearance="design-system"
            onChange={files => setField('generalUploads', files)}
          />
        </Card>
        <ReasonDialog
          open={returnDialogOpen}
          title={TEXT.reject}
          description={TEXT.rejectPrompt}
          label="Motivo"
          confirmLabel={TEXT.reject}
          requiredMessage={TEXT.rejectRequired}
          isSubmitting={reportMutations.updateReport.isPending || reportMutations.updateStatus.isPending}
          appearance="design-system"
          onCancel={() => setReturnDialogOpen(false)}
          onConfirm={reason => void handleSaveAndStatus('RETURNED', reason)}
        />
      </div>
      ) : null}

      {!readOnly ? (
        <section className="rdo-edit-actions" aria-label="Ações do formulário de edição">
          <Button
            variant="primary"
            type="button"
            loading={reportMutations.updateReport.isPending || reportMutations.updateManualReportData.isPending}
            loadingLabel="Salvando relatório"
            onClick={() => void handleSave()}
          >
            {TEXT.save}
          </Button>
          <Button variant="secondary" type="button" onClick={() => void handleDownload('pdf')}>
            PDF
          </Button>
          {canReview && !manualReport ? (
            <Button variant="secondary" type="button" onClick={() => void handleDownload('docx')}>
              DOCX
            </Button>
          ) : null}
          {user?.accountType === 'ADMIN' && canRegenerateReport(report) ? (
            <Button variant="secondary" type="button" loading={reportMutations.regenerateReports.isPending} onClick={() => setReissueOpen(true)}>Reemitir</Button>
          ) : null}
          {canReview && canApproveInEditor ? (
            <Button
              variant="primary"
              type="button"
              disabled={reportMutations.updateReport.isPending || reportMutations.updateStatus.isPending}
              onClick={() => void handleSaveAndStatus('APPROVED')}
            >
              {hasActiveClientRejection(report) ? 'Salvar e Reenviar' : 'Salvar e Aprovar'}
            </Button>
          ) : null}
          {canReview && !serviceReportMode && !manualReport ? (
            <Button
              variant="danger"
              type="button"
              disabled={reportMutations.updateReport.isPending || reportMutations.updateStatus.isPending}
              onClick={() => setReturnDialogOpen(true)}
            >
              Salvar e Devolver
            </Button>
          ) : null}
        </section>
      ) : null}

      <Modal
        open={derivedDeletionPromptOpen}
        onClose={() => resolveDerivedDeletionPrompt(null)}
        appearance="design-system"
        title="Excluir relatório de serviço?"
        size="sm"
        fullscreenOnMobile={false}
        ariaDescribedBy="derived-deletion-description"
        closeOnBackdrop={false}
        footer={
          <>
            <Button variant="secondary" onClick={() => resolveDerivedDeletionPrompt(null)}>
              Cancelar
            </Button>
            <Button variant="secondary" onClick={() => resolveDerivedDeletionPrompt(false)}>
              Manter
            </Button>
            <Button variant="danger" onClick={() => resolveDerivedDeletionPrompt(true)}>
              Excluir vinculados
            </Button>
          </>
        }
      >
        <p className="placeholder-copy" id="derived-deletion-description">
          Um ou mais serviços finalizados foram alterados para não finalizados. Deseja excluir os relatórios de serviço vinculados?
        </p>
      </Modal>

      <Modal
        open={showServiceModal && !manualReport}
        onClose={() => setShowServiceModal(false)}
        appearance="design-system"
        title="Tipo de serviço"
        size="md"
        fullscreenOnMobile={false}
        closeOnBackdrop
        backdropClassName="rdo-service-picker-backdrop"
        panelClassName="rdo-service-picker"
      >
            <div className="stype-grid">
              {serviceOptions.map(({ type, icon, name }) => (
                <button
                  className="stype-btn"
                  key={type}
                  type="button"
                  onClick={() => addService(type)}
                >
                  <div className="stype-icon"><AppIcon icon={icon} /></div>
                  <div className="stype-name">{name}</div>
                </button>
              ))}
            </div>
      </Modal>
      <PhotoCaptureNovelty user={user} placement="rdo-edit" enabled={!readOnly} />
      <ReportReissueDialog count={reissueOpen ? 1 : 0} submitting={reportMutations.regenerateReports.isPending} onConfirm={() => void handleReissue()} onCancel={() => setReissueOpen(false)} />
      {confirmDialog}
    </div>
  );
}

const statusLabels: Record<string, string> = {
  PENDING: 'Pendente',
  RETURNED: 'Devolvido',
  APPROVED: 'Aprovado',
  SIGNED: 'Assinado'
};

const reportStatusTones: StatusToneMap = {
  pending: 'warning',
  returned: 'danger',
  approved: 'success',
  signed: 'info'
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
  if (((type === 'limpeza' && data.limpezaTubulacao === 'Não')
    || (type === 'flushing' && data.flushingTubulacao === 'Não')) && data.tipoSistema) {
    rows.push({ label: 'Tipo de sistema', value: String(data.tipoSistema) });
  }
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
    if (data.equipamentoTestado) {
      const testedLabel = data.equipamentoTestado === 'mangueira'
        ? 'Mangueiras'
        : data.equipamentoTestado === 'outro'
        ? `Outro${data.equipamentoTestadoOutro ? `: ${data.equipamentoTestadoOutro}` : ''}`
        : 'Tubulação';
      rows.push({ label: 'Equipamento testado', value: testedLabel });
    }
    if (data.pressaoTrabalho) rows.push({ label: 'P. trabalho', value: `${data.pressaoTrabalho} ${data.pressaoTrabalhoUnit || ''}`.trim() });
    if (data.pressaoTeste) rows.push({ label: 'P. teste', value: `${data.pressaoTeste} ${data.pressaoTesteUnit || ''}`.trim() });
    if (data.fluidoTeste) rows.push({ label: 'Fluido', value: data.fluidoTeste === 'agua' ? 'Água' : 'Óleo' });
  }

  if (type === 'flushing' || type === 'filtragem') {
    if (data.tipoOleo) rows.push({ label: 'Tipo de óleo', value: String(data.tipoOleo) });
    if (data.volumeOleo) rows.push({ label: 'Volume', value: `${data.volumeOleo} ${data.volumeOleoUnit || ''}`.trim() });
    if (type === 'flushing' && data.tipoFlushing) {
      if (data.flushingTubulacao) rows.push({ label: 'Flushing em tubulação?', value: String(data.flushingTubulacao) });
      rows.push({ label: 'Tipo flushing', value: data.tipoFlushing === 'primario' ? 'Primário' : 'Secundário' });
    }
  }

  const notes = typeof data.notes === 'string' ? data.notes : '';
  if (notes) rows.push({ label: 'Observações', value: notes });

  return (
    <Card className="rdo-report-detail-service" padding="sm" elevation="none">
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
    </Card>
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

const auditActionLabels: Record<string, string> = {
  SIGNATURE_ROUND_CREATED: 'Rodada criada',
  SIGNED: 'Assinatura registrada',
  REJECTED: 'Reprovação registrada',
  SIGNATURES_INVALIDATED: 'Assinaturas invalidadas',
  VERSION_CREATED: 'Versão criada',
  TOKEN_ACCESSED: 'Link acessado',
  TOKEN_EXPIRED: 'Link expirado',
  REPORT_LOCKED: 'Relatório bloqueado'
};

function summarizeUserAgent(value?: string | null) {
  const text = String(value || '').trim();
  if (!text) return '';
  return text.split(/[()]/)[0].trim().slice(0, 80) || text.slice(0, 80);
}

function auditActor(log: ReportAuditLog) {
  if (log.user?.name) return log.user.name;
  if (log.user?.email) return log.user.email;
  return log.userId ? 'Usuário registrado' : 'Sistema';
}

function ReportAuditHistory({ reportId }: { reportId: string }) {
  const auditQuery = useReportAudit(reportId);
  const logs = auditQuery.data || [];

  return (
    <Card className="rdo-report-detail-card report-audit-section" padding="md" title={TEXT.reportAudit}>
      {auditQuery.isLoading ? <p className="placeholder-copy"><BrandLoading label="Carregando auditoria" inline size="sm" /></p> : null}
      {auditQuery.isError ? (
        <p className="inline-error">
          {auditQuery.error instanceof Error ? auditQuery.error.message : 'Não foi possível carregar a auditoria.'}
        </p>
      ) : null}
      {!auditQuery.isLoading && !auditQuery.isError && !logs.length ? (
        <p className="placeholder-copy">Nenhum evento de assinatura registrado.</p>
      ) : null}
      {logs.length ? (
        <div className="report-audit-list">
          {logs.map(log => {
            const sourceHash = log.version?.sourceDocumentHash || '';
            const finalHash = log.version?.finalDocumentHash || '';
            return (
              <article className="report-audit-item" key={log.id}>
                <div className="report-audit-main">
                  <div>
                    <div className="report-audit-title">{auditActionLabels[log.action] || log.action}</div>
                    <div className="report-audit-description">{log.description || 'Sem descrição'}</div>
                  </div>
                  <time>{formatDateTime(log.createdAt)}</time>
                </div>
                <div className="report-audit-meta">
                  <span>Ator: {auditActor(log)}</span>
                  {log.version ? <span>Versão: {log.version.versionNumber} ({log.version.status})</span> : null}
                  {log.ipAddress ? <span>IP: {log.ipAddress}</span> : null}
                  {log.userAgent ? <span>Navegador: {summarizeUserAgent(log.userAgent)}</span> : null}
                </div>
                {sourceHash || finalHash ? (
                  <div className="report-audit-hashes">
                    {sourceHash ? <span>Hash base: {sourceHash}</span> : null}
                    {finalHash ? <span>Hash final: {finalHash}</span> : null}
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      ) : null}
    </Card>
  );
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
      'Equipamento(s)', 'Sistema', 'Tipo de óleo', 'Volume de óleo', 'Flushing em tubulação?', 'Tipo de flushing',
      'Unidade de Flushing', 'Unidade de filtragem', 'Houve contagem de partículas?',
      'Contagem inicial NAS', 'Contagem final NAS', 'Contagem inicial ISO', 'Contagem final ISO',
      'Houve análise de umidade?', 'Umidade inicial (ppm)', 'Umidade final (ppm)',
      'Hora de início', 'Hora de término/pausa', 'Aprovado pelo cliente?', 'Desenhos / TAGs', 'Observações'
    ],
    RLM: [
      'Equipamento(s)', 'Sistema', 'Material do equipamento', 'Etapas realizadas no dia',
      'Hora de início', 'Hora de término/pausa', 'Aprovado pelo cliente?', 'Observações'
    ],
    RLF: ['Embarcação', 'Sistema', 'Material da tubulação', 'Steps', 'Linhas', 'Observações'],
    RLI: ['Embarcação', 'Sistema', 'Material da tubulação', 'Linhas', 'Observações']
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
    <Card className="rdo-report-detail-card" padding="md" title={`Dados do ${report.reportType}`}>
      <div className="detail-grid">
        {rows.map(row => (
          <div key={row.label}>
            <span className="detail-label">{row.label}</span>
            <span className="detail-value">{row.value}</span>
          </div>
        ))}
      </div>
    </Card>
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

  const linkedNightCollaborators = (report.collaborators || [])
    .filter(link => nightCollaboratorIds.includes(link.collaboratorId))
    .map(link => link.collaborator?.name || link.collaboratorId);
  const snapshotNightCollaborators = Array.isArray(noturnoDetails.colaboradores)
    ? noturnoDetails.colaboradores
        .map(item => asRecord(item).name)
        .filter((name): name is string => typeof name === 'string' && Boolean(name.trim()))
    : [];
  const nightCollaborators = linkedNightCollaborators.length ? linkedNightCollaborators : snapshotNightCollaborators;

  const generalUploads = asUploadedFiles(specialConditions.generalUploads);
  const isStandby = Boolean(specialConditions.standby);
  const isNoturno = Boolean(noturnoDetails.enabled || nightCollaboratorIds.length);

  const dds = asRecord(specialConditions.dds);
  const ddsBlocks = [
    { label: 'DDS diurno', data: asRecord(dds.diurno) },
    { label: 'DDS noturno', data: asRecord(dds.noturno) }
  ]
    .filter(block => Boolean(block.data.enabled))
    .map(block => ({
      label: block.label,
      inicio: getString(block.data.inicio),
      termino: getString(block.data.termino),
      temas: asDdsThemeSnapshots(block.data.temas).map(theme => (theme.custom ? `${theme.name} (novo)` : theme.name))
    }));

  return (
    <>
      <Card className="rdo-report-detail-card" padding="md" title={TEXT.generalInfo}>
        <div className="detail-grid">
          <div><span className="detail-label">{TEXT.project}</span><span className="detail-value">{report.project.name}</span></div>
          <div><span className="detail-label">{TEXT.code}</span><span className="detail-value">{report.project.code}</span></div>
          <div><span className="detail-label">Data</span><span className="detail-value">{formatDateOnlyPtBr(report.reportDate)}</span></div>
          <div><span className="detail-label">Local da obra</span><span className="detail-value">{getString(specialConditions.workLocation) || report.project.location || '-'}</span></div>
          <div><span className="detail-label">{TEXT.time}</span><span className="detail-value">{report.arrivalTime} às {report.departureTime}</span></div>
          <div><span className="detail-label">{TEXT.interval}</span><span className="detail-value">{report.lunchBreak || '-'}</span></div>
          <div>
            <span className="detail-label">Status</span>
            <span className="detail-value">
              <StatusPill
                status={report.status}
                label={report.status === 'SIGNED' && report.physicalSignedAt ? 'Assinado em papel' : statusLabels[report.status] || report.status}
                toneMap={reportStatusTones}
                dot={false}
              />
            </span>
          </div>
          {isReportManuallyReleased(report) ? <div>
            <span className="detail-label">Liberação ao cliente</span>
            <span className="detail-value"><Badge tone="success">Liberado individualmente</Badge></span>
          </div> : null}
          {isStandby ? <div><span className="detail-label">Standby</span><span className="detail-value">Sim</span></div> : null}
          {isNoturno ? <div><span className="detail-label">Turno noturno</span><span className="detail-value">Sim</span></div> : null}
        </div>
        <SignatureProgress report={report} />
      </Card>

      <Card className="rdo-report-detail-card" padding="md" title={TEXT.collaborators}>
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
      </Card>

      <ReportDdsSummarySection blocks={ddsBlocks} />

      {(report.services?.length ?? 0) > 0 ? (
        <Card className="rdo-report-detail-card" padding="md" title={TEXT.services}>
          <div className="rdo-report-detail-services">
            {(report.services || []).map((service, i) => (
              <ServiceSummaryRow key={service.id} service={service} index={i} />
            ))}
          </div>
        </Card>
      ) : null}

      <DerivedReportDetails report={report} />

      <Card className="rdo-report-detail-card" padding="md" title={TEXT.reportSummary}>
        <div className="detail-grid report-summary-detail-grid">
          <div><span className="detail-label">Motivo hora extra</span><span className="detail-value">{report.overtimeReason || '-'}</span></div>
          <div><span className="detail-label">{TEXT.description}</span><span className="detail-value">{report.dailyDescription || '-'}</span></div>
          <div><span className="detail-label">{TEXT.approvedAt}</span><span className="detail-value">{formatDate(report.approvedAt)}</span></div>
          <div><span className="detail-label">{TEXT.returnedAt}</span><span className="detail-value">{formatDate(report.returnedAt)}</span></div>
        </div>
        {report.reviewNotes ? <p className="report-note">{report.reviewNotes}</p> : null}
        {generalUploads.length > 0 ? (
          <div style={{ marginTop: 12 }}>
            <div className="detail-label">Fotos de registro</div>
            <div className="upload-thumbs report-upload-list">
              {generalUploads.map(file => (
                <GeneralUploadThumb key={file.url} file={file} />
              ))}
            </div>
          </div>
        ) : null}
      </Card>

      {report.clientReviews?.length ? (
        <Card className="rdo-report-detail-card" padding="md" title="Retorno do cliente">
          <div className="det-section">
            {report.clientReviews.slice(0, 3).map(review => (
              <div className="det-row" key={review.id}>
                <span className="det-label">{review.action === 'APPROVED' ? 'Aprovado' : 'Reprovado'}</span>
                <span className="det-val">{review.comment || 'Sem comentário'}</span>
              </div>
            ))}
          </div>
        </Card>
      ) : null}
    </>
  );
}

function collaboratorCanEditReport(user: ReturnType<typeof useAuth>['user'], report: ReportSummary) {
  if (!user || user.role !== 'COLLABORATOR') return false;
  if (report.createdByUserId === user.id) return true;
  const collaboratorId = user.collaboratorId;
  if (!collaboratorId) return false;
  if (report.project?.operatorId === collaboratorId) return true;
  return (report.collaborators || []).some(link => link.collaboratorId === collaboratorId);
}

export function ReportDetailPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { id = '' } = useParams();
  const { user, logout } = useAuth();
  const reportQuery = useReport(id, !!id);
  const reportBackPath = backPathFromState(location.state, roleHomePath(user?.role));
  const reportBackState = pageScrollRestoreStateFromNavigation(location.state);
  const canUseHistoryBack = hasBackPathInState(location.state);
  const navigationModules = useMemo(() => hubModulesForUser(user), [user]);
  const navigation = useMemo(
    () => createNavigationModel({ modules: navigationModules, pathname: location.pathname }),
    [location.pathname, navigationModules]
  );
  const profileInitials = user?.name
    ? user.name
        .split(' ')
        .filter(Boolean)
        .slice(0, 2)
        .map(part => part[0].toUpperCase())
        .join('')
    : 'U';

  async function handleLogout() {
    await logout();
    navigate('/', { replace: true });
  }

  function handleBack() {
    if (canUseHistoryBack) {
      navigate(-1);
      return;
    }
    navigate(reportBackPath, { replace: true, state: reportBackState });
  }

  const report = reportQuery.data;
  const canReviewReports = canReviewRdoReports(user);
  const canEditLinkedServiceReport = report ? canEditDerivedServiceReport(report, user) : false;
  const showRdoEditor =
    !!report
    && !(user?.role === 'COLLABORATOR' && report.project.isActive === false)
    && (
      (report.status !== 'SIGNED' && report.reportType === 'RDO' && (
        canReviewReports
        || collaboratorCanEditReport(user, report)
        || (user?.role === 'COORDINATOR' && report.createdByUserId === user.id)
      ))
      || (report.status !== 'SIGNED' && canReviewReports && isServiceOnlyReport(report))
      || canEditLinkedServiceReport
    );

  if (showRdoEditor && report) {
    const reportLabel = `${report.reportType}${report.sequenceNumber ? ` ${report.sequenceNumber}` : ''}`;

    return (
      <AppShell
        navigation={navigation}
        title={`Editar ${reportLabel}`}
        breadcrumb={[
          { label: 'Filtrovali', href: '/modulos' },
          { label: 'RDO', href: reportBackPath },
          { label: `Editar ${reportLabel}` }
        ]}
        contentWidth="fluid"
        profile={
          user
            ? {
                name: user.name,
                description: user.email || user.username,
                initials: profileInitials,
                onOpen: () =>
                  navigate('/conta', {
                    state: accountPageStateFromPath(location)
                  })
              }
            : undefined
        }
        onLogout={handleLogout}
      >
        <main className="fv-ds rdo-form-page rdo-edit-page">
          <PageHeader
            title={`Editar ${reportLabel}`}
            description={`${report.project.code} · ${report.project.name}`}
            breadcrumb={[
              { label: 'RDO', href: reportBackPath },
              { label: `Editar ${reportLabel}` }
            ]}
            actions={
              <Button
                variant="secondary"
                size="sm"
                iconLeft={<AppIcon icon={DS_ICONS.previous} size="sm" />}
                onClick={handleBack}
              >
                Voltar aos relatórios
              </Button>
            }
          />
          <ManagerRdoEditor report={report} />
          {canReviewReports ? <ReportAuditHistory reportId={report.id} /> : null}
        </main>
      </AppShell>
    );
  }

  const reportLabel = report
    ? `${report.reportType}${report.sequenceNumber ? ` ${report.sequenceNumber}` : ''}`
    : TEXT.details;

  return (
    <AppShell
      navigation={navigation}
      title={report ? `Detalhes do ${reportLabel}` : TEXT.details}
      breadcrumb={[
        { label: 'Filtrovali', href: '/modulos' },
        { label: 'RDO', href: reportBackPath },
        { label: reportLabel }
      ]}
      contentWidth="fluid"
      profile={
        user
          ? {
              name: user.name,
              description: user.email || user.username,
              initials: profileInitials,
              onOpen: () => navigate('/conta', { state: accountPageStateFromPath(location) })
            }
          : undefined
      }
      onLogout={handleLogout}
    >
      <main className="fv-ds rdo-report-detail-page">
        <PageHeader
          title={reportLabel}
          description={report ? `${report.project.code} · ${report.project.name}` : 'Consulte as informações do relatório.'}
          breadcrumb={[
            { label: 'RDO', href: reportBackPath },
            { label: reportLabel }
          ]}
          actions={(
            <Button
              variant="secondary"
              size="sm"
              iconLeft={<AppIcon icon={DS_ICONS.previous} size="sm" />}
              onClick={handleBack}
            >
              Voltar aos relatórios
            </Button>
          )}
        />

        {reportQuery.isLoading ? <Card className="placeholder-copy" padding="lg"><BrandLoading label={TEXT.loading} /></Card> : null}
        {reportQuery.isError ? (
          <Card className="inline-error" padding="lg">
            {reportQuery.error instanceof Error ? reportQuery.error.message : TEXT.loadError}
          </Card>
        ) : null}

        {report ? (
          <>
            <ReportSummaryView report={report} />
            {canReviewReports ? <ReportAuditHistory reportId={report.id} /> : null}
            <ReportDetailActions report={report} role={user?.role} />
          </>
        ) : null}

        {!reportQuery.isLoading && !reportQuery.isError && !report ? (
          <Card className="placeholder-copy" padding="lg">
            {TEXT.missing}
          </Card>
        ) : null}
      </main>
    </AppShell>
  );
}
