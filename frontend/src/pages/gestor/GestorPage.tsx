import { useEffect, useMemo, useRef, useState, type Dispatch, type DragEvent, type FormEvent, type KeyboardEvent, type SetStateAction } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { formatCnpj, normalizeCnpjInput } from '../../utils/formatCnpj';
import { compareReportTypes, ProjectSortButton, sortProjects, sortReportsInGroup } from '../../utils/projectSort';
import { reportDownloadFileName } from '../../utils/reportFileName';
import { matchesSearch, reportSearchParts } from '../../utils/search';
import { handleHorizontalTabListKeyDown } from '../../utils/tabKeyboard';

import type { UserRole } from '../../types/auth';
import { downloadReportDocx, downloadReportPdf, downloadReportsBatch } from '../../api/reports';
import type { SurveyQuestion, SurveyQuestionType, SurveyResponses } from '../../api/surveys';

import { useAuth } from '../../auth/AuthContext';
import { accountPageStateFromPath } from '../../auth/moduleNavigation';
import { rdoPath } from '../../auth/rolePath';
import { GroupedReportList } from '../../components/reports/GroupedReportList';
import { ReportSummaryCard } from '../../components/reports/ReportSummaryCard';
import { ReportListSkeleton } from '../../components/ui/Skeleton';
import { ImageDropzone } from '../../components/ui/ImageDropzone';
import { InfiniteScrollSentinel } from '../../components/ui/InfiniteScrollSentinel';
import { SearchBar } from '../../components/ui/SearchBar';
import { Modal } from '../../components/ui/Modal';
import { ReasonDialog } from '../../components/ui/ReasonDialog';
import { PdfDropzone } from '../../components/ui/PdfDropzone';
import { useToast } from '../../components/ui/Toast';
import { PrivacyNotice } from '../../components/privacy/PrivacyNotice';
import { ProjectRevisionPicker } from '../../components/projects/ProjectRevisionPicker';
import { getCommercialPendencias } from '../../api/acompanhamentoComercial';
import { useGestorBootstrap } from '../../hooks/useBootstrap';
import { useCollaboratorMutations } from '../../hooks/useCollaborators';
import { useDraftMutations, useDrafts } from '../../hooks/useDrafts';
import { useProjectMutations } from '../../hooks/useProjects';
import { useAccumulatedReportsPage, useReportCounts, useReportMutations } from '../../hooks/useReports';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { usePersistentSearch } from '../../hooks/usePersistentSearch';
import { useInfiniteScrollSentinel } from '../../hooks/useInfiniteScrollSentinel';
import { useUserMutations, useUsers } from '../../hooks/useUsers';
import { useSurveyMutations } from '../../hooks/useSurveys';
import { SurveyDashboardOverlay } from '../../components/surveys/SurveyDashboard';
import { MonthlyAllocationDashboardOverlay, StatsDashboardOverlay, StatsOverview } from '../../components/stats/StatsDashboard';
import { useProjectSegmentMutations } from '../../hooks/useProjectStats';
import { Shell } from '../../layout/Shell';
import { TopBar } from '../../layout/TopBar';
import { useRdoStore } from '../../store/rdoStore';
import { COLLABORATOR_SIGNATURE_NOTICE_VERSION } from '../../constants/privacy';
import type {
  Collaborator,
  ClientSegment,
  ClientSigner,
  InternalUserSummary,
  Project,
  ProjectReportSequence,
  ReportType,
  ReportDraft,
  ReportSummary,
  SatisfactionSurveySummary
} from '../../types/domain';
import { downloadBlob } from '../../utils/download';

type GestorTab =
  | 'pendentes'
  | 'aprovados'
  | 'arquivados'
  | 'projetos'
  | 'equipe'
  | 'usuarios'
  | 'nps'
  | 'estatisticas';

type SurveyQuestionDraft = Omit<SurveyQuestion, 'order' | 'options'> & { optionsText: string };
const REPORT_PAGE_SIZE = 50;
const REPORT_TYPE_PAGE_SIZE = 10;

const suggestedSurveyQuestions: Array<Omit<SurveyQuestionDraft, 'id'>> = [
  { label: 'Nome do respondente', type: 'TEXT', required: false, optionsText: '' },
  { label: 'Segmento do cliente', type: 'SELECT', required: false, optionsText: 'Petróleo & gás\nPapel e celulose\nFarmacêutico\nMineração\nSiderurgia\nOutro' },
  { label: 'Tipo de serviço principal', type: 'SELECT', required: false, optionsText: 'Filtração\nFlushing\nLimpeza química\nDesidratação\nUTH\nOutro' },
  { label: 'Primeira experiência com a Filtrovali?', type: 'SELECT', required: false, optionsText: 'Sim\nNão' },
  { label: 'Autoriza contato para conversar sobre o projeto?', type: 'SELECT', required: false, optionsText: 'Sim\nNão' },
  { label: 'O projeto foi concluído dentro do prazo?', type: 'SELECT', required: false, optionsText: 'Sim\nNão\nParcialmente' }
];

const gestorTabs: GestorTab[] = [
  'pendentes',
  'aprovados',
  'arquivados',
  'projetos',
  'equipe',
  'usuarios',
  'nps',
  'estatisticas'
];

function parseGestorTab(value: string | null): GestorTab {
  return gestorTabs.includes(value as GestorTab) ? value as GestorTab : 'pendentes';
}

function restoreScrollTop(container: HTMLElement, top: number) {
  let attempts = 0;
  const apply = () => {
    container.scrollTop = top;
    attempts += 1;
    if (attempts < 8 && Math.abs(container.scrollTop - top) > 2) {
      window.requestAnimationFrame(apply);
    }
  };
  window.requestAnimationFrame(apply);
}

type GestorUiPrefs = {
  projectSortDir: 'asc' | 'desc';
  closedArchivedProjectIds: string[];
  closedArchivedTypeKeys: string[];
  archivedTypeSortDirections: Record<string, 'asc' | 'desc'>;
  closedClientAccountGroupIds: string[];
};

function readGestorUiPrefs(storageKey: string): GestorUiPrefs {
  const fallback: GestorUiPrefs = {
    projectSortDir: 'asc',
    closedArchivedProjectIds: [],
    closedArchivedTypeKeys: [],
    archivedTypeSortDirections: {},
    closedClientAccountGroupIds: []
  };
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey) || '{}') as Partial<GestorUiPrefs>;
    return {
      projectSortDir: parsed.projectSortDir === 'desc' ? 'desc' : 'asc',
      closedArchivedProjectIds: Array.isArray(parsed.closedArchivedProjectIds) ? parsed.closedArchivedProjectIds.filter((id): id is string => typeof id === 'string') : [],
      closedArchivedTypeKeys: Array.isArray(parsed.closedArchivedTypeKeys) ? parsed.closedArchivedTypeKeys.filter((id): id is string => typeof id === 'string') : [],
      archivedTypeSortDirections: parsed.archivedTypeSortDirections && typeof parsed.archivedTypeSortDirections === 'object'
        ? Object.fromEntries(Object.entries(parsed.archivedTypeSortDirections).filter((entry): entry is [string, 'asc' | 'desc'] => entry[1] === 'asc' || entry[1] === 'desc'))
        : {},
      closedClientAccountGroupIds: Array.isArray(parsed.closedClientAccountGroupIds) ? parsed.closedClientAccountGroupIds.filter((id): id is string => typeof id === 'string') : []
    };
  } catch {
    return fallback;
  }
}

function writeGestorUiPrefs(storageKey: string, prefs: GestorUiPrefs) {
  try {
    localStorage.setItem(storageKey, JSON.stringify(prefs));
  } catch {
    // localStorage can be unavailable in private or restricted contexts.
  }
}

interface ProjectFormState {
  code: string;
  name: string;
  clientName: string;
  clientCnpj: string;
  clientEmailPrimary: string;
  clientSignerFirstName: string;
  clientSignerLastName: string;
  clientEmailCc: string;
  clientSigners: ClientSigner[];
  contractCode: string;
  location: string;
  operatorId: string;
  clientSegment: string;
  authorizedUserIds: string[];
  visibleToCollaborators: boolean;
  managerOnly: boolean;
  inhibitionServiceEnabled: boolean;
  requireServiceReportSignatures: boolean;
  isActive: boolean;
  workdayHours: string;
  weekendWorkdayHours: string;
  includesSaturday: boolean;
  includesSunday: boolean;
  reportSequences: ProjectReportSequenceFormState[];
}

interface ProjectReportSequenceFormState {
  reportType: ReportType;
  nextNumber: string;
}

interface ManualReportUploadFileState {
  id: string;
  fileName: string;
  pdfDataUrl: string;
  sequenceNumber: string;
  reportDate: string;
  serviceEquipment: string;
  serviceSystem: string;
}

interface ManualReportFormState {
  projectId: string;
  reportType: ReportType;
  sequenceNumber: string;
  reportDate: string;
  signatureMode: 'APPROVED' | 'SIGNED' | 'REQUIRES_SIGNATURE';
  serviceEquipment: string;
  serviceSystem: string;
  fileName: string;
  pdfDataUrl: string;
  files: ManualReportUploadFileState[];
}

interface CollaboratorFormState {
  name: string;
  role: string;
  email: string;
  signatureImage: string;
  signatureNoticeAccepted: boolean;
  isActive: boolean;
}

interface UserFormState {
  username: string;
  name: string;
  email: string;
  password: string;
  role: Exclude<UserRole, 'CLIENT'>;
  collaboratorId: string;
  isActive: boolean;
}

const internalRoles: Array<Exclude<UserRole, 'CLIENT'>> = ['COLLABORATOR', 'COORDINATOR', 'MANAGER'];
type ProjectVisibilityMode = 'manager-coordinator' | 'all-authorized' | 'manager-only';
const projectReportTypes: ReportType[] = ['RDO', 'RTP', 'RLQ', 'RCPU', 'RLM', 'RLI', 'RLF'];

function projectReportSequencesToForm(sequences: ProjectReportSequence[] = []): ProjectReportSequenceFormState[] {
  const sequenceByType = new Map(sequences.map(sequence => [sequence.reportType, sequence.nextNumber]));
  return projectReportTypes.map(reportType => ({
    reportType,
    nextNumber: String(sequenceByType.get(reportType) ?? 0)
  }));
}

function normalizeProjectReportSequences(sequences: ProjectReportSequenceFormState[]) {
  return projectReportTypes.map(reportType => {
    const sequence = sequences.find(item => item.reportType === reportType);
    const parsed = Number.parseInt(sequence?.nextNumber || '0', 10);
    return {
      reportType,
      nextNumber: Number.isFinite(parsed) && parsed > 0 ? parsed : 0
    };
  });
}

const emptyProjectForm: ProjectFormState = {
  code: '',
  name: '',
  clientName: '',
  clientCnpj: '',
  clientEmailPrimary: '',
  clientSignerFirstName: '',
  clientSignerLastName: '',
  clientEmailCc: '',
  clientSigners: [],
  contractCode: '',
  location: '',
  operatorId: '',
  clientSegment: '',
  authorizedUserIds: [],
  visibleToCollaborators: true,
  managerOnly: false,
  inhibitionServiceEnabled: false,
  requireServiceReportSignatures: false,
  isActive: true,
  workdayHours: '09:00',
  weekendWorkdayHours: '08:00',
  includesSaturday: false,
  includesSunday: false,
  reportSequences: projectReportSequencesToForm()
};

const emptyManualReportForm: ManualReportFormState = {
  projectId: '',
  reportType: 'RDO',
  sequenceNumber: '',
  reportDate: new Date().toISOString().slice(0, 10),
  signatureMode: 'APPROVED',
  serviceEquipment: '',
  serviceSystem: '',
  fileName: '',
  pdfDataUrl: '',
  files: []
};

const emptyCollaboratorForm: CollaboratorFormState = {
  name: '',
  role: '',
  email: '',
  signatureImage: '',
  signatureNoticeAccepted: false,
  isActive: true
};

const emptyUserForm: UserFormState = {
  username: '',
  name: '',
  email: '',
  password: '',
  role: 'COLLABORATOR',
  collaboratorId: '',
  isActive: true
};

interface RdoServiceDraft {
  id: string;
  type: string;
  data: Record<string, unknown>;
}

function asString(value: unknown, fallback = '') {
  return typeof value === 'string' ? value : fallback;
}

function asBoolean(value: unknown) {
  return typeof value === 'boolean' ? value : false;
}

function hasActiveClientRejection(report: ReportSummary) {
  const special = report.specialConditions || {};
  const rejectedAt = typeof special.__clientRejectedAt === 'string' ? special.__clientRejectedAt : '';
  const resolvedAt = typeof special.__clientRejectionResolvedAt === 'string' ? special.__clientRejectionResolvedAt : '';
  if (!rejectedAt) return false;
  return !resolvedAt || new Date(rejectedAt).getTime() > new Date(resolvedAt).getTime();
}

function isManualUploadedReport(report: ReportSummary | null | undefined) {
  return Boolean(manualReportUploadMeta(report).uploadedAt);
}

function manualReportUploadMeta(report: ReportSummary | null | undefined) {
  const meta = report?.specialConditions?.__manualUpload;
  return meta && typeof meta === 'object' && !Array.isArray(meta) ? meta as Record<string, unknown> : {};
}

function manualReportServiceData(report: ReportSummary | null | undefined) {
  const data = report?.specialConditions?.serviceData;
  return data && typeof data === 'object' && !Array.isArray(data) ? data as Record<string, unknown> : {};
}

function manualReportServiceField(report: ReportSummary | null | undefined, keys: string[]) {
  const data = manualReportServiceData(report);
  for (const key of keys) {
    const value = data[key];
    if (typeof value === 'string' || typeof value === 'number') return String(value);
  }
  return '';
}

function manualReportSignatureMode(report: ReportSummary): ManualReportFormState['signatureMode'] {
  if (report.status === 'SIGNED') return 'SIGNED';
  const meta = manualReportUploadMeta(report);
  if (meta.requiresSignature === true) return 'REQUIRES_SIGNATURE';
  return 'APPROVED';
}

function asStringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function parseEmailList(value: string) {
  return Array.from(new Set(
    value
      .split(/[\n,;]+/)
      .map(item => item.trim().toLowerCase())
      .filter(Boolean)
  ));
}

function cleanSigners(signers: ClientSigner[]) {
  const seen = new Set<string>();
  return signers
    .map(signer => ({
      firstName: signerFirstName(signer).trim(),
      lastName: signerLastName(signer).trim(),
      email: signer.email.trim().toLowerCase()
    }))
    .map(signer => ({
      ...signer,
      name: [signer.firstName, signer.lastName].filter(Boolean).join(' ')
    }))
    .filter(signer => signer.name && signer.email)
    .filter(signer => {
      if (seen.has(signer.email)) return false;
      seen.add(signer.email);
      return true;
    });
}

function splitSignerName(name = '') {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return {
    firstName: parts[0] || '',
    lastName: parts.slice(1).join(' ')
  };
}

function signerFirstName(signer: ClientSigner) {
  return signer.firstName || splitSignerName(signer.name).firstName;
}

function signerLastName(signer: ClientSigner) {
  return signer.lastName || splitSignerName(signer.name).lastName;
}

function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('Falha ao ler arquivo.'));
    reader.readAsDataURL(file);
  });
}

function manualReportFileId() {
  const random = Math.random().toString(36).slice(2, 8);
  return `manual-report-${Date.now()}-${random}`;
}

function manualReportUploadListLabel(files: ManualReportUploadFileState[]) {
  if (!files.length) return '';
  if (files.length === 1) return files[0].fileName;
  return `${files.length} PDFs selecionados`;
}

function normalizeSignatureImage(value?: string | null) {
  const signature = String(value || '').trim();
  return signature && signature !== 'null' && signature !== 'undefined' ? signature : '';
}

