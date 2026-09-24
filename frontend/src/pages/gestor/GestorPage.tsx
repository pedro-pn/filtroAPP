import { useEffect, useMemo, useRef, useState, type DragEvent, type FormEvent, type PointerEvent } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { formatCnpj, normalizeCnpjInput } from '../../utils/formatCnpj';
import { compareReportTypes, sortProjects, sortReportsInGroup } from '../../utils/projectSort';
import { ProjectSortButton } from '../../utils/ProjectSortButton';
import { manualReportMetadataFromFileName, reportDownloadFileName } from '../../utils/reportFileName';
import { SITE_RDO_DRAFT_FORM_PATH } from '../../utils/reportDraft';
import { matchesSearch, reportSearchParts } from '../../utils/search';
import { handleHorizontalTabListKeyDown } from '../../utils/tabKeyboard';
import { createPointerDragGhost, movePointerDragGhost, reorderIdFromPoint, reorderRowsById, scrollReorderContainerEdge, setReorderDragImage, type PointerDragState } from '../../utils/reorderDrag';

import type { UserRole } from '../../types/auth';
import { downloadReportDocx, downloadReportPdf, downloadReportsBatch } from '../../api/reports';
import type { SurveyQuestionType } from '../../api/surveys';

import { useAuth } from '../../auth/AuthContext';
import { accountPageStateFromPath, navigationStateFromLocation } from '../../auth/moduleNavigation';
import { rdoPath, rdoReportDetailPath } from '../../auth/rolePath';
import { GroupedReportList } from '../../components/reports/GroupedReportList';
import { ReportTypeBadge } from '../../components/reports/ReportTypeBadge';
import { ManagerReportListing } from '../../components/reports/manager/ManagerReportListing';
import { ManagerReportTypeSortButton } from '../../components/reports/manager/ManagerReportTypeSortButton';
import { AppIcon } from '../../components/icons/AppIcon';
import type { ManualReportOperationalFieldsValue } from '../../components/reports/ManualReportOperationalFields';
import { buildManualReportOperationalData, emptyManualReportOperationalFields, validateManualReportOperationalFields } from '../../components/reports/manualReportOperationalData';
import { ReportSummaryCard } from '../../components/reports/ReportSummaryCard';
import { ImageDropzone } from '../../components/ui/ImageDropzone';
import { InfiniteScrollSentinel } from '../../components/ui/InfiniteScrollSentinel';
import { Alert, Badge, Button, Card, DataTable, EmptyState, Field, FilterBar, IconButton, Input, MetricCard, SearchInput, Select, Skeleton, StatusPill, type DataTableColumn } from '../../components/ui/ds';
import { DS_ICONS } from '../../components/ui/ds/icons';
import { Modal } from '../../components/ui/Modal';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { ReasonDialog } from '../../components/ui/ReasonDialog';
import { PdfDropzone } from '../../components/ui/PdfDropzone';
import { useToast } from '../../components/ui/ToastContext';
import { PrivacyNotice } from '../../components/privacy/PrivacyNotice';
import { JobRoleManager } from '../../components/projects/JobRoleManager';
import { CollaboratorListToolbarActions, CollaboratorStatusPill } from '../../components/projects/CollaboratorListControls';
import { DdsThemeManager } from '../../components/reports/DdsThemeManager';
import { replicateManualReportCollaborators, type ManualReportCollaboratorReplicationPrompt } from './manualReportCollaboratorReplication';
import { ManualReportUploadFileCard } from './ManualReportUploadFileCard';
import { LegacyReportsUploadModal } from './LegacyReportsUploadModal';
import type { CollaboratorFormState } from './CollaboratorForm';
import { CollaboratorJobRoleHistoryEditor } from './CollaboratorJobRoleHistoryEditor';
import { manualReportFileId, manualReportUploadListLabel, type ManualReportUploadFileState } from './manualReportUploadFile';
import { getCommercialPendencias } from '../../api/acompanhamentoComercial';
import { listDdsThemes } from '../../api/ddsThemes';
import { listJobRoles } from '../../api/jobRoles';
import { useGestorBootstrap } from '../../hooks/useBootstrap';
import { useCollaboratorMutations } from '../../hooks/useCollaborators';
import { useDraftMutations, useDrafts } from '../../hooks/useDrafts';
import { useProjectMutations } from '../../hooks/useProjects';
import { useAccumulatedReportsPage, useBatchedReportCounts, useReportCounts, useReportMutations } from '../../hooks/useReports';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { setPersistentSearchValue, usePersistentSearch } from '../../hooks/usePersistentSearch';
import { useInfiniteScrollSentinel } from '../../hooks/useInfiniteScrollSentinel';
import { currentPageScrollState, saveCurrentPageScroll } from '../../hooks/usePageScrollRestoration';
import { useUserMutations, useUsers } from '../../hooks/useUsers';
import { useSurveyMutations } from '../../hooks/useSurveys';
import { SurveyDashboardOverlay } from '../../components/surveys/SurveyDashboard';
import { MonthlyAllocationDashboardOverlay, StatsDashboardOverlay, StatsOverview } from '../../components/stats/StatsDashboard';
import { useProjectSegmentMutations } from '../../hooks/useProjectStats';
import { AppShell } from '../../layout/AppShell';
import { PageHeader } from '../../layout/PageHeader';
import { createNavigationModel } from '../../layout/navigationModel';
import { useRdoStore } from '../../store/rdoStore';
import { COLLABORATOR_SIGNATURE_NOTICE_VERSION } from '../../constants/privacy';
import type { Collaborator, InternalUserSummary, Project, ReportType, ReportDraft, ReportSummary, SatisfactionSurveySummary } from '../../types/domain';
import { downloadBlob } from '../../utils/download';
import {
  formatDate,
  surveyIsExpired,
  surveyStatusLabel,
  npsResponseRows,
  npsProjectTitle,
  npsProjectKey,
  surveyQuestionToDraft,
  newSurveyQuestionDraft,
  draftToSurveyQuestion,
  surveyDraftOptions,
  scalePreviewValues,
  type SurveyQuestionDraft
} from './gestorSurveyHelpers';
import { commercialPendenciaMapByProject } from './commercialPendencias';
import { PendingProjectReviewForm } from './PendingProjectReviewForm';
import { ProjectIntakeWebhookNovelty } from './ProjectIntakeWebhookNovelty';
import { hubModulesForUser } from '../hubModules';
import '../../styles/rdo-ds-actions.css';
import './GestorPage.ds.css';
import './GestorArchivedReportsDialog.css';
import { RdoSectionNavigation } from './RdoSectionNavigation';
import { RDO_MANAGER_SECTIONS, rdoManagerSectionHref, rdoManagerSectionLabel } from './rdoSectionNavigationModel';
import {
  partitionProjectsByRegistration,
  pendingProjectRegistrationMessage,
  projectRegistrationPending,
  projectSearchParts,
  projectTitle
} from './projectPendingReview';
import {
  REPORT_PAGE_SIZE,
  REPORT_TYPE_PAGE_SIZE,
  ProjectAuthorizedUsersFields,
  ProjectClientFields,
  ProjectReportSequenceFields,
  applyProjectVisibilityMode,
  asBoolean,
  asDdsThemes,
  asServices,
  asString,
  asStringArray,
  cleanSigners,
  collaboratorSearchParts,
  collaboratorToForm,
  draftDateLabel,
  emptyCollaboratorForm,
  emptyManualReportForm,
  emptyProjectForm,
  emptyUserForm,
  fileToDataUrl,
  formatUserRole,
  hasActiveClientRejection,
  initials,
  internalRoles,
  isManualUploadedReport,
  manualReportServiceField,
  manualReportSignatureMode,
  normalizeProjectReportSequences,
  normalizeSignatureImage,
  npsStatusTone,
  parseEmailList,
  parseGestorTab,
  projectReportTypes,
  projectToForm,
  projectVisibilityMode,
  readGestorUiPrefs,
  renderProjectCard,
  segmentSlugFromLabel,
  suggestedSurveyQuestions,
  userRoleTone,
  userSearchParts,
  userToForm,
  writeGestorUiPrefs,
  type GestorTab,
  type ManualReportFormState,
  type ProjectFormState,
  type ProjectVisibilityMode,
  type UserFormState,
  type UserRoleFilter,
  type UserSortMode,
  type UserStatusFilter
} from './GestorPage.shared';

interface ManualPasswordSetup {
  username: string;
  url: string;
}

function absolutePasswordSetupUrl(url: string) {
  return new URL(url, window.location.origin).href;
}