function asServices(value: unknown): RdoServiceDraft[] {
  if (!Array.isArray(value)) return [];

  return value
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
    .map(item => ({
      id: asString(item.id, `svc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
      type: asString(item.type, 'limpeza'),
      data: item.data && typeof item.data === 'object' && !Array.isArray(item.data)
        ? item.data as Record<string, unknown>
        : {}
    }));
}

function draftDateLabel(draft: ReportDraft) {
  const payloadDate = asString(draft.payload.reportDate);
  return draft.reportDate || payloadDate || 'Sem data';
}

function formatUserRole(role: UserRole) {
  const labels: Record<UserRole, string> = {
    COLLABORATOR: 'Colaborador',
    MANAGER: 'Gestor',
    COORDINATOR: 'Coordenador',
    CLIENT: 'Cliente'
  };

  return labels[role] || role;
}

function initials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map(part => part[0] || '')
    .join('')
    .toUpperCase() || 'CL';
}

function projectSearchParts(project: Project) {
  return [
    project.code,
    project.name,
    project.registrationPending ? 'cadastro pendente' : '',
    project.clientName,
    project.clientCnpj,
    project.clientEmailPrimary,
    project.clientSignerFirstName,
    project.clientSignerLastName,
    ...(project.clientEmailCc || []),
    ...(project.clientSigners || []).flatMap(signer => [signer.name, signer.firstName, signer.lastName, signer.email]),
    project.contractCode,
    project.location,
    project.operator?.name,
    projectVisibilityLabel(project),
    formatProjectSequences(project)
  ];
}

function collaboratorSearchParts(collaborator: Collaborator) {
  return [collaborator.code, collaborator.name, collaborator.role, collaborator.email];
}

function userSearchParts(item: InternalUserSummary) {
  return [
    item.name,
    item.username,
    item.email,
    formatUserRole(item.role),
    item.collaborator?.name,
    item.clientCnpj,
    ...(item.linkedProjects || []).flatMap(project => [project.code, project.name, project.clientCnpj, project.contractCode])
  ];
}

function formatDate(value?: string | null) {
  if (!value) return 'Não informado';
  return new Date(value).toLocaleDateString('pt-BR');
}

function formatList(values: string[], fallback = 'Não informado') {
  const cleaned = values.map(value => value.trim()).filter(Boolean);
  return cleaned.length ? cleaned.join(', ') : fallback;
}

function formatProjectSigners(signers?: ClientSigner[]) {
  if (!signers?.length) return 'Nenhum assinante adicional';
  return signers
    .map(signer => [[signerFirstName(signer), signerLastName(signer)].filter(Boolean).join(' ') || signer.name, signer.email].filter(Boolean).join(' - '))
    .filter(Boolean)
    .join(', ');
}

function formatPrimaryProjectSigner(project: Project) {
  const name = [project.clientSignerFirstName, project.clientSignerLastName]
    .map(part => String(part || '').trim())
    .filter(Boolean)
    .join(' ');
  return name || 'Não informado';
}

function formatProjectSequences(project: Project) {
  const sequences = project.reportSequences || [];
  if (!sequences.length) return 'Sem sequenciais cadastrados';
  return sequences
    .map(sequence => `${sequence.reportType}: próximo ${sequence.nextNumber}`)
    .join(', ');
}

function projectVisibilityMode(form: Pick<ProjectFormState, 'managerOnly' | 'visibleToCollaborators'>): ProjectVisibilityMode {
  if (form.managerOnly) return 'manager-only';
  return form.visibleToCollaborators ? 'all-authorized' : 'manager-coordinator';
}

function projectVisibilityLabel(project: Pick<Project, 'managerOnly' | 'visibleToCollaborators'>) {
  if (project.managerOnly) return 'Somente gestor';
  if (project.visibleToCollaborators) return 'Gestor, coordenador e colaboradores responsáveis';
  return 'Gestor e coordenador';
}

function projectRegistrationPending(project: Project) {
  return Boolean(project.registrationPending);
}

function projectTitle(project: Project) {
  const name = String(project.name || '').trim();
  return name ? `${project.code} - ${name}` : `Missão ${project.code}`;
}

function latestSurvey(project: Project) {
  return (project.surveys || [])[0] || null;
}

function surveyIsActive(survey?: SatisfactionSurveySummary | null) {
  return !!survey && !survey.respondedAt && new Date(survey.expiresAt).getTime() > Date.now();
}

function surveyIsExpired(survey?: SatisfactionSurveySummary | null) {
  return !!survey && !survey.respondedAt && new Date(survey.expiresAt).getTime() <= Date.now();
}

function surveyBadge(survey?: SatisfactionSurveySummary | null) {
  if (!survey) return { label: 'Pesquisa não enviada', className: 'badge badge-pen' };
  if (survey.respondedAt) return { label: 'Pesquisa respondida', className: 'badge badge-ok' };
  if (new Date(survey.expiresAt).getTime() <= Date.now()) return { label: 'Pesquisa expirada', className: 'badge badge-rev' };
  if (survey.reminderOptOutAt) return { label: 'Lembretes cancelados', className: 'badge badge-pen' };
  return { label: 'Pesquisa enviada', className: 'badge badge-pen' };
}

function surveyHistoryBadges(project: Project) {
  const surveys = project.surveys || [];
  if (!surveys.length) return [surveyBadge(null)];
  return surveys.map((survey, index) => {
    const badge = surveyBadge(survey);
    const date = formatDate(survey.respondedAt || survey.sentAt || survey.createdAt);
    return {
      ...badge,
      label: surveys.length > 1 ? `${badge.label} #${surveys.length - index} - ${date}` : `${badge.label} - ${date}`
    };
  });
}

function projectChangedAfterSurvey(project: Project, survey: SatisfactionSurveySummary) {
  const projectUpdatedAt = project.updatedAt ? new Date(project.updatedAt).getTime() : 0;
  const surveyReferenceAt = new Date(survey.respondedAt || survey.createdAt).getTime();
  return Boolean(projectUpdatedAt && surveyReferenceAt && projectUpdatedAt > surveyReferenceAt);
}

function canSendProjectSurvey(project: Project) {
  if (project.isActive) return false;
  const survey = latestSurvey(project);
  if (!survey) return true;
  if (surveyIsActive(survey)) return false;
  if (survey.respondedAt) return projectChangedAfterSurvey(project, survey);
  return true;
}

function surveyStatusLabel(survey: SatisfactionSurveySummary) {
  if (survey.respondedAt) return { label: 'Respondida', className: 'status-approved' };
  if (surveyIsExpired(survey)) return { label: 'Expirada', className: 'status-returned' };
  return { label: 'Pendente', className: 'status-pending' };
}

function surveyResponseValue(value: unknown, fallback = 'Não respondido') {
  if (value === undefined || value === null || value === '') return fallback;
  return String(value);
}

const legacyNpsResponseLabels: Record<string, string> = {
  nps: 'Probabilidade de recomendar a Filtrovali',
  serviceQuality: 'Qualidade dos serviços prestados',
  communication: 'Comunicação da equipe durante o projeto',
  deadlines: 'Cumprimento de prazos',
  documentation: 'Qualidade da documentação entregue',
  improvement: 'O que podemos melhorar?',
  highlight: 'Algo que gostaria de destacar?'
};

function npsResponseRows(responses?: SurveyResponses | null, questions: SurveyQuestion[] = []) {
  if (questions.length) {
    return questions.map(question => [question.label, surveyResponseValue(responses?.[question.id])]);
  }
  return Object.keys(responses || {}).map(key => [
    legacyNpsResponseLabels[key] || key,
    surveyResponseValue(responses?.[key])
  ]);
}

function npsProjectTitle(survey: SatisfactionSurveySummary & { project?: { code?: string; name?: string } | null }) {
  return [survey.project?.code, survey.project?.name].filter(Boolean).join(' - ') || 'Projeto não informado';
}

function npsProjectKey(survey: SatisfactionSurveySummary & { project?: { id?: string } | null }) {
  return survey.project?.id || survey.projectId || survey.id;
}

function surveyQuestionToDraft(question: SurveyQuestion): SurveyQuestionDraft {
  return {
    id: question.id,
    label: question.label,
    type: question.type,
    required: question.required,
    optionsText: (question.options || []).join('\n')
  };
}

function newSurveyQuestionDraft(): SurveyQuestionDraft {
  return {
    id: `new-${Date.now()}`,
    label: '',
    type: 'TEXT',
    required: false,
    optionsText: ''
  };
}

function draftToSurveyQuestion(question: SurveyQuestionDraft): Omit<SurveyQuestion, 'order'> {
  const options = question.type === 'SELECT'
    ? question.optionsText
      .split(/\n|,/)
      .map(option => option.trim())
      .filter(Boolean)
    : [];
  return {
    id: question.id,
    label: question.label.trim(),
    type: question.type,
    required: question.required,
    options
  };
}

function surveyDraftOptions(question: SurveyQuestionDraft) {
  return question.optionsText
    .split(/\n|,/)
    .map(option => option.trim())
    .filter(Boolean);
}

function scalePreviewValues(type: SurveyQuestionType) {
  if (type === 'NPS') return Array.from({ length: 11 }, (_, index) => index);
  if (type === 'SCALE') return [1, 2, 3, 4, 5];
  return [];
}

function applyProjectVisibilityMode(mode: ProjectVisibilityMode): Pick<ProjectFormState, 'managerOnly' | 'visibleToCollaborators'> {
  if (mode === 'manager-only') return { managerOnly: true, visibleToCollaborators: false };
  if (mode === 'all-authorized') return { managerOnly: false, visibleToCollaborators: true };
  return { managerOnly: false, visibleToCollaborators: false };
}

function segmentSlugFromLabel(label: string) {
  return label
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function projectToForm(project: Project): ProjectFormState {
  return {
    code: project.code,
    name: project.name,
    clientName: project.clientName,
    clientCnpj: project.clientCnpj,
    clientEmailPrimary: project.clientEmailPrimary || '',
    clientSignerFirstName: project.clientSignerFirstName || '',
    clientSignerLastName: project.clientSignerLastName || '',
    clientEmailCc: parseEmailList([...(project.clientEmailCc || []), ...(project.clientSigners || []).map(signer => signer.email)].join('\n')).join('\n'),
    clientSigners: (project.clientSigners || []).map(signer => ({
      firstName: signerFirstName(signer),
      lastName: signerLastName(signer),
      name: signer.name || [signer.firstName, signer.lastName].filter(Boolean).join(' '),
      email: signer.email || ''
    })),
    contractCode: project.contractCode,
    location: project.location,
    operatorId: project.operatorId || '',
    clientSegment: project.clientSegment || '',
    authorizedUserIds: (project.authorizedUsers || []).map(link => link.userId).filter(Boolean),
    visibleToCollaborators: project.visibleToCollaborators,
    managerOnly: project.managerOnly,
    inhibitionServiceEnabled: project.inhibitionServiceEnabled ?? false,
    requireServiceReportSignatures: project.requireServiceReportSignatures ?? false,
    isActive: project.isActive,
    workdayHours: project.workdayHours || '09:00',
    weekendWorkdayHours: project.weekendWorkdayHours || '08:00',
    includesSaturday: project.includesSaturday ?? false,
    includesSunday: project.includesSunday ?? false,
    reportSequences: projectReportSequencesToForm(project.reportSequences)
  };
}

function canBeAuthorizedProjectUser(user: InternalUserSummary) {
  return Boolean(
    user.isActive
    && user.role === 'COLLABORATOR'
    && user.collaboratorId
    && (user.moduleRoles || []).includes('rdo:collaborator')
  );
}

function userProjectAccessLabel(user: InternalUserSummary) {
  const collaboratorName = user.collaborator?.name || '';
  if (collaboratorName && collaboratorName !== user.name) return `${collaboratorName} (${user.name})`;
  return user.name || user.username;
}

function ProjectAuthorizedUsersFields({
  form,
  idPrefix,
  setForm,
  users
}: {
  form: ProjectFormState;
  idPrefix: string;
  setForm: Dispatch<SetStateAction<ProjectFormState>>;
  users: InternalUserSummary[];
}) {
  const selected = new Set(form.authorizedUserIds);
  const options = users
    .filter(user => canBeAuthorizedProjectUser(user) || selected.has(user.id))
    .sort((a, b) => userProjectAccessLabel(a).localeCompare(userProjectAccessLabel(b), 'pt-BR'));
  const byId = new Map(options.map(user => [user.id, user]));
  const selectedUsers = form.authorizedUserIds.map(userId => byId.get(userId)).filter((user): user is InternalUserSummary => Boolean(user));
  const availableUsers = options.filter(user => !selected.has(user.id) && canBeAuthorizedProjectUser(user));

  function addUser(select: HTMLSelectElement | null) {
    const userId = select?.value || '';
    if (!userId) return;
    setForm(current => ({
      ...current,
      authorizedUserIds: Array.from(new Set([...current.authorizedUserIds, userId]))
    }));
    if (select) select.value = '';
  }

  function removeUser(userId: string) {
    setForm(current => ({
      ...current,
      authorizedUserIds: current.authorizedUserIds.filter(id => id !== userId)
    }));
  }

  return (
    <div className="field-group field-group-wide">
      <label htmlFor={`${idPrefix}-authorized-users-select`}>Usuários internos autorizados</label>
      {options.length ? (
        <div className="cc-list">
          {selectedUsers.map(user => (
            <div className="cc-row" key={user.id}>
              <div className="cc-row-main">
                <div className="cc-email">{userProjectAccessLabel(user)}</div>
                <div className="cc-row-actions">
                  <button
                    className="email-chip-rm"
                    type="button"
                    aria-label={`Remover ${userProjectAccessLabel(user)}`}
                    onClick={() => removeUser(user.id)}
                  >
                    ×
                  </button>
                </div>
              </div>
            </div>
          ))}
          <div className="cc-add-row">
            <select id={`${idPrefix}-authorized-users-select`} defaultValue="">
              <option value="">Selecionar usuário...</option>
              {availableUsers.map(user => (
                <option key={user.id} value={user.id}>{userProjectAccessLabel(user)}</option>
              ))}
            </select>
            <button className="cc-add-btn" type="button" disabled={!availableUsers.length} onClick={event => {
              const select = event.currentTarget.parentElement?.querySelector('select');
              addUser(select || null);
            }}>
              + Adicionar
            </button>
          </div>
        </div>
      ) : (
        <div className="form-hint">Nenhum usuário interno de colaborador disponível.</div>
      )}
    </div>
  );
}

function ProjectClientFields({
  form,
  idPrefix,
  setForm
}: {
  form: ProjectFormState;
  idPrefix: string;
  setForm: Dispatch<SetStateAction<ProjectFormState>>;
}) {
  const ccEmails = parseEmailList(form.clientEmailCc);
  const signerByEmail = new Map(form.clientSigners.map(signer => [signer.email.trim().toLowerCase(), signer]));

  function setCcEmails(values: string[]) {
    const nextEmails = parseEmailList(values.join('\n'));
    const nextEmailSet = new Set(nextEmails);

    setForm(current => ({
      ...current,
      clientEmailCc: nextEmails.join('\n'),
      clientSigners: current.clientSigners.filter(signer => nextEmailSet.has(signer.email.trim().toLowerCase()))
    }));
  }

  function commitCcInput(input: HTMLInputElement | null) {
    if (!input) return;
    const nextEmails = parseEmailList(input.value);
    input.value = '';
    if (!nextEmails.length) return;
    setCcEmails([...ccEmails, ...nextEmails]);
  }

  function handleCcInputKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter' || event.key === ',' || event.key === ';') {
      event.preventDefault();
      commitCcInput(event.currentTarget);
    }
  }

  function toggleSigner(email: string) {
    setForm(current => {
      const normalizedEmail = email.trim().toLowerCase();
      const isSigner = current.clientSigners.some(signer => signer.email.trim().toLowerCase() === normalizedEmail);
      return {
        ...current,
        clientSigners: isSigner
          ? current.clientSigners.filter(signer => signer.email.trim().toLowerCase() !== normalizedEmail)
          : [...current.clientSigners, { email: normalizedEmail, firstName: '', lastName: '', name: '' }]
      };
    });
  }

  function updateSignerNamePart(email: string, key: 'firstName' | 'lastName', value: string) {
    setForm(current => ({
      ...current,
      clientSigners: current.clientSigners.map(signer => (
        signer.email.trim().toLowerCase() === email
          ? {
              ...signer,
              [key]: value,
              name: [
                key === 'firstName' ? value : signerFirstName(signer),
                key === 'lastName' ? value : signerLastName(signer)
              ].map(part => part.trim()).filter(Boolean).join(' ')
            }
          : signer
      ))
    }));
  }

  return (
    <>
      <div className="field-group">
        <label htmlFor={`${idPrefix}-client-email-primary`}>E-mail principal do cliente</label>
        <input
          id={`${idPrefix}-client-email-primary`}
          type="email"
          value={form.clientEmailPrimary}
          onChange={event => setForm(current => ({ ...current, clientEmailPrimary: event.target.value }))}
        />
      </div>
      <div className="field-group">
        <label htmlFor={`${idPrefix}-client-signer-first-name`}>Nome do signatário principal</label>
        <input
          id={`${idPrefix}-client-signer-first-name`}
          type="text"
          value={form.clientSignerFirstName}
          placeholder="Nome"
          onChange={event => setForm(current => ({ ...current, clientSignerFirstName: event.target.value }))}
        />
      </div>
      <div className="field-group">
        <label htmlFor={`${idPrefix}-client-signer-last-name`}>Sobrenome do signatário principal</label>
        <input
          id={`${idPrefix}-client-signer-last-name`}
          type="text"
          value={form.clientSignerLastName}
          placeholder="Sobrenome"
          onChange={event => setForm(current => ({ ...current, clientSignerLastName: event.target.value }))}
        />
      </div>
      <div className="field-group field-group-wide">
        <label htmlFor={`${idPrefix}-client-email-cc-input`}>E-mails em cópia</label>
        <div className="cc-list">
          {ccEmails.length ? (
            <div className="cc-list-header">
              <span>E-mail</span>
              <span>Assinante?</span>
            </div>
          ) : null}
          {ccEmails.map(email => {
            const signer = signerByEmail.get(email);
            return (
              <div className="cc-row" key={email}>
                <div className="cc-row-main">
                  <div className="cc-email">{email}</div>
                  <div className="cc-row-actions">
                    <label className="tog">
                      <input type="checkbox" checked={Boolean(signer)} onChange={() => toggleSigner(email)} />
                      <span className="tog-sl" />
                    </label>
                    <button
                      className="email-chip-rm"
                      type="button"
                      aria-label="Remover e-mail"
                      onClick={() => setCcEmails(ccEmails.filter(item => item !== email))}
                    >
                      ×
                    </button>
                  </div>
                </div>
                {signer ? (
                  <div className="cc-name-row">
                    <label>
                      <span>Nome</span>
                      <input
                        className="cc-name-input"
                        type="text"
                        value={signerFirstName(signer)}
                        placeholder="Nome"
                        required
                        onChange={event => updateSignerNamePart(email, 'firstName', event.target.value)}
                      />
                    </label>
                    <label>
                      <span>Sobrenome</span>
                      <input
                        className="cc-name-input"
                        type="text"
                        value={signerLastName(signer)}
                        placeholder="Sobrenome"
                        required
                        onChange={event => updateSignerNamePart(email, 'lastName', event.target.value)}
                      />
                    </label>
                  </div>
                ) : null}
              </div>
            );
          })}
          <div className="cc-add-row">
            <input
              id={`${idPrefix}-client-email-cc-input`}
              type="text"
              placeholder="Digite um e-mail..."
              onKeyDown={handleCcInputKeyDown}
              onBlur={event => commitCcInput(event.currentTarget)}
            />
            <button className="cc-add-btn" type="button" onClick={event => {
              const input = event.currentTarget.parentElement?.querySelector('input');
              commitCcInput(input || null);
            }}>
              + Adicionar
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

function ProjectReportSequenceFields({
  form,
  idPrefix,
  setForm
}: {
  form: ProjectFormState;
  idPrefix: string;
  setForm: Dispatch<SetStateAction<ProjectFormState>>;
}) {
  function updateSequence(reportType: ReportType, value: string) {
    setForm(current => ({
      ...current,
      reportSequences: normalizeProjectReportSequences(current.reportSequences).map(sequence => (
        sequence.reportType === reportType
          ? { reportType, nextNumber: value.replace(/\D/g, '') }
          : { reportType: sequence.reportType, nextNumber: String(sequence.nextNumber) }
      ))
    }));
  }

  const visibleReportTypes = form.inhibitionServiceEnabled
    ? projectReportTypes
    : projectReportTypes.filter(reportType => reportType !== 'RLI' && reportType !== 'RLF');

  return (
    <div className="field-group field-group-wide">
      <label>Sequenciais dos relatórios</label>
      <div className="project-sequence-grid">
        {visibleReportTypes.map(reportType => {
          const sequence = form.reportSequences.find(item => item.reportType === reportType);
          return (
            <label className="project-sequence-field" htmlFor={`${idPrefix}-sequence-${reportType}`} key={reportType}>
              <span>{reportType}</span>
              <input
                id={`${idPrefix}-sequence-${reportType}`}
                inputMode="numeric"
                min="0"
                step="1"
                type="number"
                value={sequence?.nextNumber ?? '0'}
                onChange={event => updateSequence(reportType, event.target.value)}
              />
            </label>
          );
        })}
      </div>
      <div className="form-hint">Informe o último número usado. O próximo relatório segue a partir desse sequencial.</div>
    </div>
  );
}

function collaboratorToForm(collaborator: Collaborator): CollaboratorFormState {
  return {
    name: collaborator.name,
    role: collaborator.role,
    email: collaborator.email || '',
    signatureImage: normalizeSignatureImage(collaborator.signatureImage),
    signatureNoticeAccepted: Boolean(collaborator.signatureNoticeAcceptedAt || collaborator.signatureNoticeVersion),
    isActive: collaborator.isActive
  };
}

function userToForm(user: InternalUserSummary): UserFormState {
  return {
    username: user.username,
    name: user.name,
    email: user.email || '',
    password: '',
    role: user.role === 'CLIENT' ? 'COLLABORATOR' : user.role,
    collaboratorId: user.collaboratorId || '',
    isActive: user.isActive
  };
}

function renderProjectCard(
  project: Project,
  options: {
    onEdit: (project: Project) => void;
    onToggleArchive: (project: Project) => void;
    onRemove?: (project: Project) => void;
    detailsExpanded: boolean;
    onToggleDetails: (project: Project) => void;
    reportSectionExpanded?: boolean;
    reportCount?: number;
    onToggleReports?: (project: Project) => void;
    onSendSurvey?: (project: Project) => void;
    onResendSurvey?: (survey: SatisfactionSurveySummary) => void;
    surveyPending?: boolean;
    children?: ReactNode;
    segments?: ClientSegment[];
    commercialPendencia?: { proposalCode: string; revisionCount: number; resolved: boolean } | null;
  }
) {
  const survey = latestSurvey(project);
  const surveyInfos = !project.isActive ? surveyHistoryBadges(project) : [];
  const canSendSurvey = canSendProjectSurvey(project);
  const canResendSurvey = !project.isActive && !!survey && !survey.respondedAt;
  const pendingRegistration = projectRegistrationPending(project);
  const title = projectTitle(project);
  return (
    <article className="card admin-card project-admin-card" key={project.id}>
      <div className="project-admin-head">
        {options.onToggleReports ? (
          <button className="project-admin-toggle" type="button" onClick={() => options.onToggleReports?.(project)}>
            <span className="project-admin-title">{title}</span>
            <span className="rtype-count">{options.reportCount || 0} relatório{options.reportCount === 1 ? '' : 's'}</span>
            <span className="rtype-chevron">{options.reportSectionExpanded ? '▾' : '▸'}</span>
          </button>
        ) : (
          <div className="project-admin-title">
            {title}
          </div>
        )}
        <span className={`badge ${pendingRegistration ? 'badge-pen' : (project.includesSaturday || project.includesSunday) ? 'badge-ok' : 'badge-pen'}`}>
          {pendingRegistration ? 'Cadastro pendente' : (project.includesSaturday || project.includesSunday) ? 'Escala estendida' : 'Escala padrão'}
        </span>
      </div>
      {pendingRegistration ? (
        <div className="project-registration-alert">
          Projeto criado automaticamente pelo romaneio. Complete o cadastro antes de usar em relatórios, ou exclua se o código não deve permanecer.
        </div>
      ) : null}
      {options.commercialPendencia && !options.commercialPendencia.resolved ? (
        <div className="project-registration-alert">
          Há {options.commercialPendencia.revisionCount} proposta(s) importada(s) do comercial para o contrato {options.commercialPendencia.proposalCode}. Abra os detalhes e escolha a revisão que vale para esta missão.
        </div>
      ) : null}
      {options.children}
      {options.detailsExpanded ? (
        <div className="det-section">
          <div className="det-row">
            <span className="det-label">Cliente</span>
            <span className="det-val">{project.clientName || '-'}</span>
          </div>
          <div className="det-row">
            <span className="det-label">CNPJ</span>
            <span className="det-val">{formatCnpj(project.clientCnpj) || '-'}</span>
          </div>
          <div className="det-row">
            <span className="det-label">E-mail principal</span>
            <span className="det-val">{project.clientEmailPrimary || '-'}</span>
          </div>
          <div className="det-row">
            <span className="det-label">Signatário principal</span>
            <span className="det-val">{formatPrimaryProjectSigner(project)}</span>
          </div>
          <div className="det-row">
            <span className="det-label">E-mails em cópia</span>
            <span className="det-val">{formatList(project.clientEmailCc || [])}</span>
          </div>
          <div className="det-row">
            <span className="det-label">Assinantes adicionais</span>
            <span className="det-val">{formatProjectSigners(project.clientSigners)}</span>
          </div>
          <div className="det-row">
            <span className="det-label">Contrato</span>
            <span className="det-val">{project.contractCode || '-'}</span>
          </div>
          {options.commercialPendencia ? <ProjectRevisionPicker projectId={project.id} /> : null}
          <div className="det-row">
            <span className="det-label">Operador</span>
            <span className="det-val">{project.operator?.name || '-'}</span>
          </div>
          {project.clientSegment && (
            <div className="det-row">
              <span className="det-label">Segmento</span>
              <span className="det-val">{(options.segments || []).find(s => s.slug === project.clientSegment)?.label || project.clientSegment}</span>
            </div>
          )}
          <div className="det-row">
            <span className="det-label">Visibilidade</span>
            <span className="det-val">{projectVisibilityLabel(project)}</span>
          </div>
          <div className="det-row">
            <span className="det-label">Sequenciais</span>
            <span className="det-val">{formatProjectSequences(project)}</span>
          </div>
        </div>
      ) : null}
      <div className="admin-actions">
        <button className="mini-btn alt" type="button" onClick={() => options.onToggleDetails(project)}>
          {options.detailsExpanded ? 'Ocultar detalhes' : 'Mostrar detalhes'}
        </button>
        <button className="mini-btn alt" type="button" onClick={() => options.onToggleArchive(project)}>
          {project.isActive ? 'Arquivar' : 'Desarquivar'}
        </button>
        <button className="mini-btn alt" type="button" onClick={() => options.onEdit(project)}>
          Editar
        </button>
        {options.onRemove ? (
          <button className="mini-btn danger" type="button" onClick={() => options.onRemove?.(project)}>
            Excluir
          </button>
        ) : null}
        {!project.isActive ? (
          <span className="badge badge-rev">Arquivado</span>
        ) : null}
        {surveyInfos.map((surveyInfo, index) => (
          <span className={surveyInfo.className} key={`${project.id}-survey-badge-${index}`}>{surveyInfo.label}</span>
        ))}
        {canSendSurvey && !canResendSurvey && options.onSendSurvey ? (
          <button className="mini-btn alt" type="button" disabled={options.surveyPending} onClick={() => options.onSendSurvey?.(project)}>
            Enviar pesquisa
          </button>
        ) : null}
        {canResendSurvey && survey && options.onResendSurvey ? (
          <button className="mini-btn alt" type="button" disabled={options.surveyPending} onClick={() => options.onResendSurvey?.(survey)}>
            Reenviar pesquisa
          </button>
        ) : null}
      </div>
    </article>
  );
}

export function GestorPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user, logout } = useAuth();
  const { hydrate, reset } = useRdoStore();
  const showToast = useToast();
  const pageScrollRef = useRef<HTMLDivElement | null>(null);
  const restoredScrollKeysRef = useRef<Set<string>>(new Set());
  const [tab, setTab] = useState<GestorTab>(() => parseGestorTab(searchParams.get('tab')));
  // Busca persistida por aba: ao voltar (de outra aba ou do detalhe), restaura o termo da aba.
  const [gestorSearch, setGestorSearch] = usePersistentSearch(`gestor-search:${user?.id || 'anonymous'}:${tab}`);
  // Só o valor enviado às queries é adiado; a filtragem client-side segue instantânea.
  const debouncedGestorSearch = useDebouncedValue(gestorSearch, 300);
  const projectDetailsStorageKey = `gestor-project-details-collapsed:${user?.id || 'anonymous'}`;
  const gestorUiPrefsStorageKey = `gestor-ui-prefs:${user?.id || 'anonymous'}`;
  const initialUiPrefs = useMemo(() => readGestorUiPrefs(gestorUiPrefsStorageKey), [gestorUiPrefsStorageKey]);
  const [collapsedProjectDetailIds, setCollapsedProjectDetailIds] = useState<string[]>([]);

  const [projectForm, setProjectForm] = useState<ProjectFormState>(emptyProjectForm);
  const [projectEditingId, setProjectEditingId] = useState<string | null>(null);
  const [showProjectForm, setShowProjectForm] = useState(false);
  const [showSegmentForm, setShowSegmentForm] = useState(false);
  const [segmentLabel, setSegmentLabel] = useState('');
  const [archiveSurveyProject, setArchiveSurveyProject] = useState<Project | null>(null);
  const [openSurveyId, setOpenSurveyId] = useState<string | null>(null);
  const [npsDashboardOpen, setNpsDashboardOpen] = useState(false);
  const [statsDashboardOpen, setStatsDashboardOpen] = useState(false);
  const [allocationDashboardOpen, setAllocationDashboardOpen] = useState(false);
  const [npsSortDir, setNpsSortDir] = useState<'asc' | 'desc'>('asc');
  const [showSurveyQuestionEditor, setShowSurveyQuestionEditor] = useState(false);
  const [surveyQuestionDrafts, setSurveyQuestionDrafts] = useState<SurveyQuestionDraft[]>([]);
  const [draggedSurveyQuestionId, setDraggedSurveyQuestionId] = useState<string | null>(null);
  const [dragOverSurveyQuestionId, setDragOverSurveyQuestionId] = useState<string | null>(null);
  const [surveyOptionInputs, setSurveyOptionInputs] = useState<Record<string, string>>({});
  const surveyQuestionEditorListRef = useRef<HTMLDivElement | null>(null);

  const [collaboratorForm, setCollaboratorForm] = useState<CollaboratorFormState>(emptyCollaboratorForm);
  const [collaboratorEditingId, setCollaboratorEditingId] = useState<string | null>(null);
  const [showCollaboratorForm, setShowCollaboratorForm] = useState(false);

  const [userForm, setUserForm] = useState<UserFormState>(emptyUserForm);
  const [userEditingId, setUserEditingId] = useState<string | null>(null);
  const [showUserForm, setShowUserForm] = useState(false);
  const [userAdminGroup, setUserAdminGroup] = useState<'internal' | 'client'>('internal');

  const [returnReport, setReturnReport] = useState<ReportSummary | null>(null);
  const [sequenceEditReport, setSequenceEditReport] = useState<ReportSummary | null>(null);
  const [sequenceEditValue, setSequenceEditValue] = useState('');
  const [manualReportForm, setManualReportForm] = useState<ManualReportFormState>(emptyManualReportForm);
  const [manualReportTarget, setManualReportTarget] = useState<ReportSummary | null>(null);
  const [manualReportModalOpen, setManualReportModalOpen] = useState(false);
  const [manualReportSubmitting, setManualReportSubmitting] = useState(false);
  const [selectedReportIds, setSelectedReportIds] = useState<string[]>([]);
  const [projectSortDir, setProjectSortDir] = useState<'asc' | 'desc'>(initialUiPrefs.projectSortDir);
  const [closedArchivedProjectIds, setClosedArchivedProjectIds] = useState<string[]>(initialUiPrefs.closedArchivedProjectIds);
  const [closedArchivedTypeKeys, setClosedArchivedTypeKeys] = useState<string[]>(initialUiPrefs.closedArchivedTypeKeys);
  const [archivedVisibleByType, setArchivedVisibleByType] = useState<Record<string, number>>({});
  const [archivedTypeSortDirections, setArchivedTypeSortDirections] = useState<Record<string, 'asc' | 'desc'>>(initialUiPrefs.archivedTypeSortDirections);
  const [closedClientAccountGroupIds, setClosedClientAccountGroupIds] = useState<string[]>(initialUiPrefs.closedClientAccountGroupIds);

  const pendingReportListQuery = useAccumulatedReportsPage({
    summary: true,
    reviewQueue: true,
    projectActive: true,
    projectSort: projectSortDir,
    pageSize: REPORT_PAGE_SIZE
  }, tab === 'pendentes');
  const approvedReportListQuery = useAccumulatedReportsPage({
    summary: true,
    statuses: ['APPROVED', 'SIGNED'],
    projectActive: true,
    search: debouncedGestorSearch,
    projectSort: projectSortDir,
    pageSize: REPORT_PAGE_SIZE
  }, tab === 'aprovados');
  const archivedReportListQuery = useAccumulatedReportsPage({
    summary: true,
    statuses: ['APPROVED', 'SIGNED'],
    projectActive: false,
    search: debouncedGestorSearch,
    projectSort: projectSortDir,
    pageSize: REPORT_PAGE_SIZE
  }, tab === 'arquivados');
  const reportListQuery = tab === 'pendentes'
    ? pendingReportListQuery
    : tab === 'arquivados'
      ? archivedReportListQuery
      : approvedReportListQuery;
  const loadMoreReportsRef = useInfiniteScrollSentinel({
    hasMore: reportListQuery.hasMore,
    isLoading: reportListQuery.isLoadingMore,
    onLoadMore: reportListQuery.loadMore
  });
  // P7 — um único round-trip para os 3 totais de badges (antes: 3 queries `pageSize:1`).
  const reportCountsQuery = useReportCounts([
    { reviewQueue: true, projectActive: true },
    { status: 'APPROVED', projectActive: true },
    { status: 'SIGNED', projectActive: true }
  ]);
  const [pendingTotalCount, approvedTotalCount, signedTotalCount] = reportCountsQuery.data ?? [0, 0, 0];
  const draftsQuery = useDrafts();
  const gestorBootstrapQuery = useGestorBootstrap();
  const activeProjectsQuery = { data: gestorBootstrapQuery.data?.activeProjects, isLoading: gestorBootstrapQuery.isLoading };
  const commercialPendenciasQuery = useQuery({ queryKey: ['commercial-pendencias'], queryFn: getCommercialPendencias });
  const commercialPendenciaByProject = useMemo(() => {
    const map = new Map<string, { proposalCode: string; revisionCount: number; resolved: boolean }>();
    for (const pendencia of commercialPendenciasQuery.data || []) {
      map.set(pendencia.projectId, { proposalCode: pendencia.proposalCode, revisionCount: pendencia.revisionCount, resolved: pendencia.resolved });
    }
    return map;
  }, [commercialPendenciasQuery.data]);
  const archivedProjectsQuery = { data: gestorBootstrapQuery.data?.archivedProjects, isLoading: gestorBootstrapQuery.isLoading };
  const collaboratorsQuery = { data: gestorBootstrapQuery.data?.collaborators, isLoading: gestorBootstrapQuery.isLoading };
  const internalUsersQuery = useUsers('internal');
  const clientUsersQuery = useUsers('client');
  const surveysQuery = { data: gestorBootstrapQuery.data?.surveys, isLoading: gestorBootstrapQuery.isLoading };
  const projectSegmentsQuery = { data: gestorBootstrapQuery.data?.projectSegments, isLoading: gestorBootstrapQuery.isLoading };
  const surveyQuestionsQuery = { data: gestorBootstrapQuery.data?.surveyQuestions, isLoading: gestorBootstrapQuery.isLoading };

  const projectMutations = useProjectMutations();
  const projectSegmentMutations = useProjectSegmentMutations();
  const surveyMutations = useSurveyMutations();
  const reportMutations = useReportMutations();
  const draftMutations = useDraftMutations();
  const collaboratorMutations = useCollaboratorMutations();
  const userMutations = useUserMutations();

  useEffect(() => {
    const nextTab = parseGestorTab(searchParams.get('tab'));
    setTab(current => current === nextTab ? current : nextTab);
  }, [searchParams]);

  useEffect(() => {
    const currentTab = parseGestorTab(searchParams.get('tab'));
    const tabParam = searchParams.get('tab');
    if (currentTab === tab && ((tab === 'pendentes' && !tabParam) || (tab !== 'pendentes' && tabParam === tab))) return;

    const nextParams = new URLSearchParams(searchParams);
    if (tab === 'pendentes') {
      nextParams.delete('tab');
    } else {
      nextParams.set('tab', tab);
    }
    setSearchParams(nextParams, { replace: true });
  }, [searchParams, setSearchParams, tab]);

  const pendingReports = useMemo(
    () =>
      (reportListQuery.items || []).filter(
        report => report.status === 'PENDING' || report.status === 'RETURNED' || hasActiveClientRejection(report)
      ),
    [reportListQuery.items]
  );

  const approvedReports = useMemo(
    () =>
      (reportListQuery.items || []).filter(
        report =>
          (report.status === 'APPROVED' || report.status === 'SIGNED') && report.project?.isActive !== false
      ),
    [reportListQuery.items]
  );

  const archivedReports = useMemo(
    () =>
      (reportListQuery.items || []).filter(
        report =>
          (report.status === 'APPROVED' || report.status === 'SIGNED') && report.project?.isActive === false
      ),
    [reportListQuery.items]
  );
  const pendingCount = tab === 'pendentes'
    ? reportListQuery.pagination?.total ?? pendingReports.length
    : pendingTotalCount;
  const approvedCount = approvedTotalCount;
  const signedCount = signedTotalCount;
  const pendingProjectRegistrationCount = (activeProjectsQuery.data || [])
    .filter(project => project.isActive !== false)
    .filter(projectRegistrationPending)
    .length;

  useEffect(() => {
    if (tab !== 'arquivados') return;
    const archivedProjects = (archivedProjectsQuery.data || []).filter(project => project.isActive === false);
    archivedProjects.forEach(project => {
      if (closedArchivedProjectIds.includes(project.id)) return;
      reportListQuery.projectTypeTotals(project.id).forEach(typeTotal => {
        const typeKey = `${project.id}-${typeTotal.reportType}`;
        if (closedArchivedTypeKeys.includes(typeKey)) return;
        void reportListQuery.ensureGroupPage({
          projectId: project.id,
          reportType: typeTotal.reportType,
          pageSize: REPORT_TYPE_PAGE_SIZE,
          sortDirection: archivedTypeSortDirections[typeKey] || 'asc'
        });
      });
    });
  }, [
    archivedProjectsQuery.data,
    archivedTypeSortDirections,
    closedArchivedProjectIds,
    closedArchivedTypeKeys,
    reportListQuery,
    tab
  ]);

  const gestorScrollStorageKey = `gestor-scroll:${user?.id || user?.username || 'anonymous'}:${tab}`;

  useEffect(() => {
    const container = pageScrollRef.current;
    if (!container) return;

    const saveScroll = () => {
      sessionStorage.setItem(gestorScrollStorageKey, String(container.scrollTop));
    };
    container.addEventListener('scroll', saveScroll, { passive: true });
    return () => {
      saveScroll();
      container.removeEventListener('scroll', saveScroll);
    };
  }, [gestorScrollStorageKey]);

  useEffect(() => {
    const container = pageScrollRef.current;
    if (!container || reportListQuery.isLoading) return;
    if (restoredScrollKeysRef.current.has(gestorScrollStorageKey)) return;

    const stored = Number(sessionStorage.getItem(gestorScrollStorageKey) || '0');
    if (!Number.isFinite(stored) || stored <= 0) {
      restoredScrollKeysRef.current.add(gestorScrollStorageKey);
      return;
    }

    restoredScrollKeysRef.current.add(gestorScrollStorageKey);
    restoreScrollTop(container, stored);
  }, [
    gestorScrollStorageKey,
    reportListQuery.isLoading,
    pendingReports.length,
    approvedReports.length,
    archivedReports.length,
    draftsQuery.data?.length
  ]);

  const clientGroupingProjects = useMemo(
    () => [...(activeProjectsQuery.data || []), ...(archivedProjectsQuery.data || [])],
    [activeProjectsQuery.data, archivedProjectsQuery.data]
  );
  const manualReportProjectOptions = useMemo(() => {
    const byId = new Map<string, Project>();
    [...(activeProjectsQuery.data || []), ...(archivedProjectsQuery.data || [])]
      .filter(project => !projectRegistrationPending(project))
      .forEach(project => byId.set(project.id, project));
    return sortProjects(Array.from(byId.values()), 'asc');
  }, [activeProjectsQuery.data, archivedProjectsQuery.data]);

  useEffect(() => {
    setSelectedReportIds([]);
  }, [gestorSearch, tab]);

  useEffect(() => {
    const prefs = readGestorUiPrefs(gestorUiPrefsStorageKey);
    setProjectSortDir(prefs.projectSortDir);
    setClosedArchivedProjectIds(prefs.closedArchivedProjectIds);
    setClosedArchivedTypeKeys(prefs.closedArchivedTypeKeys);
    setArchivedTypeSortDirections(prefs.archivedTypeSortDirections);
    setClosedClientAccountGroupIds(prefs.closedClientAccountGroupIds);
  }, [gestorUiPrefsStorageKey]);

  useEffect(() => {
    writeGestorUiPrefs(gestorUiPrefsStorageKey, {
      projectSortDir,
      closedArchivedProjectIds,
      closedArchivedTypeKeys,
      archivedTypeSortDirections,
      closedClientAccountGroupIds
    });
  }, [
    gestorUiPrefsStorageKey,
    projectSortDir,
    closedArchivedProjectIds,
    closedArchivedTypeKeys,
    archivedTypeSortDirections,
    closedClientAccountGroupIds
  ]);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(projectDetailsStorageKey);
      const parsed = stored ? JSON.parse(stored) : [];
      setCollapsedProjectDetailIds(Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : []);
    } catch {
      setCollapsedProjectDetailIds([]);
    }
  }, [projectDetailsStorageKey]);

  function persistCollapsedProjectDetails(ids: string[]) {
    try {
      localStorage.setItem(projectDetailsStorageKey, JSON.stringify(ids));
    } catch {
      // localStorage can be unavailable in private or restricted contexts.
    }
  }

  function projectDetailsExpanded(projectId: string) {
    return !collapsedProjectDetailIds.includes(projectId);
  }

  function toggleProjectDetails(project: Project) {
    setCollapsedProjectDetailIds(current => {
      const next = current.includes(project.id)
        ? current.filter(id => id !== project.id)
        : [...current, project.id];
      persistCollapsedProjectDetails(next);
      return next;
    });
  }

  function toggleArchivedProject(projectId: string) {
    setClosedArchivedProjectIds(current =>
      current.includes(projectId) ? current.filter(id => id !== projectId) : [...current, projectId]
    );
  }

  function toggleArchivedType(typeKey: string) {
    setClosedArchivedTypeKeys(current =>
      current.includes(typeKey) ? current.filter(id => id !== typeKey) : [...current, typeKey]
    );
  }

  function toggleArchivedTypeSort(typeKey: string) {
    setArchivedTypeSortDirections(current => ({
      ...current,
      [typeKey]: (current[typeKey] || 'asc') === 'asc' ? 'desc' : 'asc'
    }));
  }

  function visibleArchivedTypeLimit(typeKey: string) {
    return archivedVisibleByType[typeKey] || REPORT_TYPE_PAGE_SIZE;
  }

  function revealMoreArchivedType(typeKey: string, total: number) {
    setArchivedVisibleByType(current => ({
      ...current,
      [typeKey]: Math.min(total, (current[typeKey] || REPORT_TYPE_PAGE_SIZE) + REPORT_TYPE_PAGE_SIZE)
    }));
  }

  async function handleLoadMoreArchivedType(
    projectId: string,
    reportType: string,
    typeKey: string,
    loadedCount: number,
    hasLoadedItemsToReveal: boolean,
    sortDirection: 'asc' | 'desc'
  ) {
    if (!hasLoadedItemsToReveal) {
      const loaded = await reportListQuery.loadMoreGroup({
        projectId,
        reportType,
        loadedCount,
        pageSize: REPORT_TYPE_PAGE_SIZE,
        sortDirection
      });
      if (loaded === false) return;
    }
    setArchivedVisibleByType(current => ({
      ...current,
      [typeKey]: (current[typeKey] || REPORT_TYPE_PAGE_SIZE) + REPORT_TYPE_PAGE_SIZE
    }));
  }

  function toggleClientAccountGroup(groupId: string) {
    setClosedClientAccountGroupIds(current =>
      current.includes(groupId) ? current.filter(id => id !== groupId) : [...current, groupId]
    );
  }

  async function handleLogout() {
    await logout();
    navigate('/', { replace: true });
  }

  function handleNewReport() {
    reset();
    navigate(rdoPath('/relatorio/novo'));
  }

  function handleResumeDraft(draft: ReportDraft) {
    const payload = draft.payload || {};

    hydrate({
      draftId: draft.id,
      serviceOnly: asBoolean(payload.serviceOnly),
      projectId: asString(payload.projectId, draft.projectId || '') || null,
      reportDate: asString(payload.reportDate, draft.reportDate || ''),
      arrivalTime: asString(payload.arrivalTime),
      departureTime: asString(payload.departureTime),
      lunchBreak: asString(payload.lunchBreak, '01:00:00'),
      collaboratorIds: asStringArray(payload.collaboratorIds),
      nightCollaboratorIds: asStringArray(payload.nightCollaboratorIds),
      standby: asBoolean(payload.standby),
      standbyDuration: asString(payload.standbyDuration),
      standbyMotivo: asString(payload.standbyMotivo),
      noturno: asBoolean(payload.noturno),
      noturnoStart: asString(payload.noturnoStart),
      noturnoEnd: asString(payload.noturnoEnd),
      noturnoInterval: asString(payload.noturnoInterval, '01:00:00'),
      overtimeReason: asString(payload.overtimeReason),
      dailyDescription: asString(payload.dailyDescription),
      generalUploads: Array.isArray(payload.generalUploads) ? payload.generalUploads : [],
      services: asServices(payload.services)
    });

    navigate(rdoPath('/relatorio/novo'));
  }

  function resetProjectForm() {
    setProjectForm(emptyProjectForm);
    setProjectEditingId(null);
    setShowProjectForm(false);
  }

  function openSegmentForm() {
    setSegmentLabel('');
    setShowSegmentForm(true);
  }

  function closeSegmentForm() {
    setShowSegmentForm(false);
    setSegmentLabel('');
  }

  function resetCollaboratorForm() {
    setCollaboratorForm(emptyCollaboratorForm);
    setCollaboratorEditingId(null);
    setShowCollaboratorForm(false);
  }

  function resetUserForm() {
    setUserForm(emptyUserForm);
    setUserEditingId(null);
    setShowUserForm(false);
  }

  function openNewCollaboratorForm() {
    setCollaboratorForm(emptyCollaboratorForm);
    setCollaboratorEditingId(null);
    setShowCollaboratorForm(true);
  }

  function openNewUserForm() {
    setUserForm(emptyUserForm);
    setUserEditingId(null);
    setShowUserForm(true);
  }

  function handleCollaboratorSignatureFile(file: File | null) {
    if (!file) {
      setCollaboratorForm(current => ({ ...current, signatureImage: '', signatureNoticeAccepted: false }));
      return;
    }
    void (async () => {
      try {
        const dataUrl = await fileToDataUrl(file);
        setCollaboratorForm(current => ({ ...current, signatureImage: dataUrl, signatureNoticeAccepted: false }));
      } catch (error) {
        showToast(error instanceof Error ? error.message : 'Não foi possível carregar a assinatura.', 'error');
      }
    })();
  }

  function renderCollaboratorSignatureField() {
    const normalizedSignature = normalizeSignatureImage(collaboratorForm.signatureImage);

    return (
      <div className="field-group field-group-wide collaborator-signature-field">
        <label>Assinatura</label>
        <ImageDropzone
          previewSrc={normalizedSignature || undefined}
          ariaLabel="Carregar assinatura"
          placeholder="Arraste a assinatura aqui"
          onFile={handleCollaboratorSignatureFile}
        />
        <div className="form-hint">Aceita apenas uma imagem.</div>
        {normalizedSignature ? (
          <PrivacyNotice
            variant="collaboratorSignature"
            checked={collaboratorForm.signatureNoticeAccepted}
            onCheckedChange={checked => setCollaboratorForm(current => ({
              ...current,
              signatureNoticeAccepted: checked
            }))}
          />
        ) : null}
      </div>
    );
  }

  async function handleProjectSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const payload = {
      code: projectForm.code.trim(),
      name: projectForm.name.trim(),
      clientName: projectForm.clientName.trim(),
      clientCnpj: projectForm.clientCnpj.trim(),
      clientEmailPrimary: projectForm.clientEmailPrimary.trim().toLowerCase(),
      clientSignerFirstName: projectForm.clientSignerFirstName.trim(),
      clientSignerLastName: projectForm.clientSignerLastName.trim(),
      clientEmailCc: parseEmailList(projectForm.clientEmailCc),
      clientSigners: cleanSigners(projectForm.clientSigners),
      contractCode: projectForm.contractCode.trim(),
      location: projectForm.location.trim(),
      visibleToCollaborators: projectForm.visibleToCollaborators,
      managerOnly: projectForm.managerOnly,
      inhibitionServiceEnabled: projectForm.inhibitionServiceEnabled,
      requireServiceReportSignatures: projectForm.requireServiceReportSignatures,
      isActive: projectForm.isActive,
      operatorId: projectForm.operatorId || null,
      clientSegment: projectForm.clientSegment || null,
      authorizedUserIds: projectForm.authorizedUserIds,
      workdayHours: projectForm.workdayHours || '09:00',
      weekendWorkdayHours: projectForm.weekendWorkdayHours || '08:00',
      includesSaturday: projectForm.includesSaturday,
      includesSunday: projectForm.includesSunday,
      reportSequences: normalizeProjectReportSequences(projectForm.reportSequences)
    };

    try {
      if (projectEditingId) {
        await projectMutations.updateProject.mutateAsync({ id: projectEditingId, payload });
        showToast('Projeto atualizado.', 'success');
      } else {
        await projectMutations.createProject.mutateAsync(payload);
        showToast('Projeto criado.', 'success');
      }
      resetProjectForm();
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Não foi possível salvar o projeto.', 'error');
    }
  }

  async function handleSegmentSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const label = segmentLabel.trim();
    const slug = segmentSlugFromLabel(label);
    if (!label || !slug) return;

    try {
      const created = await projectSegmentMutations.createSegment.mutateAsync({
        label,
        slug,
        isActive: true,
        order: (projectSegmentsQuery.data || []).length + 1
      });
      setProjectForm(current => ({ ...current, clientSegment: created.slug }));
      closeSegmentForm();
      showToast('Segmento criado.', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Não foi possível criar o segmento.', 'error');
    }
  }

  async function applyProjectArchiveChange(project: Project, sendSurvey: boolean) {
    try {
      const shouldArchive = project.isActive;
      await projectMutations.updateProject.mutateAsync({
        id: project.id,
        payload: { isActive: !project.isActive }
      });
      if (sendSurvey) {
        await surveyMutations.sendProjectSurvey.mutateAsync(project.id);
        showToast('Projeto arquivado e pesquisa enviada ao cliente.', 'success');
      } else if (shouldArchive && !project.clientEmailPrimary) {
        showToast('Projeto arquivado. Cadastre o e-mail principal do cliente para enviar pesquisa.', 'info');
      } else {
        showToast(project.isActive ? 'Projeto arquivado.' : 'Projeto desarquivado.', 'success');
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Não foi possível atualizar o projeto.', 'error');
    }
  }

  async function handleProjectToggleArchive(project: Project) {
    if (project.isActive && project.clientEmailPrimary) {
      setArchiveSurveyProject(project);
      return;
    }
    await applyProjectArchiveChange(project, false);
  }

  async function handleArchiveSurveyChoice(sendSurvey: boolean) {
    const project = archiveSurveyProject;
    if (!project) return;
    setArchiveSurveyProject(null);
    await applyProjectArchiveChange(project, sendSurvey);
  }

  async function handleSendSurvey(project: Project) {
    try {
      await surveyMutations.sendProjectSurvey.mutateAsync(project.id);
      showToast('Pesquisa enviada ao cliente.', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Não foi possível enviar a pesquisa.', 'error');
    }
  }

  async function handleResendSurvey(survey: SatisfactionSurveySummary) {
    try {
      await surveyMutations.resendSurvey.mutateAsync(survey.id);
      showToast('Pesquisa reenviada ao cliente.', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Não foi possível reenviar a pesquisa.', 'error');
    }
  }

  function openSurveyQuestionEditor() {
    if (surveyQuestionsQuery.isLoading) {
      showToast('Carregando perguntas da pesquisa.', 'info');
      return;
    }
    setSurveyQuestionDrafts((surveyQuestionsQuery.data || []).map(surveyQuestionToDraft));
    setShowSurveyQuestionEditor(true);
  }

  function updateSurveyQuestionDraft(index: number, patch: Partial<SurveyQuestionDraft>) {
    setSurveyQuestionDrafts(current => current.map((question, itemIndex) => (
      itemIndex === index ? { ...question, ...patch } : question
    )));
  }

  function moveSurveyQuestion(fromIndex: number, toIndex: number) {
    if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0) return;
    setSurveyQuestionDrafts(current => {
      const next = [...current];
      const [item] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, item);
      return next;
    });
  }

  function addSurveyQuestionOption(index: number) {
    const question = surveyQuestionDrafts[index];
    if (!question) return;
    const option = (surveyOptionInputs[question.id] || '').trim();
    if (!option) return;
    const nextOptions = Array.from(new Set([...surveyDraftOptions(question), option]));
    updateSurveyQuestionDraft(index, { optionsText: nextOptions.join('\n') });
    setSurveyOptionInputs(current => ({ ...current, [question.id]: '' }));
  }

  function removeSurveyQuestionOption(index: number, option: string) {
    const question = surveyQuestionDrafts[index];
    if (!question) return;
    updateSurveyQuestionDraft(index, {
      optionsText: surveyDraftOptions(question).filter(item => item !== option).join('\n')
    });
  }

  function handleSurveyQuestionDragOver(event: DragEvent<HTMLElement>, questionId?: string) {
    event.preventDefault();
    if (questionId) setDragOverSurveyQuestionId(questionId);
    const container = surveyQuestionEditorListRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const edgeSize = 88;
    const scrollStep = 18;
    if (event.clientY < rect.top + edgeSize) {
      container.scrollTop -= scrollStep;
    } else if (event.clientY > rect.bottom - edgeSize) {
      container.scrollTop += scrollStep;
    }
  }

  function handleSurveyQuestionDragStart(event: DragEvent<HTMLButtonElement>, questionId: string) {
    setDraggedSurveyQuestionId(questionId);
    setDragOverSurveyQuestionId(questionId);
    const card = event.currentTarget.closest('.survey-question-card');
    if (card instanceof HTMLElement) {
      event.dataTransfer.setDragImage(card, Math.min(80, card.clientWidth / 2), 28);
    }
    event.dataTransfer.effectAllowed = 'move';
  }

  function addSurveyQuestionDraft() {
    setSurveyQuestionDrafts(current => [...current, newSurveyQuestionDraft()]);
    window.setTimeout(() => {
      const container = surveyQuestionEditorListRef.current;
      if (!container) return;
      container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
    }, 0);
  }

  function addSuggestedSurveyQuestion(template: Omit<SurveyQuestionDraft, 'id'>) {
    const normalizedLabel = template.label.trim().toLowerCase();
    if (surveyQuestionDrafts.some(question => question.label.trim().toLowerCase() === normalizedLabel)) {
      showToast('Essa pergunta sugerida já está na pesquisa.', 'info');
      return;
    }
    setSurveyQuestionDrafts(current => [...current, { ...template, id: `new-${Date.now()}` }]);
    window.setTimeout(() => {
      const container = surveyQuestionEditorListRef.current;
      if (!container) return;
      container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
    }, 0);
  }

  async function handleSurveyQuestionsSubmit(event: FormEvent) {
    event.preventDefault();
    const questions = surveyQuestionDrafts
      .map(draftToSurveyQuestion)
      .filter(question => question.label);
    if (!questions.length) {
      showToast('Mantenha ao menos uma pergunta na pesquisa.', 'error');
      return;
    }
    const invalidSelect = questions.find(question => question.type === 'SELECT' && !question.options.length);
    if (invalidSelect) {
      showToast(`Adicione opções para a pergunta: ${invalidSelect.label}`, 'error');
      return;
    }

    try {
      await surveyMutations.updateQuestions.mutateAsync(questions);
      setShowSurveyQuestionEditor(false);
      showToast('Perguntas da pesquisa atualizadas.', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Não foi possível atualizar a pesquisa.', 'error');
    }
  }

  async function handleProjectRemove(project: Project) {
    if (!window.confirm('Excluir este projeto? Se houver relatórios associados, o projeto será ocultado e os relatórios permanecerão preservados.')) return;

    try {
      await projectMutations.removeProject.mutateAsync(project.id);
      if (projectEditingId === project.id) resetProjectForm();
      showToast('Projeto excluído.', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Não foi possível excluir o projeto.', 'error');
    }
  }

  async function handleCollaboratorSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const signatureImage = collaboratorForm.signatureImage || null;

    if (signatureImage && !collaboratorForm.signatureNoticeAccepted) {
      showToast('Aceite o aviso de privacidade da assinatura do colaborador.', 'error');
      return;
    }

    const payload = {
      name: collaboratorForm.name.trim(),
      role: collaboratorForm.role.trim(),
      email: collaboratorForm.email.trim() || null,
      signatureImage,
      isActive: collaboratorForm.isActive,
      ...(signatureImage ? {
        signatureNoticeAccepted: true as const,
        signatureNoticeVersion: COLLABORATOR_SIGNATURE_NOTICE_VERSION
      } : {})
    };

    try {
      if (collaboratorEditingId) {
        await collaboratorMutations.updateCollaborator.mutateAsync({ id: collaboratorEditingId, payload });
        showToast('Colaborador atualizado.', 'success');
      } else {
        await collaboratorMutations.createCollaborator.mutateAsync(payload);
        showToast('Colaborador criado.', 'success');
      }
      resetCollaboratorForm();
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Não foi possível salvar o colaborador.', 'error');
    }
  }

  async function handleCollaboratorToggle(collaborator: Collaborator) {
    try {
      await collaboratorMutations.removeCollaborator.mutateAsync(collaborator.id);
      showToast('Colaborador removido.', 'success');
      if (collaboratorEditingId === collaborator.id) resetCollaboratorForm();
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Não foi possível remover o colaborador.', 'error');
    }
  }

  async function handleUserSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const basePayload = {
      username: userForm.username.trim(),
      name: userForm.name.trim(),
      email: userForm.email.trim() || null,
      role: userForm.role,
      collaboratorId: userForm.collaboratorId || null,
      isActive: userForm.isActive
    };

    try {
      if (userEditingId) {
        await userMutations.updateUser.mutateAsync({
          id: userEditingId,
          payload: {
            ...basePayload,
            ...(userForm.password.trim() ? { password: userForm.password.trim() } : {})
          }
        });
        showToast('Usuário atualizado.', 'success');
      } else {
        await userMutations.createUser.mutateAsync({
          ...basePayload,
          password: userForm.password.trim()
        });
        showToast('Usuário criado.', 'success');
      }
      resetUserForm();
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Não foi possível salvar o usuário.', 'error');
    }
  }

  async function handleUserDelete(id: string) {
    try {
      await userMutations.removeUser.mutateAsync(id);
      showToast('Usuário removido.', 'success');
      if (userEditingId === id) resetUserForm();
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Não foi possível remover o usuário.', 'error');
    }
  }

  async function handleResendClientAccess(id: string) {
    try {
      await userMutations.resendClientAccess.mutateAsync(id);
      showToast('E-mail de acesso reenviado.', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Não foi possível reenviar o acesso.', 'error');
    }
  }

  async function handleReportStatus(report: ReportSummary, status: 'APPROVED' | 'RETURNED', reviewNotes?: string | null) {
    try {
      await reportMutations.updateStatus.mutateAsync({
        id: report.id,
        payload: { status, reviewNotes }
      });
      if (status === 'RETURNED') setReturnReport(null);
      showToast(status === 'APPROVED' ? 'Relatório aprovado.' : 'Relatório devolvido.', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Não foi possível revisar o relatório.', 'error');
    }
  }

  async function handleReportDownload(report: ReportSummary, format: 'pdf' | 'docx') {
    const fileName = reportDownloadFileName(report, format);
    showToast(format === 'pdf' ? 'Gerando PDF...' : 'Gerando DOCX...', 'info');

    try {
      const blob = format === 'pdf' ? await downloadReportPdf(report.id) : await downloadReportDocx(report.id);
      downloadBlob(blob, fileName);
      showToast(format === 'pdf' ? 'PDF gerado com sucesso.' : 'DOCX baixado com sucesso.', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Não foi possível baixar o relatório.', 'error');
    }
  }

  async function handleReportDelete(report: ReportSummary) {
    if (!window.confirm('Arquivar este relatório? O registro permanecerá preservado no banco de dados.')) return;

    try {
      await reportMutations.deleteReport.mutateAsync(report.id);
      setSelectedReportIds(current => current.filter(id => id !== report.id));
      showToast('Relatório arquivado.', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Não foi possível arquivar o relatório.', 'error');
    }
  }

  function openReportSequenceEdit(report: ReportSummary) {
    setSequenceEditReport(report);
    setSequenceEditValue(report.sequenceNumber ? String(report.sequenceNumber) : '');
  }

  function closeReportSequenceEdit() {
    setSequenceEditReport(null);
    setSequenceEditValue('');
  }

  async function handleReportSequenceEditSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!sequenceEditReport) return;

    const normalizedValue = sequenceEditValue.trim();
    const sequenceNumber = /^\d+$/.test(normalizedValue) ? Number.parseInt(normalizedValue, 10) : NaN;
    if (!Number.isInteger(sequenceNumber) || sequenceNumber < 1) {
      showToast('Informe um número maior que zero.', 'error');
      return;
    }
    if (sequenceNumber === sequenceEditReport.sequenceNumber) {
      closeReportSequenceEdit();
      return;
    }

    try {
      await reportMutations.updateSequence.mutateAsync({
        id: sequenceEditReport.id,
        payload: { sequenceNumber }
      });
      closeReportSequenceEdit();
      showToast('Numeração atualizada.', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Não foi possível alterar a numeração.', 'error');
    }
  }

  function resetManualReportModal() {
    setManualReportModalOpen(false);
    setManualReportTarget(null);
    setManualReportForm(emptyManualReportForm);
  }

  function closeManualReportModal() {
    if (manualReportSubmitting) return;
    resetManualReportModal();
  }

  function openManualReportUpload(projectId = '') {
    setManualReportTarget(null);
    setManualReportForm({
      ...emptyManualReportForm,
      projectId: projectId || manualReportProjectOptions[0]?.id || '',
      reportDate: new Date().toISOString().slice(0, 10)
    });
    setManualReportModalOpen(true);
  }

  function openManualReportReplace(report: ReportSummary) {
    setManualReportTarget(report);
    setManualReportForm({
      projectId: report.projectId,
      reportType: report.reportType,
      sequenceNumber: report.sequenceNumber ? String(report.sequenceNumber) : '',
      reportDate: String(report.reportDate || '').slice(0, 10) || new Date().toISOString().slice(0, 10),
      signatureMode: manualReportSignatureMode(report),
      serviceEquipment: manualReportServiceField(report, ['Equipamento', 'Equipamento(s)']),
      serviceSystem: manualReportServiceField(report, ['Sistema']),
      fileName: '',
      pdfDataUrl: '',
      files: []
    });
    setManualReportModalOpen(true);
  }

  async function handleManualReportFile(file: File | null) {
    if (!file) {
      setManualReportForm(current => ({ ...current, fileName: '', pdfDataUrl: '' }));
      return;
    }
    const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
    if (!isPdf) {
      showToast('Selecione um arquivo PDF.', 'error');
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      showToast('O PDF deve ter no máximo 20 MB.', 'error');
      return;
    }
    try {
      const pdfDataUrl = await fileToDataUrl(file);
      setManualReportForm(current => ({ ...current, fileName: file.name, pdfDataUrl }));
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Não foi possível ler o PDF.', 'error');
    }
  }

  async function handleManualReportFiles(files: File[]) {
    if (!files.length) {
      setManualReportForm(current => ({ ...current, files: [] }));
      return;
    }

    const invalidFile = files.find(file => !(file.type === 'application/pdf' || /\.pdf$/i.test(file.name)));
    if (invalidFile) {
      showToast(`Selecione apenas arquivos PDF.`, 'error');
      return;
    }

    const oversizedFile = files.find(file => file.size > 20 * 1024 * 1024);
    if (oversizedFile) {
      showToast(`O PDF ${oversizedFile.name} deve ter no máximo 20 MB.`, 'error');
      return;
    }

    const baseDate = manualReportForm.reportDate || new Date().toISOString().slice(0, 10);
    const serviceEquipment = manualReportForm.serviceEquipment.trim();
    const serviceSystem = manualReportForm.serviceSystem.trim();

    try {
      const uploadFiles = await Promise.all(files.map(async file => ({
        id: manualReportFileId(),
        fileName: file.name,
        pdfDataUrl: await fileToDataUrl(file),
        sequenceNumber: '',
        reportDate: baseDate,
        serviceEquipment,
        serviceSystem
      })));
      setManualReportForm(current => ({
        ...current,
        files: [...current.files, ...uploadFiles]
      }));
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Não foi possível ler os PDFs.', 'error');
    }
  }

  function updateManualReportUploadFile(id: string, patch: Partial<ManualReportUploadFileState>) {
    setManualReportForm(current => ({
      ...current,
      files: current.files.map(file => file.id === id ? { ...file, ...patch } : file)
    }));
  }

  function removeManualReportUploadFile(id: string) {
    setManualReportForm(current => ({
      ...current,
      files: current.files.filter(file => file.id !== id)
    }));
  }

  async function handleManualReportSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (manualReportSubmitting) return;
    if (manualReportTarget && !manualReportForm.pdfDataUrl) {
      showToast('Selecione um PDF.', 'error');
      return;
    }
    if (!manualReportTarget && !manualReportForm.files.length) {
      showToast('Selecione ao menos um PDF.', 'error');
      return;
    }
    if (!manualReportTarget && !manualReportForm.projectId) {
      showToast('Selecione um projeto.', 'error');
      return;
    }
    if (!manualReportTarget && manualReportForm.files.some(file => !file.reportDate)) {
      showToast('Informe a data de todos os PDFs.', 'error');
      return;
    }

    const replacementServiceMetadata = manualReportForm.reportType !== 'RDO'
      ? {
          serviceEquipment: manualReportForm.serviceEquipment.trim(),
          serviceSystem: manualReportForm.serviceSystem.trim()
        }
      : {};

    const uploadFiles = manualReportForm.files.map(file => {
      const sequenceText = file.sequenceNumber.trim();
      const parsedSequenceNumber = sequenceText ? Number.parseInt(sequenceText, 10) : undefined;
      return {
        ...file,
        sequenceNumber: parsedSequenceNumber && parsedSequenceNumber > 0 ? parsedSequenceNumber : undefined,
        invalidSequenceNumber: parsedSequenceNumber !== undefined
          && (!Number.isInteger(parsedSequenceNumber) || parsedSequenceNumber < 1)
      };
    });

    if (!manualReportTarget && uploadFiles.some(file => file.invalidSequenceNumber)) {
      showToast('Informe numerações maiores que zero.', 'error');
      return;
    }

    setManualReportSubmitting(true);
    const uploadedFileIds: string[] = [];
    try {
      if (manualReportTarget) {
        await reportMutations.replaceManualReportPdf.mutateAsync({
          id: manualReportTarget.id,
          payload: {
            fileName: manualReportForm.fileName,
            ...replacementServiceMetadata,
            pdfDataUrl: manualReportForm.pdfDataUrl,
            signatureMode: manualReportForm.signatureMode
          }
        });
        showToast('PDF substituído.', 'success');
      } else {
        for (const file of uploadFiles) {
          const serviceMetadata = manualReportForm.reportType !== 'RDO'
            ? {
                serviceEquipment: file.serviceEquipment.trim(),
                serviceSystem: file.serviceSystem.trim()
              }
            : {};
          await reportMutations.uploadManualReport.mutateAsync({
            projectId: manualReportForm.projectId,
            reportType: manualReportForm.reportType,
            sequenceNumber: file.sequenceNumber,
            reportDate: file.reportDate,
            fileName: file.fileName,
            ...serviceMetadata,
            pdfDataUrl: file.pdfDataUrl,
            signatureMode: manualReportForm.signatureMode
          });
          uploadedFileIds.push(file.id);
        }
        setTab('aprovados');
        showToast(uploadFiles.length === 1 ? 'Relatório antigo adicionado.' : `${uploadFiles.length} relatórios antigos adicionados.`, 'success');
      }
      resetManualReportModal();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Não foi possível salvar o relatório antigo.';
      if (!manualReportTarget && uploadedFileIds.length) {
        setManualReportForm(current => ({
          ...current,
          files: current.files.filter(file => !uploadedFileIds.includes(file.id))
        }));
        const label = uploadedFileIds.length === 1 ? '1 relatório foi adicionado' : `${uploadedFileIds.length} relatórios foram adicionados`;
        showToast(`${label}. ${message}`, 'error');
      } else {
        showToast(message, 'error');
      }
    } finally {
      setManualReportSubmitting(false);
    }
  }

  function toggleReportSelection(id: string, checked: boolean) {
    setSelectedReportIds(current => {
      const next = checked ? [...current, id] : current.filter(item => item !== id);
      return Array.from(new Set(next));
    });
  }

  async function handleBatchReportDownload(format: 'pdf' | 'docx', reports: ReportSummary[]) {
    const visibleIds = new Set(reports.map(report => report.id));
    const ids = selectedReportIds.filter(id => visibleIds.has(id));

    if (!ids.length) {
      showToast('Selecione ao menos um relatório desta aba.', 'error');
      return;
    }

    showToast('Gerando ZIP...', 'info');
    try {
      const blob = await downloadReportsBatch(ids, format);
      downloadBlob(blob, `relatorios_${format}_${new Date().toISOString().slice(0, 10)}.zip`);
      showToast('Download em lote concluído.', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Não foi possível baixar os relatórios.', 'error');
    }
  }

  function renderManagerReportActions(report: ReportSummary) {
    const canReview = tab === 'pendentes' && report.status !== 'SIGNED';
    const manualReport = isManualUploadedReport(report);

    return (
      <>
        <span className="report-download-actions">
          <button className="mini-btn alt" type="button" onClick={() => void handleReportDownload(report, 'pdf')}>
            PDF
          </button>
          {!manualReport ? (
            <button className="mini-btn alt" type="button" onClick={() => void handleReportDownload(report, 'docx')}>
              DOCX
            </button>
          ) : null}
        </span>
        {manualReport ? (
          <button
            className="mini-btn alt"
            type="button"
            disabled={reportMutations.replaceManualReportPdf.isPending}
            onClick={() => openManualReportReplace(report)}
          >
            Substituir PDF
          </button>
        ) : null}
        {canReview && report.status !== 'APPROVED' ? (
          <button
            className="mini-btn"
            type="button"
            title={hasActiveClientRejection(report) ? 'Reenviar para avaliação' : 'Aprovar'}
            onClick={() => void handleReportStatus(report, 'APPROVED')}
          >
            {hasActiveClientRejection(report) ? 'Reenviar' : 'Aprovar'}
          </button>
        ) : null}
        {canReview && report.status !== 'RETURNED' ? (
          <button className="mini-btn alt" type="button" onClick={() => setReturnReport(report)}>
            Devolver
          </button>
        ) : null}
        {report.status !== 'SIGNED' ? (
          <button
            className="mini-btn alt"
            type="button"
            disabled={reportMutations.updateSequence.isPending}
            onClick={() => openReportSequenceEdit(report)}
          >
            Nº
          </button>
        ) : null}
        {report.status !== 'SIGNED' ? (
          <button
            className="icon-button danger-icon-button"
            type="button"
            title="Arquivar relatório"
            aria-label="Arquivar relatório"
            disabled={reportMutations.deleteReport.isPending}
            onClick={() => void handleReportDelete(report)}
          >
            🗑
          </button>
        ) : null}
      </>
    );
  }

  function renderBatchReportActions(reports: ReportSummary[]) {
    const visibleIds = reports.map(report => report.id);
    const selectedVisibleCount = selectedReportIds.filter(id => visibleIds.includes(id)).length;
    const hasSelectedVisible = selectedVisibleCount > 0;

    return (
      <div className="report-batch-toolbar">
        <span className="report-batch-count">{selectedVisibleCount} selecionado(s)</span>
        <div className="admin-form-actions">
          <button className="mini-btn alt" type="button" onClick={() => setSelectedReportIds(visibleIds)}>
            Selecionar todos
          </button>
          {hasSelectedVisible ? (
            <>
              <button className="mini-btn alt" type="button" onClick={() => setSelectedReportIds([])}>
                Limpar seleção
              </button>
              <button className="mini-btn alt" type="button" onClick={() => void handleBatchReportDownload('pdf', reports)}>
                Baixar PDF
              </button>
              <button className="mini-btn alt" type="button" onClick={() => void handleBatchReportDownload('docx', reports)}>
                Baixar DOCX
              </button>
            </>
          ) : null}
        </div>
      </div>
    );
  }

  function renderProjectReportGroups(reports: ReportSummary[]) {
    return (
      <GroupedReportList
        reports={reports}
        archived={tab === 'arquivados'}
        sortDirection={projectSortDir}
        showTypeSort
        storageKey={`gestor-report-groups:${user?.id || user?.username || 'anonymous'}:${tab}`}
        renderTypeActions={renderBatchReportActions}
        onLoadMoreType={reportListQuery.loadMoreGroup}
        onEnsureTypePage={reportListQuery.ensureGroupPage}
        isTypePageReady={reportListQuery.isGroupPageReady}
        getTypeLoadedCount={reportListQuery.groupLoadedCount}
        hasMoreType={reportListQuery.hasMoreGroup}
        isTypeLoading={reportListQuery.isGroupLoading}
        isTypePageErrored={reportListQuery.isGroupError}
        getTypeTotal={reportListQuery.groupTotal}
        getProjectTypeTotals={reportListQuery.projectTypeTotals}
        renderReport={report => (
          <ReportSummaryCard
            key={report.id}
            report={report}
            leadingControl={(
              <label className="report-select-checkbox" title="Selecionar relatório">
                <input
                  type="checkbox"
                  checked={selectedReportIds.includes(report.id)}
                  onChange={event => toggleReportSelection(report.id, event.target.checked)}
                />
              </label>
            )}
            actions={renderManagerReportActions(report)}
          />
        )}
      />
    );
  }

  function renderReportTypeSections(reports: ReportSummary[], projectId?: string) {
    const byType = reports.reduce<Record<string, ReportSummary[]>>((acc, report) => {
      if (!acc[report.reportType]) acc[report.reportType] = [];
      acc[report.reportType].push(report);
      return acc;
    }, {});
    if (projectId) {
      reportListQuery.projectTypeTotals(projectId).forEach(typeTotal => {
        if (!byType[typeTotal.reportType]) byType[typeTotal.reportType] = [];
      });
    }

    return Object.entries(byType)
      .sort(([a], [b]) => compareReportTypes(a, b))
      .map(([reportType, typeReports]) => {
        const typeKey = `${projectId || 'project'}-${reportType}`;
        const typeClosed = closedArchivedTypeKeys.includes(typeKey);
        const typeSortDirection = archivedTypeSortDirections[typeKey] || 'asc';
        const sortedReports = sortReportsInGroup(typeReports, typeSortDirection);
        const visibleLimit = visibleArchivedTypeLimit(typeKey);
        const totalReports = projectId
          ? reportListQuery.groupTotal(projectId, reportType) ?? typeReports.length
          : typeReports.length;
        const typeErrored = projectId ? reportListQuery.isGroupError(projectId, reportType) : false;
        const orderedLoadedCount = projectId
          ? Math.min(
              reportListQuery.groupLoadedCount(projectId, reportType, REPORT_TYPE_PAGE_SIZE, typeSortDirection),
              totalReports
            )
          : typeReports.length;
        const needsOrderedPage = !!projectId
          && totalReports > 0
          && !typeErrored
          && !reportListQuery.isGroupPageReady(projectId, reportType, REPORT_TYPE_PAGE_SIZE, typeSortDirection);
        const orderedReports = sortedReports.slice(0, orderedLoadedCount);
        const visibleReports = needsOrderedPage ? [] : orderedReports.slice(0, visibleLimit);
        const hasLoadedItemsToReveal = !needsOrderedPage && visibleReports.length < orderedReports.length;
        const hasRemoteItemsToLoad = !!projectId
          && !needsOrderedPage
          && !hasLoadedItemsToReveal
          && orderedLoadedCount < totalReports;
        const typeLoading = projectId ? reportListQuery.isGroupLoading(projectId, reportType) : false;

        return (
          <div className="report-type-group" key={typeKey}>
            <div
              className="report-type-header"
              onClick={() => toggleArchivedType(typeKey)}
              role="button"
              tabIndex={0}
              onKeyDown={event => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  toggleArchivedType(typeKey);
                }
              }}
            >
              <span className={`rtype-badge rtype-${reportType}`}>{reportType}</span>
              <span className="rtype-count">
                {visibleReports.length} de {totalReports} relatório{totalReports !== 1 ? 's' : ''}
              </span>
              <span onClick={event => event.stopPropagation()}>
                <ProjectSortButton direction={typeSortDirection} onToggle={() => toggleArchivedTypeSort(typeKey)} />
              </span>
              <span className="rtype-chevron">{typeClosed ? '▸' : '▾'}</span>
            </div>
            {!typeClosed ? (
              <>
                {visibleReports.length ? renderBatchReportActions(visibleReports) : null}
                {visibleReports.length ? (
                  <div className="report-type-list">
                    {visibleReports.map(report => (
                      <ReportSummaryCard
                        key={report.id}
                        report={report}
                        leadingControl={(
                          <label className="report-select-checkbox" title="Selecionar relatório">
                            <input
                              type="checkbox"
                              checked={selectedReportIds.includes(report.id)}
                              onChange={event => toggleReportSelection(report.id, event.target.checked)}
                            />
                          </label>
                        )}
                        actions={renderManagerReportActions(report)}
                      />
                    ))}
                  </div>
                ) : null}
                {needsOrderedPage ? (
                  <div className="placeholder-copy">Carregando relatórios...</div>
                ) : null}
                {typeErrored ? (
                  <div className="placeholder-copy">Não foi possível carregar os relatórios desta aba.</div>
                ) : null}
                {hasLoadedItemsToReveal || hasRemoteItemsToLoad ? (
                  <div className="admin-create-toolbar report-type-load-more">
                    <InfiniteScrollSentinel
                      hasMore={(hasLoadedItemsToReveal || hasRemoteItemsToLoad) && !typeErrored}
                      isLoading={typeLoading}
                      onLoadMore={() => {
                        if (hasLoadedItemsToReveal) {
                          revealMoreArchivedType(typeKey, sortedReports.length);
                          return;
                        }
                        if (projectId) {
                          void handleLoadMoreArchivedType(projectId, reportType, typeKey, sortedReports.length, hasLoadedItemsToReveal, typeSortDirection);
                        }
                      }}
                    />
                    <button
                      className="mini-btn"
                      type="button"
                      disabled={typeLoading}
                      onClick={() => {
                        if (hasLoadedItemsToReveal) {
                          revealMoreArchivedType(typeKey, sortedReports.length);
                          return;
                        }
                        if (projectId) {
                          void handleLoadMoreArchivedType(projectId, reportType, typeKey, sortedReports.length, hasLoadedItemsToReveal, typeSortDirection);
                        }
                      }}
                    >
                      {typeLoading ? 'Carregando...' : typeErrored ? 'Tentar novamente' : 'Carregar mais'}
                    </button>
                  </div>
                ) : null}
              </>
            ) : null}
          </div>
        );
      });
  }

  function renderManualReportModal() {
    const replacing = Boolean(manualReportTarget);
    const submitting = manualReportSubmitting || reportMutations.uploadManualReport.isPending || reportMutations.replaceManualReportPdf.isPending;
    const serviceReportSelected = manualReportForm.reportType !== 'RDO';
    const selectedPdfLabel = replacing
      ? manualReportForm.fileName
      : manualReportUploadListLabel(manualReportForm.files);

    return (
      <Modal
        open={manualReportModalOpen}
        onClose={closeManualReportModal}
        ariaLabelledBy="manual-report-upload-title"
        panelClassName="modal-card manual-report-modal"
      >
        <form className="admin-form admin-form-grid manual-report-form" onSubmit={handleManualReportSubmit}>
          <div className="section-title" id="manual-report-upload-title">
            {replacing ? 'Substituir PDF' : 'Upload de relatório antigo'}
          </div>
          <div className="field-group">
            <label htmlFor="manual-report-project">Projeto</label>
            <select
              id="manual-report-project"
              value={manualReportForm.projectId}
              disabled={replacing}
              onChange={event => setManualReportForm(current => ({ ...current, projectId: event.target.value }))}
              required
            >
              <option value="">Selecionar projeto...</option>
              {manualReportProjectOptions.map(project => (
                <option key={project.id} value={project.id}>
                  {[project.code, project.name].filter(Boolean).join(' - ')}
                </option>
              ))}
            </select>
          </div>
          <div className="field-group">
            <label htmlFor="manual-report-type">Tipo</label>
            <select
              id="manual-report-type"
              value={manualReportForm.reportType}
              disabled={replacing}
              onChange={event => {
                const reportType = event.target.value as ReportType;
                setManualReportForm(current => ({
                  ...current,
                  reportType,
                  ...(reportType === 'RDO' ? {
                    serviceEquipment: '',
                    serviceSystem: '',
                    files: current.files.map(file => ({ ...file, serviceEquipment: '', serviceSystem: '' }))
                  } : {})
                }));
              }}
            >
              {projectReportTypes.map(reportType => (
                <option key={reportType} value={reportType}>{reportType}</option>
              ))}
            </select>
          </div>
          {serviceReportSelected && replacing ? (
            <>
              <div className="field-group">
                <label htmlFor="manual-report-service-equipment">Equipamento</label>
                <input
                  id="manual-report-service-equipment"
                  value={manualReportForm.serviceEquipment}
                  onChange={event => setManualReportForm(current => ({ ...current, serviceEquipment: event.target.value }))}
                  placeholder="Equipamento do serviço"
                />
              </div>
              <div className="field-group">
                <label htmlFor="manual-report-service-system">Sistema</label>
                <input
                  id="manual-report-service-system"
                  value={manualReportForm.serviceSystem}
                  onChange={event => setManualReportForm(current => ({ ...current, serviceSystem: event.target.value }))}
                  placeholder="Sistema do serviço"
                />
              </div>
            </>
          ) : null}
          {replacing ? (
            <>
              <div className="field-group">
                <label htmlFor="manual-report-date">Data</label>
                <input
                  id="manual-report-date"
                  type="date"
                  value={manualReportForm.reportDate}
                  disabled
                  onChange={event => setManualReportForm(current => ({ ...current, reportDate: event.target.value }))}
                  required
                />
              </div>
              <div className="field-group">
                <label htmlFor="manual-report-sequence">Número</label>
                <input
                  id="manual-report-sequence"
                  type="number"
                  min={1}
                  step={1}
                  inputMode="numeric"
                  value={manualReportForm.sequenceNumber}
                  disabled
                  onChange={event => setManualReportForm(current => ({ ...current, sequenceNumber: event.target.value.replace(/\D/g, '') }))}
                  placeholder="Automático"
                />
              </div>
            </>
          ) : null}
          <div className="field-group">
            <label htmlFor="manual-report-signature-mode">Estado do PDF</label>
            <select
              id="manual-report-signature-mode"
              value={manualReportForm.signatureMode}
              onChange={event => setManualReportForm(current => ({ ...current, signatureMode: event.target.value as ManualReportFormState['signatureMode'] }))}
            >
              <option value="APPROVED">Aprovado (assinatura opcional)</option>
              <option value="REQUIRES_SIGNATURE">Precisa de assinatura</option>
              <option value="SIGNED">Já assinado</option>
            </select>
          </div>
          <div className="field-group-wide">
            <PdfDropzone
              id="manual-report-pdf"
              label={replacing ? 'PDF' : 'PDFs'}
              fileName={selectedPdfLabel}
              onFile={file => void handleManualReportFile(file)}
              multiple={!replacing}
              onFiles={files => void handleManualReportFiles(files)}
              disabled={submitting}
            />
          </div>
          {!replacing && manualReportForm.files.length ? (
            <div className="manual-report-file-list">
              {manualReportForm.files.map((file, index) => {
                const dateId = `manual-report-file-date-${file.id}`;
                const sequenceId = `manual-report-file-sequence-${file.id}`;
                const equipmentId = `manual-report-file-equipment-${file.id}`;
                const systemId = `manual-report-file-system-${file.id}`;
                return (
                  <div className="manual-report-file-card" key={file.id}>
                    <div className="manual-report-file-header">
                      <span className="manual-report-file-name">{index + 1}. {file.fileName}</span>
                      <button
                        className="mini-btn alt"
                        type="button"
                        disabled={submitting}
                        onClick={() => removeManualReportUploadFile(file.id)}
                      >
                        Remover
                      </button>
                    </div>
                    <div className={`manual-report-file-fields ${serviceReportSelected ? 'with-service' : ''}`}>
                      <div className="field-group">
                        <label htmlFor={dateId}>Data</label>
                        <input
                          id={dateId}
                          type="date"
                          value={file.reportDate}
                          onChange={event => updateManualReportUploadFile(file.id, { reportDate: event.target.value })}
                          required
                        />
                      </div>
                      <div className="field-group">
                        <label htmlFor={sequenceId}>Número</label>
                        <input
                          id={sequenceId}
                          type="number"
                          min={1}
                          step={1}
                          inputMode="numeric"
                          value={file.sequenceNumber}
                          onChange={event => updateManualReportUploadFile(file.id, { sequenceNumber: event.target.value.replace(/\D/g, '') })}
                          placeholder="Automático"
                        />
                      </div>
                      {serviceReportSelected ? (
                        <>
                          <div className="field-group">
                            <label htmlFor={equipmentId}>Equipamento</label>
                            <input
                              id={equipmentId}
                              value={file.serviceEquipment}
                              onChange={event => updateManualReportUploadFile(file.id, { serviceEquipment: event.target.value })}
                              placeholder="Equipamento do serviço"
                            />
                          </div>
                          <div className="field-group">
                            <label htmlFor={systemId}>Sistema</label>
                            <input
                              id={systemId}
                              value={file.serviceSystem}
                              onChange={event => updateManualReportUploadFile(file.id, { serviceSystem: event.target.value })}
                              placeholder="Sistema do serviço"
                            />
                          </div>
                        </>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : null}
          <div className="admin-form-actions manual-report-actions">
            <button className="secondary-button" type="button" disabled={submitting} onClick={closeManualReportModal}>
              Cancelar
            </button>
            <button className="primary-button" type="submit" disabled={submitting || (replacing ? !manualReportForm.pdfDataUrl : !manualReportForm.files.length)}>
              {submitting ? 'Salvando...' : replacing ? 'Substituir PDF' : manualReportForm.files.length > 1 ? 'Adicionar relatórios' : 'Adicionar relatório'}
            </button>
          </div>
        </form>
      </Modal>
    );
  }

  function renderLoadMoreReports() {
    const showButton = reportListQuery.hasMore || reportListQuery.isLoadingMore;
    return (
      <>
        <div ref={loadMoreReportsRef} aria-hidden="true" />
        {showButton ? (
          <div className="admin-create-toolbar">
            <button
              className="mini-btn"
              type="button"
              disabled={reportListQuery.isLoadingMore}
              onClick={reportListQuery.loadMore}
            >
              {reportListQuery.isLoadingMore ? 'Carregando...' : 'Carregar mais'}
            </button>
          </div>
        ) : null}
      </>
    );
  }

  function renderReportTabContent() {
    const sourceReports =
      tab === 'pendentes' ? pendingReports : tab === 'arquivados' ? archivedReports : approvedReports;
    const visibleReports = sourceReports;

    if (reportListQuery.isLoadingInitial) {
      return <ReportListSkeleton />;
    }

    const topActions = (
      <div className="admin-create-toolbar">
        {tab === 'pendentes' ? (
          <button className="mini-btn" type="button" onClick={handleNewReport}>
            + Criar Relatório
          </button>
        ) : null}
        <ProjectSortButton
          direction={projectSortDir}
          onToggle={() => setProjectSortDir(direction => direction === 'asc' ? 'desc' : 'asc')}
        />
      </div>
    );
    const drafts = (draftsQuery.data || []).filter(draft => draft.projectId || draft.payload.projectId);
    const draftsBlock = tab === 'pendentes' && drafts.length ? (
      <section className="page-card">
        <div className="section-title">Relatórios em andamento</div>
        <div className="admin-stack">
          {drafts.map(draft => (
            <article className="card admin-card" key={draft.id}>
              <div className="admin-card-head">
                <div>
                  <div className="admin-card-title">{draft.title || 'Relatório em andamento'}</div>
                  <div className="admin-card-meta">
                    <span>{draft.project?.code || draft.projectId || 'Projeto'}</span>
                    <span>{draftDateLabel(draft)}</span>
                    {(() => {
                      const count = Array.isArray((draft.payload as Record<string, unknown>).services)
                        ? (draft.payload as Record<string, unknown>).services as unknown[]
                        : [];
                      return count.length ? <span>{count.length} serviço(s)</span> : null;
                    })()}
                  </div>
                </div>
                <div className="admin-card-actions">
                  <button className="mini-btn alt" type="button" onClick={() => handleResumeDraft(draft)}>
                    Continuar
                  </button>
                  <button className="mini-btn danger" type="button" onClick={() => draftMutations.removeDraft.mutate(draft.id)}>
                    Excluir
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>
    ) : null;

    if (!visibleReports.length) {
      return (
        <>
          {topActions}
          {draftsBlock}
          <div className="page-card placeholder-copy">
            {tab === 'pendentes'
              ? 'Nenhum relatório pendente.'
              : tab === 'arquivados'
                ? 'Nenhum relatório arquivado.'
                : 'Nenhum relatório aprovado.'}
          </div>
        </>
      );
    }

    const reasonDialog = (
      <ReasonDialog
        open={!!returnReport}
        title="Devolver relatório"
        description="Informe o motivo da devolução do relatório."
        label="Motivo"
        confirmLabel="Devolver"
        requiredMessage="Informe um motivo para devolver o relatório."
        isSubmitting={reportMutations.updateStatus.isPending}
        onCancel={() => setReturnReport(null)}
        onConfirm={reason => {
          if (returnReport) void handleReportStatus(returnReport, 'RETURNED', reason);
        }}
      />
    );
    const sequenceDialog = (
      <Modal
        open={!!sequenceEditReport}
        onClose={closeReportSequenceEdit}
        ariaLabelledBy="report-sequence-edit-title"
      >
        <form className="admin-form" onSubmit={handleReportSequenceEditSubmit}>
          <div className="section-title" id="report-sequence-edit-title">Alterar numeração</div>
          <p className="placeholder-copy">
            {sequenceEditReport
              ? `Informe o novo número para ${sequenceEditReport.reportType}${sequenceEditReport.sequenceNumber ? ` ${sequenceEditReport.sequenceNumber}` : ''}.`
              : 'Informe o novo número do relatório.'}
          </p>
          <div className="field-group">
            <label htmlFor="report-sequence-edit-input">Novo número</label>
            <input
              id="report-sequence-edit-input"
              type="number"
              min={1}
              step={1}
              inputMode="numeric"
              value={sequenceEditValue}
              onChange={event => setSequenceEditValue(event.target.value)}
              required
            />
          </div>
          <div className="admin-form-actions sequence-dialog-actions">
            <button
              className="secondary-button"
              type="button"
              disabled={reportMutations.updateSequence.isPending}
              onClick={closeReportSequenceEdit}
            >
              Cancelar
            </button>
            <button className="primary-button" type="submit" disabled={reportMutations.updateSequence.isPending}>
              {reportMutations.updateSequence.isPending ? 'Salvando...' : 'Salvar número'}
            </button>
          </div>
        </form>
      </Modal>
    );

    return (
      <>
        {topActions}
        {draftsBlock}
        {renderProjectReportGroups(visibleReports)}
        {renderLoadMoreReports()}
        {reasonDialog}
        {sequenceDialog}
      </>
    );
  }

  function renderProjectsTab() {
    const allActiveProjects = (activeProjectsQuery.data || [])
      .filter(project => project.isActive !== false);
    const pendingRegistrationProjects = allActiveProjects.filter(projectRegistrationPending);
    const activeProjects = allActiveProjects
      .filter(project => !projectRegistrationPending(project))
      .filter(project => matchesSearch(projectSearchParts(project), gestorSearch));

    if (activeProjectsQuery.isLoading) {
      return <div className="page-card placeholder-copy">Carregando projetos...</div>;
    }

    const renderEditableProjectCard = (project: Project) => renderProjectCard(project, {
      commercialPendencia: commercialPendenciaByProject.get(project.id) ?? null,
      children: projectEditingId === project.id ? (
        <form className="admin-inline-form admin-inline-grid" onSubmit={handleProjectSubmit}>
            <div className="field-group">
              <label htmlFor={`project-code-${project.id}`}>Número da missão</label>
              <input id={`project-code-${project.id}`} value={projectForm.code} readOnly />
            </div>
            <div className="field-group">
              <label htmlFor={`project-name-${project.id}`}>Nome</label>
              <input id={`project-name-${project.id}`} value={projectForm.name} onChange={event => setProjectForm(current => ({ ...current, name: event.target.value }))} required />
            </div>
            <div className="field-group">
              <label htmlFor={`project-client-${project.id}`}>Cliente</label>
              <input id={`project-client-${project.id}`} value={projectForm.clientName} onChange={event => setProjectForm(current => ({ ...current, clientName: event.target.value }))} required />
            </div>
            <div className="field-group">
              <label htmlFor={`project-cnpj-${project.id}`}>CNPJ</label>
              <input id={`project-cnpj-${project.id}`} value={projectForm.clientCnpj} onChange={event => setProjectForm(current => ({ ...current, clientCnpj: normalizeCnpjInput(event.target.value) }))} required />
            </div>
            <ProjectClientFields form={projectForm} idPrefix={`project-${project.id}`} setForm={setProjectForm} />
            <div className="field-group">
              <label htmlFor={`project-contract-${project.id}`}>Contrato</label>
              <input id={`project-contract-${project.id}`} value={projectForm.contractCode} onChange={event => setProjectForm(current => ({ ...current, contractCode: event.target.value }))} />
            </div>
            <div className="field-group">
              <label htmlFor={`project-location-${project.id}`}>Local</label>
              <input id={`project-location-${project.id}`} value={projectForm.location} onChange={event => setProjectForm(current => ({ ...current, location: event.target.value }))} />
            </div>
            <div className="field-group">
              <label htmlFor={`project-operator-${project.id}`}>Operador responsável</label>
              <select id={`project-operator-${project.id}`} value={projectForm.operatorId} onChange={event => setProjectForm(current => ({ ...current, operatorId: event.target.value }))}>
                <option value="">Selecionar...</option>
                {(collaboratorsQuery.data || []).filter(item => item.isActive).map(item => (
                  <option key={item.id} value={item.id}>{item.name}</option>
                ))}
              </select>
            </div>
            <ProjectAuthorizedUsersFields
              form={projectForm}
              idPrefix={`project-${project.id}`}
              setForm={setProjectForm}
              users={internalUsersQuery.data || []}
            />
            <div className="field-group">
              <label htmlFor={`project-segment-${project.id}`}>Segmento do cliente</label>
              <select id={`project-segment-${project.id}`} value={projectForm.clientSegment} onChange={event => setProjectForm(current => ({ ...current, clientSegment: event.target.value }))}>
                <option value="">Selecionar segmento...</option>
                {(projectSegmentsQuery.data || []).map(s => (
                  <option key={s.slug} value={s.slug}>{s.label}</option>
                ))}
              </select>
              <button className="mini-btn alt" type="button" onClick={openSegmentForm}>+ Adicionar segmento</button>
            </div>
            <div className="field-group">
              <label htmlFor={`project-visible-${project.id}`}>Visibilidade / criação de relatórios</label>
              <select
                id={`project-visible-${project.id}`}
                value={projectVisibilityMode(projectForm)}
                onChange={event => setProjectForm(current => ({
                  ...current,
                  ...applyProjectVisibilityMode(event.target.value as ProjectVisibilityMode)
                }))}
              >
                <option value="manager-coordinator">Gestor e coordenador</option>
                <option value="all-authorized">Gestor, coordenador e colaboradores responsáveis</option>
                <option value="manager-only">Somente gestor</option>
              </select>
            </div>
            <div className="field-group">
              <label htmlFor={`project-inhibition-service-${project.id}`}>Serviço de inibição</label>
              <select
                id={`project-inhibition-service-${project.id}`}
                value={projectForm.inhibitionServiceEnabled ? 'true' : 'false'}
                onChange={event => setProjectForm(current => ({ ...current, inhibitionServiceEnabled: event.target.value === 'true' }))}
              >
                <option value="false">Não</option>
                <option value="true">Sim</option>
              </select>
            </div>
            <div className="field-group">
              <label>Assinatura de relatórios de serviço</label>
              <div className="tog-row project-toggle-row">
                <span className="tog-lbl">Exigir assinatura</span>
                <label className="tog">
                  <input
                    type="checkbox"
                    checked={projectForm.requireServiceReportSignatures}
                    onChange={event => setProjectForm(current => ({ ...current, requireServiceReportSignatures: event.target.checked }))}
                  />
                  <span className="tog-sl" />
                </label>
              </div>
            </div>
            <ProjectReportSequenceFields form={projectForm} idPrefix={`project-${project.id}`} setForm={setProjectForm} />
            <div className="field-group">
              <label htmlFor={`project-workday-${project.id}`}>Jornada padrão</label>
              <input id={`project-workday-${project.id}`} type="text" placeholder="09:00" value={projectForm.workdayHours} onChange={event => setProjectForm(current => ({ ...current, workdayHours: event.target.value }))} />
            </div>
            <div className="field-group">
              <label htmlFor={`project-weekend-${project.id}`}>Jornada fim de semana</label>
              <input id={`project-weekend-${project.id}`} type="text" placeholder="08:00" value={projectForm.weekendWorkdayHours} onChange={event => setProjectForm(current => ({ ...current, weekendWorkdayHours: event.target.value }))} />
            </div>
            <div className="field-group">
              <label htmlFor={`project-sat-${project.id}`}>Inclui sábado</label>
              <select id={`project-sat-${project.id}`} value={projectForm.includesSaturday ? 'true' : 'false'} onChange={event => setProjectForm(current => ({ ...current, includesSaturday: event.target.value === 'true' }))}>
                <option value="true">Sim</option>
                <option value="false">Não</option>
              </select>
            </div>
            <div className="field-group">
              <label htmlFor={`project-sun-${project.id}`}>Inclui domingo</label>
              <select id={`project-sun-${project.id}`} value={projectForm.includesSunday ? 'true' : 'false'} onChange={event => setProjectForm(current => ({ ...current, includesSunday: event.target.value === 'true' }))}>
                <option value="true">Sim</option>
                <option value="false">Não</option>
              </select>
            </div>
            <div className="admin-form-actions">
              <button className="mini-btn" type="submit" disabled={projectMutations.updateProject.isPending}>Salvar projeto</button>
              <button className="mini-btn alt" type="button" onClick={resetProjectForm}>Cancelar edição</button>
            </div>
        </form>
      ) : null,
      onEdit: item => {
        setProjectEditingId(item.id);
        setShowProjectForm(true);
        setProjectForm(projectToForm(item));
      },
      onToggleArchive: handleProjectToggleArchive,
      onRemove: handleProjectRemove,
      detailsExpanded: projectDetailsExpanded(project.id),
      onToggleDetails: toggleProjectDetails,
      onSendSurvey: handleSendSurvey,
      onResendSurvey: handleResendSurvey,
      surveyPending: surveyMutations.sendProjectSurvey.isPending || surveyMutations.resendSurvey.isPending,
      segments: projectSegmentsQuery.data
    });

    return (
      <>
        <section className="page-card project-admin-panel">
          <div className="admin-toolbar">
            <div className="sec">{projectEditingId ? 'Editar projeto' : 'Projetos ativos'}</div>
            <div className="admin-form-actions">
              <ProjectSortButton
                direction={projectSortDir}
                onToggle={() => setProjectSortDir(direction => direction === 'asc' ? 'desc' : 'asc')}
              />
              {!showProjectForm && !projectEditingId ? (
                <button
                  className="mini-btn"
                  type="button"
                  onClick={() => { setShowProjectForm(true); setProjectEditingId(null); setProjectForm(emptyProjectForm); }}
                >
                  + Novo projeto
                </button>
              ) : null}
            </div>
          </div>
          {showProjectForm && !projectEditingId ? (
            <div className="admin-inline-form">
              <div className="admin-section-head">
                <div className="section-title" style={{ marginBottom: 0 }}>Novo projeto</div>
                <button className="mini-btn alt" type="button" onClick={resetProjectForm}>Cancelar</button>
              </div>
              <form className="admin-inline-grid" onSubmit={handleProjectSubmit}>
                <div className="field-group">
                  <label htmlFor="project-code">Número da missão</label>
                  <input id="project-code" value={projectForm.code} onChange={event => setProjectForm(current => ({ ...current, code: event.target.value }))} required />
                </div>
                <div className="field-group">
                  <label htmlFor="project-name">Nome</label>
                  <input id="project-name" value={projectForm.name} onChange={event => setProjectForm(current => ({ ...current, name: event.target.value }))} required />
                </div>
                <div className="field-group">
                  <label htmlFor="project-client-name">Cliente</label>
                  <input id="project-client-name" value={projectForm.clientName} onChange={event => setProjectForm(current => ({ ...current, clientName: event.target.value }))} required />
                </div>
                <div className="field-group">
                  <label htmlFor="project-client-cnpj">CNPJ</label>
                  <input id="project-client-cnpj" value={projectForm.clientCnpj} onChange={event => setProjectForm(current => ({ ...current, clientCnpj: normalizeCnpjInput(event.target.value) }))} required />
                </div>
                <ProjectClientFields form={projectForm} idPrefix="project" setForm={setProjectForm} />
                <div className="field-group">
                  <label htmlFor="project-contract">Contrato</label>
                  <input id="project-contract" value={projectForm.contractCode} onChange={event => setProjectForm(current => ({ ...current, contractCode: event.target.value }))} />
                </div>
                <div className="field-group">
                  <label htmlFor="project-location">Local</label>
                  <input id="project-location" value={projectForm.location} onChange={event => setProjectForm(current => ({ ...current, location: event.target.value }))} />
                </div>
                <div className="field-group">
                  <label htmlFor="project-operator">Operador responsável</label>
                  <select id="project-operator" value={projectForm.operatorId} onChange={event => setProjectForm(current => ({ ...current, operatorId: event.target.value }))}>
                    <option value="">Selecionar...</option>
                    {(collaboratorsQuery.data || []).filter(item => item.isActive).map(item => (
                      <option key={item.id} value={item.id}>{item.name}</option>
                    ))}
                  </select>
                </div>
                <ProjectAuthorizedUsersFields
                  form={projectForm}
                  idPrefix="project"
                  setForm={setProjectForm}
                  users={internalUsersQuery.data || []}
                />
                <div className="field-group">
                  <label htmlFor="project-segment">Segmento do cliente</label>
                  <select id="project-segment" value={projectForm.clientSegment} onChange={event => setProjectForm(current => ({ ...current, clientSegment: event.target.value }))}>
                    <option value="">Selecionar segmento...</option>
                    {(projectSegmentsQuery.data || []).map(s => (
                      <option key={s.slug} value={s.slug}>{s.label}</option>
                    ))}
                  </select>
                  <button className="mini-btn alt" type="button" onClick={openSegmentForm}>+ Adicionar segmento</button>
                </div>
                <div className="field-group">
                  <label htmlFor="project-visible">Visibilidade / criação de relatórios</label>
                  <select
                    id="project-visible"
                    value={projectVisibilityMode(projectForm)}
                    onChange={event => setProjectForm(current => ({
                      ...current,
                      ...applyProjectVisibilityMode(event.target.value as ProjectVisibilityMode)
                    }))}
                  >
                    <option value="manager-coordinator">Gestor e coordenador</option>
                    <option value="all-authorized">Gestor, coordenador e colaboradores responsáveis</option>
                    <option value="manager-only">Somente gestor</option>
                  </select>
                </div>
                <div className="field-group">
                  <label htmlFor="project-inhibition-service">Serviço de inibição</label>
                  <select
                    id="project-inhibition-service"
                    value={projectForm.inhibitionServiceEnabled ? 'true' : 'false'}
                    onChange={event => setProjectForm(current => ({ ...current, inhibitionServiceEnabled: event.target.value === 'true' }))}
                  >
                    <option value="false">Não</option>
                    <option value="true">Sim</option>
                  </select>
                </div>
                <div className="field-group">
                  <label>Assinatura de relatórios de serviço</label>
                  <div className="tog-row project-toggle-row">
                    <span className="tog-lbl">Exigir assinatura</span>
                    <label className="tog">
                      <input
                        type="checkbox"
                        checked={projectForm.requireServiceReportSignatures}
                        onChange={event => setProjectForm(current => ({ ...current, requireServiceReportSignatures: event.target.checked }))}
                      />
                      <span className="tog-sl" />
                    </label>
                  </div>
                </div>
                <ProjectReportSequenceFields form={projectForm} idPrefix="project" setForm={setProjectForm} />
                <div className="field-group">
                  <label htmlFor="project-workday">Jornada padrão</label>
                  <input id="project-workday" type="text" placeholder="09:00" value={projectForm.workdayHours} onChange={event => setProjectForm(current => ({ ...current, workdayHours: event.target.value }))} />
                </div>
                <div className="field-group">
                  <label htmlFor="project-weekend">Jornada fim de semana</label>
                  <input id="project-weekend" type="text" placeholder="08:00" value={projectForm.weekendWorkdayHours} onChange={event => setProjectForm(current => ({ ...current, weekendWorkdayHours: event.target.value }))} />
                </div>
                <div className="field-group">
                  <label htmlFor="project-sat">Inclui sábado</label>
                  <select id="project-sat" value={projectForm.includesSaturday ? 'true' : 'false'} onChange={event => setProjectForm(current => ({ ...current, includesSaturday: event.target.value === 'true' }))}>
                    <option value="true">Sim</option>
                    <option value="false">Não</option>
                  </select>
                </div>
                <div className="field-group">
                  <label htmlFor="project-sun">Inclui domingo</label>
                  <select id="project-sun" value={projectForm.includesSunday ? 'true' : 'false'} onChange={event => setProjectForm(current => ({ ...current, includesSunday: event.target.value === 'true' }))}>
                    <option value="true">Sim</option>
                    <option value="false">Não</option>
                  </select>
                </div>
                <div className="admin-form-actions">
                  <button className="mini-btn" type="submit" disabled={projectMutations.createProject.isPending}>Criar projeto</button>
                </div>
              </form>
            </div>
          ) : null}
        </section>

        {pendingRegistrationProjects.length ? (
          <div className="project-registration-fixed-block">
            <div className="project-registration-alert project-registration-alert-panel">
              {pendingRegistrationProjects.length === 1
                ? 'Há 1 projeto criado pelo romaneio aguardando conclusão do cadastro.'
                : `Há ${pendingRegistrationProjects.length} projetos criados pelo romaneio aguardando conclusão do cadastro.`}
            </div>
            <div className="admin-stack">
              {sortProjects(pendingRegistrationProjects, projectSortDir).map(renderEditableProjectCard)}
            </div>
          </div>
        ) : null}

        {activeProjects.length ? (
          <div className="admin-stack">
            {sortProjects(activeProjects, projectSortDir).map(renderEditableProjectCard)}
          </div>
        ) : pendingRegistrationProjects.length ? null : (
          <div className="card admin-card">
            <div className="placeholder-copy">Nenhum projeto ativo.</div>
          </div>
        )}

      </>
    );
  }

  function renderArchivedProjectsTab() {
    const archivedProjects = (archivedProjectsQuery.data || []).filter(project => project.isActive === false);

    if (archivedProjectsQuery.isLoading || reportListQuery.isLoadingInitial) {
      return <div className="page-card placeholder-copy">Carregando projetos arquivados...</div>;
    }

    const archivedProjectCards = sortProjects(archivedProjects, projectSortDir)
      .map(project => {
        const projectReports = archivedReports.filter(report => report.projectId === project.id);
        const projectMatches = matchesSearch(projectSearchParts(project), gestorSearch);
        const filteredProjectReports = projectMatches
          ? projectReports
          : projectReports.filter(report => matchesSearch(reportSearchParts(report), gestorSearch));
        return {
          project,
          projectReports: filteredProjectReports,
          visible: filteredProjectReports.length > 0 || (!gestorSearch.trim() && projectMatches)
        };
      })
      .filter(item => item.visible);

    return (
      <section className="page-card">
        <div className="admin-section-head">
          <div className="section-title">Projetos arquivados</div>
          <ProjectSortButton
            direction={projectSortDir}
            onToggle={() => setProjectSortDir(direction => direction === 'asc' ? 'desc' : 'asc')}
          />
        </div>
        {archivedProjectCards.length ? (
          <div className="admin-stack">
            {archivedProjectCards.map(({ project, projectReports }) => {
              const projectClosed = closedArchivedProjectIds.includes(project.id);
              return renderProjectCard(project, {
                commercialPendencia: commercialPendenciaByProject.get(project.id) ?? null,
                children: (
                  <>
                    {projectReports.length ? (
                      <div className="admin-stack" style={{ marginTop: 14 }}>
                        {!projectClosed ? renderReportTypeSections(projectReports, project.id) : null}
                      </div>
                    ) : (
                      <div className="placeholder-copy" style={{ marginTop: 14 }}>
                        Nenhum relatório aprovado neste projeto arquivado.
                      </div>
                    )}
                  </>
                ),
                onEdit: item => {
                  setProjectEditingId(item.id);
                  setShowProjectForm(true);
                  setProjectForm(projectToForm(item));
                },
                onToggleArchive: handleProjectToggleArchive,
                onRemove: handleProjectRemove,
                detailsExpanded: projectDetailsExpanded(project.id),
                onToggleDetails: toggleProjectDetails,
                reportSectionExpanded: !projectClosed,
                reportCount: projectReports.length,
                onToggleReports: item => toggleArchivedProject(item.id),
                onSendSurvey: handleSendSurvey,
                onResendSurvey: handleResendSurvey,
                surveyPending: surveyMutations.sendProjectSurvey.isPending || surveyMutations.resendSurvey.isPending,
                segments: projectSegmentsQuery.data
              });
            })}
          </div>
        ) : (
          <p className="placeholder-copy">
            {gestorSearch.trim() ? 'Nenhum projeto arquivado encontrado.' : 'Nenhum projeto arquivado.'}
          </p>
        )}
        {renderLoadMoreReports()}
      </section>
    );
  }

  function renderEquipeTab() {
    if (collaboratorsQuery.isLoading) {
      return <div className="page-card placeholder-copy">Carregando colaboradores...</div>;
    }

    const collaborators = (collaboratorsQuery.data || [])
      .filter(collaborator => collaborator.isActive !== false)
      .filter(collaborator => matchesSearch(collaboratorSearchParts(collaborator), gestorSearch));

    return (
      <>
          <div className="admin-toolbar">
            <div className="sec">Equipe</div>
            {!showCollaboratorForm && !collaboratorEditingId ? (
	              <button
	                className="mini-btn"
	                type="button"
	                onClick={openNewCollaboratorForm}
	              >
	                + Novo colaborador
	              </button>
            ) : null}
          </div>
          {showCollaboratorForm && !collaboratorEditingId ? (
	          <form className="admin-inline-form" onSubmit={handleCollaboratorSubmit} autoComplete="off">
	            <div className="admin-toolbar full">
	              <div className="sec">Novo colaborador</div>
	              <button className="mini-btn alt" type="button" onClick={resetCollaboratorForm}>Cancelar</button>
	            </div>
	            <div className="admin-inline-grid">
	              <div className="field-group">
	                <label htmlFor="collaborator-name">Nome</label>
	                <input
	                  id="collaborator-name"
	                  value={collaboratorForm.name}
	                  autoComplete="off"
	                  onChange={event => setCollaboratorForm(current => ({ ...current, name: event.target.value }))}
	                  required
	                />
	              </div>
	              <div className="field-group">
	                <label htmlFor="collaborator-role">Cargo</label>
	                <input
	                  id="collaborator-role"
	                  value={collaboratorForm.role}
	                  autoComplete="off"
	                  onChange={event => setCollaboratorForm(current => ({ ...current, role: event.target.value }))}
	                  required
	                />
	              </div>
	              <div className="field-group">
	                <label htmlFor="collaborator-email">E-mail</label>
	                <input
	                  id="collaborator-email"
	                  type="email"
	                  value={collaboratorForm.email}
	                  autoComplete="off"
	                  placeholder="email@empresa.com"
	                  onChange={event => setCollaboratorForm(current => ({ ...current, email: event.target.value }))}
	                />
	              </div>
	              <div className="field-group">
	                <label htmlFor="collaborator-active">Status</label>
	                <select
	                  id="collaborator-active"
	                  value={String(collaboratorForm.isActive)}
	                  onChange={event => setCollaboratorForm(current => ({ ...current, isActive: event.target.value === 'true' }))}
	                >
	                  <option value="true">Ativo</option>
	                  <option value="false">Inativo</option>
	                </select>
	              </div>
	              {renderCollaboratorSignatureField()}
	              <div className="admin-form-actions">
	                <button
	                  className="mini-btn"
	                  type="submit"
	                  disabled={
	                    collaboratorMutations.createCollaborator.isPending ||
	                    collaboratorMutations.updateCollaborator.isPending
	                  }
	                >
	                  Salvar
	                </button>
	              </div>
	            </div>
	          </form>
          ) : null}

          {collaborators.length ? (
            <div className="admin-stack">
              {collaborators.map(collaborator => (
                <article className="card admin-card" key={collaborator.id}>
                  <div className="admin-item-row">
                    <div className="admin-avatar" aria-hidden="true">{initials(collaborator.name)}</div>
                    <div className="admin-item-main">
                      <div className="admin-item-title">{collaborator.name}</div>
                      <div className="admin-item-sub">
                        {collaborator.role || '-'}{collaborator.email ? ` - ${collaborator.email}` : ''}
                      </div>
                    </div>
                    <div className="admin-actions collaborator-card-actions">
                      <button
                        className="mini-btn alt"
                        type="button"
                        onClick={() => {
                          setCollaboratorEditingId(collaborator.id);
                          setShowCollaboratorForm(true);
                          setCollaboratorForm(collaboratorToForm(collaborator));
                        }}
                      >
                        Editar
                      </button>
                      <button
                        className="mini-btn danger"
                        type="button"
                        onClick={() => void handleCollaboratorToggle(collaborator)}
                      >
                        Remover
                      </button>
                    </div>
                  </div>
	                  {collaboratorEditingId === collaborator.id ? (
	                    <form className="admin-inline-form" onSubmit={handleCollaboratorSubmit} autoComplete="off">
	                      <div className="admin-toolbar full">
	                        <div className="sec">Editar colaborador</div>
	                        <button className="mini-btn alt" type="button" onClick={resetCollaboratorForm}>Cancelar</button>
	                      </div>
	                      <div className="admin-inline-grid">
	                        <div className="field-group">
	                          <label htmlFor={`collaborator-name-${collaborator.id}`}>Nome</label>
	                          <input
	                            id={`collaborator-name-${collaborator.id}`}
	                            value={collaboratorForm.name}
	                            autoComplete="off"
	                            onChange={event => setCollaboratorForm(current => ({ ...current, name: event.target.value }))}
	                            required
	                          />
	                        </div>
	                        <div className="field-group">
	                          <label htmlFor={`collaborator-role-${collaborator.id}`}>Cargo</label>
	                          <input
	                            id={`collaborator-role-${collaborator.id}`}
	                            value={collaboratorForm.role}
	                            autoComplete="off"
	                            onChange={event => setCollaboratorForm(current => ({ ...current, role: event.target.value }))}
	                            required
	                          />
	                        </div>
	                        <div className="field-group">
	                          <label htmlFor={`collaborator-email-${collaborator.id}`}>E-mail</label>
	                          <input
	                            id={`collaborator-email-${collaborator.id}`}
	                            type="email"
	                            value={collaboratorForm.email}
	                            autoComplete="off"
	                            placeholder="email@empresa.com"
	                            onChange={event => setCollaboratorForm(current => ({ ...current, email: event.target.value }))}
	                          />
	                        </div>
	                        <div className="field-group">
	                          <label htmlFor={`collaborator-active-${collaborator.id}`}>Status</label>
	                          <select
	                            id={`collaborator-active-${collaborator.id}`}
	                            value={String(collaboratorForm.isActive)}
	                            onChange={event => setCollaboratorForm(current => ({ ...current, isActive: event.target.value === 'true' }))}
	                          >
	                            <option value="true">Ativo</option>
	                            <option value="false">Inativo</option>
	                          </select>
	                        </div>
	                        {renderCollaboratorSignatureField()}
	                        <div className="admin-form-actions">
	                          <button className="mini-btn" type="submit" disabled={collaboratorMutations.updateCollaborator.isPending}>Salvar</button>
	                        </div>
	                      </div>
	                    </form>
	                  ) : null}
                </article>
              ))}
            </div>
          ) : (
            <div className="card admin-card">
              <div className="placeholder-copy">Nenhum colaborador ativo.</div>
            </div>
          )}
      </>
    );
  }

  function renderUsuariosTab() {
    const internalUsers = (internalUsersQuery.data || [])
      .filter(item => matchesSearch(userSearchParts(item), gestorSearch));
    const clientUsers = (clientUsersQuery.data || [])
      .filter(item => matchesSearch(userSearchParts(item), gestorSearch));

    if (internalUsersQuery.isLoading || clientUsersQuery.isLoading) {
      return <div className="page-card placeholder-copy">{'Carregando usuários...'}</div>;
    }
    const showInternal = userAdminGroup === 'internal';

    return (
      <>
        <section className="page-card compact-link-card">
          <div className="filter-tabs" role="tablist" aria-label="Tipo de usuário" onKeyDown={handleHorizontalTabListKeyDown}>
            <button
              className={`filter-tab ${showInternal ? 'active' : ''}`}
              type="button"
              role="tab"
              aria-selected={showInternal}
              onClick={() => {
                setUserAdminGroup('internal');
              }}
            >
              Internos
            </button>
            <button
              className={`filter-tab ${!showInternal ? 'active' : ''}`}
              type="button"
              role="tab"
              aria-selected={!showInternal}
              onClick={() => {
                setUserAdminGroup('client');
                resetUserForm();
              }}
            >
              Clientes
            </button>
          </div>
        </section>

        {showInternal ? (
        <>
          <div className="admin-toolbar">
            <div className="sec">Usuários internos</div>
          {!showUserForm && !userEditingId ? (
	              <button
	                className="mini-btn"
	                type="button"
	                onClick={openNewUserForm}
	              >
                + Novo usuário
              </button>
          ) : null}
          </div>
          {showUserForm && !userEditingId ? (
	          <form className="admin-inline-form" onSubmit={handleUserSubmit} autoComplete="off">
	            <div className="admin-toolbar full">
	              <div className="sec">Novo usuário</div>
	              <button className="mini-btn alt" type="button" onClick={resetUserForm}>Cancelar</button>
	            </div>
	            <div className="admin-inline-grid">
	              <div className="field-group">
	                <label htmlFor="user-username">Usuário</label>
	                <input
	                  id="user-username"
	                  value={userForm.username}
	                  autoComplete="off"
	                  onChange={event => setUserForm(current => ({ ...current, username: event.target.value }))}
	                  required
	                />
	              </div>
	              <div className="field-group">
	                <label htmlFor="user-name">Nome</label>
	                <input
	                  id="user-name"
	                  value={userForm.name}
	                  autoComplete="off"
	                  onChange={event => setUserForm(current => ({ ...current, name: event.target.value }))}
	                  required
	                />
	              </div>
	              <div className="field-group">
	                <label htmlFor="user-email">E-mail</label>
	                <input
	                  id="user-email"
	                  type="email"
	                  value={userForm.email}
	                  autoComplete="off"
	                  placeholder="email@empresa.com"
	                  onChange={event => setUserForm(current => ({ ...current, email: event.target.value }))}
	                />
	              </div>
	              <div className="field-group">
	                <label htmlFor="user-role">Perfil</label>
	                <select
	                  id="user-role"
	                  value={userForm.role}
	                  onChange={event =>
	                    setUserForm(current => ({ ...current, role: event.target.value as Exclude<UserRole, 'CLIENT'> }))
	                  }
	                >
	                  {internalRoles.map(role => (
	                    <option key={role} value={role}>
	                      {formatUserRole(role)}
	                    </option>
	                  ))}
	                </select>
	              </div>
	              <div className="field-group">
	                <label htmlFor="user-active">Status</label>
	                <select
	                  id="user-active"
	                  value={String(userForm.isActive)}
	                  onChange={event => setUserForm(current => ({ ...current, isActive: event.target.value === 'true' }))}
	                >
	                  <option value="true">Ativo</option>
	                  <option value="false">Inativo</option>
	                </select>
	              </div>
	              <div className="field-group field-group-wide">
	                <label htmlFor="user-collaborator">Vincular colaborador</label>
	                <select
	                  id="user-collaborator"
	                  value={userForm.collaboratorId}
	                  onChange={event => setUserForm(current => ({ ...current, collaboratorId: event.target.value }))}
	                >
	                  <option value="">Sem vínculo</option>
	                  {(collaboratorsQuery.data || [])
	                    .filter(item => item.isActive)
	                    .map(item => (
	                      <option key={item.id} value={item.id}>
	                        {item.name}
	                      </option>
	                    ))}
	                </select>
	              </div>
	              <div className="field-group field-group-wide">
	                <label htmlFor="user-password">Senha</label>
	                <input
	                  id="user-password"
	                  type="password"
	                  value={userForm.password}
	                  autoComplete="new-password"
	                  onChange={event => setUserForm(current => ({ ...current, password: event.target.value }))}
	                  required
	                />
	              </div>
	              <div className="admin-form-actions">
	                <button
	                  className="mini-btn"
	                  type="submit"
	                  disabled={userMutations.createUser.isPending || userMutations.updateUser.isPending}
	                >
	                  Salvar
	                </button>
	              </div>
	            </div>
	          </form>
          ) : null}

          {internalUsers.length ? (
            <div className="admin-stack">
              {internalUsers.map(item => (
                <article className="card admin-card" key={item.id}>
                  <div className="admin-item-title">
                    {item.name} · {item.username}
                  </div>
	                  <div className="admin-item-sub">
	                    {formatUserRole(item.role)}
	                    {item.email ? ` · ${item.email}` : ''}
	                    {item.collaborator?.name ? ` · ${item.collaborator.name}` : ''}
	                  </div>
                  <div className="admin-actions">
                    <button
                      className="mini-btn alt"
                      type="button"
                      onClick={() => {
                        setUserEditingId(item.id);
                        setShowUserForm(true);
                        setUserForm(userToForm(item));
                      }}
                    >
                      Editar
                    </button>
                    <button className="mini-btn danger" type="button" onClick={() => void handleUserDelete(item.id)}>
                      Remover
                    </button>
                  </div>
	                  {userEditingId === item.id ? (
	                    <form className="admin-inline-form" onSubmit={handleUserSubmit} autoComplete="off">
	                      <div className="admin-toolbar full">
	                        <div className="sec">Editar usuário</div>
	                        <button className="mini-btn alt" type="button" onClick={resetUserForm}>Cancelar</button>
	                      </div>
	                      <div className="admin-inline-grid">
	                        <div className="field-group">
	                          <label htmlFor={`user-username-${item.id}`}>Usuário</label>
	                          <input
	                            id={`user-username-${item.id}`}
	                            value={userForm.username}
	                            autoComplete="off"
	                            onChange={event => setUserForm(current => ({ ...current, username: event.target.value }))}
	                            required
	                            readOnly
	                          />
	                        </div>
	                        <div className="field-group">
	                          <label htmlFor={`user-name-${item.id}`}>Nome</label>
	                          <input
	                            id={`user-name-${item.id}`}
	                            value={userForm.name}
	                            autoComplete="off"
	                            onChange={event => setUserForm(current => ({ ...current, name: event.target.value }))}
	                            required
	                          />
	                        </div>
	                        <div className="field-group">
	                          <label htmlFor={`user-email-${item.id}`}>E-mail</label>
	                          <input
	                            id={`user-email-${item.id}`}
	                            type="email"
	                            value={userForm.email}
	                            autoComplete="off"
	                            placeholder="email@empresa.com"
	                            onChange={event => setUserForm(current => ({ ...current, email: event.target.value }))}
	                          />
	                        </div>
	                        <div className="field-group">
	                          <label htmlFor={`user-role-${item.id}`}>Perfil</label>
	                          <select
	                            id={`user-role-${item.id}`}
	                            value={userForm.role}
	                            onChange={event => setUserForm(current => ({ ...current, role: event.target.value as Exclude<UserRole, 'CLIENT'> }))}
	                          >
	                            {internalRoles.map(role => <option key={role} value={role}>{formatUserRole(role)}</option>)}
	                          </select>
	                        </div>
	                        <div className="field-group">
	                          <label htmlFor={`user-active-${item.id}`}>Status</label>
	                          <select
	                            id={`user-active-${item.id}`}
	                            value={String(userForm.isActive)}
	                            onChange={event => setUserForm(current => ({ ...current, isActive: event.target.value === 'true' }))}
	                          >
	                            <option value="true">Ativo</option>
	                            <option value="false">Inativo</option>
	                          </select>
	                        </div>
	                        <div className="field-group field-group-wide">
	                          <label htmlFor={`user-collaborator-${item.id}`}>Vincular colaborador</label>
	                          <select
	                            id={`user-collaborator-${item.id}`}
	                            value={userForm.collaboratorId}
	                            onChange={event => setUserForm(current => ({ ...current, collaboratorId: event.target.value }))}
	                          >
	                            <option value="">Sem vínculo</option>
	                            {(collaboratorsQuery.data || [])
	                              .filter(collaborator => collaborator.isActive)
	                              .map(collaborator => (
	                                <option key={collaborator.id} value={collaborator.id}>
	                                  {collaborator.name}
	                                </option>
	                              ))}
	                          </select>
	                        </div>
	                        <div className="field-group field-group-wide">
	                          <label htmlFor={`user-password-${item.id}`}>Senha (opcional)</label>
	                          <input
	                            id={`user-password-${item.id}`}
	                            type="password"
	                            value={userForm.password}
	                            autoComplete="new-password"
	                            onChange={event => setUserForm(current => ({ ...current, password: event.target.value }))}
	                          />
	                        </div>
	                        <div className="admin-form-actions">
	                          <button className="mini-btn" type="submit" disabled={userMutations.updateUser.isPending}>Salvar</button>
	                        </div>
	                      </div>
	                    </form>
	                  ) : null}
                </article>
              ))}
            </div>
          ) : (
            <div className="card admin-card">
              <div className="placeholder-copy">Nenhum usuário interno cadastrado.</div>
            </div>
          )}
        </>
        ) : (
        <section className="client-accounts-panel">
          <div className="admin-section-head">
            <div>
              <div className="section-title">Clientes</div>
              <div className="admin-card-subtitle">Contas criadas automaticamente a partir dos projetos.</div>
            </div>
          </div>
          {(() => {
            // Group by CNPJ
            const groups: Record<string, { cnpj: string; clientName: string; primary: typeof clientUsers[0] | null; cc: typeof clientUsers }> = {};
            const noGroup: typeof clientUsers = [];

            const clientNameForCnpj = (cnpj: string) => {
              const project = clientGroupingProjects.find(item => item.clientCnpj.replace(/\D/g, '') === cnpj);
              if (!project) return '';
              return project.clientName || '';
            };

            clientUsers.forEach(item => {
              const rawUsername = String(item.username || '');
              const isPrimaryByCnpj = /^\d{14}$/.test(rawUsername.replace(/\D/g, '')) && rawUsername.replace(/\D/g, '').length === 14;
              let cnpj = item.clientCnpj ? item.clientCnpj.replace(/\D/g, '') : (isPrimaryByCnpj ? rawUsername.replace(/\D/g, '') : null);
              if (!cnpj) {
                const email = String(item.email || item.username || '').trim().toLowerCase();
                const linkedCnpj = (item.linkedProjects || []).find(project => project.clientCnpj)?.clientCnpj;
                const emailProject = clientGroupingProjects.find(project =>
                  (project.clientEmailCc || []).some(cc => cc.trim().toLowerCase() === email)
                );
                cnpj = String(linkedCnpj || emailProject?.clientCnpj || '').replace(/\D/g, '') || null;
              }
              if (cnpj) {
                if (!groups[cnpj]) groups[cnpj] = { cnpj, clientName: clientNameForCnpj(cnpj), primary: null, cc: [] };
                if (isPrimaryByCnpj && !groups[cnpj].primary) {
                  groups[cnpj].primary = item;
                  if (!groups[cnpj].clientName) groups[cnpj].clientName = item.name || '';
                } else {
                  groups[cnpj].cc.push(item);
                }
              } else {
                noGroup.push(item);
              }
            });

            const renderClientCard = (item: typeof clientUsers[0], isCc: boolean) => {
              return (
                <div className="card admin-card client-account-card" key={item.id}>
                  <div className="admin-item-title">{item.name || 'Cliente'}</div>
                  <div className="admin-item-sub client-account-email">
                    {item.email || item.username}{item.isActive === false ? ' - Inativo' : ''}
                  </div>
                  <div className="client-account-action-area">
                    <div className="client-account-badges">
                      {isCc ? <span className="status-pill status-pending" style={{ fontSize: 10 }}>CC / Assinante</span> : null}
                      <span className={`status-pill ${item.isActive ? 'status-approved' : 'status-returned'}`}>{item.isActive ? 'Ativo' : 'Inativo'}</span>
                    </div>
                    <div className="client-account-button-row">
                      <button className="mini-btn alt" type="button" disabled={userMutations.resendClientAccess.isPending} onClick={() => void handleResendClientAccess(item.id)}>Reenviar acesso</button>
                      <button className="mini-btn danger" type="button" onClick={() => void handleUserDelete(item.id)}>Remover</button>
                    </div>
                  </div>
                </div>
              );
            };

            if (!clientUsers.length) return <p className="placeholder-copy">Nenhum cliente provisionado.</p>;

            return (
              <div className="admin-stack">
                {Object.values(groups).map(g => {
                  const closed = closedClientAccountGroupIds.includes(g.cnpj);
                  const linkedProjects = sortProjects(
                    clientGroupingProjects.filter(project => project.clientCnpj.replace(/\D/g, '') === g.cnpj),
                    'asc'
                  );
                  const title = g.clientName || clientNameForCnpj(g.cnpj) || g.cnpj;
                  const missionSummary = Array.from(new Set(
                    linkedProjects
                      .map(project => [project.code, project.name].filter(Boolean).join(' - ') || project.name)
                      .filter(Boolean)
                  )).join(', ');
                  return (
                    <article className="card admin-card" key={g.cnpj}>
                      <button
                        className="client-account-group-toggle"
                        type="button"
                        onClick={() => toggleClientAccountGroup(g.cnpj)}
                      >
                        <span className="rtype-chevron">{closed ? '▸' : '▾'}</span>
                        <span>{title}</span>
                      </button>
                      <div className="client-account-group-meta">
                        <span>{formatCnpj(g.cnpj)}</span>
                        {missionSummary ? <span>Missões: {missionSummary}</span> : null}
                      </div>
                      {!closed ? (
                        <>
                          {g.primary ? renderClientCard(g.primary, false) : null}
                          {g.cc.map(u => renderClientCard(u, true))}
                        </>
                      ) : null}
                    </article>
                  );
                })}
                {noGroup.length ? (
                  <article className="card admin-card">
                    <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 8 }}>Sem CNPJ associado</div>
                    {noGroup.map(u => renderClientCard(u, true))}
                  </article>
                ) : null}
              </div>
            );
          })()}
        </section>
        )}
      </>
    );
  }


  function renderNpsTab() {
    const surveys = (surveysQuery.data || [])
      .filter(survey => {
        const status = surveyStatusLabel(survey).label.toLowerCase();
        const parts = [
          survey.project?.code,
          survey.project?.name,
          survey.project?.clientName,
          survey.emailTo,
          status
        ];
        return matchesSearch(parts, gestorSearch);
      });
    const surveyGroups = Array.from(surveys.reduce((groups, survey) => {
      const key = npsProjectKey(survey);
      const current = groups.get(key);
      if (current) {
        current.surveys.push(survey);
      } else {
        groups.set(key, { key, title: npsProjectTitle(survey), clientName: survey.project?.clientName || '-', surveys: [survey] });
      }
      return groups;
    }, new Map<string, { key: string; title: string; clientName: string; surveys: typeof surveys }>()).values())
      .map(group => ({
        ...group,
        surveys: group.surveys.sort((a, b) => new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime())
      }))
      .sort((a, b) => {
        const titleA = a.title;
        const titleB = b.title;
        return npsSortDir === 'asc'
          ? titleA.localeCompare(titleB, 'pt-BR', { numeric: true, sensitivity: 'base' })
          : titleB.localeCompare(titleA, 'pt-BR', { numeric: true, sensitivity: 'base' });
      });

    if (surveysQuery.isLoading) {
      return <div className="page-card placeholder-copy">Carregando pesquisas...</div>;
    }

    return (
      <>
      {npsDashboardOpen && <SurveyDashboardOverlay onClose={() => setNpsDashboardOpen(false)} />}
      <div className="nps-tab-toolbar">
        <div className="nps-tab-toolbar-left">
          <button className="mini-btn alt" type="button" onClick={openSurveyQuestionEditor}>
            Editar pesquisa
          </button>
        </div>
        <div className="nps-tab-toolbar-right">
          <button className="mini-btn" type="button" onClick={() => setNpsDashboardOpen(true)}>
            Dashboard NPS
          </button>
        </div>
      </div>
      <section className="nps-tab-content">
        <div className="nps-tab-heading">
          <div>
            <div className="section-title">NPS</div>
            <div className="admin-card-subtitle">Pesquisas pendentes, respondidas e expiradas.</div>
          </div>
          <ProjectSortButton
            direction={npsSortDir}
            onToggle={() => setNpsSortDir(direction => direction === 'asc' ? 'desc' : 'asc')}
          />
        </div>
        {surveyGroups.length ? (
          <div className="admin-stack">
            {surveyGroups.map(group => {
              return (
                <article className="card admin-card" key={group.key}>
                  <div className="admin-card-title">{group.title}</div>
                  <div className="admin-card-meta">
                    <span>{group.clientName}</span>
                    <span>{group.surveys.length} pesquisa{group.surveys.length !== 1 ? 's' : ''}</span>
                  </div>
                  <div className="admin-stack" style={{ marginTop: 12 }}>
                    {group.surveys.map((survey, index) => {
                      const status = surveyStatusLabel(survey);
                      const open = openSurveyId === survey.id;
                      const canResendSurvey = !survey.respondedAt && survey.project?.isActive === false;
                      return (
                        <div className="report-type-group" key={survey.id}>
                          <button
                            className="client-account-group-toggle"
                            type="button"
                            onClick={() => setOpenSurveyId(current => current === survey.id ? null : survey.id)}
                          >
                            <span className="rtype-chevron">{open ? '▾' : '▸'}</span>
                            <span>Pesquisa #{group.surveys.length - index}</span>
                          </button>
                          <div className="admin-card-meta">
                            <span>Enviada: {formatDate(survey.sentAt)}</span>
                            <span>Respondida: {survey.respondedAt ? formatDate(survey.respondedAt) : '-'}</span>
                            <span>Expira: {formatDate(survey.expiresAt)}</span>
                            <span className={`status-pill ${status.className}`}>{status.label}</span>
                            {canResendSurvey ? (
                              <button
                                className="mini-btn alt"
                                type="button"
                                disabled={surveyMutations.resendSurvey.isPending}
                                onClick={() => void handleResendSurvey(survey)}
                              >
                                Reenviar pesquisa
                              </button>
                            ) : null}
                          </div>
                          {open ? (
                            survey.respondedAt ? (
                              <div className="det-section" style={{ marginTop: 12 }}>
                                {npsResponseRows(survey.responses, survey.questions || []).map(([question, answer]) => (
                                  <div className="det-row" key={question}>
                                    <span className="det-label">{question}</span>
                                    <span className="det-val">{answer}</span>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <p className="placeholder-copy" style={{ marginTop: 12 }}>
                                {surveyIsExpired(survey)
                                  ? 'Pesquisa expirada sem resposta do cliente.'
                                  : 'Pesquisa enviada, aguardando resposta do cliente.'}
                              </p>
                            )
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <p className="placeholder-copy">
            {gestorSearch.trim() ? 'Nenhuma pesquisa encontrada.' : 'Nenhuma pesquisa NPS disponível.'}
          </p>
        )}
      </section>
      </>
    );
  }

  function renderGestorSearch() {
    const labels: Partial<Record<GestorTab, string>> = {
      aprovados: 'Buscar em aprovados',
      projetos: 'Buscar em projetos',
      arquivados: 'Buscar em arquivados',
      equipe: 'Buscar na equipe',
      usuarios: 'Buscar em usuários',
      nps: 'Buscar em pesquisas NPS'
    };
    const label = labels[tab];
    if (!label) return null;

    return (
      <div className="admin-search-row">
        <SearchBar value={gestorSearch} onChange={setGestorSearch} placeholder={label} ariaLabel={label} />
      </div>
    );
  }

  function renderEstatisticasTab() {
    return (
      <>
        {statsDashboardOpen && <StatsDashboardOverlay onClose={() => setStatsDashboardOpen(false)} />}
        {allocationDashboardOpen && <MonthlyAllocationDashboardOverlay onClose={() => setAllocationDashboardOpen(false)} />}
        <div className="nps-tab-toolbar">
          <div className="nps-tab-toolbar-left" />
          <div className="nps-tab-toolbar-right">
            <button className="mini-btn alt" type="button" onClick={() => setAllocationDashboardOpen(true)}>
              Alocação mensal
            </button>
            <button className="mini-btn" type="button" onClick={() => setStatsDashboardOpen(true)}>
              Dashboard detalhado
            </button>
          </div>
        </div>
        <StatsOverview />
      </>
    );
  }

  function renderTabContent() {
    if (tab === 'pendentes' || tab === 'aprovados') return renderReportTabContent();
    if (tab === 'projetos') return renderProjectsTab();
    if (tab === 'arquivados') return renderArchivedProjectsTab();
    if (tab === 'equipe') return renderEquipeTab();
    if (tab === 'usuarios') return renderUsuariosTab();
    if (tab === 'estatisticas') return renderEstatisticasTab();
    return renderNpsTab();
  }

  function renderReportSummary() {
    if (tab !== 'pendentes' && tab !== 'aprovados') return null;
    const approvedTotal = approvedCount + signedCount;

    return (
      <section className="page-card summary-card-compact">
        <div className="admin-section-head">
          <div className="section-title">Resumo</div>
          <button className="mini-btn" type="button" onClick={() => openManualReportUpload()}>
            Upload PDF antigo
          </button>
        </div>
        <div className="stats-grid stats-grid-compact">
          {tab === 'pendentes' ? (
            <div className="stat-card-react">
              <div className="stat-number-react">{pendingCount}</div>
              <div className="stat-label-react">Pendentes/devolvidos</div>
            </div>
          ) : null}
          <div className="stat-card-react">
            <div className="stat-number-react">{tab === 'aprovados' ? approvedCount : approvedTotal}</div>
            <div className="stat-label-react">Aprovados</div>
          </div>
          {tab === 'aprovados' ? (
            <div className="stat-card-react">
              <div className="stat-number-react">{signedCount}</div>
              <div className="stat-label-react">Assinados</div>
            </div>
          ) : null}
        </div>
      </section>
    );
  }

  return (
    <Shell>
      <TopBar
        title="Painel do gestor"
        subtitle={user?.name}
        showLogo
        actions={
          <>
            <button className="topbar-chip" type="button" onClick={() => navigate('/conta', { state: accountPageStateFromPath(location.pathname) })}>
              Conta
            </button>
            <button className="topbar-chip" type="button" onClick={handleLogout}>
              Sair
            </button>
          </>
        }
      />

      <div className="nav-tabs-wrap">
        <div className="nav-tabs" role="tablist" aria-label="Seções do gestor" onKeyDown={handleHorizontalTabListKeyDown}>
          <button className={`nav-tab ${tab === 'pendentes' ? 'active' : ''}`} type="button" role="tab" aria-selected={tab === 'pendentes'} onClick={() => setTab('pendentes')}>
            Pendentes
            <span className="nav-tab-count">{pendingCount}</span>
          </button>
          <button className={`nav-tab ${tab === 'aprovados' ? 'active' : ''}`} type="button" role="tab" aria-selected={tab === 'aprovados'} onClick={() => setTab('aprovados')}>
            Aprovados
          </button>
          <button className={`nav-tab ${tab === 'projetos' ? 'active' : ''}`} type="button" role="tab" aria-selected={tab === 'projetos'} onClick={() => setTab('projetos')}>
            Projetos
            {pendingProjectRegistrationCount ? (
              <span className="nav-tab-count">{pendingProjectRegistrationCount}</span>
            ) : null}
          </button>
          <button className={`nav-tab ${tab === 'arquivados' ? 'active' : ''}`} type="button" role="tab" aria-selected={tab === 'arquivados'} onClick={() => setTab('arquivados')}>
            Arquivados
          </button>
          <button className={`nav-tab ${tab === 'equipe' ? 'active' : ''}`} type="button" role="tab" aria-selected={tab === 'equipe'} onClick={() => setTab('equipe')}>
            Equipe
          </button>
          <button className={`nav-tab ${tab === 'usuarios' ? 'active' : ''}`} type="button" role="tab" aria-selected={tab === 'usuarios'} onClick={() => setTab('usuarios')}>
            Usuários
          </button>
          <button className={`nav-tab ${tab === 'nps' ? 'active' : ''}`} type="button" role="tab" aria-selected={tab === 'nps'} onClick={() => setTab('nps')}>
            NPS
          </button>
          <button className={`nav-tab ${tab === 'estatisticas' ? 'active' : ''}`} type="button" role="tab" aria-selected={tab === 'estatisticas'} onClick={() => setTab('estatisticas')}>
            Estatísticas
          </button>
        </div>
      </div>

      <main className="page-scroll" ref={pageScrollRef}>
        {renderReportSummary()}
        {renderGestorSearch()}
        {renderTabContent()}
      </main>

      {renderManualReportModal()}

      <Modal
        open={showSegmentForm}
        onClose={closeSegmentForm}
        ariaLabelledBy="client-segment-title"
      >
        <form className="admin-form" onSubmit={handleSegmentSubmit}>
          <div className="section-title" id="client-segment-title">Adicionar segmento</div>
          <div className="field-group">
            <label htmlFor="client-segment-label">Nome</label>
            <input
              id="client-segment-label"
              value={segmentLabel}
              onChange={event => setSegmentLabel(event.target.value)}
              required
            />
          </div>
          <div className="admin-form-actions segment-dialog-actions">
            <button className="secondary-button" type="button" onClick={closeSegmentForm}>
              Cancelar
            </button>
            <button className="primary-button" type="submit" disabled={projectSegmentMutations.createSegment.isPending}>
              Salvar segmento
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        open={Boolean(archiveSurveyProject)}
        onClose={() => setArchiveSurveyProject(null)}
        ariaLabelledBy="archive-survey-title"
        ariaDescribedBy="archive-survey-description"
      >
        <div className="section-title" id="archive-survey-title">Arquivar projeto</div>
        <p className="placeholder-copy" id="archive-survey-description">
          Deseja arquivar o projeto e enviar a pesquisa de satisfação ao cliente?
        </p>
        <div className="admin-form-actions">
          <button
            className="secondary-button"
            type="button"
            disabled={projectMutations.updateProject.isPending || surveyMutations.sendProjectSurvey.isPending}
            onClick={() => setArchiveSurveyProject(null)}
          >
            Cancelar
          </button>
          <button
            className="secondary-button"
            type="button"
            disabled={projectMutations.updateProject.isPending || surveyMutations.sendProjectSurvey.isPending}
            onClick={() => void handleArchiveSurveyChoice(false)}
          >
            Arquivar sem enviar
          </button>
          <button
            className="primary-button"
            type="button"
            disabled={projectMutations.updateProject.isPending || surveyMutations.sendProjectSurvey.isPending}
            onClick={() => void handleArchiveSurveyChoice(true)}
          >
            Enviar pesquisa
          </button>
        </div>
      </Modal>

      <Modal
        open={showSurveyQuestionEditor}
        onClose={() => setShowSurveyQuestionEditor(false)}
        ariaLabelledBy="survey-question-editor-title"
        panelClassName="modal-card survey-question-editor-modal"
      >
        <form className="admin-form survey-question-editor-form" onSubmit={handleSurveyQuestionsSubmit}>
          <div className="survey-question-editor-head">
            <div className="section-title" id="survey-question-editor-title">Editar pesquisa NPS</div>
            <button className="mini-btn alt" type="button" onClick={() => setShowSurveyQuestionEditor(false)}>
              Fechar
            </button>
          </div>
          <div className="survey-question-suggestions">
            <span>Adicionar sugestão:</span>
            {suggestedSurveyQuestions.map(template => (
              <button
                className="mini-btn alt"
                type="button"
                key={template.label}
                onClick={() => addSuggestedSurveyQuestion(template)}
              >
                {template.label}
              </button>
            ))}
          </div>
          <div
            className="admin-stack survey-question-editor-list"
            ref={surveyQuestionEditorListRef}
            onDragOver={event => handleSurveyQuestionDragOver(event)}
          >
            {surveyQuestionDrafts.map((question, index) => (
              <div
                className={`card admin-card survey-question-card ${draggedSurveyQuestionId === question.id ? 'dragging' : ''} ${dragOverSurveyQuestionId === question.id && draggedSurveyQuestionId !== question.id ? 'drag-over' : ''}`}
                key={question.id}
                onDragEnter={() => setDragOverSurveyQuestionId(question.id)}
                onDragOver={event => handleSurveyQuestionDragOver(event, question.id)}
                onDrop={() => {
                  const fromIndex = surveyQuestionDrafts.findIndex(item => item.id === draggedSurveyQuestionId);
                  moveSurveyQuestion(fromIndex, index);
                  setDraggedSurveyQuestionId(null);
                  setDragOverSurveyQuestionId(null);
                }}
              >
                <div className="admin-inline-grid">
                  <div className="survey-question-drag-cell">
                    <button
                      className="survey-question-drag-handle"
                      type="button"
                      draggable
                      onDragStart={event => handleSurveyQuestionDragStart(event, question.id)}
                      onDragEnd={() => {
                        setDraggedSurveyQuestionId(null);
                        setDragOverSurveyQuestionId(null);
                      }}
                      title="Arrastar para reordenar"
                      aria-label="Arrastar pergunta para reordenar"
                    >
                      <span aria-hidden="true">::</span>
                    </button>
                  </div>
                  <div className="field-group field-group-wide">
                    <label htmlFor={`survey-question-label-${question.id}`}>Pergunta</label>
                    <input
                      id={`survey-question-label-${question.id}`}
                      value={question.label}
                      onChange={event => updateSurveyQuestionDraft(index, { label: event.target.value })}
                      required
                    />
                  </div>
                  <div className="field-group survey-question-type-field">
                    <label htmlFor={`survey-question-type-${question.id}`}>Tipo</label>
                    <select
                      id={`survey-question-type-${question.id}`}
                      value={question.type}
                      onChange={event => updateSurveyQuestionDraft(index, { type: event.target.value as SurveyQuestionType })}
                    >
                      <option value="NPS">NPS 0-10</option>
                      <option value="SCALE">Escala 1-5</option>
                      <option value="SELECT">Lista suspensa</option>
                      <option value="TEXT">Campo de texto</option>
                    </select>
                  </div>
                  <label className="checkbox-line">
                    <input
                      type="checkbox"
                      checked={question.required}
                      onChange={event => updateSurveyQuestionDraft(index, { required: event.target.checked })}
                    />
                    Obrigatória
                  </label>
                  {scalePreviewValues(question.type).length ? (
                    <div className="field-group field-group-wide">
                      <label>Exemplo</label>
                      <div className="survey-scale-row preview" aria-hidden="true">
                        {scalePreviewValues(question.type).map(value => (
                          <span className="survey-scale-option" key={value}>
                            <span className="survey-scale-dot">{value}</span>
                          </span>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  {question.type === 'SELECT' ? (
                    <div className="field-group field-group-wide">
                      <label htmlFor={`survey-question-option-input-${question.id}`}>Opções</label>
                      <div className="inline-add-row">
                        <input
                          id={`survey-question-option-input-${question.id}`}
                          placeholder="Adicionar opção..."
                          value={surveyOptionInputs[question.id] || ''}
                          onChange={event => setSurveyOptionInputs(current => ({ ...current, [question.id]: event.target.value }))}
                          onKeyDown={event => {
                            if (event.key === 'Enter') {
                              event.preventDefault();
                              addSurveyQuestionOption(index);
                            }
                          }}
                        />
                        <button className="mini-btn alt" type="button" onClick={() => addSurveyQuestionOption(index)}>
                          Adicionar
                        </button>
                      </div>
                      {surveyDraftOptions(question).length ? (
                        <div className="survey-option-list">
                          {surveyDraftOptions(question).map(option => (
                            <span className="colab-tag" key={option}>
                              <span>{option}</span>
                              <button type="button" onClick={() => removeSurveyQuestionOption(index, option)}>×</button>
                            </span>
                          ))}
                        </div>
                      ) : (
                        <div className="placeholder-copy">Nenhuma opção adicionada.</div>
                      )}
                    </div>
                  ) : null}
                  <div className="admin-form-actions">
                    <button
                      className="mini-btn alt"
                      type="button"
                      disabled={index === 0}
                      onClick={() => setSurveyQuestionDrafts(current => {
                        const next = [...current];
                        const previous = next[index - 1];
                        next[index - 1] = next[index];
                        next[index] = previous;
                        return next;
                      })}
                    >
                      Subir
                    </button>
                    <button
                      className="mini-btn alt"
                      type="button"
                      disabled={index === surveyQuestionDrafts.length - 1}
                      onClick={() => setSurveyQuestionDrafts(current => {
                        const next = [...current];
                        const nextItem = next[index + 1];
                        next[index + 1] = next[index];
                        next[index] = nextItem;
                        return next;
                      })}
                    >
                      Descer
                    </button>
                    <button
                      className="mini-btn danger"
                      type="button"
                      onClick={() => setSurveyQuestionDrafts(current => current.filter((_, itemIndex) => itemIndex !== index))}
                    >
                      Remover
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="admin-form-actions survey-question-editor-actions">
            <button className="mini-btn alt" type="button" onClick={addSurveyQuestionDraft}>
              + Pergunta
            </button>
            <button className="secondary-button" type="button" onClick={() => setShowSurveyQuestionEditor(false)}>
              Cancelar
            </button>
            <button className="primary-button" type="submit" disabled={surveyMutations.updateQuestions.isPending}>
              Salvar pesquisa
            </button>
          </div>
        </form>
      </Modal>
    </Shell>
  );
}