export function GestorPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const { user, logout } = useAuth();
  const managerModules = useMemo(() => hubModulesForUser(user), [user]);
  const managerInitials = user?.name
    ? user.name
        .split(' ')
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part[0].toUpperCase())
        .join('')
    : 'FV';
  const { hydrate, reset } = useRdoStore();
  const showToast = useToast();
  const tab = parseGestorTab(searchParams.get('tab'));
  const reportListingTab = tab === 'pendentes' || tab === 'aprovados';
  const projectsTab = tab === 'projetos';
  const archivedProjectsTab = tab === 'arquivados';
  const teamTab = tab === 'equipe';
  const usersTab = tab === 'usuarios';
  const adminTab = teamTab || usersTab;
  const npsTab = tab === 'nps';
  const statisticsTab = tab === 'estatisticas';
  const [equipeSubTab, setEquipeSubTab] = useState<'colaboradores' | 'cargos' | 'dds'>('colaboradores');
  const [jobRoleCreateOpen, setJobRoleCreateOpen] = useState(false);
  const [ddsThemeCreateOpen, setDdsThemeCreateOpen] = useState(false);
  const jobRoleCreateButtonRef = useRef<HTMLButtonElement>(null);
  const ddsThemeCreateButtonRef = useRef<HTMLButtonElement>(null);
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
  const segmentLabelInputRef = useRef<HTMLInputElement>(null);
  const [archiveSurveyProject, setArchiveSurveyProject] = useState<Project | null>(null);
  const [removeProjectTarget, setRemoveProjectTarget] = useState<Project | null>(null);
  const archiveSurveyCancelRef = useRef<HTMLButtonElement>(null);
  const [projectTeamDialogProject, setProjectTeamDialogProject] = useState<Project | null>(null);
  const [projectTeamForm, setProjectTeamForm] = useState<ProjectFormState>(emptyProjectForm);
  const projectTeamOperatorRef = useRef<HTMLSelectElement>(null);
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
  const surveyQuestionDragId = useRef<string | null>(null);
  const surveyQuestionDropHandled = useRef(false);
  const surveyQuestionStartDrafts = useRef<SurveyQuestionDraft[]>([]);
  const surveyQuestionDraftsRef = useRef<SurveyQuestionDraft[]>([]);
  const surveyQuestionTouchDrag = useRef<PointerDragState | null>(null);
  const surveyQuestionEditorListRef = useRef<HTMLDivElement | null>(null);

  const [collaboratorForm, setCollaboratorForm] = useState<CollaboratorFormState>(emptyCollaboratorForm);
  const [collaboratorEditingId, setCollaboratorEditingId] = useState<string | null>(null);
  const [showCollaboratorForm, setShowCollaboratorForm] = useState(false);
  const [showInactiveCollaborators, setShowInactiveCollaborators] = useState(false);

  const [userForm, setUserForm] = useState<UserFormState>(emptyUserForm);
  const [userEditingId, setUserEditingId] = useState<string | null>(null);
  const [showUserForm, setShowUserForm] = useState(false);
  const [userAdminGroup, setUserAdminGroup] = useState<'internal' | 'client'>('internal');
  const [userRoleFilter, setUserRoleFilter] = useState<UserRoleFilter>('all');
  const [userStatusFilter, setUserStatusFilter] = useState<UserStatusFilter>('all');
  const [userSortMode, setUserSortMode] = useState<UserSortMode>('name-asc');
  const [manualPasswordSetup, setManualPasswordSetup] = useState<ManualPasswordSetup | null>(null);

  const [returnReport, setReturnReport] = useState<ReportSummary | null>(null);
  const [archiveReportTarget, setArchiveReportTarget] = useState<ReportSummary | null>(null);
  const returnReportTriggerRef = useRef<HTMLButtonElement | null>(null);
  const returnReportTriggerIdRef = useRef<string | null>(null);
  const [sequenceEditReport, setSequenceEditReport] = useState<ReportSummary | null>(null);
  const [sequenceEditValue, setSequenceEditValue] = useState('');
  const sequenceEditInputRef = useRef<HTMLInputElement>(null);
  const [manualReportForm, setManualReportForm] = useState<ManualReportFormState>(emptyManualReportForm);
  const [manualReportTarget, setManualReportTarget] = useState<ReportSummary | null>(null);
  const [manualReportModalOpen, setManualReportModalOpen] = useState(false);
  const [manualReportSubmitting, setManualReportSubmitting] = useState(false);
  const [manualReportCollaboratorPrompts, setManualReportCollaboratorPrompts] = useState<ManualReportCollaboratorReplicationPrompt[]>([]);
  const [selectedReportIds, setSelectedReportIds] = useState<string[]>([]);
  const [projectSortDir, setProjectSortDir] = useState<'asc' | 'desc'>(initialUiPrefs.projectSortDir);
  const [archivedReportsProjectId, setArchivedReportsProjectId] = useState<string | null>(null);
  const [closedArchivedTypeKeys, setClosedArchivedTypeKeys] = useState<string[]>(initialUiPrefs.closedArchivedTypeKeys);
  const [archivedVisibleByType, setArchivedVisibleByType] = useState<Record<string, number>>({});
  const [archivedTypeSortDirections, setArchivedTypeSortDirections] = useState<Record<string, 'asc' | 'desc'>>(initialUiPrefs.archivedTypeSortDirections);
  const [closedClientAccountGroupIds, setClosedClientAccountGroupIds] = useState<string[]>(initialUiPrefs.closedClientAccountGroupIds);

  const pendingReportListQuery = useAccumulatedReportsPage(
    {
      summary: true,
      reviewQueue: true,
      projectActive: true,
      search: debouncedGestorSearch || undefined,
      projectSort: projectSortDir,
      pageSize: REPORT_PAGE_SIZE
    },
    tab === 'pendentes'
  );
  const approvedReportListQuery = useAccumulatedReportsPage(
    {
      summary: true,
      statuses: ['APPROVED', 'SIGNED'],
      projectActive: true,
      search: debouncedGestorSearch,
      projectSort: projectSortDir,
      pageSize: REPORT_PAGE_SIZE
    },
    tab === 'aprovados'
  );
  const archivedReportListQuery = useAccumulatedReportsPage(
    {
      summary: true,
      statuses: ['APPROVED', 'SIGNED'],
      projectActive: false,
      search: debouncedGestorSearch,
      projectSort: projectSortDir,
      pageSize: REPORT_PAGE_SIZE
    },
    tab === 'arquivados'
  );
  const reportListQuery = tab === 'pendentes' ? pendingReportListQuery : tab === 'arquivados' ? archivedReportListQuery : approvedReportListQuery;
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
  const activeProjectsQuery = {
    data: gestorBootstrapQuery.data?.activeProjects,
    isLoading: gestorBootstrapQuery.isLoading,
    isError: gestorBootstrapQuery.isError,
    refetch: gestorBootstrapQuery.refetch
  };
  const activeProjectReportCountQueries = useMemo(() => (activeProjectsQuery.data || []).map((project) => ({ projectId: project.id })), [activeProjectsQuery.data]);
  const activeProjectReportCountsQuery = useBatchedReportCounts(activeProjectReportCountQueries, projectsTab && activeProjectReportCountQueries.length > 0);
  const activeProjectReportCountById = useMemo(
    () => new Map(activeProjectReportCountQueries.map((query, index) => [query.projectId, activeProjectReportCountsQuery.data?.[index]])),
    [activeProjectReportCountQueries, activeProjectReportCountsQuery.data]
  );
  const commercialPendenciasQuery = useQuery({ queryKey: ['commercial-pendencias'], queryFn: getCommercialPendencias });
  const commercialPendenciaByProject = useMemo(() => commercialPendenciaMapByProject(commercialPendenciasQuery.data || []), [commercialPendenciasQuery.data]);
  const jobRolesQuery = useQuery({ queryKey: ['job-roles', 'all'], queryFn: () => listJobRoles(true) });
  const ddsThemesQuery = useQuery({
    queryKey: ['dds-themes', 'all'],
    queryFn: () => listDdsThemes(true),
    enabled: teamTab
  });
  const jobRoleIds = useMemo(() => new Set((jobRolesQuery.data || []).filter((role) => role.isActive).map((role) => role.id)), [jobRolesQuery.data]);
  const renderRoleOptions = (value: string) => {
    const current = collaboratorsQuery.data?.find((item) => item.jobRoleId === value)?.jobRole;
    const showCurrent = Boolean(current) && !jobRoleIds.has(value);
    return (
      <>
        <option value="" disabled>
          Selecione o cargo
        </option>
        {showCurrent ? <option value={value}>{current?.name} (inativo)</option> : null}
        {(jobRolesQuery.data || [])
          .filter((role) => role.isActive)
          .map((role) => (
            <option key={role.id} value={role.id}>
              {role.name}
            </option>
          ))}
      </>
    );
  };
  const archivedProjectsQuery = { data: gestorBootstrapQuery.data?.archivedProjects, isLoading: gestorBootstrapQuery.isLoading };
  const collaboratorsQuery = {
    data: gestorBootstrapQuery.data?.collaborators,
    isLoading: gestorBootstrapQuery.isLoading,
    isError: gestorBootstrapQuery.isError,
    refetch: gestorBootstrapQuery.refetch
  };
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

  const pendingReports = useMemo(() => (reportListQuery.items || []).filter((report) => report.status === 'PENDING' || report.status === 'RETURNED' || hasActiveClientRejection(report)), [reportListQuery.items]);

  const approvedReports = useMemo(() => (reportListQuery.items || []).filter((report) => (report.status === 'APPROVED' || report.status === 'SIGNED') && report.project?.isActive !== false), [reportListQuery.items]);

  const archivedReports = useMemo(() => (reportListQuery.items || []).filter((report) => (report.status === 'APPROVED' || report.status === 'SIGNED') && report.project?.isActive === false), [reportListQuery.items]);
  const pendingCount = tab === 'pendentes' ? (reportListQuery.pagination?.total ?? pendingReports.length) : pendingTotalCount;
  const approvedCount = approvedTotalCount;
  const signedCount = signedTotalCount;
  const pendingProjectRegistrationCount = (activeProjectsQuery.data || []).filter((project) => project.isActive !== false).filter(projectRegistrationPending).length;
  const managerNavigation = useMemo(
    () =>
      createNavigationModel({
        modules: managerModules,
        pathname: location.pathname,
        subNavigation: {
          parentId: 'rdo',
          items: RDO_MANAGER_SECTIONS.map((section) => ({
            id: section.id,
            label: section.label,
            href: rdoManagerSectionHref(section.id, searchParams.toString()),
            badge: section.id === 'pendentes' && pendingCount > 0 ? pendingCount : undefined,
            active: section.id === tab
          }))
        }
      }),
    [location.pathname, managerModules, pendingCount, searchParams, tab]
  );

  useEffect(() => {
    if (tab !== 'arquivados' || !archivedReportsProjectId) return;
    reportListQuery.projectTypeTotals(archivedReportsProjectId).forEach((typeTotal) => {
      const typeKey = `${archivedReportsProjectId}-${typeTotal.reportType}`;
      if (closedArchivedTypeKeys.includes(typeKey)) return;
      void reportListQuery.ensureGroupPage({
        projectId: archivedReportsProjectId,
        reportType: typeTotal.reportType,
        pageSize: REPORT_TYPE_PAGE_SIZE,
        sortDirection: archivedTypeSortDirections[typeKey] || 'asc'
      });
    });
  }, [archivedReportsProjectId, archivedTypeSortDirections, closedArchivedTypeKeys, reportListQuery, tab]);

  const clientGroupingProjects = useMemo(() => [...(activeProjectsQuery.data || []), ...(archivedProjectsQuery.data || [])], [activeProjectsQuery.data, archivedProjectsQuery.data]);
  const manualReportProjectOptions = useMemo(() => {
    const byId = new Map<string, Project>();
    [...(activeProjectsQuery.data || []), ...(archivedProjectsQuery.data || [])].filter((project) => !projectRegistrationPending(project)).forEach((project) => byId.set(project.id, project));
    return sortProjects(Array.from(byId.values()), 'asc');
  }, [activeProjectsQuery.data, archivedProjectsQuery.data]);

  useEffect(() => {
    setSelectedReportIds([]);
    setArchivedReportsProjectId(null);
  }, [gestorSearch, tab, gestorUiPrefsStorageKey]);

  useEffect(() => {
    const prefs = readGestorUiPrefs(gestorUiPrefsStorageKey);
    setProjectSortDir(prefs.projectSortDir);
    setClosedArchivedTypeKeys(prefs.closedArchivedTypeKeys);
    setArchivedTypeSortDirections(prefs.archivedTypeSortDirections);
    setClosedClientAccountGroupIds(prefs.closedClientAccountGroupIds);
  }, [gestorUiPrefsStorageKey]);

  useEffect(() => {
    writeGestorUiPrefs(gestorUiPrefsStorageKey, {
      ...initialUiPrefs,
      projectSortDir,
      closedArchivedTypeKeys,
      archivedTypeSortDirections,
      closedClientAccountGroupIds
    });
  }, [gestorUiPrefsStorageKey, initialUiPrefs, projectSortDir, closedArchivedTypeKeys, archivedTypeSortDirections, closedClientAccountGroupIds]);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(projectDetailsStorageKey);
      const parsed = stored ? JSON.parse(stored) : [];
      const storedIds = Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
      if (stored !== null && Array.isArray(parsed)) {
        setCollapsedProjectDetailIds(storedIds);
        return;
      }

      const activeProjects = (activeProjectsQuery.data || []).filter((project) => project.isActive !== false);
      const readyProjects = partitionProjectsByRegistration(activeProjects).ready;
      const initiallyExpandedId = sortProjects(readyProjects, projectSortDir)[0]?.id || activeProjects[0]?.id;
      setCollapsedProjectDetailIds(activeProjects.filter((project) => project.id !== initiallyExpandedId).map((project) => project.id));
    } catch {
      setCollapsedProjectDetailIds([]);
    }
  }, [activeProjectsQuery.data, projectDetailsStorageKey, projectSortDir]);

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
    setCollapsedProjectDetailIds((current) => {
      const next = current.includes(project.id) ? current.filter((id) => id !== project.id) : [...current, project.id];
      persistCollapsedProjectDetails(next);
      return next;
    });
  }

  function openArchivedReports(project: Project) {
    setSelectedReportIds([]);
    setArchivedReportsProjectId(project.id);
  }

  function closeArchivedReports() {
    setArchivedReportsProjectId(null);
    setSelectedReportIds([]);
  }

  function toggleArchivedType(typeKey: string) {
    setClosedArchivedTypeKeys((current) => (current.includes(typeKey) ? current.filter((id) => id !== typeKey) : [...current, typeKey]));
  }

  function toggleArchivedTypeSort(typeKey: string) {
    setArchivedTypeSortDirections((current) => ({
      ...current,
      [typeKey]: (current[typeKey] || 'asc') === 'asc' ? 'desc' : 'asc'
    }));
  }

  function visibleArchivedTypeLimit(typeKey: string) {
    return archivedVisibleByType[typeKey] || REPORT_TYPE_PAGE_SIZE;
  }

  function revealMoreArchivedType(typeKey: string, total: number) {
    setArchivedVisibleByType((current) => ({
      ...current,
      [typeKey]: Math.min(total, (current[typeKey] || REPORT_TYPE_PAGE_SIZE) + REPORT_TYPE_PAGE_SIZE)
    }));
  }

  async function handleLoadMoreArchivedType(projectId: string, reportType: string, typeKey: string, loadedCount: number, hasLoadedItemsToReveal: boolean, sortDirection: 'asc' | 'desc') {
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
    setArchivedVisibleByType((current) => ({
      ...current,
      [typeKey]: (current[typeKey] || REPORT_TYPE_PAGE_SIZE) + REPORT_TYPE_PAGE_SIZE
    }));
  }

  function toggleClientAccountGroup(groupId: string) {
    setClosedClientAccountGroupIds((current) => (current.includes(groupId) ? current.filter((id) => id !== groupId) : [...current, groupId]));
  }

  async function handleLogout() {
    await logout();
    navigate('/', { replace: true });
  }

  function handleNewReport() {
    reset();
    navigate(rdoPath('/relatorio/novo'));
  }

  function handleOpenReport(report: ReportSummary) {
    saveCurrentPageScroll(location, user?.id || user?.username || 'anonymous');
    navigate(rdoReportDetailPath(user, report.id), {
      state: {
        ...(navigationStateFromLocation(location) || {}),
        ...currentPageScrollState()
      }
    });
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
      ddsDay: asBoolean(payload.ddsDay),
      ddsDayStart: asString(payload.ddsDayStart),
      ddsDayEnd: asString(payload.ddsDayEnd),
      ddsDayThemes: asDdsThemes(payload.ddsDayThemes),
      ddsNight: asBoolean(payload.ddsNight),
      ddsNightStart: asString(payload.ddsNightStart),
      ddsNightEnd: asString(payload.ddsNightEnd),
      ddsNightThemes: asDdsThemes(payload.ddsNightThemes),
      overtimeReason: asString(payload.overtimeReason),
      workforceJustification: asString(payload.workforceJustification),
      dailyDescription: asString(payload.dailyDescription),
      generalUploads: Array.isArray(payload.generalUploads) ? payload.generalUploads : [],
      services: asServices(payload.services)
    });

    navigate(rdoPath(SITE_RDO_DRAFT_FORM_PATH));
  }

  function resetProjectForm() {
    setProjectForm(emptyProjectForm);
    setProjectEditingId(null);
    setShowProjectForm(false);
  }

  function toggleProjectEdit(project: Project) {
    if (projectEditingId === project.id) {
      resetProjectForm();
      return;
    }
    setProjectEditingId(project.id);
    setShowProjectForm(true);
    setProjectForm(projectToForm(project));
  }

  function openProjectTeamDialog(project: Project) {
    setProjectTeamForm(projectToForm(project));
    setProjectTeamDialogProject(project);
  }

  function closeProjectTeamDialog() {
    if (projectMutations.updateProject.isPending) return;
    setProjectTeamDialogProject(null);
    setProjectTeamForm(emptyProjectForm);
  }

  async function handleProjectTeamSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const project = projectTeamDialogProject;
    if (!project) return;

    try {
      await projectMutations.updateProject.mutateAsync({
        id: project.id,
        payload: {
          operatorId: projectTeamForm.operatorId || null,
          authorizedUserIds: projectTeamForm.authorizedUserIds
        }
      });
      showToast('Equipe do projeto atualizada.', 'success');
      setProjectTeamDialogProject(null);
      setProjectTeamForm(emptyProjectForm);
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Não foi possível atualizar a equipe do projeto.', 'error');
    }
  }

  function handleViewProjectReports(project: Project) {
    const searchValue = project.code.trim() || project.name.trim();
    setPersistentSearchValue(`gestor-search:${user?.id || 'anonymous'}:aprovados`, searchValue);
    navigate(rdoManagerSectionHref('aprovados', searchParams.toString()), {
      state: location.state
    });
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
    setManualPasswordSetup(null);
  }

  function handleCollaboratorSignatureFile(file: File | null) {
    if (!file) {
      setCollaboratorForm((current) => ({ ...current, signatureImage: '', signatureNoticeAccepted: false }));
      return;
    }
    void (async () => {
      try {
        const dataUrl = await fileToDataUrl(file);
        setCollaboratorForm((current) => ({ ...current, signatureImage: dataUrl, signatureNoticeAccepted: false }));
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
        <ImageDropzone previewSrc={normalizedSignature || undefined} ariaLabel="Carregar assinatura" placeholder="Arraste a assinatura aqui" onFile={handleCollaboratorSignatureFile} />
        <div className="form-hint">Aceita apenas uma imagem.</div>
        {normalizedSignature ? (
          <PrivacyNotice
            variant="collaboratorSignature"
            checked={collaboratorForm.signatureNoticeAccepted}
            onCheckedChange={(checked) =>
              setCollaboratorForm((current) => ({
                ...current,
                signatureNoticeAccepted: checked
              }))
            }
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
      setProjectForm((current) => ({ ...current, clientSegment: created.slug }));
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

  useEffect(() => {
    if (!surveyQuestionDragId.current) surveyQuestionDraftsRef.current = surveyQuestionDrafts;
  }, [surveyQuestionDrafts]);

  function updateSurveyQuestionDraft(index: number, patch: Partial<SurveyQuestionDraft>) {
    setSurveyQuestionDrafts((current) => current.map((question, itemIndex) => (itemIndex === index ? { ...question, ...patch } : question)));
  }

  function applySurveyQuestionDrafts(next: SurveyQuestionDraft[]) {
    surveyQuestionDraftsRef.current = next;
    setSurveyQuestionDrafts(next);
  }

  function clearSurveyQuestionDrag() {
    surveyQuestionDragId.current = null;
    setDraggedSurveyQuestionId(null);
    setDragOverSurveyQuestionId(null);
  }

  function startSurveyQuestionDrag(questionId: string) {
    surveyQuestionDropHandled.current = false;
    surveyQuestionDraftsRef.current = surveyQuestionDrafts;
    surveyQuestionStartDrafts.current = surveyQuestionDrafts;
    surveyQuestionDragId.current = questionId;
    setDraggedSurveyQuestionId(questionId);
    setDragOverSurveyQuestionId(questionId);
  }

  function applySurveyQuestionReorder(targetId: string) {
    const fromId = surveyQuestionDragId.current;
    if (!fromId) return;
    const next = reorderRowsById(surveyQuestionDraftsRef.current, fromId, targetId, (question) => question.id);
    if (next === surveyQuestionDraftsRef.current) return;
    setDragOverSurveyQuestionId(targetId);
    applySurveyQuestionDrafts(next);
  }

  function addSurveyQuestionOption(index: number) {
    const question = surveyQuestionDrafts[index];
    if (!question) return;
    const option = (surveyOptionInputs[question.id] || '').trim();
    if (!option) return;
    const nextOptions = Array.from(new Set([...surveyDraftOptions(question), option]));
    updateSurveyQuestionDraft(index, { optionsText: nextOptions.join('\n') });
    setSurveyOptionInputs((current) => ({ ...current, [question.id]: '' }));
  }

  function removeSurveyQuestionOption(index: number, option: string) {
    const question = surveyQuestionDrafts[index];
    if (!question) return;
    updateSurveyQuestionDraft(index, {
      optionsText: surveyDraftOptions(question)
        .filter((item) => item !== option)
        .join('\n')
    });
  }

  function handleSurveyQuestionDragOver(event: DragEvent<HTMLElement>, questionId?: string) {
    event.preventDefault();
    if (questionId) applySurveyQuestionReorder(questionId);
    scrollReorderContainerEdge(surveyQuestionEditorListRef.current, event.clientY);
  }

  function handleSurveyQuestionDragStart(event: DragEvent<HTMLButtonElement>, questionId: string) {
    startSurveyQuestionDrag(questionId);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', questionId);
    setReorderDragImage(event, '.survey-question-card', 'app-reorder-drag-ghost');
  }

  function handleSurveyQuestionDrop(event: DragEvent<HTMLElement>, questionId: string) {
    event.preventDefault();
    surveyQuestionDropHandled.current = true;
    applySurveyQuestionReorder(questionId);
    clearSurveyQuestionDrag();
  }

  function handleSurveyQuestionDragEnd() {
    if (!surveyQuestionDropHandled.current) applySurveyQuestionDrafts(surveyQuestionStartDrafts.current);
    surveyQuestionDropHandled.current = false;
    clearSurveyQuestionDrag();
  }

  function handleSurveyQuestionPointerDown(event: PointerEvent<HTMLButtonElement>, questionId: string) {
    if (event.pointerType === 'mouse') return;
    const card = event.currentTarget.closest('.survey-question-card');
    if (!(card instanceof HTMLElement)) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    startSurveyQuestionDrag(questionId);
    document.body.classList.add('app-reorder-touching');
    const state = createPointerDragGhost(card, event.clientX, event.clientY, 'app-reorder-touch-ghost');
    state.pointerId = event.pointerId;
    surveyQuestionTouchDrag.current = state;
  }

  function handleSurveyQuestionPointerMove(event: PointerEvent<HTMLButtonElement>) {
    const state = surveyQuestionTouchDrag.current;
    if (!state || state.pointerId !== event.pointerId || !surveyQuestionDragId.current) return;
    event.preventDefault();
    movePointerDragGhost(state, event.clientX, event.clientY);
    scrollReorderContainerEdge(surveyQuestionEditorListRef.current, event.clientY);
    const targetId = reorderIdFromPoint(event.clientX, event.clientY, '.survey-question-card');
    if (targetId) applySurveyQuestionReorder(targetId);
  }

  function finishSurveyQuestionPointerDrag(event: PointerEvent<HTMLButtonElement>, persist: boolean) {
    const state = surveyQuestionTouchDrag.current;
    if (!state || state.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    state.ghost.remove();
    surveyQuestionTouchDrag.current = null;
    document.body.classList.remove('app-reorder-touching');
    if (!persist) applySurveyQuestionDrafts(surveyQuestionStartDrafts.current);
    clearSurveyQuestionDrag();
  }

  function addSurveyQuestionDraft() {
    setSurveyQuestionDrafts((current) => [...current, newSurveyQuestionDraft()]);
    window.setTimeout(() => {
      const container = surveyQuestionEditorListRef.current;
      if (!container) return;
      container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
    }, 0);
  }

  function addSuggestedSurveyQuestion(template: Omit<SurveyQuestionDraft, 'id'>) {
    const normalizedLabel = template.label.trim().toLowerCase();
    if (surveyQuestionDrafts.some((question) => question.label.trim().toLowerCase() === normalizedLabel)) {
      showToast('Essa pergunta sugerida já está na pesquisa.', 'info');
      return;
    }
    setSurveyQuestionDrafts((current) => [...current, { ...template, id: `new-${Date.now()}` }]);
    window.setTimeout(() => {
      const container = surveyQuestionEditorListRef.current;
      if (!container) return;
      container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
    }, 0);
  }

  async function handleSurveyQuestionsSubmit(event: FormEvent) {
    event.preventDefault();
    const questions = surveyQuestionDrafts.map(draftToSurveyQuestion).filter((question) => question.label);
    if (!questions.length) {
      showToast('Mantenha ao menos uma pergunta na pesquisa.', 'error');
      return;
    }
    const invalidSelect = questions.find((question) => question.type === 'SELECT' && !question.options.length);
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
    setRemoveProjectTarget(null);
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
      jobRoleId: collaboratorForm.jobRoleId,
      jobRoleEffectiveDate: collaboratorForm.jobRoleEffectiveDate,
      email: collaboratorForm.email.trim() || null,
      terminationDate: collaboratorForm.terminationDate || null,
      signatureImage,
      isActive: collaboratorForm.isActive,
      ...(signatureImage
        ? {
            signatureNoticeAccepted: true as const,
            signatureNoticeVersion: COLLABORATOR_SIGNATURE_NOTICE_VERSION
          }
        : {})
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
        const createdUser = await userMutations.createUser.mutateAsync(basePayload);
        if (createdUser.passwordSetup.delivery === 'email') {
          setManualPasswordSetup(null);
          showToast(`Usuário criado. Enviamos para ${createdUser.email} o link para criar a senha.`, 'success');
        } else {
          setManualPasswordSetup({
            username: createdUser.username,
            url: absolutePasswordSetupUrl(createdUser.passwordSetup.url)
          });
          showToast('Usuário criado. Compartilhe o link para criação da senha.', 'success');
        }
      }
      resetUserForm();
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Não foi possível salvar o usuário.', 'error');
    }
  }

  async function copyManualPasswordSetup() {
    if (!manualPasswordSetup) return;
    try {
      await navigator.clipboard.writeText(manualPasswordSetup.url);
      showToast('Link copiado.', 'success');
    } catch {
      showToast('Não foi possível copiar automaticamente. Selecione o link e copie manualmente.', 'error');
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
    setArchiveReportTarget(null);
    try {
      await reportMutations.deleteReport.mutateAsync(report.id);
      setSelectedReportIds((current) => current.filter((id) => id !== report.id));
      showToast('Relatório arquivado.', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Não foi possível arquivar o relatório.', 'error');
    }
  }

  function openReportSequenceEdit(report: ReportSummary) {
    setSequenceEditReport(report);
    setSequenceEditValue(report.sequenceNumber ? String(report.sequenceNumber) : '');
  }

  function openReturnReportDialog(report: ReportSummary, trigger: HTMLButtonElement) {
    returnReportTriggerRef.current = trigger;
    returnReportTriggerIdRef.current = report.id;
    setReturnReport(report);
  }

  function closeReturnReportDialog() {
    setReturnReport(null);
    window.requestAnimationFrame(() => {
      const connectedTrigger = returnReportTriggerRef.current?.isConnected
        ? returnReportTriggerRef.current
        : Array.from(document.querySelectorAll<HTMLButtonElement>('[data-rdo-return-report-id]')).find((trigger) => trigger.dataset.rdoReturnReportId === returnReportTriggerIdRef.current);
      connectedTrigger?.focus();
    });
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
    setManualReportCollaboratorPrompts([]);
  }

  function closeManualReportModal() {
    if (manualReportSubmitting) return;
    resetManualReportModal();
  }

  function openManualReportUpload(projectId = '') {
    setManualReportTarget(null);
    setManualReportCollaboratorPrompts([]);
    setManualReportForm({
      ...emptyManualReportForm,
      projectId: projectId || manualReportProjectOptions[0]?.id || '',
      reportDate: new Date().toISOString().slice(0, 10)
    });
    setManualReportModalOpen(true);
  }

  function openManualReportReplace(report: ReportSummary) {
    setManualReportTarget(report);
    setManualReportCollaboratorPrompts([]);
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
      ...emptyManualReportOperationalFields(),
      files: []
    });
    setManualReportModalOpen(true);
  }

  async function handleManualReportFile(file: File | null) {
    if (!file) {
      setManualReportForm((current) => ({ ...current, fileName: '', pdfDataUrl: '' }));
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
      setManualReportForm((current) => ({ ...current, fileName: file.name, pdfDataUrl }));
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Não foi possível ler o PDF.', 'error');
    }
  }

  async function handleManualReportFiles(files: File[]) {
    if (!files.length) {
      setManualReportForm((current) => ({ ...current, files: [] }));
      setManualReportCollaboratorPrompts([]);
      return;
    }

    const invalidFile = files.find((file) => !(file.type === 'application/pdf' || /\.pdf$/i.test(file.name)));
    if (invalidFile) {
      showToast(`Selecione apenas arquivos PDF.`, 'error');
      return;
    }

    const oversizedFile = files.find((file) => file.size > 20 * 1024 * 1024);
    if (oversizedFile) {
      showToast(`O PDF ${oversizedFile.name} deve ter no máximo 20 MB.`, 'error');
      return;
    }

    const baseDate = manualReportForm.reportDate || new Date().toISOString().slice(0, 10);
    const serviceEquipment = manualReportForm.serviceEquipment.trim();
    const serviceSystem = manualReportForm.serviceSystem.trim();

    try {
      const uploadFiles = await Promise.all(
        files.map(async (file) => {
          const metadata = manualReportMetadataFromFileName(file.name, manualReportForm.reportType);
          return {
            id: manualReportFileId(),
            fileName: file.name,
            pdfDataUrl: await fileToDataUrl(file),
            sequenceNumber: metadata.sequenceNumber,
            reportDate: metadata.reportDate || baseDate,
            serviceEquipment,
            serviceSystem,
            ...emptyManualReportOperationalFields()
          };
        })
      );
      setManualReportForm((current) => ({
        ...current,
        files: [...current.files, ...uploadFiles]
      }));
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Não foi possível ler os PDFs.', 'error');
    }
  }

  function updateManualReportUploadFile(id: string, patch: Partial<ManualReportUploadFileState>) {
    setManualReportForm((current) => ({
      ...current,
      files: current.files.map((file) => (file.id === id ? { ...file, ...patch } : file))
    }));
  }

  function updateManualReportOperationalFields(file: ManualReportUploadFileState, patch: Partial<ManualReportOperationalFieldsValue>) {
    updateManualReportUploadFile(file.id, patch);

    const field = (['collaboratorIds', 'noturnoCollaboratorIds'] as const).find((candidate) => patch[candidate] !== undefined);
    if (!field) return;

    const nextIds = patch[field] || [];
    const addedIds = nextIds.filter((id) => !file[field].includes(id));
    const hasOtherReportToUpdate = manualReportForm.files.some((candidate) => candidate.id !== file.id && addedIds.some((id) => !candidate[field].includes(id)));

    setManualReportCollaboratorPrompts((current) => {
      const existing = current.find((prompt) => prompt.sourceFileId === file.id && prompt.field === field);
      const pendingIds = Array.from(new Set([...(existing?.collaboratorIds || []), ...addedIds])).filter((id) => nextIds.includes(id));
      const remaining = current.filter((prompt) => !(prompt.sourceFileId === file.id && prompt.field === field));

      if (!pendingIds.length || (!existing && !hasOtherReportToUpdate)) return remaining;
      return [...remaining, { sourceFileId: file.id, field, collaboratorIds: pendingIds }];
    });
  }

  function applyManualReportCollaboratorsToOthers(prompt: ManualReportCollaboratorReplicationPrompt) {
    setManualReportForm((current) => ({
      ...current,
      files: replicateManualReportCollaborators(current.files, prompt.sourceFileId, prompt.field, prompt.collaboratorIds)
    }));
    dismissManualReportCollaboratorPrompt(prompt);
  }

  function dismissManualReportCollaboratorPrompt(prompt: ManualReportCollaboratorReplicationPrompt) {
    setManualReportCollaboratorPrompts((current) => current.filter((candidate) => !(candidate.sourceFileId === prompt.sourceFileId && candidate.field === prompt.field)));
  }

  function removeManualReportUploadFile(id: string) {
    setManualReportForm((current) => ({
      ...current,
      files: current.files.filter((file) => file.id !== id)
    }));
    setManualReportCollaboratorPrompts((current) => current.filter((prompt) => prompt.sourceFileId !== id));
  }

  async function handleManualReportSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (manualReportSubmitting) return;
    if (!manualReportTarget && !manualReportForm.files.length) {
      showToast('Selecione ao menos um PDF.', 'error');
      return;
    }
    if (!manualReportForm.projectId) {
      showToast('Selecione um projeto.', 'error');
      return;
    }
    if (!manualReportTarget && manualReportForm.files.some((file) => !file.reportDate)) {
      showToast('Informe a data de todos os PDFs.', 'error');
      return;
    }

    const replacementServiceMetadata =
      manualReportForm.reportType !== 'RDO'
        ? {
            serviceEquipment: manualReportForm.serviceEquipment.trim(),
            serviceSystem: manualReportForm.serviceSystem.trim()
          }
        : {};

    const uploadFiles = manualReportForm.files.map((file) => {
      const sequenceText = file.sequenceNumber.trim();
      const parsedSequenceNumber = sequenceText ? Number.parseInt(sequenceText, 10) : undefined;
      return {
        ...file,
        sequenceNumber: parsedSequenceNumber && parsedSequenceNumber > 0 ? parsedSequenceNumber : undefined,
        invalidSequenceNumber: parsedSequenceNumber !== undefined && (!Number.isInteger(parsedSequenceNumber) || parsedSequenceNumber < 1)
      };
    });

    if (!manualReportTarget && uploadFiles.some((file) => file.invalidSequenceNumber)) {
      showToast('Informe numerações maiores que zero.', 'error');
      return;
    }
    if (!manualReportTarget) {
      const invalidOperationalData = uploadFiles
        .map((file, index) =>
          validateManualReportOperationalFields(file, {
            reportType: manualReportForm.reportType,
            label: `PDF ${index + 1}`
          })
        )
        .find(Boolean);
      if (invalidOperationalData) {
        showToast(invalidOperationalData, 'error');
        return;
      }
    }

    setManualReportSubmitting(true);
    const uploadedFileIds: string[] = [];
    try {
      if (manualReportTarget) {
        await reportMutations.replaceManualReportPdf.mutateAsync({
          id: manualReportTarget.id,
          payload: {
            projectId: manualReportForm.projectId,
            fileName: manualReportForm.fileName,
            ...replacementServiceMetadata,
            ...(manualReportForm.pdfDataUrl
              ? {
                  pdfDataUrl: manualReportForm.pdfDataUrl,
                  signatureMode: manualReportForm.signatureMode
                }
              : {})
          }
        });
        showToast(manualReportForm.pdfDataUrl ? 'PDF substituído.' : 'Relatório atualizado.', 'success');
      } else {
        for (const file of uploadFiles) {
          const serviceMetadata =
            manualReportForm.reportType !== 'RDO'
              ? {
                  serviceEquipment: file.serviceEquipment.trim(),
                  serviceSystem: file.serviceSystem.trim()
                }
              : {};
          const operationalData = buildManualReportOperationalData(file, manualReportForm.reportType);
          await reportMutations.uploadManualReport.mutateAsync({
            projectId: manualReportForm.projectId,
            reportType: manualReportForm.reportType,
            sequenceNumber: file.sequenceNumber,
            reportDate: file.reportDate,
            fileName: file.fileName,
            ...serviceMetadata,
            pdfDataUrl: file.pdfDataUrl,
            signatureMode: manualReportForm.signatureMode,
            ...(operationalData ? { operationalData } : {})
          });
          uploadedFileIds.push(file.id);
        }
        navigate(rdoManagerSectionHref('aprovados', searchParams.toString()), {
          state: location.state
        });
        showToast(uploadFiles.length === 1 ? 'Relatório antigo adicionado.' : `${uploadFiles.length} relatórios antigos adicionados.`, 'success');
      }
      resetManualReportModal();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Não foi possível salvar o relatório antigo.';
      if (!manualReportTarget && uploadedFileIds.length) {
        setManualReportForm((current) => ({
          ...current,
          files: current.files.filter((file) => !uploadedFileIds.includes(file.id))
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
    setSelectedReportIds((current) => {
      const next = checked ? [...current, id] : current.filter((item) => item !== id);
      return Array.from(new Set(next));
    });
  }

  async function handleBatchReportDownload(format: 'pdf' | 'docx', reports: ReportSummary[]) {
    const visibleIds = new Set(reports.map((report) => report.id));
    const ids = selectedReportIds.filter((id) => visibleIds.has(id));

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

  function renderManagerReportActions(report: ReportSummary, forceDesignSystem = false) {
    const canReview = tab === 'pendentes' && report.status !== 'SIGNED';
    const manualReport = isManualUploadedReport(report);

    if (reportListingTab || forceDesignSystem) {
      return (
        <>
          <Button variant="secondary" size="sm" onClick={() => void handleReportDownload(report, 'pdf')}>
            PDF
          </Button>
          {!manualReport ? (
            <Button variant="secondary" size="sm" onClick={() => void handleReportDownload(report, 'docx')}>
              DOCX
            </Button>
          ) : null}
          {manualReport ? (
            <Button aria-label="Editar manual" variant="secondary" size="sm" disabled={reportMutations.replaceManualReportPdf.isPending} onClick={() => openManualReportReplace(report)}>
              <span className="rdo-approved-action-label rdo-approved-action-label--full" aria-hidden="true">
                Editar manual
              </span>
              <span className="rdo-approved-action-label rdo-approved-action-label--compact" aria-hidden="true">
                Editar
              </span>
            </Button>
          ) : null}
          {canReview && report.status !== 'APPROVED' ? (
            <Button variant="primary" size="sm" title={hasActiveClientRejection(report) ? 'Reenviar para avaliação' : 'Aprovar'} onClick={() => void handleReportStatus(report, 'APPROVED')}>
              {hasActiveClientRejection(report) ? 'Reenviar' : 'Aprovar'}
            </Button>
          ) : null}
          {canReview && report.status !== 'RETURNED' ? (
            <Button variant="secondary" size="sm" data-rdo-return-report-id={report.id} onClick={(event) => openReturnReportDialog(report, event.currentTarget)}>
              Devolver
            </Button>
          ) : null}
          {report.status !== 'SIGNED' ? (
            <Button variant="secondary" size="sm" disabled={reportMutations.updateSequence.isPending} onClick={() => openReportSequenceEdit(report)}>
              Nº
            </Button>
          ) : null}
          {report.status !== 'SIGNED' ? <IconButton icon={DS_ICONS.trash} label="Arquivar relatório" variant="danger" size="sm" disabled={reportMutations.deleteReport.isPending} onClick={() => setArchiveReportTarget(report)} /> : null}
        </>
      );
    }

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
          <button className="mini-btn alt" type="button" disabled={reportMutations.replaceManualReportPdf.isPending} onClick={() => openManualReportReplace(report)}>
            Editar manual
          </button>
        ) : null}
        {canReview && report.status !== 'APPROVED' ? (
          <button className="mini-btn" type="button" title={hasActiveClientRejection(report) ? 'Reenviar para avaliação' : 'Aprovar'} onClick={() => void handleReportStatus(report, 'APPROVED')}>
            {hasActiveClientRejection(report) ? 'Reenviar' : 'Aprovar'}
          </button>
        ) : null}
        {canReview && report.status !== 'RETURNED' ? (
          <button className="mini-btn alt" type="button" data-rdo-return-report-id={report.id} onClick={(event) => openReturnReportDialog(report, event.currentTarget)}>
            Devolver
          </button>
        ) : null}
        {report.status !== 'SIGNED' ? (
          <button className="mini-btn alt" type="button" disabled={reportMutations.updateSequence.isPending} onClick={() => openReportSequenceEdit(report)}>
            Nº
          </button>
        ) : null}
        {report.status !== 'SIGNED' ? (
          <button className="icon-button danger-icon-button" type="button" title="Arquivar relatório" aria-label="Arquivar relatório" disabled={reportMutations.deleteReport.isPending} onClick={() => setArchiveReportTarget(report)}>
            🗑
          </button>
        ) : null}
      </>
    );
  }

  function renderBatchReportActions(reports: ReportSummary[], forceDesignSystem = false) {
    const visibleIds = reports.map((report) => report.id);
    const selectedVisibleCount = selectedReportIds.filter((id) => visibleIds.includes(id)).length;
    const hasSelectedVisible = selectedVisibleCount > 0;

    if (reportListingTab || forceDesignSystem) {
      return (
        <div className={`report-batch-toolbar rdo-manager-listing__batch-toolbar${forceDesignSystem ? ' rdo-manager-listing__batch-toolbar--archived' : ''}`}>
          <span className="report-batch-count" role="status" aria-live="polite">
            {selectedVisibleCount} selecionado(s)
          </span>
          <div className="admin-form-actions">
            <Button className="report-batch-select-all" variant="secondary" size="sm" aria-label="Selecionar todos" onClick={() => setSelectedReportIds(visibleIds)}>
              <span className="report-batch-action-label report-batch-action-label--full">Selecionar todos</span>
              <span className="report-batch-action-label report-batch-action-label--compact">Todos</span>
            </Button>
            {hasSelectedVisible ? (
              <>
                <Button variant="ghost" size="sm" aria-label="Limpar seleção" onClick={() => setSelectedReportIds([])}>
                  <span className="report-batch-action-label report-batch-action-label--full">Limpar seleção</span>
                  <span className="report-batch-action-label report-batch-action-label--compact">Limpar</span>
                </Button>
                <Button variant="secondary" size="sm" aria-label="Baixar PDF" onClick={() => void handleBatchReportDownload('pdf', reports)}>
                  <span className="report-batch-action-label report-batch-action-label--full">Baixar PDF</span>
                  <span className="report-batch-action-label report-batch-action-label--compact">PDF</span>
                </Button>
                <Button variant="secondary" size="sm" aria-label="Baixar DOCX" onClick={() => void handleBatchReportDownload('docx', reports)}>
                  <span className="report-batch-action-label report-batch-action-label--full">Baixar DOCX</span>
                  <span className="report-batch-action-label report-batch-action-label--compact">DOCX</span>
                </Button>
              </>
            ) : null}
          </div>
        </div>
      );
    }

    return (
      <div className="report-batch-toolbar">
        <span className="report-batch-count">{selectedVisibleCount} selecionado(s)</span>
        <div className="admin-form-actions">
          <button className="mini-btn alt" type="button" aria-label="Selecionar todos" onClick={() => setSelectedReportIds(visibleIds)}>
            <span className="report-batch-action-label report-batch-action-label--full">Selecionar todos</span>
            <span className="report-batch-action-label report-batch-action-label--compact">Todos</span>
          </button>
          {hasSelectedVisible ? (
            <>
              <button className="mini-btn alt" type="button" aria-label="Limpar seleção" onClick={() => setSelectedReportIds([])}>
                <span className="report-batch-action-label report-batch-action-label--full">Limpar seleção</span>
                <span className="report-batch-action-label report-batch-action-label--compact">Limpar</span>
              </button>
              <button className="mini-btn alt" type="button" aria-label="Baixar PDF" onClick={() => void handleBatchReportDownload('pdf', reports)}>
                <span className="report-batch-action-label report-batch-action-label--full">Baixar PDF</span>
                <span className="report-batch-action-label report-batch-action-label--compact">PDF</span>
              </button>
              <button className="mini-btn alt" type="button" aria-label="Baixar DOCX" onClick={() => void handleBatchReportDownload('docx', reports)}>
                <span className="report-batch-action-label report-batch-action-label--full">Baixar DOCX</span>
                <span className="report-batch-action-label report-batch-action-label--compact">DOCX</span>
              </button>
            </>
          ) : null}
        </div>
      </div>
    );
  }

  function renderProjectReportGroups(reports: ReportSummary[]) {
    return (
      <div className="rdo-manager-listing" id="rdo-manager-report-results">
        <GroupedReportList
          reports={reports}
          appearance="design-system"
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
          renderReportCollection={({ reports: typeReports, projectLabel, reportType, sortDirection, onSortChange }) => (
            <ManagerReportListing
              reports={typeReports}
              selectedReportIds={selectedReportIds}
              onSelectionChange={(ids) => setSelectedReportIds(ids)}
              onOpenReport={handleOpenReport}
              renderActions={renderManagerReportActions}
              reportType={reportType}
              projectLabel={projectLabel}
              sortDirection={sortDirection}
              onSortChange={onSortChange}
            />
          )}
          renderReport={(report) => (
            <ReportSummaryCard
              key={report.id}
              report={report}
              leadingControl={
                <label className="report-select-checkbox" title="Selecionar relatório">
                  <input type="checkbox" checked={selectedReportIds.includes(report.id)} onChange={(event) => toggleReportSelection(report.id, event.target.checked)} />
                </label>
              }
              actions={renderManagerReportActions(report)}
            />
          )}
        />
      </div>
    );
  }

  function renderReportTypeSections(reports: ReportSummary[], projectId?: string, appearance: 'legacy' | 'design-system' = 'legacy') {
    const designSystem = appearance === 'design-system';
    const byType = reports.reduce<Record<string, ReportSummary[]>>((acc, report) => {
      if (!acc[report.reportType]) acc[report.reportType] = [];
      acc[report.reportType].push(report);
      return acc;
    }, {});
    if (projectId) {
      reportListQuery.projectTypeTotals(projectId).forEach((typeTotal) => {
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
        const totalReports = projectId ? (reportListQuery.groupTotal(projectId, reportType) ?? typeReports.length) : typeReports.length;
        const typeErrored = projectId ? reportListQuery.isGroupError(projectId, reportType) : false;
        const orderedLoadedCount = projectId ? Math.min(reportListQuery.groupLoadedCount(projectId, reportType, REPORT_TYPE_PAGE_SIZE, typeSortDirection), totalReports) : typeReports.length;
        const needsOrderedPage = !!projectId && totalReports > 0 && !typeErrored && !reportListQuery.isGroupPageReady(projectId, reportType, REPORT_TYPE_PAGE_SIZE, typeSortDirection);
        const orderedReports = sortedReports.slice(0, orderedLoadedCount);
        const visibleReports = needsOrderedPage ? [] : orderedReports.slice(0, visibleLimit);
        const hasLoadedItemsToReveal = !needsOrderedPage && visibleReports.length < orderedReports.length;
        const hasRemoteItemsToLoad = !!projectId && !needsOrderedPage && !hasLoadedItemsToReveal && orderedLoadedCount < totalReports;
        const typeLoading = projectId ? reportListQuery.isGroupLoading(projectId, reportType) : false;
        const typeContentId = `archived-report-type-${typeKey.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
        const toggleType = () => toggleArchivedType(typeKey);
        const loadMoreType = () => {
          if (hasLoadedItemsToReveal) {
            revealMoreArchivedType(typeKey, sortedReports.length);
            return;
          }
          if (projectId) {
            void handleLoadMoreArchivedType(projectId, reportType, typeKey, sortedReports.length, hasLoadedItemsToReveal, typeSortDirection);
          }
        };

        return (
          <div className={designSystem ? 'rdo-archived-report-type' : 'report-type-group'} key={typeKey}>
            {designSystem ? (
              <div className="rdo-archived-report-type__header">
                <button className="rdo-archived-report-type__toggle" type="button" aria-expanded={!typeClosed} aria-controls={typeContentId} onClick={toggleType}>
                  <ReportTypeBadge reportType={reportType} />
                  <span className="rdo-archived-report-type__count">
                    {visibleReports.length} de {totalReports} relatório{totalReports !== 1 ? 's' : ''}
                  </span>
                  <AppIcon className="rdo-archived-report-type__chevron" icon={DS_ICONS.chevronDown} size="sm" />
                </button>
                <ManagerReportTypeSortButton reportType={reportType} direction={typeSortDirection} onToggle={() => toggleArchivedTypeSort(typeKey)} />
              </div>
            ) : (
              <div
                className="report-type-header"
                onClick={toggleType}
                role="button"
                tabIndex={0}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    toggleType();
                  }
                }}
              >
                <span className={`rtype-badge rtype-${reportType}`}>{reportType}</span>
                <span className="rtype-count">
                  {visibleReports.length} de {totalReports} relatório{totalReports !== 1 ? 's' : ''}
                </span>
                <span onClick={(event) => event.stopPropagation()}>
                  <ProjectSortButton direction={typeSortDirection} onToggle={() => toggleArchivedTypeSort(typeKey)} />
                </span>
                <span className="rtype-chevron">{typeClosed ? '▸' : '▾'}</span>
              </div>
            )}
            {!typeClosed ? (
              <div className={designSystem ? 'rdo-archived-report-type__content' : undefined} id={typeContentId}>
                {designSystem && visibleReports.length ? renderBatchReportActions(visibleReports, true) : null}
                {visibleReports.length ? (
                  designSystem ? (
                    <ManagerReportListing
                      reports={visibleReports}
                      layout="cards"
                      selectedReportIds={selectedReportIds}
                      onSelectionChange={(ids) => setSelectedReportIds(ids)}
                      onOpenReport={handleOpenReport}
                      renderActions={(report) => renderManagerReportActions(report, true)}
                      reportType={reportType}
                      projectLabel={typeReports[0]?.project?.name || 'Projeto arquivado'}
                      sortDirection={typeSortDirection}
                      onSortChange={() => toggleArchivedTypeSort(typeKey)}
                    />
                  ) : (
                    <div className="report-type-list">
                      {visibleReports.map((report) => (
                        <ReportSummaryCard
                          key={report.id}
                          report={report}
                          leadingControl={
                            <label className="report-select-checkbox" title="Selecionar relatório">
                              <input type="checkbox" checked={selectedReportIds.includes(report.id)} onChange={(event) => toggleReportSelection(report.id, event.target.checked)} />
                            </label>
                          }
                          actions={renderManagerReportActions(report)}
                        />
                      ))}
                    </div>
                  )
                ) : null}
                {needsOrderedPage ? (
                  designSystem ? (
                    <div className="rdo-archived-report-type__loading" role="status" aria-live="polite">
                      <span className="fv-sr-only">Carregando relatórios…</span>
                      <Skeleton variant="card" decorative />
                    </div>
                  ) : (
                    <div className="placeholder-copy">Carregando relatórios...</div>
                  )
                ) : null}
                {typeErrored ? designSystem ? <EmptyState variant="error" title="Não foi possível carregar os relatórios desta seção." /> : <div className="placeholder-copy">Não foi possível carregar os relatórios desta aba.</div> : null}
                {hasLoadedItemsToReveal || hasRemoteItemsToLoad ? (
                  <div className={designSystem ? 'rdo-archived-report-type__load-more' : 'admin-create-toolbar report-type-load-more'}>
                    <InfiniteScrollSentinel hasMore={(hasLoadedItemsToReveal || hasRemoteItemsToLoad) && !typeErrored} isLoading={typeLoading} onLoadMore={loadMoreType} />
                    {designSystem ? (
                      <Button variant="secondary" loading={typeLoading} disabled={typeLoading} onClick={loadMoreType}>
                        Carregar mais
                      </Button>
                    ) : (
                      <button className="mini-btn" type="button" disabled={typeLoading} onClick={loadMoreType}>
                        {typeLoading ? 'Carregando...' : typeErrored ? 'Tentar novamente' : 'Carregar mais'}
                      </button>
                    )}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        );
      });
  }

  function renderManualReportModal() {
    if (!manualReportModalOpen) return null;
    const replacing = Boolean(manualReportTarget);
    const submitting = manualReportSubmitting || reportMutations.uploadManualReport.isPending || reportMutations.replaceManualReportPdf.isPending;
    const serviceReportSelected = manualReportForm.reportType !== 'RDO';
    const selectedPdfLabel = replacing ? manualReportForm.fileName : manualReportUploadListLabel(manualReportForm.files);

    return (
      <LegacyReportsUploadModal
        replacing={replacing}
        submitting={submitting}
        projects={manualReportProjectOptions}
        projectId={manualReportForm.projectId}
        onProjectChange={projectId => setManualReportForm(current => ({ ...current, projectId }))}
        onClose={closeManualReportModal}
        footer={
          <>
            <Button variant="secondary" size="sm" type="button" disabled={submitting} onClick={closeManualReportModal}>
              Cancelar
            </Button>
            <Button variant="primary" size="sm" type="submit" form="manual-report-form" disabled={submitting || (replacing ? !manualReportForm.projectId : !manualReportForm.files.length)}>
              {submitting ? 'Salvando...' : replacing ? 'Salvar alterações' : manualReportForm.files.length > 1 ? 'Adicionar relatórios' : 'Adicionar relatório'}
            </Button>
          </>
        }
      >
        <form id="manual-report-form" className="admin-form admin-form-grid manual-report-form" onSubmit={handleManualReportSubmit}>
          <div className="field-group">
            <label htmlFor="manual-report-project">Projeto</label>
            <select id="manual-report-project" value={manualReportForm.projectId} onChange={(event) => setManualReportForm((current) => ({ ...current, projectId: event.target.value }))} required>
              <option value="">Selecionar projeto...</option>
              {manualReportProjectOptions.map((project) => (
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
              onChange={(event) => {
                const reportType = event.target.value as ReportType;
                setManualReportForm((current) => ({
                  ...current,
                  reportType,
                  ...(reportType === 'RDO'
                    ? {
                        serviceEquipment: '',
                        serviceSystem: '',
                        files: current.files.map((file) => ({ ...file, serviceEquipment: '', serviceSystem: '' }))
                      }
                    : {})
                }));
              }}
            >
              {projectReportTypes.map((reportType) => (
                <option key={reportType} value={reportType}>
                  {reportType}
                </option>
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
                  onChange={(event) => setManualReportForm((current) => ({ ...current, serviceEquipment: event.target.value }))}
                  placeholder="Equipamento do serviço"
                />
              </div>
              <div className="field-group">
                <label htmlFor="manual-report-service-system">Sistema</label>
                <input id="manual-report-service-system" value={manualReportForm.serviceSystem} onChange={(event) => setManualReportForm((current) => ({ ...current, serviceSystem: event.target.value }))} placeholder="Sistema do serviço" />
              </div>
            </>
          ) : null}
          {replacing ? (
            <>
              <div className="field-group">
                <label htmlFor="manual-report-date">Data</label>
                <input id="manual-report-date" type="date" value={manualReportForm.reportDate} disabled onChange={(event) => setManualReportForm((current) => ({ ...current, reportDate: event.target.value }))} required />
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
                  onChange={(event) => setManualReportForm((current) => ({ ...current, sequenceNumber: event.target.value.replace(/\D/g, '') }))}
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
              disabled={replacing && !manualReportForm.pdfDataUrl}
              onChange={(event) => setManualReportForm((current) => ({ ...current, signatureMode: event.target.value as ManualReportFormState['signatureMode'] }))}
            >
              <option value="APPROVED">Aprovado (assinatura opcional)</option>
              <option value="REQUIRES_SIGNATURE">Precisa de assinatura</option>
              <option value="SIGNED">Já assinado</option>
            </select>
          </div>
          <div className="field-group-wide">
            <PdfDropzone
              id="manual-report-pdf"
              label={replacing ? 'PDF (opcional)' : 'PDFs'}
              fileName={selectedPdfLabel}
              onFile={(file) => void handleManualReportFile(file)}
              multiple={!replacing}
              onFiles={(files) => void handleManualReportFiles(files)}
              disabled={submitting}
            />
          </div>
          {!replacing && manualReportForm.files.length ? (
            <div className="manual-report-file-list">
              {manualReportForm.files.map((file, index) => {
                const collaboratorPrompts = manualReportCollaboratorPrompts.filter((prompt) => prompt.sourceFileId === file.id);
                return (
                  <ManualReportUploadFileCard
                    key={file.id}
                    file={file}
                    index={index}
                    serviceReportSelected={serviceReportSelected}
                    showStandby={manualReportForm.reportType === 'RDO'}
                    collaborators={collaboratorsQuery.data || []}
                    disabled={submitting}
                    collaboratorPrompts={collaboratorPrompts}
                    onRemove={removeManualReportUploadFile}
                    onUpdate={updateManualReportUploadFile}
                    onOperationalChange={updateManualReportOperationalFields}
                    onApplyPrompt={applyManualReportCollaboratorsToOthers}
                    onDismissPrompt={dismissManualReportCollaboratorPrompt}
                  />
                );
              })}
            </div>
          ) : null}
        </form>
      </LegacyReportsUploadModal>
    );
  }

  function renderLoadMoreReports(appearance: 'design-system' | 'legacy' = 'legacy') {
    const showButton = reportListQuery.hasMore || reportListQuery.isLoadingMore;
    return (
      <>
        <div ref={loadMoreReportsRef} aria-hidden="true" />
        {showButton ? (
          <div className={appearance === 'design-system' ? 'admin-create-toolbar rdo-manager-listing__global-load-more' : 'admin-create-toolbar'}>
            {appearance === 'design-system' ? (
              <Button variant="secondary" loading={reportListQuery.isLoadingMore} disabled={reportListQuery.isLoadingMore} onClick={reportListQuery.loadMore}>
                Carregar mais
              </Button>
            ) : (
              <button className="mini-btn" type="button" disabled={reportListQuery.isLoadingMore} onClick={reportListQuery.loadMore}>
                {reportListQuery.isLoadingMore ? 'Carregando...' : 'Carregar mais'}
              </button>
            )}
          </div>
        ) : null}
      </>
    );
  }

  function renderReportTabContent() {
    const sourceReports = tab === 'pendentes' ? pendingReports : tab === 'arquivados' ? archivedReports : approvedReports;
    const visibleReports = sourceReports;

    if (reportListQuery.isLoadingInitial) {
      return (
        <div className="rdo-manager-listing__loading" role="status" aria-live="polite">
          <span className="fv-sr-only">Carregando relatórios…</span>
          <Skeleton variant="card" decorative />
          <Skeleton variant="card" decorative />
        </div>
      );
    }

    if (reportListQuery.isError && !visibleReports.length) {
      return (
        <Card padding="lg">
          <EmptyState
            variant="error"
            title="Não foi possível carregar os relatórios."
            description="Tente novamente para consultar os relatórios desta área."
            action={{
              label: 'Tentar novamente',
              onClick: () => {
                void reportListQuery.refetch();
              }
            }}
          />
        </Card>
      );
    }

    const drafts = (draftsQuery.data || []).filter((draft) => draft.projectId || draft.payload.projectId);
    const draftsBlock =
      tab === 'pendentes' && drafts.length ? (
        <Card className="rdo-manager-listing__drafts" padding="md" title="Relatórios em andamento">
          <div className="rdo-manager-listing__draft-grid">
            {drafts.map((draft) => (
              <Card className="rdo-manager-listing__draft" variant="flat" padding="sm" key={draft.id}>
                <div className="rdo-manager-listing__draft-head">
                  <div>
                    <div className="rdo-manager-listing__draft-title">{draft.title || 'Relatório em andamento'}</div>
                    <div className="rdo-manager-listing__draft-meta">
                      <span>{draft.project?.code || draft.projectId || 'Projeto'}</span>
                      <span>{draftDateLabel(draft)}</span>
                      {(() => {
                        const count = Array.isArray((draft.payload as Record<string, unknown>).services) ? ((draft.payload as Record<string, unknown>).services as unknown[]) : [];
                        return count.length ? <span>{count.length} serviço(s)</span> : null;
                      })()}
                    </div>
                  </div>
                  <div className="rdo-manager-listing__draft-actions">
                    <Button variant="secondary" size="sm" onClick={() => handleResumeDraft(draft)}>
                      Continuar
                    </Button>
                    <Button variant="danger" size="sm" onClick={() => draftMutations.removeDraft.mutate(draft.id)}>
                      Excluir
                    </Button>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </Card>
      ) : null;

    if (!visibleReports.length) {
      return (
        <>
          {draftsBlock}
          <Card padding="lg">
            <EmptyState
              variant={gestorSearch.trim() ? 'search' : 'default'}
              title={tab === 'pendentes' ? 'Nenhum relatório pendente.' : tab === 'arquivados' ? 'Nenhum relatório arquivado.' : 'Nenhum relatório aprovado.'}
              description={gestorSearch.trim() ? 'Revise ou limpe a busca para ver outros relatórios.' : undefined}
            />
          </Card>
        </>
      );
    }

    const reasonDialog = (
      <ReasonDialog
        open={!!returnReport}
        appearance="design-system"
        title="Devolver relatório"
        description="Informe o motivo da devolução do relatório."
        label="Motivo"
        confirmLabel="Devolver"
        requiredMessage="Informe um motivo para devolver o relatório."
        isSubmitting={reportMutations.updateStatus.isPending}
        onCancel={closeReturnReportDialog}
        onConfirm={(reason) => {
          if (returnReport) void handleReportStatus(returnReport, 'RETURNED', reason);
        }}
      />
    );
    return (
      <>
        {draftsBlock}
        {renderProjectReportGroups(visibleReports)}
        {renderLoadMoreReports('design-system')}
        {reasonDialog}
      </>
    );
  }

  function renderReportSequenceDialog() {
    const sequenceDialog = (
      <Modal
        open={!!sequenceEditReport}
        onClose={closeReportSequenceEdit}
        appearance="design-system"
        size="sm"
        title="Alterar numeração"
        ariaLabelledBy="report-sequence-edit-title"
        ariaDescribedBy="report-sequence-edit-description"
        backdropClassName="rdo-manager-sequence-dialog-backdrop"
        panelClassName="rdo-manager-sequence-dialog-modal"
        fullscreenOnMobile={false}
        initialFocusRef={sequenceEditInputRef}
        footer={
          <>
            <Button variant="secondary" size="md" type="button" disabled={reportMutations.updateSequence.isPending} onClick={closeReportSequenceEdit}>
              Cancelar
            </Button>
            <Button variant="primary" size="md" type="submit" form="report-sequence-edit-form" disabled={reportMutations.updateSequence.isPending}>
              {reportMutations.updateSequence.isPending ? 'Salvando...' : 'Salvar número'}
            </Button>
          </>
        }
      >
        <form id="report-sequence-edit-form" className="rdo-manager-sequence-dialog" onSubmit={handleReportSequenceEditSubmit}>
          <p className="rdo-manager-sequence-dialog__description" id="report-sequence-edit-description">
            {sequenceEditReport ? `Informe o novo número para ${sequenceEditReport.reportType}${sequenceEditReport.sequenceNumber ? ` ${sequenceEditReport.sequenceNumber}` : ''}.` : 'Informe o novo número do relatório.'}
          </p>
          <Field required>
            <div className="fv-field__heading">
              <label className="fv-field__label" htmlFor="report-sequence-edit-input">
                Novo número
                <span className="fv-field__required" aria-hidden="true">
                  {' '}
                  *
                </span>
              </label>
            </div>
            <Input ref={sequenceEditInputRef} id="report-sequence-edit-input" type="number" size="lg" min={1} step={1} inputMode="numeric" value={sequenceEditValue} onChange={(event) => setSequenceEditValue(event.target.value)} required />
          </Field>
        </form>
      </Modal>
    );

    return (
      <>
        {sequenceDialog}
      </>
    );
  }

  function renderProjectsTab() {
    const allActiveProjects = (activeProjectsQuery.data || []).filter((project) => project.isActive !== false);
    const projectRegistrationGroups = partitionProjectsByRegistration(allActiveProjects);
    const pendingRegistrationProjects = projectRegistrationGroups.pending;
    const readyProjects = projectRegistrationGroups.ready;
    const activeProjects = readyProjects.filter((project) => matchesSearch(projectSearchParts(project), gestorSearch));

    if (activeProjectsQuery.isLoading) {
      return (
        <div className="rdo-manager-projects__loading" role="status" aria-live="polite">
          <span className="fv-sr-only">Carregando projetos…</span>
          <Skeleton variant="card" decorative />
          <Skeleton variant="card" decorative />
        </div>
      );
    }

    if (activeProjectsQuery.isError) {
      return (
        <Card padding="lg">
          <EmptyState
            variant="error"
            title="Não foi possível carregar os projetos."
            description="Tente novamente para consultar e gerenciar os projetos ativos."
            action={{
              label: 'Tentar novamente',
              onClick: () => {
                void activeProjectsQuery.refetch();
              }
            }}
          />
        </Card>
      );
    }

    const renderEditableProjectCard = (project: Project) =>
      renderProjectCard(project, {
        appearance: 'design-system',
        commercialPendencia: commercialPendenciaByProject.get(project.id) ?? null,
        onUploadOldReports: project => openManualReportUpload(project.id),
        children:
          projectEditingId === project.id ? (
            projectRegistrationPending(project) ? (
              <PendingProjectReviewForm
                project={project}
                saving={projectMutations.updateProject.isPending}
                onCancel={resetProjectForm}
                onSubmit={async (payload) => {
                  try {
                    await projectMutations.updateProject.mutateAsync({ id: project.id, payload });
                    showToast('Projeto verificado e liberado.', 'success');
                    resetProjectForm();
                  } catch (error) {
                    showToast(error instanceof Error ? error.message : 'Não foi possível confirmar o projeto.', 'error');
                  }
                }}
              />
            ) : (
              <form className="admin-inline-form admin-inline-grid rdo-project-edit-form" onSubmit={handleProjectSubmit}>
                <div className="field-group">
                  <label htmlFor={`project-code-${project.id}`}>Número da missão</label>
                  <input id={`project-code-${project.id}`} value={projectForm.code} readOnly />
                </div>
                <div className="field-group">
                  <label htmlFor={`project-name-${project.id}`}>Nome</label>
                  <input id={`project-name-${project.id}`} value={projectForm.name} onChange={(event) => setProjectForm((current) => ({ ...current, name: event.target.value }))} required />
                </div>
                <div className="field-group">
                  <label htmlFor={`project-client-${project.id}`}>Cliente</label>
                  <input id={`project-client-${project.id}`} value={projectForm.clientName} onChange={(event) => setProjectForm((current) => ({ ...current, clientName: event.target.value }))} required />
                </div>
                <div className="field-group">
                  <label htmlFor={`project-cnpj-${project.id}`}>CNPJ</label>
                  <input id={`project-cnpj-${project.id}`} value={projectForm.clientCnpj} onChange={(event) => setProjectForm((current) => ({ ...current, clientCnpj: normalizeCnpjInput(event.target.value) }))} required />
                </div>
                <ProjectClientFields form={projectForm} idPrefix={`project-${project.id}`} setForm={setProjectForm} />
                <div className="field-group">
                  <label htmlFor={`project-contract-${project.id}`}>Proposta</label>
                  <input id={`project-contract-${project.id}`} value={projectForm.contractCode} onChange={(event) => setProjectForm((current) => ({ ...current, contractCode: event.target.value }))} />
                </div>
                <div className="field-group">
                  <label htmlFor={`project-location-${project.id}`}>Local</label>
                  <input id={`project-location-${project.id}`} value={projectForm.location} onChange={(event) => setProjectForm((current) => ({ ...current, location: event.target.value }))} />
                </div>
                <div className="field-group">
                  <label htmlFor={`project-operator-${project.id}`}>Operador responsável</label>
                  <select id={`project-operator-${project.id}`} value={projectForm.operatorId} onChange={(event) => setProjectForm((current) => ({ ...current, operatorId: event.target.value }))}>
                    <option value="">Selecionar...</option>
                    {(collaboratorsQuery.data || [])
                      .filter((item) => item.isActive)
                      .map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name}
                        </option>
                      ))}
                  </select>
                </div>
                <ProjectAuthorizedUsersFields form={projectForm} idPrefix={`project-${project.id}`} setForm={setProjectForm} users={internalUsersQuery.data || []} />
                <div className="field-group">
                  <label htmlFor={`project-segment-${project.id}`}>Segmento do cliente</label>
                  <select id={`project-segment-${project.id}`} value={projectForm.clientSegment} onChange={(event) => setProjectForm((current) => ({ ...current, clientSegment: event.target.value }))}>
                    <option value="">Selecionar segmento...</option>
                    {(projectSegmentsQuery.data || []).map((s) => (
                      <option key={s.slug} value={s.slug}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                  <Button variant="secondary" size="sm" type="button" onClick={openSegmentForm}>
                    + Adicionar segmento
                  </Button>
                </div>
                <div className="field-group">
                  <label htmlFor={`project-visible-${project.id}`}>Visibilidade / criação de relatórios</label>
                  <select
                    id={`project-visible-${project.id}`}
                    value={projectVisibilityMode(projectForm)}
                    onChange={(event) =>
                      setProjectForm((current) => ({
                        ...current,
                        ...applyProjectVisibilityMode(event.target.value as ProjectVisibilityMode)
                      }))
                    }
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
                    onChange={(event) => setProjectForm((current) => ({ ...current, inhibitionServiceEnabled: event.target.value === 'true' }))}
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
                      <input type="checkbox" checked={projectForm.requireServiceReportSignatures} onChange={(event) => setProjectForm((current) => ({ ...current, requireServiceReportSignatures: event.target.checked }))} />
                      <span className="tog-sl" />
                    </label>
                  </div>
                </div>
                <ProjectReportSequenceFields form={projectForm} idPrefix={`project-${project.id}`} setForm={setProjectForm} />
                <div className="field-group">
                  <label htmlFor={`project-workday-${project.id}`}>Jornada padrão</label>
                  <input id={`project-workday-${project.id}`} type="text" placeholder="09:00" value={projectForm.workdayHours} onChange={(event) => setProjectForm((current) => ({ ...current, workdayHours: event.target.value }))} />
                </div>
                <div className="field-group">
                  <label htmlFor={`project-weekend-${project.id}`}>Jornada fim de semana</label>
                  <input
                    id={`project-weekend-${project.id}`}
                    type="text"
                    placeholder="08:00"
                    value={projectForm.weekendWorkdayHours}
                    onChange={(event) => setProjectForm((current) => ({ ...current, weekendWorkdayHours: event.target.value }))}
                  />
                </div>
                <div className="field-group">
                  <label htmlFor={`project-sat-${project.id}`}>Inclui sábado</label>
                  <select id={`project-sat-${project.id}`} value={projectForm.includesSaturday ? 'true' : 'false'} onChange={(event) => setProjectForm((current) => ({ ...current, includesSaturday: event.target.value === 'true' }))}>
                    <option value="true">Sim</option>
                    <option value="false">Não</option>
                  </select>
                </div>
                <div className="field-group">
                  <label htmlFor={`project-sun-${project.id}`}>Inclui domingo</label>
                  <select id={`project-sun-${project.id}`} value={projectForm.includesSunday ? 'true' : 'false'} onChange={(event) => setProjectForm((current) => ({ ...current, includesSunday: event.target.value === 'true' }))}>
                    <option value="true">Sim</option>
                    <option value="false">Não</option>
                  </select>
                </div>
                <div className="admin-form-actions">
                  <Button variant="primary" size="md" type="submit" disabled={projectMutations.updateProject.isPending}>
                    Salvar projeto
                  </Button>
                  <Button variant="secondary" size="md" type="button" onClick={resetProjectForm}>
                    Cancelar edição
                  </Button>
                </div>
              </form>
            )
          ) : null,
        onEdit: toggleProjectEdit,
        editing: projectEditingId === project.id,
        onManageTeam: openProjectTeamDialog,
        onViewReports: handleViewProjectReports,
        reportCount: activeProjectReportCountById.get(project.id),
        onToggleArchive: handleProjectToggleArchive,
        onRemove: setRemoveProjectTarget,
        detailsExpanded: projectDetailsExpanded(project.id),
        onToggleDetails: toggleProjectDetails,
        onSendSurvey: handleSendSurvey,
        onResendSurvey: handleResendSurvey,
        surveyPending: surveyMutations.sendProjectSurvey.isPending || surveyMutations.resendSurvey.isPending,
        segments: projectSegmentsQuery.data
      });

    return (
      <section id="rdo-manager-project-results" className="rdo-manager-projects rdo-ds-actions" aria-label="Lista de projetos ativos">
        {showProjectForm && !projectEditingId ? (
          <Card
            className="rdo-manager-projects__legacy-form"
            padding="md"
            title="Novo projeto"
            actions={
              <Button variant="secondary" size="sm" type="button" onClick={resetProjectForm}>
                Cancelar
              </Button>
            }
          >
            <form className="admin-inline-grid" onSubmit={handleProjectSubmit}>
              <div className="field-group">
                <label htmlFor="project-code">Número da missão</label>
                <input id="project-code" value={projectForm.code} onChange={(event) => setProjectForm((current) => ({ ...current, code: event.target.value }))} required />
              </div>
              <div className="field-group">
                <label htmlFor="project-name">Nome</label>
                <input id="project-name" value={projectForm.name} onChange={(event) => setProjectForm((current) => ({ ...current, name: event.target.value }))} required />
              </div>
              <div className="field-group">
                <label htmlFor="project-client-name">Cliente</label>
                <input id="project-client-name" value={projectForm.clientName} onChange={(event) => setProjectForm((current) => ({ ...current, clientName: event.target.value }))} required />
              </div>
              <div className="field-group">
                <label htmlFor="project-client-cnpj">CNPJ</label>
                <input id="project-client-cnpj" value={projectForm.clientCnpj} onChange={(event) => setProjectForm((current) => ({ ...current, clientCnpj: normalizeCnpjInput(event.target.value) }))} required />
              </div>
              <ProjectClientFields form={projectForm} idPrefix="project" setForm={setProjectForm} />
              <div className="field-group">
                <label htmlFor="project-contract">Proposta</label>
                <input id="project-contract" value={projectForm.contractCode} onChange={(event) => setProjectForm((current) => ({ ...current, contractCode: event.target.value }))} />
              </div>
              <div className="field-group">
                <label htmlFor="project-location">Local</label>
                <input id="project-location" value={projectForm.location} onChange={(event) => setProjectForm((current) => ({ ...current, location: event.target.value }))} />
              </div>
              <div className="field-group">
                <label htmlFor="project-operator">Operador responsável</label>
                <select id="project-operator" value={projectForm.operatorId} onChange={(event) => setProjectForm((current) => ({ ...current, operatorId: event.target.value }))}>
                  <option value="">Selecionar...</option>
                  {(collaboratorsQuery.data || [])
                    .filter((item) => item.isActive)
                    .map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                </select>
              </div>
              <ProjectAuthorizedUsersFields form={projectForm} idPrefix="project" setForm={setProjectForm} users={internalUsersQuery.data || []} />
              <div className="field-group">
                <label htmlFor="project-segment">Segmento do cliente</label>
                <select id="project-segment" value={projectForm.clientSegment} onChange={(event) => setProjectForm((current) => ({ ...current, clientSegment: event.target.value }))}>
                  <option value="">Selecionar segmento...</option>
                  {(projectSegmentsQuery.data || []).map((s) => (
                    <option key={s.slug} value={s.slug}>
                      {s.label}
                    </option>
                  ))}
                </select>
                <Button variant="secondary" size="sm" type="button" onClick={openSegmentForm}>
                  + Adicionar segmento
                </Button>
              </div>
              <div className="field-group">
                <label htmlFor="project-visible">Visibilidade / criação de relatórios</label>
                <select
                  id="project-visible"
                  value={projectVisibilityMode(projectForm)}
                  onChange={(event) =>
                    setProjectForm((current) => ({
                      ...current,
                      ...applyProjectVisibilityMode(event.target.value as ProjectVisibilityMode)
                    }))
                  }
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
                  onChange={(event) => setProjectForm((current) => ({ ...current, inhibitionServiceEnabled: event.target.value === 'true' }))}
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
                    <input type="checkbox" checked={projectForm.requireServiceReportSignatures} onChange={(event) => setProjectForm((current) => ({ ...current, requireServiceReportSignatures: event.target.checked }))} />
                    <span className="tog-sl" />
                  </label>
                </div>
              </div>
              <ProjectReportSequenceFields form={projectForm} idPrefix="project" setForm={setProjectForm} />
              <div className="field-group">
                <label htmlFor="project-workday">Jornada padrão</label>
                <input id="project-workday" type="text" placeholder="09:00" value={projectForm.workdayHours} onChange={(event) => setProjectForm((current) => ({ ...current, workdayHours: event.target.value }))} />
              </div>
              <div className="field-group">
                <label htmlFor="project-weekend">Jornada fim de semana</label>
                <input id="project-weekend" type="text" placeholder="08:00" value={projectForm.weekendWorkdayHours} onChange={(event) => setProjectForm((current) => ({ ...current, weekendWorkdayHours: event.target.value }))} />
              </div>
              <div className="field-group">
                <label htmlFor="project-sat">Inclui sábado</label>
                <select id="project-sat" value={projectForm.includesSaturday ? 'true' : 'false'} onChange={(event) => setProjectForm((current) => ({ ...current, includesSaturday: event.target.value === 'true' }))}>
                  <option value="true">Sim</option>
                  <option value="false">Não</option>
                </select>
              </div>
              <div className="field-group">
                <label htmlFor="project-sun">Inclui domingo</label>
                <select id="project-sun" value={projectForm.includesSunday ? 'true' : 'false'} onChange={(event) => setProjectForm((current) => ({ ...current, includesSunday: event.target.value === 'true' }))}>
                  <option value="true">Sim</option>
                  <option value="false">Não</option>
                </select>
              </div>
              <div className="admin-form-actions">
                <Button variant="primary" type="submit" disabled={projectMutations.createProject.isPending}>
                  Criar projeto
                </Button>
              </div>
            </form>
          </Card>
        ) : null}

        <p className="rdo-manager-projects__result-count" role="status" aria-live="polite">
          {activeProjects.length} projeto
          {activeProjects.length === 1 ? '' : 's'} encontrado
          {activeProjects.length === 1 ? '' : 's'}
        </p>

        {pendingRegistrationProjects.length ? (
          <section className="rdo-manager-projects__pending" aria-labelledby="pending-project-registration-title" data-project-intake-pending>
            <div className="rdo-manager-projects__pending-header">
              <h2 id="pending-project-registration-title">Projetos aguardando revisão</h2>
              <Badge tone="warning">{pendingRegistrationProjects.length}</Badge>
            </div>
            <Alert tone="warning" title="Verificação necessária">
              {pendingProjectRegistrationMessage(pendingRegistrationProjects)}
            </Alert>
            <div className="rdo-manager-projects__list">{sortProjects(pendingRegistrationProjects, projectSortDir).map(renderEditableProjectCard)}</div>
          </section>
        ) : null}

        {activeProjects.length ? (
          <div className="rdo-manager-projects__list">{sortProjects(activeProjects, projectSortDir).map(renderEditableProjectCard)}</div>
        ) : pendingRegistrationProjects.length ? null : (
          <Card padding="lg">
            <EmptyState
              variant={gestorSearch.trim() ? 'search' : 'default'}
              title={gestorSearch.trim() ? 'Nenhum projeto encontrado.' : 'Nenhum projeto ativo.'}
              description={gestorSearch.trim() ? 'Revise o termo da busca ou limpe o filtro para ver todos os projetos.' : undefined}
            />
          </Card>
        )}
      </section>
    );
  }

  function renderArchivedProjectsTab() {
    const archivedProjects = (archivedProjectsQuery.data || []).filter((project) => project.isActive === false);

    if (archivedProjectsQuery.isLoading || reportListQuery.isLoadingInitial) {
      return (
        <div className="rdo-archived-projects__loading" role="status" aria-live="polite">
          <span className="fv-sr-only">Carregando projetos arquivados…</span>
          <Skeleton variant="card" decorative />
          <Skeleton variant="card" decorative />
        </div>
      );
    }

    if (reportListQuery.isError) {
      return (
        <Card padding="lg">
          <EmptyState
            variant="error"
            title="Não foi possível carregar os projetos arquivados."
            description="Tente novamente para consultar os projetos e relatórios arquivados."
            action={{
              label: 'Tentar novamente',
              onClick: () => {
                void reportListQuery.refetch();
              }
            }}
          />
        </Card>
      );
    }

    const archivedProjectCards = sortProjects(archivedProjects, projectSortDir)
      .map((project) => {
        const projectReports = archivedReports.filter((report) => report.projectId === project.id);
        const projectMatches = matchesSearch(projectSearchParts(project), gestorSearch);
        const filteredProjectReports = projectMatches ? projectReports : projectReports.filter((report) => matchesSearch(reportSearchParts(report), gestorSearch));
        const groupedReportTotal = reportListQuery.projectTypeTotals(project.id).reduce((total, group) => total + group.total, 0);
        return {
          project,
          projectReports: filteredProjectReports,
          reportTotal: groupedReportTotal || filteredProjectReports.length,
          visible: filteredProjectReports.length > 0 || (!gestorSearch.trim() && projectMatches)
        };
      })
      .filter((item) => item.visible);
    const dialogProject = archivedProjectCards.find(({ project }) => project.id === archivedReportsProjectId);
    return (
      <section id="rdo-manager-archived-results" className="rdo-archived-projects rdo-ds-actions" aria-label="Lista de projetos arquivados">
        {archivedProjectCards.length ? (
          <>
            <p className="rdo-archived-projects__result-count">
              {archivedProjectCards.length} projeto{archivedProjectCards.length === 1 ? '' : 's'} encontrado{archivedProjectCards.length === 1 ? '' : 's'}
            </p>
            <div className="rdo-archived-projects__list">
              {archivedProjectCards.map(({ project, reportTotal }) => {
                return renderProjectCard(project, {
                  appearance: 'design-system',
                  commercialPendencia: commercialPendenciaByProject.get(project.id) ?? null,
                  onUploadOldReports: project => openManualReportUpload(project.id),
                  onEdit: toggleProjectEdit,
                  onToggleArchive: handleProjectToggleArchive,
                  onRemove: setRemoveProjectTarget,
                  detailsExpanded: projectDetailsExpanded(project.id),
                  onToggleDetails: toggleProjectDetails,
                  reportCount: reportTotal,
                  onOpenReports: openArchivedReports,
                  onSendSurvey: handleSendSurvey,
                  onResendSurvey: handleResendSurvey,
                  surveyPending: surveyMutations.sendProjectSurvey.isPending || surveyMutations.resendSurvey.isPending,
                  segments: projectSegmentsQuery.data
                });
              })}
            </div>
          </>
        ) : (
          <EmptyState
            variant={gestorSearch.trim() ? 'search' : 'default'}
            title={gestorSearch.trim() ? 'Nenhum projeto arquivado encontrado.' : 'Nenhum projeto arquivado.'}
            description={gestorSearch.trim() ? 'Revise o termo da busca ou limpe o filtro para ver todos os projetos.' : undefined}
          />
        )}
        {renderLoadMoreReports('design-system')}
        <Modal
          open={Boolean(dialogProject)}
          onClose={closeArchivedReports}
          closeOnBackdrop
          appearance="design-system"
          title="Relatórios do projeto"
          size="lg"
          fullscreenOnMobile={false}
          ariaDescribedBy="archived-reports-project-context"
          backdropClassName="rdo-archived-reports-dialog-backdrop"
          panelClassName="rdo-archived-reports-dialog rdo-ds-actions"
        >
          {dialogProject ? (
            <div className="rdo-archived-reports-dialog__content">
              <p id="archived-reports-project-context" className="rdo-archived-reports-dialog__context">
                <strong>{projectTitle(dialogProject.project)}</strong>
                <span>{dialogProject.reportTotal} relatório{dialogProject.reportTotal === 1 ? '' : 's'} aprovado{dialogProject.reportTotal === 1 ? '' : 's'} ou assinado{dialogProject.reportTotal === 1 ? '' : 's'}</span>
              </p>
              {gestorSearch.trim() ? <p className="rdo-archived-reports-dialog__filter">Filtro da busca: {gestorSearch}</p> : null}
              {dialogProject.reportTotal ? (
                renderReportTypeSections(dialogProject.projectReports, dialogProject.project.id, 'design-system')
              ) : (
                <EmptyState title="Nenhum relatório disponível" description="Este projeto arquivado ainda não possui relatórios aprovados ou assinados." />
              )}
            </div>
          ) : null}
        </Modal>
      </section>
    );
  }

  function renderEquipeTab() {
    return (
      <section className="rdo-admin-section rdo-team" id="rdo-manager-team-results" aria-label="Gestão da equipe">
        <Card className="rdo-team-workspace" padding="md" elevation="sm">
          <div className="rdo-admin-tabs" role="tablist" aria-label="Seções da equipe" onKeyDown={handleHorizontalTabListKeyDown}>
            <button
              id="rdo-team-tab-collaborators"
              className={`rdo-admin-tab ${equipeSubTab === 'colaboradores' ? 'is-active' : ''}`}
              type="button"
              role="tab"
              aria-selected={equipeSubTab === 'colaboradores'}
              aria-controls="rdo-team-panel"
              onClick={() => {
                setEquipeSubTab('colaboradores');
                setJobRoleCreateOpen(false);
                setDdsThemeCreateOpen(false);
              }}
            >
              Colaboradores
            </button>
            <button
              id="rdo-team-tab-roles"
              className={`rdo-admin-tab ${equipeSubTab === 'cargos' ? 'is-active' : ''}`}
              type="button"
              role="tab"
              aria-selected={equipeSubTab === 'cargos'}
              aria-controls="rdo-team-panel"
              onClick={() => {
                setEquipeSubTab('cargos');
                setDdsThemeCreateOpen(false);
              }}
            >
              Cargos
            </button>
            <button
              id="rdo-team-tab-dds"
              className={`rdo-admin-tab ${equipeSubTab === 'dds' ? 'is-active' : ''}`}
              type="button"
              role="tab"
              aria-selected={equipeSubTab === 'dds'}
              aria-controls="rdo-team-panel"
              onClick={() => {
                setEquipeSubTab('dds');
                setJobRoleCreateOpen(false);
              }}
            >
              Temas de DDS
            </button>
          </div>
          <div className="rdo-admin-section__content" id="rdo-team-panel" role="tabpanel" aria-labelledby={`rdo-team-tab-${equipeSubTab === 'colaboradores' ? 'collaborators' : equipeSubTab === 'cargos' ? 'roles' : 'dds'}`}>
            {equipeSubTab === 'cargos' ? (
              <JobRoleManager
                appearance="design-system"
                createOpen={jobRoleCreateOpen}
                onCreateOpenChange={(open) => {
                  setJobRoleCreateOpen(open);
                  if (!open) window.requestAnimationFrame(() => jobRoleCreateButtonRef.current?.focus());
                }}
                searchValue={gestorSearch}
                showCreateAction={false}
              />
            ) : equipeSubTab === 'dds' ? (
              <DdsThemeManager
                appearance="design-system"
                createOpen={ddsThemeCreateOpen}
                onCreateOpenChange={(open) => {
                  setDdsThemeCreateOpen(open);
                  if (!open) window.requestAnimationFrame(() => ddsThemeCreateButtonRef.current?.focus());
                }}
                searchValue={gestorSearch}
                showCreateAction={false}
              />
            ) : (
              renderColaboradoresSubTab()
            )}
          </div>
        </Card>
      </section>
    );
  }

  function renderColaboradoresSubTab() {
    const allCollaborators = collaboratorsQuery.data || [];
    const collaborators = allCollaborators
      .filter((collaborator) => (showInactiveCollaborators ? collaborator.isActive === false : collaborator.isActive !== false))
      .filter((collaborator) => matchesSearch(collaboratorSearchParts(collaborator), gestorSearch));
    const emptyCollaboratorsMessage = showInactiveCollaborators ? 'Nenhum colaborador inativo.' : 'Nenhum colaborador ativo.';
    const collaboratorSaving = collaboratorEditingId ? collaboratorMutations.updateCollaborator.isPending : collaboratorMutations.createCollaborator.isPending;

    function openCollaboratorEditor(collaborator: Collaborator) {
      if (showCollaboratorForm && collaboratorEditingId === collaborator.id) {
        resetCollaboratorForm();
        return;
      }
      setCollaboratorEditingId(collaborator.id);
      setShowCollaboratorForm(true);
      setCollaboratorForm(collaboratorToForm(collaborator));
    }

    function renderCollaboratorActions(collaborator: Collaborator) {
      const editing = showCollaboratorForm && collaboratorEditingId === collaborator.id;

      return (
        <>
          <Button
            variant="secondary"
            size="sm"
            type="button"
            iconLeft={<AppIcon icon={DS_ICONS.edit} size="sm" />}
            aria-expanded={editing}
            aria-controls={`rdo-team-collaborator-edit-${collaborator.id}`}
            onClick={() => openCollaboratorEditor(collaborator)}
          >
            Editar
          </Button>
          {collaborator.isActive !== false ? (
            <Button
              variant="danger"
              size="sm"
              type="button"
              iconLeft={<AppIcon icon={DS_ICONS.trash} size="sm" />}
              disabled={collaboratorMutations.removeCollaborator.isPending}
              loading={collaboratorMutations.removeCollaborator.isPending}
              onClick={() => void handleCollaboratorToggle(collaborator)}
            >
              Remover
            </Button>
          ) : null}
        </>
      );
    }

    const collaboratorColumns: readonly DataTableColumn<Collaborator>[] = [
      {
        key: 'collaborator',
        header: 'Colaborador',
        rowHeader: true,
        render: (collaborator) => (
          <div className="rdo-team-collaborator__identity" data-collaborator-name={collaborator.name}>
            <span className="rdo-team-collaborator__avatar" aria-hidden="true">
              {initials(collaborator.name)}
            </span>
            <span className="rdo-team-collaborator__identity-copy">
              <strong>{collaborator.name}</strong>
              <span>{collaborator.code || 'Código não informado'}</span>
            </span>
          </div>
        )
      },
      {
        key: 'role',
        header: 'Cargo',
        render: (collaborator) => <span className="rdo-team-collaborator__text">{collaborator.role || '—'}</span>
      },
      {
        key: 'email',
        header: 'E-mail',
        render: (collaborator) => <span className="rdo-team-collaborator__email">{collaborator.email || '—'}</span>
      },
      {
        key: 'status',
        header: 'Status',
        render: (collaborator) => <CollaboratorStatusPill isActive={collaborator.isActive} />
      }
    ];

    function renderCollaboratorForm(mode: 'create' | 'edit', collaborator?: Collaborator) {
      const editing = mode === 'edit' && collaborator;
      const idSuffix = editing ? `-${collaborator.id}` : '';
      const formId = editing ? `rdo-team-collaborator-edit-${collaborator.id}` : 'rdo-team-collaborator-create';

      return (
        <form id={formId} className={`rdo-admin-form rdo-team-collaborator-form${editing ? ' rdo-admin-form--nested' : ''}`} data-collaborator-form={mode} onSubmit={handleCollaboratorSubmit} autoComplete="off">
          <div className="rdo-admin-form__header">
            <h3>{editing ? `Editar ${collaborator.name}` : 'Novo colaborador'}</h3>
          </div>
          <div className="rdo-team-collaborator-form__grid">
            <Field label="Nome" id={`collaborator-name${idSuffix}`} required>
              <Input size="lg" value={collaboratorForm.name} autoComplete="off" autoFocus onChange={(event) => setCollaboratorForm((current) => ({ ...current, name: event.target.value }))} required />
            </Field>
            <Field label="Cargo" id={`collaborator-role${idSuffix}`} required>
              <Select
                size="lg"
                value={collaboratorForm.jobRoleId}
                onChange={(event) =>
                  setCollaboratorForm((current) => ({
                    ...current,
                    jobRoleId: event.target.value
                  }))
                }
                required
              >
                {renderRoleOptions(collaboratorForm.jobRoleId)}
              </Select>
            </Field>
            <Field label="E-mail" id={`collaborator-email${idSuffix}`}>
              <Input
                id={`collaborator-email${idSuffix}-control`}
                size="lg"
                type="email"
                value={collaboratorForm.email}
                autoComplete="off"
                placeholder="email@empresa.com"
                onChange={(event) => setCollaboratorForm((current) => ({ ...current, email: event.target.value }))}
              />
            </Field>
            <Field label="Status" id={`collaborator-active${idSuffix}`} optionalText={null}>
              <Select size="lg" value={String(collaboratorForm.isActive)} onChange={(event) => setCollaboratorForm((current) => ({ ...current, isActive: event.target.value === 'true' }))}>
                <option value="true">Ativo</option>
                <option value="false">Inativo</option>
              </Select>
            </Field>
            {renderCollaboratorSignatureField()}
            <div className="rdo-team-collaborator-form__actions">
              <Button variant="secondary" size="md" type="button" onClick={resetCollaboratorForm}>
                Cancelar
              </Button>
              <Button variant="primary" size="md" type="submit" disabled={collaboratorSaving} loading={collaboratorSaving}>
                Salvar
              </Button>
            </div>
          </div>
        </form>
      );
    }

    return (
      <div className="rdo-admin-listing rdo-team-collaborators rdo-ds-actions">
        <div className="rdo-team-surface-heading">
          <span className="rdo-team-surface-heading__icon" aria-hidden="true">
            <AppIcon icon={DS_ICONS.users} size="md" />
          </span>
          <div>
            <h2>Colaboradores</h2>
            <p>Gerencie os profissionais disponíveis para composição das equipes de projeto.</p>
          </div>
        </div>

        {showCollaboratorForm && !collaboratorEditingId ? renderCollaboratorForm('create') : null}

        <DataTable
          className="rdo-team-collaborators__table"
          rows={collaborators}
          columns={collaboratorColumns}
          getRowId={(collaborator) => collaborator.id}
          getRowClassName={(collaborator) => (collaborator.isActive === false ? 'rdo-team-collaborator__row rdo-team-collaborator__row--inactive' : 'rdo-team-collaborator__row')}
          ariaLabel="Colaboradores"
          density="compact"
          mobileBreakpoint="xl"
          actionsLabel="Ações"
          rowActions={renderCollaboratorActions}
          renderRowDetails={(collaborator) =>
            showCollaboratorForm && collaboratorEditingId === collaborator.id ? (
              <>
                {renderCollaboratorForm('edit', collaborator)}
                <CollaboratorJobRoleHistoryEditor
                  collaborator={collaborator}
                  jobRoles={jobRolesQuery.data || []}
                  isPending={collaboratorMutations.updateJobRoleHistory.isPending || collaboratorMutations.removeJobRoleHistory.isPending}
                  onUpdate={(historyId, payload) =>
                    collaboratorMutations.updateJobRoleHistory.mutateAsync({
                      id: collaborator.id,
                      historyId,
                      payload
                    })
                  }
                  onRemove={(historyId) =>
                    collaboratorMutations.removeJobRoleHistory.mutateAsync({
                      id: collaborator.id,
                      historyId
                    })
                  }
                />
              </>
            ) : null
          }
          loading={collaboratorsQuery.isLoading}
          loadingRows={6}
          error={collaboratorsQuery.isError ? 'Não foi possível carregar os colaboradores.' : undefined}
          onRetry={() => void collaboratorsQuery.refetch()}
          emptyState={<EmptyState variant={gestorSearch.trim() ? 'search' : 'default'} title={emptyCollaboratorsMessage} description={gestorSearch.trim() ? 'Revise a busca para localizar outro colaborador.' : undefined} />}
          auxiliary={
            !collaboratorsQuery.isLoading && !collaboratorsQuery.isError && collaborators.length ? (
              <p className="rdo-team-collaborators__count">
                {collaborators.length} {collaborators.length === 1 ? 'colaborador exibido' : 'colaboradores exibidos'}
              </p>
            ) : null
          }
          mobile={{
            ariaLabel: 'Colaboradores',
            renderItem: (collaborator) => ({
              title: (
                <span className="rdo-team-collaborator__mobile-title">
                  <span className="rdo-team-collaborator__avatar" aria-hidden="true">
                    {initials(collaborator.name)}
                  </span>
                  <span>{collaborator.name}</span>
                </span>
              ),
              subtitle: collaborator.role || 'Cargo não informado',
              metadata: [
                { label: 'Código', value: collaborator.code || '—' },
                { label: 'E-mail', value: collaborator.email || '—' }
              ],
              status: <CollaboratorStatusPill isActive={collaborator.isActive} />,
              actions: renderCollaboratorActions(collaborator)
            })
          }}
        />
      </div>
    );
  }

  function renderUsersToolbar() {
    const sourceUsers = userAdminGroup === 'internal' ? internalUsersQuery.data || [] : clientUsersQuery.data || [];
    const searchedUsers = sourceUsers.filter((item) => matchesSearch(userSearchParts(item), gestorSearch));
    const filteredUsers = searchedUsers.filter((item) => {
      const matchesRole = userAdminGroup === 'client' || userRoleFilter === 'all' || item.role === userRoleFilter;
      const matchesStatus = userStatusFilter === 'all' || (userStatusFilter === 'active' ? item.isActive : !item.isActive);
      return matchesRole && matchesStatus;
    });
    const activeFilters = [
      ...(userAdminGroup === 'internal' && userRoleFilter !== 'all'
        ? [
            {
              id: 'role',
              label: `Perfil: ${formatUserRole(userRoleFilter)}`,
              onRemove: () => setUserRoleFilter('all')
            }
          ]
        : []),
      ...(userStatusFilter !== 'all'
        ? [
            {
              id: 'status',
              label: `Status: ${userStatusFilter === 'active' ? 'Ativo' : 'Inativo'}`,
              onRemove: () => setUserStatusFilter('all')
            }
          ]
        : [])
    ];

    return (
      <FilterBar
        className="rdo-users__filters"
        label="Busca e filtros dos usuários"
        resultsId="rdo-manager-users-results"
        search={
          <SearchInput
            value={gestorSearch}
            onChange={setGestorSearch}
            label="Buscar em usuários"
            placeholder="Buscar por nome, usuário ou e-mail..."
            autoComplete="off"
            resultCount={{
              shown: filteredUsers.length,
              total: sourceUsers.length
            }}
          />
        }
        activeFilters={activeFilters}
        activeCount={activeFilters.length}
        onClear={
          activeFilters.length
            ? () => {
                setUserRoleFilter('all');
                setUserStatusFilter('all');
              }
            : undefined
        }
        clearLabel="Limpar filtros de usuários"
        mobileTitle="Filtrar usuários"
        mobileDescription="Refine por perfil, status e ordenação."
        mobileBreakpoint="xl"
      >
        {userAdminGroup === 'internal' ? (
          <label className="rdo-users-filter-control">
            <span>Perfil</span>
            <Select
              size="md"
              aria-label="Filtrar usuários por perfil"
              value={userRoleFilter}
              onChange={(event) => setUserRoleFilter(event.target.value as UserRoleFilter)}
              options={[
                { value: 'all', label: 'Todos' },
                ...internalRoles.map((role) => ({
                  value: role,
                  label: formatUserRole(role)
                }))
              ]}
            />
          </label>
        ) : null}
        <label className="rdo-users-filter-control">
          <span>Status</span>
          <Select
            size="md"
            aria-label="Filtrar usuários por status"
            value={userStatusFilter}
            onChange={(event) => setUserStatusFilter(event.target.value as UserStatusFilter)}
            options={[
              { value: 'all', label: 'Todos' },
              { value: 'active', label: 'Ativos' },
              { value: 'inactive', label: 'Inativos' }
            ]}
          />
        </label>
        <label className="rdo-users-filter-control rdo-users-filter-control--sort">
          <span className="fv-sr-only">Ordenação</span>
          <Select
            size="md"
            aria-label="Ordenar usuários"
            value={userSortMode}
            onChange={(event) => setUserSortMode(event.target.value as UserSortMode)}
            options={[
              { value: 'name-asc', label: 'Ordenar por: Nome (A–Z)' },
              { value: 'name-desc', label: 'Ordenar por: Nome (Z–A)' },
              { value: 'role-asc', label: 'Ordenar por: Perfil' }
            ]}
          />
        </label>
      </FilterBar>
    );
  }

  function renderUsuariosTab() {
    const sortUsers = (items: InternalUserSummary[]) =>
      [...items].sort((left, right) => {
        if (userSortMode === 'role-asc') {
          const roleComparison = formatUserRole(left.role).localeCompare(formatUserRole(right.role), 'pt-BR', { sensitivity: 'base' });
          if (roleComparison) return roleComparison;
        }

        const nameComparison = (left.name || left.username).localeCompare(right.name || right.username, 'pt-BR', { numeric: true, sensitivity: 'base' });
        return userSortMode === 'name-desc' ? -nameComparison : nameComparison;
      });
    const matchesUserStatus = (item: InternalUserSummary) => userStatusFilter === 'all' || (userStatusFilter === 'active' ? item.isActive : !item.isActive);
    const internalUsers = sortUsers((internalUsersQuery.data || []).filter((item) => matchesSearch(userSearchParts(item), gestorSearch) && (userRoleFilter === 'all' || item.role === userRoleFilter) && matchesUserStatus(item)));
    const clientUsers = sortUsers((clientUsersQuery.data || []).filter((item) => matchesSearch(userSearchParts(item), gestorSearch) && matchesUserStatus(item)));

    if (internalUsersQuery.isLoading || clientUsersQuery.isLoading) {
      return (
        <div className="rdo-admin-loading" role="status" aria-live="polite">
          <span className="fv-sr-only">Carregando usuários…</span>
          <Skeleton variant="card" decorative />
          <Skeleton variant="card" decorative />
        </div>
      );
    }
    if (internalUsersQuery.isError || clientUsersQuery.isError) {
      return (
        <Alert
          tone="danger"
          title="Não foi possível carregar os usuários"
          action={{
            label: 'Tentar novamente',
            onClick: () => {
              void internalUsersQuery.refetch();
              void clientUsersQuery.refetch();
            }
          }}
        >
          Os dados existentes não foram alterados. Tente carregar a listagem novamente.
        </Alert>
      );
    }
    const showInternal = userAdminGroup === 'internal';

    function openInternalUserEditor(item: InternalUserSummary) {
      if (showUserForm && userEditingId === item.id) {
        resetUserForm();
        return;
      }
      setUserEditingId(item.id);
      setShowUserForm(true);
      setUserForm(userToForm(item));
    }

    function renderInternalUserForm(mode: 'create' | 'edit', item?: InternalUserSummary) {
      const editing = mode === 'edit' && item;
      const idSuffix = editing ? `-${item.id}` : '';

      return (
        <form id={editing ? `rdo-user-edit-${item.id}` : 'rdo-user-create'} className={`rdo-admin-form rdo-user-form${editing ? ' rdo-admin-form--nested' : ''}`} data-user-form={mode} onSubmit={handleUserSubmit} autoComplete="off">
          <div className="rdo-admin-form__header">
            <h2>{editing ? `Editar ${item.name}` : 'Novo usuário'}</h2>
          </div>
          <div className="rdo-user-form__grid">
            <Field label="Usuário" id={`user-username${idSuffix}`} required>
              <Input
                size="lg"
                value={userForm.username}
                autoComplete="off"
                readOnly={Boolean(editing)}
                onChange={(event) =>
                  setUserForm((current) => ({
                    ...current,
                    username: event.target.value
                  }))
                }
                required
              />
            </Field>
            <Field label="Nome" id={`user-name${idSuffix}`} required>
              <Input
                size="lg"
                value={userForm.name}
                autoComplete="off"
                autoFocus
                onChange={(event) =>
                  setUserForm((current) => ({
                    ...current,
                    name: event.target.value
                  }))
                }
                required
              />
            </Field>
            <Field label="E-mail" id={`user-email${idSuffix}`}>
              <Input
                id={`user-email${idSuffix}-control`}
                size="lg"
                type="email"
                value={userForm.email}
                autoComplete="off"
                placeholder="email@empresa.com"
                onChange={(event) =>
                  setUserForm((current) => ({
                    ...current,
                    email: event.target.value
                  }))
                }
              />
            </Field>
            <Field label="Perfil" id={`user-role${idSuffix}`} required>
              <Select
                size="lg"
                value={userForm.role}
                onChange={(event) =>
                  setUserForm((current) => ({
                    ...current,
                    role: event.target.value as Exclude<UserRole, 'CLIENT'>
                  }))
                }
                required
              >
                {internalRoles.map((role) => (
                  <option key={role} value={role}>
                    {formatUserRole(role)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Status" id={`user-active${idSuffix}`}>
              <Select
                size="lg"
                value={String(userForm.isActive)}
                onChange={(event) =>
                  setUserForm((current) => ({
                    ...current,
                    isActive: event.target.value === 'true'
                  }))
                }
              >
                <option value="true">Ativo</option>
                <option value="false">Inativo</option>
              </Select>
            </Field>
            <Field label="Vincular colaborador" id={`user-collaborator${idSuffix}`}>
              <Select
                size="lg"
                value={userForm.collaboratorId}
                onChange={(event) =>
                  setUserForm((current) => ({
                    ...current,
                    collaboratorId: event.target.value
                  }))
                }
              >
                <option value="">Sem vínculo</option>
                {(collaboratorsQuery.data || [])
                  .filter((collaborator) => collaborator.isActive)
                  .map((collaborator) => (
                    <option key={collaborator.id} value={collaborator.id}>
                      {collaborator.name}
                    </option>
                  ))}
              </Select>
            </Field>
            {editing ? <Field
              label="Nova senha"
              helperText={editing ? 'Deixe em branco para manter a senha atual.' : undefined}
              id={`user-password${idSuffix}`}
              required={!editing}
            >
              <Input
                size="lg"
                type="password"
                value={userForm.password}
                autoComplete="new-password"
                onChange={(event) =>
                  setUserForm((current) => ({
                    ...current,
                    password: event.target.value
                  }))
                }
                required={!editing}
              />
            </Field> : <p className="form-hint">
              A senha será criada pelo próprio usuário por um link único. Com e-mail, o link será enviado automaticamente.
            </p>}
            <div className="rdo-user-form__actions">
              <Button variant="secondary" size="md" type="button" onClick={resetUserForm}>
                Cancelar
              </Button>
              <Button variant="primary" size="md" type="submit" loading={editing ? userMutations.updateUser.isPending : userMutations.createUser.isPending}>
                Salvar usuário
              </Button>
            </div>
          </div>
        </form>
      );
    }

    function renderInternalUserActions(item: InternalUserSummary) {
      const editing = showUserForm && userEditingId === item.id;

      return (
        <>
          <Button variant="secondary" size="sm" type="button" iconLeft={<AppIcon icon={DS_ICONS.edit} size="sm" />} aria-expanded={editing} aria-controls={`rdo-user-edit-${item.id}`} onClick={() => openInternalUserEditor(item)}>
            Editar
          </Button>
          <IconButton variant="danger" size="sm" type="button" icon={DS_ICONS.trash} label={`Remover ${item.name}`} onClick={() => void handleUserDelete(item.id)} />
        </>
      );
    }

    const internalUserColumns: DataTableColumn<InternalUserSummary>[] = [
      {
        key: 'user',
        header: 'Usuário',
        rowHeader: true,
        render: (item) => (
          <span className="rdo-user-identity">
            <span className="rdo-user-avatar" aria-hidden="true">
              {initials(item.name)}
            </span>
            <span className="rdo-user-identity__copy">
              <strong>{item.name}</strong>
              <span>{item.username}</span>
            </span>
          </span>
        )
      },
      {
        key: 'email',
        header: 'E-mail',
        render: (item) => <span className="rdo-user-email">{item.email || 'Não informado'}</span>
      },
      {
        key: 'role',
        header: 'Perfil',
        render: (item) => <Badge tone={userRoleTone(item.role)}>{formatUserRole(item.role)}</Badge>
      },
      {
        key: 'status',
        header: 'Status',
        render: (item) => <StatusPill status={item.isActive ? 'active' : 'inactive'} label={item.isActive ? 'Ativo' : 'Inativo'} tone={item.isActive ? 'success' : 'neutral'} />
      },
      {
        key: 'link',
        header: 'Vínculo',
        render: (item) => <span className="rdo-user-link">{item.collaborator?.name || 'Sem colaborador vinculado'}</span>
      }
    ];

    return (
      <section className="rdo-admin-section rdo-users" id="rdo-manager-users-results" aria-label="Administração de usuários">
        <Card className="rdo-users-workspace" padding="md">
          <div className="rdo-admin-tabs" role="tablist" aria-label="Tipo de usuário" onKeyDown={handleHorizontalTabListKeyDown}>
            <button
              id="rdo-users-tab-internal"
              className={`rdo-admin-tab ${showInternal ? 'is-active' : ''}`}
              type="button"
              role="tab"
              aria-selected={showInternal}
              aria-controls="rdo-users-panel"
              onClick={() => {
                setUserAdminGroup('internal');
                resetUserForm();
              }}
            >
              Internos
            </button>
            <button
              id="rdo-users-tab-client"
              className={`rdo-admin-tab ${!showInternal ? 'is-active' : ''}`}
              type="button"
              role="tab"
              aria-selected={!showInternal}
              aria-controls="rdo-users-panel"
              onClick={() => {
                setUserAdminGroup('client');
                setUserRoleFilter('all');
                resetUserForm();
              }}
            >
              Clientes
            </button>
          </div>

          <div className="rdo-admin-section__content" id="rdo-users-panel" role="tabpanel" aria-labelledby={showInternal ? 'rdo-users-tab-internal' : 'rdo-users-tab-client'}>
            {showInternal ? (
              <>
                {showUserForm && !userEditingId ? renderInternalUserForm('create') : null}

          {manualPasswordSetup ? (
            <Card>
              <div className="section-title">Link para criar a senha</div>
              <p className="placeholder-copy">
                Usuário: <strong>{manualPasswordSetup.username}</strong>. O link é de uso único e expira em 7 dias.
              </p>
              <div className="field-group">
                <label htmlFor="gestor-password-setup-link">Link para compartilhar</label>
                <Input id="gestor-password-setup-link" value={manualPasswordSetup.url} readOnly onFocus={event => event.currentTarget.select()} />
              </div>
              <div className="admin-actions">
                <Button variant="primary" type="button" onClick={() => void copyManualPasswordSetup()}>
                  Copiar link
                </Button>
              </div>
            </Card>
          ) : null}
                <DataTable
                  className="rdo-users__table"
                  rows={internalUsers}
                  columns={internalUserColumns}
                  getRowId={(item) => item.id}
                  ariaLabel="Usuários internos"
                  density="compact"
                  mobileBreakpoint="xl"
                  actionsLabel="Ações"
                  rowActions={renderInternalUserActions}
                  renderRowDetails={(item) => (showUserForm && userEditingId === item.id ? renderInternalUserForm('edit', item) : null)}
                  toolbar={
                    <div className="rdo-users__table-summary">
                      <strong>
                        {internalUsers.length} {internalUsers.length === 1 ? 'usuário interno' : 'usuários internos'}
                      </strong>
                      <span>Contas da operação com acesso ao RDO</span>
                    </div>
                  }
                  emptyState={<EmptyState title="Nenhum usuário interno encontrado." description="Revise a busca ou os filtros aplicados." />}
                  mobile={{
                    ariaLabel: 'Usuários internos',
                    renderItem: (item) => ({
                      title: (
                        <span className="rdo-user-identity rdo-user-identity--mobile">
                          <span className="rdo-user-avatar" aria-hidden="true">
                            {initials(item.name)}
                          </span>
                          <span className="rdo-user-identity__copy">
                            <strong>{item.name}</strong>
                            <span>{item.email || item.username}</span>
                          </span>
                        </span>
                      ),
                      metadata: [
                        { label: 'Perfil', value: formatUserRole(item.role) },
                        {
                          label: 'Vínculo',
                          value: item.collaborator?.name || 'Sem vínculo'
                        }
                      ],
                      status: <StatusPill status={item.isActive ? 'active' : 'inactive'} label={item.isActive ? 'Ativo' : 'Inativo'} tone={item.isActive ? 'success' : 'neutral'} />,
                      actions: renderInternalUserActions(item)
                    })
                  }}
                />
              </>
            ) : (
              <section className="client-accounts-panel rdo-client-accounts">
                <div className="rdo-admin-section-heading">
                  <div>
                    <h2>Clientes</h2>
                    <p>Contas criadas automaticamente a partir dos projetos.</p>
                  </div>
                </div>
                {(() => {
                  // Group by CNPJ
                  const groups: Record<string, { cnpj: string; clientName: string; primary: (typeof clientUsers)[0] | null; cc: typeof clientUsers }> = {};
                  const noGroup: typeof clientUsers = [];

                  const clientNameForCnpj = (cnpj: string) => {
                    const project = clientGroupingProjects.find((item) => item.clientCnpj.replace(/\D/g, '') === cnpj);
                    if (!project) return '';
                    return project.clientName || '';
                  };

                  clientUsers.forEach((item) => {
                    const rawUsername = String(item.username || '');
                    const isPrimaryByCnpj = /^\d{14}$/.test(rawUsername.replace(/\D/g, '')) && rawUsername.replace(/\D/g, '').length === 14;
                    let cnpj = item.clientCnpj ? item.clientCnpj.replace(/\D/g, '') : isPrimaryByCnpj ? rawUsername.replace(/\D/g, '') : null;
                    if (!cnpj) {
                      const email = String(item.email || item.username || '')
                        .trim()
                        .toLowerCase();
                      const linkedCnpj = (item.linkedProjects || []).find((project) => project.clientCnpj)?.clientCnpj;
                      const emailProject = clientGroupingProjects.find((project) => (project.clientEmailCc || []).some((cc) => cc.trim().toLowerCase() === email));
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

                  const renderClientCard = (item: (typeof clientUsers)[0], isCc: boolean) => {
                    return (
                      <Card className="rdo-client-account-card" padding="sm" key={item.id}>
                        <div className="admin-avatar" aria-hidden="true">
                          {initials(item.name || 'Cliente')}
                        </div>
                        <div className="admin-item-main">
                          <div className="admin-item-title">{item.name || 'Cliente'}</div>
                          <div className="admin-item-sub client-account-email">{item.email || item.username}</div>
                        </div>
                        <div className="client-account-action-area">
                          <div className="client-account-badges">
                            {isCc ? <Badge tone="info">CC / Assinante</Badge> : null}
                            <StatusPill status={item.isActive ? 'active' : 'inactive'} label={item.isActive ? 'Ativo' : 'Inativo'} tone={item.isActive ? 'success' : 'neutral'} />
                          </div>
                          <div className="client-account-button-row">
                            <Button variant="secondary" size="sm" type="button" disabled={userMutations.resendClientAccess.isPending} onClick={() => void handleResendClientAccess(item.id)}>
                              Reenviar acesso
                            </Button>
                            <Button variant="danger" size="sm" type="button" onClick={() => void handleUserDelete(item.id)}>
                              Remover
                            </Button>
                          </div>
                        </div>
                      </Card>
                    );
                  };

                  if (!clientUsers.length)
                    return (
                      <Card padding="lg">
                        <EmptyState title="Nenhum cliente provisionado." />
                      </Card>
                    );

                  return (
                    <div className="rdo-admin-card-list">
                      {Object.values(groups).map((g) => {
                        const closed = closedClientAccountGroupIds.includes(g.cnpj);
                        const linkedProjects = sortProjects(
                          clientGroupingProjects.filter((project) => project.clientCnpj.replace(/\D/g, '') === g.cnpj),
                          'asc'
                        );
                        const title = g.clientName || clientNameForCnpj(g.cnpj) || g.cnpj;
                        const missionSummary = Array.from(new Set(linkedProjects.map((project) => [project.code, project.name].filter(Boolean).join(' - ') || project.name).filter(Boolean))).join(', ');
                        const groupPanelId = `client-account-group-${g.cnpj}`;
                        return (
                          <Card className="rdo-client-account-group" padding="md" key={g.cnpj}>
                            <button className="client-account-group-toggle" type="button" aria-expanded={!closed} aria-controls={groupPanelId} onClick={() => toggleClientAccountGroup(g.cnpj)}>
                              <span>{title}</span>
                              <AppIcon className="rtype-chevron" icon={DS_ICONS.chevronDown} size="sm" />
                            </button>
                            <div className="client-account-group-meta">
                              <span>{formatCnpj(g.cnpj)}</span>
                              {missionSummary ? <span>Missões: {missionSummary}</span> : null}
                            </div>
                            {!closed ? (
                              <div className="rdo-client-account-group__accounts" id={groupPanelId}>
                                {g.primary ? renderClientCard(g.primary, false) : null}
                                {g.cc.map((u) => renderClientCard(u, true))}
                              </div>
                            ) : null}
                          </Card>
                        );
                      })}
                      {noGroup.length ? (
                        <Card className="rdo-client-account-group" padding="md" title="Sem CNPJ associado">
                          {noGroup.map((u) => renderClientCard(u, true))}
                        </Card>
                      ) : null}
                    </div>
                  );
                })()}
              </section>
            )}
          </div>
        </Card>
      </section>
    );
  }

  function renderNpsTab() {
    const surveys = (surveysQuery.data || []).filter((survey) => {
      const status = surveyStatusLabel(survey).label.toLowerCase();
      const parts = [survey.project?.code, survey.project?.name, survey.project?.clientName, survey.emailTo, status];
      return matchesSearch(parts, gestorSearch);
    });
    const surveyGroups = Array.from(
      surveys
        .reduce((groups, survey) => {
          const key = npsProjectKey(survey);
          const current = groups.get(key);
          if (current) {
            current.surveys.push(survey);
          } else {
            groups.set(key, { key, title: npsProjectTitle(survey), clientName: survey.project?.clientName || '-', surveys: [survey] });
          }
          return groups;
        }, new Map<string, { key: string; title: string; clientName: string; surveys: typeof surveys }>())
        .values()
    )
      .map((group) => ({
        ...group,
        surveys: group.surveys.sort((a, b) => new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime())
      }))
      .sort((a, b) => {
        const titleA = a.title;
        const titleB = b.title;
        return npsSortDir === 'asc' ? titleA.localeCompare(titleB, 'pt-BR', { numeric: true, sensitivity: 'base' }) : titleB.localeCompare(titleA, 'pt-BR', { numeric: true, sensitivity: 'base' });
      });
    const allSurveys = surveysQuery.data || [];
    const respondedSurveyCount = allSurveys.filter((survey) => survey.respondedAt).length;
    const expiredSurveyCount = allSurveys.filter((survey) => !survey.respondedAt && surveyIsExpired(survey)).length;
    const pendingSurveyCount = allSurveys.length - respondedSurveyCount - expiredSurveyCount;
    const surveyedProjectCount = new Set(allSurveys.map(npsProjectKey)).size;

    return (
      <section className="fv-ds rdo-nps rdo-ds-actions" aria-label="NPS">
        {npsDashboardOpen && <SurveyDashboardOverlay appearance="design-system" onClose={() => setNpsDashboardOpen(false)} />}
        <PageHeader
          className="rdo-nps__page-header"
          title="NPS"
          description="Pesquisas pendentes, respondidas e expiradas."
          actions={
            <div className="rdo-nps__toolbar">
              <Button variant="secondary" iconLeft={<AppIcon icon={DS_ICONS.settings} size="sm" />} aria-label="Editar pesquisa NPS" onClick={openSurveyQuestionEditor}>
                <span className="rdo-action-label rdo-action-label--full">Editar pesquisa</span>
                <span className="rdo-action-label rdo-action-label--compact">Editar</span>
              </Button>
              <Button variant="primary" iconLeft={<AppIcon icon={DS_ICONS.fileText} size="sm" />} aria-label="Abrir dashboard NPS" onClick={() => setNpsDashboardOpen(true)}>
                <span className="rdo-action-label rdo-action-label--full">Dashboard NPS</span>
                <span className="rdo-action-label rdo-action-label--compact">Dashboard</span>
              </Button>
            </div>
          }
        />

        <FilterBar
          className="rdo-nps__filters"
          label="Busca e ordenação das pesquisas NPS"
          resultsId="rdo-nps-results"
          search={<SearchInput value={gestorSearch} onChange={setGestorSearch} label="Buscar em pesquisas NPS" placeholder="Buscar em pesquisas NPS" autoComplete="off" />}
          actions={
            <Button
              variant="secondary"
              iconLeft={<AppIcon icon={DS_ICONS.sort} size="sm" />}
              aria-label={npsSortDir === 'asc' ? 'Ordenar projetos de Z a A' : 'Ordenar projetos de A a Z'}
              onClick={() => setNpsSortDir((direction) => (direction === 'asc' ? 'desc' : 'asc'))}
            >
              <span className="rdo-sort-label rdo-sort-label--full">Ordenar por: {npsSortDir === 'asc' ? 'A–Z' : 'Z–A'}</span>
              <span className="rdo-sort-label rdo-sort-label--compact">{npsSortDir === 'asc' ? 'A–Z' : 'Z–A'}</span>
            </Button>
          }
        />

        {!surveysQuery.isLoading && !gestorBootstrapQuery.isError ? (
          <section className="rdo-manager-metrics rdo-nps__metrics" aria-label="Resumo das pesquisas NPS">
            <MetricCard label="Respondidas" value={respondedSurveyCount} description="Com retorno do cliente" tone="success" icon={<AppIcon icon={DS_ICONS.alertSuccess} size="md" />} />
            <MetricCard label="Pendentes" value={pendingSurveyCount} description="Aguardando resposta" tone="warning" icon={<AppIcon icon={DS_ICONS.alertWarning} size="md" />} />
            <MetricCard label="Expiradas" value={expiredSurveyCount} description="Sem resposta no prazo" tone="danger" icon={<AppIcon icon={DS_ICONS.alertDanger} size="md" />} />
            <MetricCard label="Projetos avaliados" value={surveyedProjectCount} description="Com pesquisa enviada" tone="info" icon={<AppIcon icon={DS_ICONS.fileText} size="md" />} />
          </section>
        ) : null}

        <div className="rdo-nps__results" id="rdo-nps-results">
          {surveysQuery.isLoading ? (
            <Skeleton className="rdo-nps__loading" variant="table-rows" lines={6} label="Carregando pesquisas..." />
          ) : gestorBootstrapQuery.isError ? (
            <Alert tone="danger" title="Não foi possível carregar as pesquisas.">
              Tente novamente em instantes.
            </Alert>
          ) : surveyGroups.length ? (
            <div className="rdo-nps__groups">
              {surveyGroups.map((group) => {
                return (
                  <Card key={group.key} className="rdo-nps__group" data-nps-group={group.key} variant="flat" padding="md">
                    <div className="rdo-nps__group-header">
                      <span className="rdo-nps__group-icon" aria-hidden="true">
                        <AppIcon icon={DS_ICONS.fileText} size="md" />
                      </span>
                      <div className="rdo-nps__group-copy">
                        <h3 className="rdo-nps__group-title">{group.title}</h3>
                        <p className="rdo-nps__group-meta">
                          <span>{group.clientName}</span>
                          <span>
                            {group.surveys.length} pesquisa{group.surveys.length !== 1 ? 's' : ''}
                          </span>
                        </p>
                      </div>
                    </div>
                    <div className="rdo-nps__surveys">
                      {group.surveys.map((survey, index) => {
                        const status = surveyStatusLabel(survey);
                        const open = openSurveyId === survey.id;
                        const canResendSurvey = !survey.respondedAt && survey.project?.isActive === false;
                        const surveyLabel = `Pesquisa #${group.surveys.length - index}`;
                        const panelId = `rdo-nps-panel-${survey.id}`;
                        return (
                          <div className="rdo-nps__survey" data-nps-survey={survey.id} key={survey.id}>
                            <button
                              className="rdo-nps__toggle"
                              type="button"
                              aria-expanded={open}
                              aria-controls={panelId}
                              aria-label={`${surveyLabel} — ${group.title}`}
                              onClick={() => setOpenSurveyId((current) => (current === survey.id ? null : survey.id))}
                            >
                              <AppIcon className="rdo-nps__chevron" icon={open ? DS_ICONS.chevronDown : DS_ICONS.next} size="sm" />
                              <span>{surveyLabel}</span>
                            </button>
                            <div className="rdo-nps__survey-meta">
                              <span>Enviada: {formatDate(survey.sentAt)}</span>
                              <span>Respondida: {survey.respondedAt ? formatDate(survey.respondedAt) : '-'}</span>
                              <span>Expira: {formatDate(survey.expiresAt)}</span>
                              <StatusPill status={status.label} label={status.label} tone={npsStatusTone(status.className)} />
                              {canResendSurvey ? (
                                <Button size="sm" variant="secondary" disabled={surveyMutations.resendSurvey.isPending} loading={surveyMutations.resendSurvey.isPending} onClick={() => void handleResendSurvey(survey)}>
                                  Reenviar pesquisa
                                </Button>
                              ) : null}
                            </div>
                            <div id={panelId} hidden={!open}>
                              {open ? (
                                survey.respondedAt ? (
                                  <dl className="rdo-nps__responses">
                                    {npsResponseRows(survey.responses, survey.questions || []).map(([question, answer]) => (
                                      <div className="rdo-nps__response" key={question}>
                                        <dt>{question}</dt>
                                        <dd>{answer}</dd>
                                      </div>
                                    ))}
                                  </dl>
                                ) : (
                                  <p className="rdo-nps__empty-response">{surveyIsExpired(survey) ? 'Pesquisa expirada sem resposta do cliente.' : 'Pesquisa enviada, aguardando resposta do cliente.'}</p>
                                )
                              ) : null}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </Card>
                );
              })}
            </div>
          ) : (
            <EmptyState title={gestorSearch.trim() ? 'Nenhuma pesquisa encontrada.' : 'Nenhuma pesquisa NPS disponível.'} />
          )}
        </div>
      </section>
    );
  }

  function renderGestorSearch() {
    const labels: Partial<Record<GestorTab, string>> = {
      pendentes: 'Buscar em pendentes',
      aprovados: 'Buscar em aprovados',
      projetos: 'Buscar em projetos',
      arquivados: 'Buscar em arquivados',
      equipe: 'Buscar na equipe',
      usuarios: 'Buscar em usuários',
      nps: 'Buscar em pesquisas NPS'
    };
    const placeholders: Partial<Record<GestorTab, string>> = {
      projetos: 'Buscar por código ou nome do projeto...',
      arquivados: 'Buscar em projetos e relatórios arquivados...'
    };
    const label = labels[tab];
    if (!label) return null;
    if (npsTab) return null;

    if (reportListingTab || projectsTab || archivedProjectsTab || adminTab) {
      const reportResultsId = projectsTab
        ? !activeProjectsQuery.isLoading && !activeProjectsQuery.isError
          ? 'rdo-manager-project-results'
          : undefined
        : archivedProjectsTab
          ? !reportListQuery.isLoadingInitial && !archivedProjectsQuery.isLoading
            ? 'rdo-manager-archived-results'
            : undefined
          : teamTab
            ? !collaboratorsQuery.isLoading
              ? 'rdo-manager-team-results'
              : undefined
            : usersTab
              ? !internalUsersQuery.isLoading && !clientUsersQuery.isLoading
                ? 'rdo-manager-users-results'
                : undefined
              : !reportListQuery.isLoadingInitial && (tab === 'pendentes' ? pendingReports.length : approvedReports.length) > 0
                ? 'rdo-manager-report-results'
                : undefined;

      return (
        <FilterBar
          className={projectsTab ? 'rdo-manager-projects__filters' : archivedProjectsTab ? 'rdo-archived-projects__filters' : adminTab ? 'rdo-admin-page__filters' : 'rdo-manager-listing__filters'}
          label={
            projectsTab
              ? 'Busca dos projetos ativos'
              : archivedProjectsTab
                ? 'Busca dos projetos arquivados'
                : teamTab
                  ? 'Busca na equipe'
                  : usersTab
                    ? 'Busca dos usuários'
                    : tab === 'pendentes'
                      ? 'Busca dos relatórios pendentes'
                      : 'Busca dos relatórios aprovados'
          }
          resultsId={reportResultsId}
          search={<SearchInput value={gestorSearch} onChange={setGestorSearch} label={label} placeholder={placeholders[tab] || label} autoComplete="off" />}
          actions={
            reportListingTab || projectsTab || archivedProjectsTab ? (
              <Button
                className="project-sort-button"
                variant="secondary"
                iconLeft={<AppIcon icon={DS_ICONS.sort} size="sm" />}
                aria-label={projectSortDir === 'asc' ? 'Ordenar projetos de Z a A' : 'Ordenar projetos de A a Z'}
                onClick={() => setProjectSortDir((direction) => (direction === 'asc' ? 'desc' : 'asc'))}
              >
                <span className="rdo-sort-label rdo-sort-label--full">Ordenar por: {projectSortDir === 'asc' ? 'A–Z' : 'Z–A'}</span>
                <span className="rdo-sort-label rdo-sort-label--compact">{projectSortDir === 'asc' ? 'A–Z' : 'Z–A'}</span>
              </Button>
            ) : undefined
          }
        />
      );
    }

    return null;
  }

  function renderEstatisticasTab() {
    return (
      <>
        <PageHeader
          className="rdo-manager-stats-page__header"
          title="Estatísticas"
          description="Visão geral dos projetos e relatórios aprovados ou assinados."
          actions={
            <>
              <Button variant="secondary" iconLeft={<AppIcon icon={DS_ICONS.fileText} size="sm" />} aria-label="Abrir alocação mensal" onClick={() => setAllocationDashboardOpen(true)}>
                <span className="rdo-action-label rdo-action-label--full">Alocação mensal</span>
                <span className="rdo-action-label rdo-action-label--compact">Alocação</span>
              </Button>
              <Button variant="primary" iconLeft={<AppIcon icon={DS_ICONS.fileText} size="sm" />} aria-label="Abrir dashboard detalhado" onClick={() => setStatsDashboardOpen(true)}>
                <span className="rdo-action-label rdo-action-label--full">Dashboard detalhado</span>
                <span className="rdo-action-label rdo-action-label--compact">Dashboard</span>
              </Button>
            </>
          }
        />
        <StatsOverview appearance="design-system" />
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
      <section className={`rdo-manager-metrics${tab === 'aprovados' ? ' rdo-manager-metrics--approved' : ''}`} aria-label={`Resumo de ${tab === 'pendentes' ? 'relatórios pendentes' : 'relatórios aprovados'}`}>
        {tab === 'pendentes' ? (
          <MetricCard label="Aguardando revisão" value={pendingCount} description="Pendentes ou devolvidos" tone="warning" icon={<AppIcon icon={DS_ICONS.alertWarning} size="md" />} />
        ) : (
          <MetricCard label="Total disponível" value={approvedTotal} description="Aprovados e assinados" tone="brand" icon={<AppIcon icon={DS_ICONS.fileText} size="md" />} />
        )}
        <MetricCard label="Aprovados" value={approvedCount} description="Prontos para consulta" tone="success" icon={<AppIcon icon={DS_ICONS.alertSuccess} size="md" />} />
        {tab === 'aprovados' ? <MetricCard label="Assinados" value={signedCount} description="Com assinatura concluída" tone="info" icon={<AppIcon icon={DS_ICONS.fileText} size="md" />} /> : null}
      </section>
    );
  }

  function renderProjectMetrics() {
    if (projectsTab) {
      if (activeProjectsQuery.isLoading || activeProjectsQuery.isError) {
        return null;
      }
      const activeProjects = (activeProjectsQuery.data || []).filter((project) => project.isActive !== false);
      const projectGroups = partitionProjectsByRegistration(activeProjects);

      return (
        <section className="rdo-manager-metrics" aria-label="Resumo dos projetos ativos">
          <MetricCard label="Projetos ativos" value={projectGroups.ready.length} description="Disponíveis para gestão" tone="success" icon={<AppIcon icon={DS_ICONS.fileText} size="md" />} />
          <MetricCard label="Aguardando revisão" value={projectGroups.pending.length} description="Cadastros a verificar" tone="warning" icon={<AppIcon icon={DS_ICONS.alertWarning} size="md" />} />
        </section>
      );
    }

    if (archivedProjectsTab) {
      if (archivedProjectsQuery.isLoading || reportListQuery.isLoadingInitial || reportListQuery.isError) {
        return null;
      }
      const archivedProjects = (archivedProjectsQuery.data || []).filter((project) => project.isActive === false);
      const archivedProjectCount = archivedProjects.length;
      const archivedReportCount = reportListQuery.pagination?.total ?? archivedReports.length;

      return (
        <section className="rdo-manager-metrics" aria-label="Resumo dos projetos arquivados">
          <MetricCard label="Projetos arquivados" value={archivedProjectCount} description="Fora da operação ativa" tone="neutral" icon={<AppIcon icon={DS_ICONS.archive} size="md" />} />
          <MetricCard label="Relatórios arquivados" value={archivedReportCount} description="Vinculados aos projetos arquivados" tone="info" icon={<AppIcon icon={DS_ICONS.fileText} size="md" />} />
        </section>
      );
    }

    return null;
  }

  function renderAdminMetrics() {
    if (teamTab) {
      if (collaboratorsQuery.isLoading || jobRolesQuery.isLoading || ddsThemesQuery.isLoading) return null;
      const collaborators = collaboratorsQuery.data || [];
      const activeCount = collaborators.filter((collaborator) => collaborator.isActive !== false).length;
      const inactiveCollaboratorCount = collaborators.length - activeCount;
      const jobRoles = jobRolesQuery.data || [];
      const inactiveJobRoleCount = jobRoles.filter((role) => !role.isActive).length;
      const ddsThemes = ddsThemesQuery.data || [];
      const inactiveDdsThemeCount = ddsThemes.filter((theme) => !theme.isActive).length;
      const inactiveRegistrationCount = inactiveCollaboratorCount + inactiveJobRoleCount + inactiveDdsThemeCount;

      return (
        <section className="rdo-manager-metrics" aria-label="Resumo da equipe">
          <MetricCard label="Colaboradores ativos" value={activeCount} description="Disponíveis para alocação" tone="success" icon={<AppIcon icon={DS_ICONS.users} size="md" />} />
          <MetricCard label="Cargos cadastrados" value={jobRoles.length} description={`${jobRoles.length - inactiveJobRoleCount} ativos`} tone="brand" icon={<AppIcon icon={DS_ICONS.settings} size="md" />} />
          <MetricCard label="Temas de DDS" value={ddsThemes.length} description={`${ddsThemes.length - inactiveDdsThemeCount} ativos`} tone="info" icon={<AppIcon icon={DS_ICONS.fileText} size="md" />} />
          <MetricCard
            label="Cadastros inativos"
            value={inactiveRegistrationCount}
            description={`${inactiveCollaboratorCount} colaboradores · ${inactiveJobRoleCount} cargos · ${inactiveDdsThemeCount} temas`}
            tone={inactiveRegistrationCount ? 'warning' : 'neutral'}
            icon={<AppIcon icon={DS_ICONS.alertWarning} size="md" />}
          />
        </section>
      );
    }

    if (usersTab) {
      if (internalUsersQuery.isLoading || clientUsersQuery.isLoading) {
        return null;
      }
      const internalUsers = internalUsersQuery.data || [];
      const clientUsers = clientUsersQuery.data || [];
      const activeCount = [...internalUsers, ...clientUsers].filter((account) => account.isActive).length;
      const managerCount = internalUsers.filter((account) => account.role === 'MANAGER').length;
      const inactiveCount = internalUsers.length + clientUsers.length - activeCount;

      return (
        <section className="rdo-manager-metrics" aria-label="Resumo dos usuários">
          <MetricCard label="Usuários ativos" value={activeCount} description={`${internalUsers.length} internos · ${clientUsers.length} clientes`} tone="success" icon={<AppIcon icon={DS_ICONS.users} size="md" />} />
          <MetricCard label="Gestores" value={managerCount} description="Contas com perfil de gestor" tone="brand" icon={<AppIcon icon={DS_ICONS.settings} size="md" />} />
          <MetricCard label="Clientes" value={clientUsers.length} description="Contas provisionadas" tone="info" icon={<AppIcon icon={DS_ICONS.fileText} size="md" />} />
          <MetricCard label="Contas inativas" value={inactiveCount} description="Acessos atualmente desativados" tone={inactiveCount ? 'warning' : 'neutral'} icon={<AppIcon icon={DS_ICONS.alertWarning} size="md" />} />
        </section>
      );
    }

    return null;
  }

  return (
    <AppShell
      navigation={managerNavigation}
      title="RDO"
      breadcrumb={[{ label: 'Filtrovali', href: '/modulos' }, { label: 'RDO', href: '/rdo/gestor' }, { label: rdoManagerSectionLabel(tab) }]}
      contentWidth="fluid"
      profile={
        user
          ? {
              name: user.name,
              description: user.email || user.username,
              initials: managerInitials,
              onOpen: () =>
                navigate('/conta', {
                  state: accountPageStateFromPath(location)
                })
            }
          : undefined
      }
      onLogout={handleLogout}
    >
      <RdoSectionNavigation
        current={tab}
        onNavigate={(section) =>
          navigate(rdoManagerSectionHref(section, searchParams.toString()), {
            state: location.state
          })
        }
      />

      {statisticsTab && statsDashboardOpen ? <StatsDashboardOverlay appearance="design-system" onClose={() => setStatsDashboardOpen(false)} /> : null}
      {statisticsTab && allocationDashboardOpen ? <MonthlyAllocationDashboardOverlay appearance="design-system" onClose={() => setAllocationDashboardOpen(false)} /> : null}

      <main
        className={
          reportListingTab || projectsTab || archivedProjectsTab || adminTab || npsTab || statisticsTab
            ? `fv-ds page-scroll ${
                reportListingTab
                  ? 'rdo-manager-page'
                  : projectsTab
                    ? 'rdo-manager-projects-page'
                    : archivedProjectsTab
                      ? 'rdo-manager-archived-page'
                      : adminTab
                        ? 'rdo-manager-admin-page'
                        : npsTab
                          ? 'rdo-manager-nps-page'
                          : 'rdo-manager-stats-page'
              }`
            : 'page-scroll'
        }
      >
        {teamTab ? (
          <PageHeader
            className="rdo-admin-page__header rdo-team-page__header"
            title="Equipe"
            description="Gerencie colaboradores, cargos e temas de DDS do seu time."
            actions={
              <>
                {renderGestorSearch()}
                {equipeSubTab === 'colaboradores' ? (
                  !showCollaboratorForm && !collaboratorEditingId ? (
                    <CollaboratorListToolbarActions
                      showInactive={showInactiveCollaborators}
                      inactiveCount={(collaboratorsQuery.data || []).filter((collaborator) => collaborator.isActive === false).length}
                      onNew={openNewCollaboratorForm}
                      onToggleInactive={() => {
                        resetCollaboratorForm();
                        setShowInactiveCollaborators((current) => !current);
                      }}
                    />
                  ) : null
                ) : equipeSubTab === 'cargos' ? (
                  !jobRoleCreateOpen ? (
                    <Button ref={jobRoleCreateButtonRef} variant="primary" iconLeft={<AppIcon icon={DS_ICONS.plus} size="sm" />} onClick={() => setJobRoleCreateOpen(true)}>
                      Novo cargo
                    </Button>
                  ) : null
                ) : !ddsThemeCreateOpen ? (
                  <Button ref={ddsThemeCreateButtonRef} variant="primary" iconLeft={<AppIcon icon={DS_ICONS.plus} size="sm" />} onClick={() => setDdsThemeCreateOpen(true)}>
                    Novo tema
                  </Button>
                ) : null}
              </>
            }
          />
        ) : null}
        {usersTab ? (
          <PageHeader
            className="rdo-admin-page__header rdo-users-page__header"
            title="Usuários"
            description="Administre contas internas e acessos de clientes com seus vínculos e perfis."
            actions={
              userAdminGroup === 'internal' && !showUserForm && !userEditingId ? (
                <Button variant="primary" iconLeft={<AppIcon icon={DS_ICONS.plus} size="sm" />} onClick={openNewUserForm}>
                  Novo usuário
                </Button>
              ) : null
            }
          />
        ) : null}
        {usersTab ? renderUsersToolbar() : null}
        {reportListingTab ? (
          <PageHeader
            className="rdo-manager-listing__page-header"
            title={tab === 'pendentes' ? 'Relatórios pendentes' : 'Relatórios aprovados'}
            description={tab === 'pendentes' ? 'Acompanhe os relatórios que aguardam revisão ou foram devolvidos.' : 'Consulte os relatórios aprovados e assinados.'}
            actions={
              <>
                <Button variant="secondary" aria-label="Abrir upload de relatórios antigos" onClick={() => openManualReportUpload()}>
                  <span className="rdo-action-label rdo-action-label--full">Upload de relatórios antigos</span>
                  <span className="rdo-action-label rdo-action-label--compact">Upload antigo</span>
                </Button>
                {tab === 'pendentes' ? (
                  <Button variant="primary" iconLeft={<AppIcon icon={DS_ICONS.plus} size="sm" />} aria-label="Criar relatório" onClick={handleNewReport}>
                    <span className="rdo-action-label rdo-action-label--full">Criar Relatório</span>
                    <span className="rdo-action-label rdo-action-label--compact">Criar relatório</span>
                  </Button>
                ) : null}
              </>
            }
          />
        ) : null}
        {archivedProjectsTab ? <PageHeader className="rdo-projects-page__header" title="Arquivados" description="Projetos e relatórios arquivados para organização e histórico. Restaure itens quando necessário." /> : null}
        {projectsTab ? (
          <PageHeader
            className="rdo-projects-page__header"
            title="Projetos"
            description="Gerencie os projetos ativos, acompanhe cadastros pendentes e revise suas informações."
            actions={
              <>
                {!showProjectForm && !projectEditingId ? (
                  <Button
                    variant="primary"
                    iconLeft={<AppIcon icon={DS_ICONS.plus} size="sm" />}
                    onClick={() => {
                      setShowProjectForm(true);
                      setProjectEditingId(null);
                      setProjectForm(emptyProjectForm);
                    }}
                  >
                    Novo projeto
                  </Button>
                ) : null}
                {renderGestorSearch()}
              </>
            }
          />
        ) : null}
        {archivedProjectsTab ? renderGestorSearch() : null}
        {renderReportSummary()}
        {reportListingTab ? renderGestorSearch() : null}
        {renderProjectMetrics()}
        {renderAdminMetrics()}
        {renderTabContent()}
      </main>

      <ProjectIntakeWebhookNovelty user={user} enabled={tab === 'projetos' && pendingProjectRegistrationCount > 0} />

      {renderReportSequenceDialog()}
      {renderManualReportModal()}

      <Modal
        open={showSegmentForm}
        onClose={closeSegmentForm}
        appearance="design-system"
        size="sm"
        panelClassName="rdo-manager-segment-dialog rdo-ds-actions"
        ariaLabelledBy="client-segment-title"
        initialFocusRef={segmentLabelInputRef}
        showCloseButton={false}
        title={<h2 className="rdo-manager-segment-dialog__title">Adicionar segmento</h2>}
        footer={
          <>
            <Button variant="secondary" size="sm" type="button" disabled={projectSegmentMutations.createSegment.isPending} onClick={closeSegmentForm}>
              Cancelar
            </Button>
            <Button variant="primary" size="md" type="submit" form="client-segment-form" loading={projectSegmentMutations.createSegment.isPending} loadingLabel="Salvando segmento…">
              Salvar segmento
            </Button>
          </>
        }
      >
        <form id="client-segment-form" className="rdo-manager-segment-dialog__form" onSubmit={handleSegmentSubmit}>
          <Field id="client-segment-label" label="Nome" required>
            <Input ref={segmentLabelInputRef} value={segmentLabel} onChange={(event) => setSegmentLabel(event.target.value)} autoComplete="off" required />
          </Field>
        </form>
      </Modal>

      <Modal
        open={Boolean(projectTeamDialogProject)}
        onClose={closeProjectTeamDialog}
        appearance="design-system"
        size="md"
        backdropClassName="rdo-manager-project-team-dialog-backdrop"
        panelClassName="rdo-manager-project-team-dialog rdo-ds-actions"
        fullscreenOnMobile={false}
        ariaLabelledBy="project-team-dialog-title"
        ariaDescribedBy="project-team-dialog-description"
        initialFocusRef={projectTeamOperatorRef}
        title={
          <h2 id="project-team-dialog-title" className="rdo-manager-project-team-dialog__title">
            Gerenciar equipe
          </h2>
        }
        footer={
          <>
            <Button variant="secondary" size="sm" type="button" disabled={projectMutations.updateProject.isPending} onClick={closeProjectTeamDialog}>
              Cancelar
            </Button>
            <Button variant="primary" size="sm" type="submit" form="project-team-form" loading={projectMutations.updateProject.isPending} loadingLabel="Salvando equipe…">
              Salvar equipe
            </Button>
          </>
        }
      >
        <form id="project-team-form" className="rdo-manager-project-team-dialog__form" onSubmit={handleProjectTeamSubmit}>
          <p id="project-team-dialog-description">
            Defina o operador responsável e os usuários internos autorizados para <strong>{projectTeamDialogProject ? projectTitle(projectTeamDialogProject) : 'este projeto'}</strong>.
          </p>
          <Field id="project-team-operator" label="Operador responsável">
            <Select
              ref={projectTeamOperatorRef}
              value={projectTeamForm.operatorId}
              onChange={(event) =>
                setProjectTeamForm((current) => ({
                  ...current,
                  operatorId: event.target.value
                }))
              }
            >
              <option value="">Sem operador responsável</option>
              {(collaboratorsQuery.data || [])
                .filter((item) => item.isActive)
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
            </Select>
          </Field>
          <ProjectAuthorizedUsersFields form={projectTeamForm} idPrefix="project-team" setForm={setProjectTeamForm} users={internalUsersQuery.data || []} />
        </form>
      </Modal>

      <Modal
        open={Boolean(archiveSurveyProject)}
        onClose={() => setArchiveSurveyProject(null)}
        appearance="design-system"
        size="sm"
        backdropClassName="rdo-manager-archive-project-dialog-backdrop"
        panelClassName="rdo-manager-archive-project-dialog rdo-ds-actions"
        fullscreenOnMobile={false}
        ariaLabelledBy="archive-survey-title"
        ariaDescribedBy="archive-survey-description"
        initialFocusRef={archiveSurveyCancelRef}
        title={<h2 className="rdo-manager-archive-project-dialog__title">Arquivar projeto</h2>}
        footer={
          <>
            <Button ref={archiveSurveyCancelRef} variant="secondary" size="sm" type="button" disabled={projectMutations.updateProject.isPending || surveyMutations.sendProjectSurvey.isPending} onClick={() => setArchiveSurveyProject(null)}>
              Cancelar
            </Button>
            <Button variant="danger" size="sm" type="button" disabled={projectMutations.updateProject.isPending || surveyMutations.sendProjectSurvey.isPending} onClick={() => void handleArchiveSurveyChoice(false)}>
              Arquivar sem enviar
            </Button>
            <Button variant="primary" size="sm" type="button" disabled={projectMutations.updateProject.isPending || surveyMutations.sendProjectSurvey.isPending} onClick={() => void handleArchiveSurveyChoice(true)}>
              Enviar pesquisa
            </Button>
          </>
        }
      >
        <p className="rdo-manager-archive-project-dialog__description" id="archive-survey-description">
          Deseja arquivar o projeto e enviar a pesquisa de satisfação ao cliente?
        </p>
      </Modal>

      <ConfirmDialog
        open={Boolean(removeProjectTarget)}
        appearance="design-system"
        title="Excluir projeto?"
        description="Se houver relatórios associados, o projeto será ocultado e os registros permanecerão preservados."
        highlight={removeProjectTarget ? projectTitle(removeProjectTarget) : undefined}
        confirmLabel="Excluir projeto"
        confirmDisabled={projectMutations.removeProject.isPending}
        onCancel={() => setRemoveProjectTarget(null)}
        onConfirm={() => removeProjectTarget && void handleProjectRemove(removeProjectTarget)}
      />

      <ConfirmDialog
        open={Boolean(archiveReportTarget)}
        appearance="design-system"
        title="Arquivar relatório?"
        description="O relatório continuará preservado no banco de dados e poderá ser restaurado pela área de arquivados."
        highlight={archiveReportTarget ? `${archiveReportTarget.reportType} ${archiveReportTarget.sequenceNumber || ''}`.trim() : undefined}
        confirmLabel="Arquivar relatório"
        confirmDisabled={reportMutations.deleteReport.isPending}
        onCancel={() => setArchiveReportTarget(null)}
        onConfirm={() => archiveReportTarget && void handleReportDelete(archiveReportTarget)}
      />

      <Modal open={showSurveyQuestionEditor} onClose={() => setShowSurveyQuestionEditor(false)} appearance="design-system" size="lg" title="Editar pesquisa NPS" panelClassName="rdo-manager-survey-editor-dialog">
        <form className="admin-form survey-question-editor-form" onSubmit={handleSurveyQuestionsSubmit}>
          <div className="survey-question-suggestions">
            <span>Adicionar sugestão:</span>
            {suggestedSurveyQuestions.map((template) => (
              <button className="mini-btn alt" type="button" key={template.label} onClick={() => addSuggestedSurveyQuestion(template)}>
                {template.label}
              </button>
            ))}
          </div>
          <div className="admin-stack survey-question-editor-list" ref={surveyQuestionEditorListRef} onDragOver={(event) => handleSurveyQuestionDragOver(event)}>
            {surveyQuestionDrafts.map((question, index) => (
              <div
                className={`card admin-card survey-question-card ${draggedSurveyQuestionId === question.id ? 'drag-placeholder' : ''} ${dragOverSurveyQuestionId === question.id && draggedSurveyQuestionId !== question.id ? 'drag-over' : ''}`}
                key={question.id}
                data-reorder-id={question.id}
                onDragEnter={() => setDragOverSurveyQuestionId(question.id)}
                onDragOver={(event) => handleSurveyQuestionDragOver(event, question.id)}
                onDrop={(event) => handleSurveyQuestionDrop(event, question.id)}
              >
                <div className="admin-inline-grid">
                  <div className="survey-question-drag-cell">
                    <button
                      className="survey-question-drag-handle"
                      type="button"
                      draggable
                      onDragStart={(event) => handleSurveyQuestionDragStart(event, question.id)}
                      onDragEnd={handleSurveyQuestionDragEnd}
                      onPointerDown={(event) => handleSurveyQuestionPointerDown(event, question.id)}
                      onPointerMove={handleSurveyQuestionPointerMove}
                      onPointerUp={(event) => finishSurveyQuestionPointerDrag(event, true)}
                      onPointerCancel={(event) => finishSurveyQuestionPointerDrag(event, false)}
                      title="Arrastar para reordenar"
                      aria-label="Arrastar pergunta para reordenar"
                    >
                      <span aria-hidden="true">::</span>
                    </button>
                  </div>
                  <div className="field-group field-group-wide">
                    <label htmlFor={`survey-question-label-${question.id}`}>Pergunta</label>
                    <input id={`survey-question-label-${question.id}`} value={question.label} onChange={(event) => updateSurveyQuestionDraft(index, { label: event.target.value })} required />
                  </div>
                  <div className="field-group survey-question-type-field">
                    <label htmlFor={`survey-question-type-${question.id}`}>Tipo</label>
                    <select id={`survey-question-type-${question.id}`} value={question.type} onChange={(event) => updateSurveyQuestionDraft(index, { type: event.target.value as SurveyQuestionType })}>
                      <option value="NPS">NPS 0-10</option>
                      <option value="SCALE">Escala 1-5</option>
                      <option value="SELECT">Lista suspensa</option>
                      <option value="TEXT">Campo de texto</option>
                    </select>
                  </div>
                  <label className="checkbox-line">
                    <input type="checkbox" checked={question.required} onChange={(event) => updateSurveyQuestionDraft(index, { required: event.target.checked })} />
                    Obrigatória
                  </label>
                  {scalePreviewValues(question.type).length ? (
                    <div className="field-group field-group-wide">
                      <label>Exemplo</label>
                      <div className="survey-scale-row preview" aria-hidden="true">
                        {scalePreviewValues(question.type).map((value) => (
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
                          onChange={(event) => setSurveyOptionInputs((current) => ({ ...current, [question.id]: event.target.value }))}
                          onKeyDown={(event) => {
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
                          {surveyDraftOptions(question).map((option) => (
                            <span className="colab-tag" key={option}>
                              <span>{option}</span>
                              <button type="button" onClick={() => removeSurveyQuestionOption(index, option)}>
                                ×
                              </button>
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
                      onClick={() =>
                        setSurveyQuestionDrafts((current) => {
                          const next = [...current];
                          const previous = next[index - 1];
                          next[index - 1] = next[index];
                          next[index] = previous;
                          return next;
                        })
                      }
                    >
                      Subir
                    </button>
                    <button
                      className="mini-btn alt"
                      type="button"
                      disabled={index === surveyQuestionDrafts.length - 1}
                      onClick={() =>
                        setSurveyQuestionDrafts((current) => {
                          const next = [...current];
                          const nextItem = next[index + 1];
                          next[index + 1] = next[index];
                          next[index] = nextItem;
                          return next;
                        })
                      }
                    >
                      Descer
                    </button>
                    <button className="mini-btn danger" type="button" onClick={() => setSurveyQuestionDrafts((current) => current.filter((_, itemIndex) => itemIndex !== index))}>
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
    </AppShell>
  );
}
