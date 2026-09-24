/* eslint-disable react-refresh/only-export-components */
import type { Dispatch, KeyboardEvent, ReactNode, SetStateAction } from 'react';
import type { UserRole } from '../../types/auth';
import { formatCnpj } from '../../utils/formatCnpj';
import { AppIcon } from '../../components/icons/AppIcon';
import type { ManualReportOperationalFieldsValue } from '../../components/reports/ManualReportOperationalFields';
import { emptyManualReportOperationalFields } from '../../components/reports/manualReportOperationalData';
import { Alert, Badge, Button, Card, IconButton, Select, StatusPill, type SemanticTone } from '../../components/ui/ds';
import { DS_ICONS } from '../../components/ui/ds/icons';
import { ProjectRevisionPicker } from '../../components/projects/ProjectRevisionPicker';
import type { CollaboratorFormState } from './CollaboratorForm';
import type { ManualReportUploadFileState } from './manualReportUploadFile';
import type { CommercialPendencia } from '../../api/acompanhamentoComercial';
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
import { formatDate, latestSurvey, surveyHistoryBadges, canSendProjectSurvey, type SurveyQuestionDraft } from './gestorSurveyHelpers';
import { commercialPendenciaAlertText } from './commercialPendencias';
import { RDO_MANAGER_SECTIONS, type RdoManagerSection } from './rdoSectionNavigationModel';
import { automaticProjectReviewMessage, formatProjectSequences, projectRegistrationPending, projectTitle, projectVisibilityLabel } from './projectPendingReview';

// Shared types, formatters and project-card presenters used by GestorPage.
// semântico do StatusPill. O mapeamento é 1:1 com o legacy — nada de novo é
// classificado aqui, e `gestorSurveyHelpers` permanece intocado.
export function npsStatusTone(className: string): SemanticTone {
  if (className === 'status-approved') return 'success';
  if (className === 'status-returned') return 'danger';
  return 'warning';
}

export type GestorTab = RdoManagerSection;

export const REPORT_PAGE_SIZE = 50;
export const REPORT_TYPE_PAGE_SIZE = 10;

export const suggestedSurveyQuestions: Array<Omit<SurveyQuestionDraft, 'id'>> = [
  { label: 'Nome do respondente', type: 'TEXT', required: false, optionsText: '' },
  { label: 'Segmento do cliente', type: 'SELECT', required: false, optionsText: 'Petróleo & gás\nPapel e celulose\nFarmacêutico\nMineração\nSiderurgia\nOutro' },
  { label: 'Tipo de serviço principal', type: 'SELECT', required: false, optionsText: 'Filtração\nFlushing\nLimpeza química\nDesidratação\nUTH\nOutro' },
  { label: 'Primeira experiência com a Filtrovali?', type: 'SELECT', required: false, optionsText: 'Sim\nNão' },
  { label: 'Autoriza contato para conversar sobre o projeto?', type: 'SELECT', required: false, optionsText: 'Sim\nNão' },
  { label: 'O projeto foi concluído dentro do prazo?', type: 'SELECT', required: false, optionsText: 'Sim\nNão\nParcialmente' }
];

export function parseGestorTab(value: string | null): GestorTab {
  return RDO_MANAGER_SECTIONS.some(section => section.id === value) ? value as GestorTab : 'pendentes';
}

export type GestorUiPrefs = {
  projectSortDir: 'asc' | 'desc';
  archivedDefaultExpansionApplied: boolean;
  closedArchivedProjectIds: string[];
  closedArchivedTypeKeys: string[];
  archivedTypeSortDirections: Record<string, 'asc' | 'desc'>;
  closedClientAccountGroupIds: string[];
};

export function readGestorUiPrefs(storageKey: string): GestorUiPrefs {
  const fallback: GestorUiPrefs = {
    projectSortDir: 'asc',
    archivedDefaultExpansionApplied: false,
    closedArchivedProjectIds: [],
    closedArchivedTypeKeys: [],
    archivedTypeSortDirections: {},
    closedClientAccountGroupIds: []
  };
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey) || '{}') as Partial<GestorUiPrefs>;
    return {
      projectSortDir: parsed.projectSortDir === 'desc' ? 'desc' : 'asc',
      archivedDefaultExpansionApplied: parsed.archivedDefaultExpansionApplied === true,
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

export function writeGestorUiPrefs(storageKey: string, prefs: GestorUiPrefs) {
  try {
    localStorage.setItem(storageKey, JSON.stringify(prefs));
  } catch {
    // localStorage can be unavailable in private or restricted contexts.
  }
}

export interface ProjectFormState {
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

export interface ProjectReportSequenceFormState {
  reportType: ReportType;
  nextNumber: string;
}

export interface ManualReportFormState extends ManualReportOperationalFieldsValue {
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

export interface UserFormState {
  username: string;
  name: string;
  email: string;
  password: string;
  role: Exclude<UserRole, 'CLIENT'>;
  collaboratorId: string;
  isActive: boolean;
}

export const internalRoles: Array<Exclude<UserRole, 'CLIENT'>> = ['COLLABORATOR', 'COORDINATOR', 'MANAGER'];
export type UserRoleFilter = 'all' | Exclude<UserRole, 'CLIENT'>;
export type UserStatusFilter = 'all' | 'active' | 'inactive';
export type UserSortMode = 'name-asc' | 'name-desc' | 'role-asc';
export type ProjectVisibilityMode = 'manager-coordinator' | 'all-authorized' | 'manager-only';
export const projectReportTypes: ReportType[] = ['RDO', 'RTP', 'RLQ', 'RCPU', 'RLM', 'RLI', 'RLF'];

export function projectReportSequencesToForm(sequences: ProjectReportSequence[] = []): ProjectReportSequenceFormState[] {
  const sequenceByType = new Map(sequences.map(sequence => [sequence.reportType, sequence.nextNumber]));
  return projectReportTypes.map(reportType => ({
    reportType,
    nextNumber: String(sequenceByType.get(reportType) ?? 0)
  }));
}

export function normalizeProjectReportSequences(sequences: ProjectReportSequenceFormState[]) {
  return projectReportTypes.map(reportType => {
    const sequence = sequences.find(item => item.reportType === reportType);
    const parsed = Number.parseInt(sequence?.nextNumber || '0', 10);
    return {
      reportType,
      nextNumber: Number.isFinite(parsed) && parsed > 0 ? parsed : 0
    };
  });
}

export const emptyProjectForm: ProjectFormState = {
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

export const emptyManualReportForm: ManualReportFormState = {
  projectId: '',
  reportType: 'RDO',
  sequenceNumber: '',
  reportDate: new Date().toISOString().slice(0, 10),
  signatureMode: 'APPROVED',
  serviceEquipment: '',
  serviceSystem: '',
  fileName: '',
  pdfDataUrl: '',
  ...emptyManualReportOperationalFields(),
  files: []
};

export const emptyCollaboratorForm: CollaboratorFormState = {
  name: '',
  jobRoleId: '',
  jobRoleEffectiveDate: new Date().toISOString().slice(0, 10),
  email: '',
  terminationDate: '',
  signatureImage: '',
  signatureNoticeAccepted: false,
  isActive: true
};

export const emptyUserForm: UserFormState = {
  username: '',
  name: '',
  email: '',
  password: '',
  role: 'COLLABORATOR',
  collaboratorId: '',
  isActive: true
};

export interface RdoServiceDraft {
  id: string;
  type: string;
  data: Record<string, unknown>;
}

export function asString(value: unknown, fallback = '') {
  return typeof value === 'string' ? value : fallback;
}

export function asBoolean(value: unknown) {
  return typeof value === 'boolean' ? value : false;
}

export function hasActiveClientRejection(report: ReportSummary) {
  const special = report.specialConditions || {};
  const rejectedAt = typeof special.__clientRejectedAt === 'string' ? special.__clientRejectedAt : '';
  const resolvedAt = typeof special.__clientRejectionResolvedAt === 'string' ? special.__clientRejectionResolvedAt : '';
  if (!rejectedAt) return false;
  return !resolvedAt || new Date(rejectedAt).getTime() > new Date(resolvedAt).getTime();
}

export function isManualUploadedReport(report: ReportSummary | null | undefined) {
  return Boolean(manualReportUploadMeta(report).uploadedAt);
}

export function manualReportUploadMeta(report: ReportSummary | null | undefined) {
  const meta = report?.specialConditions?.__manualUpload;
  return meta && typeof meta === 'object' && !Array.isArray(meta) ? meta as Record<string, unknown> : {};
}

export function manualReportServiceData(report: ReportSummary | null | undefined) {
  const data = report?.specialConditions?.serviceData;
  return data && typeof data === 'object' && !Array.isArray(data) ? data as Record<string, unknown> : {};
}

export function manualReportServiceField(report: ReportSummary | null | undefined, keys: string[]) {
  const data = manualReportServiceData(report);
  for (const key of keys) {
    const value = data[key];
    if (typeof value === 'string' || typeof value === 'number') return String(value);
  }
  return '';
}

export function manualReportSignatureMode(report: ReportSummary): ManualReportFormState['signatureMode'] {
  if (report.status === 'SIGNED') return 'SIGNED';
  const meta = manualReportUploadMeta(report);
  if (meta.requiresSignature === true) return 'REQUIRES_SIGNATURE';
  return 'APPROVED';
}

export function asStringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

export function parseEmailList(value: string) {
  return Array.from(new Set(
    value
      .split(/[\n,;]+/)
      .map(item => item.trim().toLowerCase())
      .filter(Boolean)
  ));
}

export function cleanSigners(signers: ClientSigner[]) {
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

export function splitSignerName(name = '') {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return {
    firstName: parts[0] || '',
    lastName: parts.slice(1).join(' ')
  };
}

export function signerFirstName(signer: ClientSigner) {
  return signer.firstName || splitSignerName(signer.name).firstName;
}

export function signerLastName(signer: ClientSigner) {
  return signer.lastName || splitSignerName(signer.name).lastName;
}

export function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('Falha ao ler arquivo.'));
    reader.readAsDataURL(file);
  });
}

export function normalizeSignatureImage(value?: string | null) {
  const signature = String(value || '').trim();
  return signature && signature !== 'null' && signature !== 'undefined' ? signature : '';
}

export function asServices(value: unknown): RdoServiceDraft[] {
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

export function asDdsThemes(value: unknown): { id: string; name: string; custom?: boolean }[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
    .map(item => ({ id: asString(item.id), name: asString(item.name), ...(item.custom === true ? { custom: true } : {}) }))
    .filter(item => item.id && item.name);
}

export function draftDateLabel(draft: ReportDraft) {
  const payloadDate = asString(draft.payload.reportDate);
  return draft.reportDate || payloadDate || 'Sem data';
}

export function formatUserRole(role: UserRole) {
  const labels: Record<UserRole, string> = {
    COLLABORATOR: 'Colaborador',
    MANAGER: 'Gestor',
    COORDINATOR: 'Coordenador',
    CLIENT: 'Cliente'
  };

  return labels[role] || role;
}

export function userRoleTone(role: UserRole): SemanticTone {
  if (role === 'MANAGER') return 'brand';
  if (role === 'COORDINATOR') return 'info';
  if (role === 'CLIENT') return 'warning';
  return 'neutral';
}

export function initials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map(part => part[0] || '')
    .join('')
    .toUpperCase() || 'CL';
}

export function collaboratorSearchParts(collaborator: Collaborator) {
  return [collaborator.code, collaborator.name, collaborator.role, collaborator.email];
}

export function userSearchParts(item: InternalUserSummary) {
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

export function formatList(values: string[], fallback = 'Não informado') {
  const cleaned = values.map(value => value.trim()).filter(Boolean);
  return cleaned.length ? cleaned.join(', ') : fallback;
}

export function formatProjectSigners(signers?: ClientSigner[]) {
  if (!signers?.length) return 'Nenhum assinante adicional';
  return signers
    .map(signer => [[signerFirstName(signer), signerLastName(signer)].filter(Boolean).join(' ') || signer.name, signer.email].filter(Boolean).join(' - '))
    .filter(Boolean)
    .join(', ');
}

export function formatPrimaryProjectSigner(project: Project) {
  const name = [project.clientSignerFirstName, project.clientSignerLastName]
    .map(part => String(part || '').trim())
    .filter(Boolean)
    .join(' ');
  return name || 'Não informado';
}

export function projectVisibilityMode(form: Pick<ProjectFormState, 'managerOnly' | 'visibleToCollaborators'>): ProjectVisibilityMode {
  if (form.managerOnly) return 'manager-only';
  return form.visibleToCollaborators ? 'all-authorized' : 'manager-coordinator';
}

export function applyProjectVisibilityMode(mode: ProjectVisibilityMode): Pick<ProjectFormState, 'managerOnly' | 'visibleToCollaborators'> {
  if (mode === 'manager-only') return { managerOnly: true, visibleToCollaborators: false };
  if (mode === 'all-authorized') return { managerOnly: false, visibleToCollaborators: true };
  return { managerOnly: false, visibleToCollaborators: false };
}

export function segmentSlugFromLabel(label: string) {
  return label
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export function projectToForm(project: Project): ProjectFormState {
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

export function canBeAuthorizedProjectUser(user: InternalUserSummary) {
  return Boolean(
    user.isActive
    && user.role === 'COLLABORATOR'
    && user.collaboratorId
    && (user.moduleRoles || []).includes('rdo:collaborator')
  );
}

export function userProjectAccessLabel(user: InternalUserSummary) {
  const collaboratorName = user.collaborator?.name || '';
  if (collaboratorName && collaboratorName !== user.name) return `${collaboratorName} (${user.name})`;
  return user.name || user.username;
}

export function ProjectAuthorizedUsersFields({
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
            <Select id={`${idPrefix}-authorized-users-select`} defaultValue="">
              <option value="">Selecionar usuário...</option>
              {availableUsers.map(user => (
                <option key={user.id} value={user.id}>{userProjectAccessLabel(user)}</option>
              ))}
            </Select>
            <Button variant="primary" size="sm" type="button" disabled={!availableUsers.length} onClick={event => {
              const select = event.currentTarget.parentElement?.querySelector('select');
              addUser(select || null);
            }}>
              + Adicionar
            </Button>
          </div>
        </div>
      ) : (
        <div className="form-hint">Nenhum usuário interno de colaborador disponível.</div>
      )}
    </div>
  );
}

export function ProjectClientFields({
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
            <Button variant="primary" size="sm" type="button" onClick={event => {
              const input = event.currentTarget.parentElement?.querySelector('input');
              commitCcInput(input || null);
            }}>
              + Adicionar
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}

export function ProjectReportSequenceFields({
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

export function collaboratorToForm(collaborator: Collaborator): CollaboratorFormState {
  return {
    name: collaborator.name,
    jobRoleId: collaborator.jobRoleId,
    jobRoleEffectiveDate: new Date().toISOString().slice(0, 10),
    email: collaborator.email || '',
    terminationDate: collaborator.terminationDate?.slice(0, 10) || '',
    signatureImage: normalizeSignatureImage(collaborator.signatureImage),
    signatureNoticeAccepted: Boolean(collaborator.signatureNoticeAcceptedAt || collaborator.signatureNoticeVersion),
    isActive: collaborator.isActive
  };
}

export function userToForm(user: InternalUserSummary): UserFormState {
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

export function renderProjectCard(
  project: Project,
  options: {
    onEdit: (project: Project) => void;
    editing?: boolean;
    onManageTeam?: (project: Project) => void;
    onViewReports?: (project: Project) => void;
    onToggleArchive: (project: Project) => void;
    onRemove?: (project: Project) => void;
    onUploadOldReports?: (project: Project) => void;
    detailsExpanded: boolean;
    onToggleDetails: (project: Project) => void;
    reportSectionExpanded?: boolean;
    reportCount?: number;
    onToggleReports?: (project: Project) => void;
    onOpenReports?: (project: Project) => void;
    onSendSurvey?: (project: Project) => void;
    onResendSurvey?: (survey: SatisfactionSurveySummary) => void;
    surveyPending?: boolean;
    children?: ReactNode;
    segments?: ClientSegment[];
    commercialPendencia?: CommercialPendencia | null;
    appearance?: 'legacy' | 'design-system';
  }
) {
  const survey = latestSurvey(project);
  const surveyInfos = !project.isActive ? surveyHistoryBadges(project) : [];
  const canSendSurvey = canSendProjectSurvey(project);
  const canResendSurvey = !project.isActive && !!survey && !survey.respondedAt;
  const pendingRegistration = projectRegistrationPending(project);
  const title = projectTitle(project);
  const commercialPendenciaText = options.commercialPendencia ? commercialPendenciaAlertText(options.commercialPendencia) : null;
  if (options.appearance === 'design-system') {
    const activeProject = project.isActive !== false;
    const reportsRegionId = `project-reports-${project.id}`;
    const reportsInDialog = Boolean(options.onOpenReports);
    const reportsTriggerLabel = reportsInDialog
      ? `Ver relatórios de ${title}`
      : `${options.reportSectionExpanded ? 'Recolher' : 'Expandir'} relatórios de ${title}`;
    const handleReports = () => (options.onOpenReports ?? options.onToggleReports)?.(project);
    const detailsRegionId = `project-details-${project.id}`;
    const scheduleLabel = project.includesSaturday || project.includesSunday
      ? 'Escala estendida'
      : 'Escala padrão';
    const stateLabel = pendingRegistration
      ? 'Cadastro pendente'
      : activeProject
        ? 'Ativo'
        : 'Arquivado';
    const stateTone = pendingRegistration
      ? 'warning'
      : activeProject
        ? 'success'
        : 'neutral';
    const projectKicker = pendingRegistration
      ? 'Projeto aguardando revisão'
      : activeProject
        ? 'Projeto ativo'
        : 'Projeto arquivado';
    const segmentLabel = project.clientSegment
      ? (options.segments || []).find(segment => segment.slug === project.clientSegment)?.label ||
        project.clientSegment
      : 'Sem categoria';
    const overviewRows: Array<[string, ReactNode]> = [
      ['Cliente', project.clientName || 'Não informado'],
      ['Segmento', segmentLabel],
      ['Responsável', project.operator?.name || 'Não informado'],
      ['Atualização', formatDate(project.updatedAt || project.createdAt)]
    ];
    const detailRows: Array<[string, ReactNode]> = [
      ['Cliente', project.clientName || '-'],
      ['CNPJ', formatCnpj(project.clientCnpj) || '-'],
      ['E-mail principal', project.clientEmailPrimary || '-'],
      ['Signatário principal', formatPrimaryProjectSigner(project)],
      ['E-mails em cópia', formatList(project.clientEmailCc || [])],
      ['Assinantes adicionais', formatProjectSigners(project.clientSigners)],
      ['Proposta', project.contractCode || '-'],
      ['Local', project.location || '-'],
      ['Operador', project.operator?.name || '-'],
      ['Visibilidade', projectVisibilityLabel(project)],
      ['Sequenciais', formatProjectSequences(project)]
    ];
    if (project.clientSegment) {
      detailRows.splice(9, 0, [
        'Segmento',
        (options.segments || []).find(s => s.slug === project.clientSegment)?.label || project.clientSegment
      ]);
    }

    if (activeProject && !options.onToggleReports) {
      const editRegionId = `project-edit-${project.id}`;
      const authorizedUserCount = project.authorizedUsers?.length || 0;
      const additionalSignerCount = project.clientSigners?.length || 0;
      const weekendDays =
        [
          project.includesSaturday ? 'sábado' : null,
          project.includesSunday ? 'domingo' : null
        ]
          .filter(Boolean)
          .join(' e ') || 'Não incluído';

      return (
        <Card
          className={`rdo-project-card rdo-archived-project-card rdo-ds-actions rdo-active-project-card ${pendingRegistration ? 'rdo-active-project-card--pending' : ''} ${options.detailsExpanded ? 'rdo-active-project-card--expanded' : 'rdo-active-project-card--compact'}`}
          data-active-project-id={project.id}
          data-project-editing={Boolean(options.editing)}
          key={project.id}
          padding="sm"
          title={
            <div className="rdo-active-project-card__heading">
              <span
                className="rdo-active-project-card__icon"
                aria-hidden="true"
              >
                <AppIcon icon={DS_ICONS.folder} size="md" />
              </span>
              <div className="rdo-active-project-card__identity">
                <div className="rdo-active-project-card__title-row">
                  <h3 className="rdo-archived-project-card__title">
                    <button
                      className="rdo-project-card__title-toggle"
                      type="button"
                      aria-label={`${options.detailsExpanded ? 'Ocultar' : 'Mostrar'} detalhes de ${title}`}
                      aria-expanded={options.detailsExpanded}
                      aria-controls={detailsRegionId}
                      onClick={() => options.onToggleDetails(project)}
                    >
                      {title}
                    </button>
                  </h3>
                  <StatusPill
                    status={pendingRegistration ? 'pending' : 'active'}
                    label={stateLabel}
                    tone={stateTone}
                  />
                </div>
                <div className="rdo-active-project-card__context">
                  <span>
                    Cliente:{' '}
                    <strong>{project.clientName || 'Não informado'}</strong>
                  </span>
                  <Badge tone="neutral">{segmentLabel}</Badge>
                </div>
              </div>
            </div>
          }
          actions={
            <div className="rdo-active-project-card__header-actions">
              <IconButton
                icon={DS_ICONS.edit}
                label={`${pendingRegistration ? 'Revisar cadastro' : 'Editar'}: ${title}`}
                variant="secondary"
                size="sm"
                aria-expanded={options.editing}
                aria-controls={editRegionId}
                onClick={() => options.onEdit(project)}
              />
              <IconButton
                icon={DS_ICONS.archive}
                label="Arquivar"
                variant="secondary"
                size="sm"
                onClick={() => options.onToggleArchive(project)}
              />
              {options.onRemove ? (
                <IconButton
                  icon={DS_ICONS.trash}
                  label={`Excluir: ${title}`}
                  variant="danger"
                  size="sm"
                  onClick={() => options.onRemove?.(project)}
                />
              ) : null}
            </div>
          }
        >
          <dl
            className="rdo-active-project-card__summary"
            aria-label={`Resumo de ${title}`}
          >
            <div className="rdo-active-project-card__summary-item">
              <AppIcon icon={DS_ICONS.calendar} size="sm" />
              <dt>Atualização</dt>
              <dd>{formatDate(project.updatedAt || project.createdAt)}</dd>
            </div>
            <div className="rdo-active-project-card__summary-item">
              <AppIcon icon={DS_ICONS.user} size="sm" />
              <dt>Responsável</dt>
              <dd>{project.operator?.name || 'Não informado'}</dd>
            </div>
            <div className="rdo-active-project-card__summary-item">
              <AppIcon icon={DS_ICONS.users} size="sm" />
              <dt>Equipe autorizada</dt>
              <dd>{authorizedUserCount}</dd>
            </div>
            <div className="rdo-active-project-card__summary-item">
              <AppIcon icon={DS_ICONS.fileText} size="sm" />
              <dt>Relatórios</dt>
              <dd>{options.reportCount ?? '—'}</dd>
            </div>
          </dl>

          {pendingRegistration ? (
            <Alert tone="warning" title="Cadastro pendente">
              {automaticProjectReviewMessage(project)}
            </Alert>
          ) : null}
          {commercialPendenciaText ? (
            <Alert tone="warning" title="Revisão comercial pendente">
              {commercialPendenciaText}
            </Alert>
          ) : null}

          <section
            className="rdo-active-project-card__detail-panel rdo-active-project-card__quick-actions"
            aria-labelledby={`project-actions-${project.id}-title`}
          >
            <h4 id={`project-actions-${project.id}-title`}>Ações rápidas</h4>
            <div className="rdo-active-project-card__quick-action-list">
              <Button
                variant="secondary"
                size="sm"
                iconLeft={<AppIcon icon={DS_ICONS.edit} size="sm" />}
                aria-label={`${options.editing ? 'Fechar edição' : pendingRegistration ? 'Revisar cadastro' : 'Editar projeto'}: ${title}`}
                onClick={() => options.onEdit(project)}
              >
                <span className="rdo-project-action-label--full">
                  {options.editing
                    ? 'Fechar edição'
                    : pendingRegistration
                      ? 'Revisar cadastro'
                      : 'Editar projeto'}
                </span>
                <span className="rdo-project-action-label--compact">
                  {options.editing ? 'Fechar' : pendingRegistration ? 'Revisar' : 'Editar'}
                </span>
              </Button>
              {options.onManageTeam ? (
                <Button
                  variant="secondary"
                  size="sm"
                  iconLeft={<AppIcon icon={DS_ICONS.users} size="sm" />}
                  aria-label="Gerenciar equipe"
                  onClick={() => options.onManageTeam?.(project)}
                >
                  <span className="rdo-project-action-label--full">Gerenciar equipe</span>
                  <span className="rdo-project-action-label--compact">Equipe</span>
                </Button>
              ) : null}
              {options.onViewReports ? (
                <Button
                  variant="secondary"
                  size="sm"
                  iconLeft={<AppIcon icon={DS_ICONS.fileText} size="sm" />}
                  aria-label="Ver relatórios"
                  onClick={() => options.onViewReports?.(project)}
                >
                  <span className="rdo-project-action-label--full">Ver relatórios</span>
                  <span className="rdo-project-action-label--compact">Relatórios</span>
                </Button>
              ) : null}
              {options.onUploadOldReports && !pendingRegistration ? (
                <Button variant="secondary" size="sm" type="button" onClick={() => options.onUploadOldReports?.(project)}>
                  Upload de relatórios antigos
                </Button>
              ) : null}
            </div>
          </section>

          {options.children ? (
            <div
              className="rdo-active-project-card__embedded-flow"
              id={editRegionId}
            >
              {options.children}
            </div>
          ) : null}

          <div
            className={`rdo-active-project-card__details-region ${options.detailsExpanded ? 'rdo-active-project-card__details-region--expanded' : ''}`}
          >
            <div className="rdo-active-project-card__details-disclosure">
              <Button
                className="rdo-active-project-card__details-toggle"
                iconLeft={<AppIcon icon={DS_ICONS.chevronDown} size="sm" />}
                variant="secondary"
                size="sm"
                type="button"
                aria-label={`${options.detailsExpanded ? 'Ocultar' : 'Mostrar'} detalhes de ${title}`}
                aria-expanded={options.detailsExpanded}
                aria-controls={detailsRegionId}
                onClick={() => options.onToggleDetails(project)}
              >
                Detalhes
              </Button>
            </div>

            {options.detailsExpanded ? (
              <div
                className="rdo-archived-project-card__details rdo-active-project-card__expanded-content"
                id={detailsRegionId}
              >
                <div className="rdo-active-project-card__details-grid">
                  <section
                  className="rdo-active-project-card__detail-panel rdo-active-project-card__detail-panel--overview"
                  aria-labelledby={`project-information-${project.id}-title`}
                >
                  <h4 id={`project-information-${project.id}-title`}>
                    Informações do projeto
                  </h4>
                  <dl>
                    <div className="rdo-archived-project-card__detail">
                      <dt>Cliente</dt>
                      <dd>{project.clientName || '-'}</dd>
                    </div>
                    <div className="rdo-archived-project-card__detail">
                      <dt>CNPJ</dt>
                      <dd>{formatCnpj(project.clientCnpj) || '-'}</dd>
                    </div>
                    <div className="rdo-archived-project-card__detail">
                      <dt>Local</dt>
                      <dd>{project.location || '-'}</dd>
                    </div>
                    <div className="rdo-archived-project-card__detail">
                      <dt>Proposta</dt>
                      <dd>{project.contractCode || '-'}</dd>
                    </div>
                    <div className="rdo-archived-project-card__detail">
                      <dt>Segmento</dt>
                      <dd>{segmentLabel}</dd>
                    </div>
                    <div className="rdo-archived-project-card__detail">
                      <dt>E-mail principal</dt>
                      <dd>{project.clientEmailPrimary || '-'}</dd>
                    </div>
                  </dl>
                  </section>

                  <section
                  className="rdo-active-project-card__detail-panel"
                  aria-labelledby={`project-operation-${project.id}-title`}
                >
                  <h4 id={`project-operation-${project.id}-title`}>Operação</h4>
                  <dl>
                    <div className="rdo-archived-project-card__detail">
                      <dt>Responsável</dt>
                      <dd>{project.operator?.name || '-'}</dd>
                    </div>
                    <div className="rdo-archived-project-card__detail">
                      <dt>Jornada padrão</dt>
                      <dd>{project.workdayHours || '-'}</dd>
                    </div>
                    <div className="rdo-archived-project-card__detail">
                      <dt>Fim de semana</dt>
                      <dd>{weekendDays}</dd>
                    </div>
                    <div className="rdo-archived-project-card__detail">
                      <dt>Visibilidade</dt>
                      <dd>{projectVisibilityLabel(project)}</dd>
                    </div>
                  </dl>
                  </section>

                  <section
                  className="rdo-active-project-card__detail-panel"
                  aria-labelledby={`project-summary-${project.id}`}
                >
                  <h4 id={`project-summary-${project.id}`}>Resumo</h4>
                  <dl>
                    <div className="rdo-archived-project-card__detail">
                      <dt>Equipe autorizada</dt>
                      <dd>{authorizedUserCount}</dd>
                    </div>
                    <div className="rdo-archived-project-card__detail">
                      <dt>Assinantes adicionais</dt>
                      <dd>{additionalSignerCount}</dd>
                    </div>
                    <div className="rdo-archived-project-card__detail">
                      <dt>Relatórios vinculados</dt>
                      <dd>{options.reportCount ?? '—'}</dd>
                    </div>
                    <div className="rdo-archived-project-card__detail">
                      <dt>Exige assinatura em relatórios de serviço</dt>
                      <dd>
                        {project.requireServiceReportSignatures ? 'Sim' : 'Não'}
                      </dd>
                    </div>
                  </dl>
                  </section>
                </div>

                {options.commercialPendencia ? (
                  <ProjectRevisionPicker projectId={project.id} />
                ) : null}
              </div>
            ) : null}
            </div>
        </Card>
      );
    }

    return (
      <Card
        className={`rdo-project-card rdo-archived-project-card rdo-ds-actions ${activeProject ? 'rdo-active-project-card' : 'rdo-project-card--archived'} ${!activeProject && !reportsInDialog && !options.reportSectionExpanded ? 'rdo-project-card--archived-collapsed' : ''} ${pendingRegistration ? 'rdo-active-project-card--pending' : ''}`}
        data-active-project-id={activeProject ? project.id : undefined}
        data-archived-project-id={!activeProject ? project.id : undefined}
        key={project.id}
        padding="md"
        title={options.onToggleReports || options.onOpenReports ? (
          <div className="rdo-archived-project-card__heading">
            <Button
              className="rdo-archived-project-card__reports-toggle"
              type="button"
              aria-label={reportsTriggerLabel}
              aria-haspopup={reportsInDialog ? 'dialog' : undefined}
              aria-expanded={reportsInDialog ? undefined : options.reportSectionExpanded}
              aria-controls={reportsInDialog ? undefined : reportsRegionId}
              onClick={handleReports}
              variant="secondary"
              size="sm"
              iconLeft={
                <AppIcon
                  className={reportsInDialog ? undefined : 'rdo-archived-project-card__chevron'}
                  icon={reportsInDialog ? DS_ICONS.fileText : DS_ICONS.chevronDown}
                  size="sm"
                />
              }
            >
              Relatórios
            </Button>
            <span className="rdo-archived-project-card__icon" aria-hidden="true">
              <AppIcon icon={DS_ICONS.archive} size="md" />
            </span>
            <span className="rdo-archived-project-card__identity">
              <span className="rdo-archived-project-card__title-row">
                <span className="rdo-archived-project-card__title">
                  <button
                    className="rdo-project-card__title-toggle"
                    type="button"
                    aria-label={reportsTriggerLabel}
                    aria-haspopup={reportsInDialog ? 'dialog' : undefined}
                    aria-expanded={reportsInDialog ? undefined : options.reportSectionExpanded}
                    aria-controls={reportsInDialog ? undefined : reportsRegionId}
                    onClick={handleReports}
                  >
                    {title}
                  </button>
                </span>
                <Badge tone={project.includesSaturday || project.includesSunday ? 'warning' : 'neutral'}>
                  {scheduleLabel}
                </Badge>
              </span>
              <span className="rdo-archived-project-card__meta">
                <span>Atualizado em {formatDate(project.updatedAt || project.createdAt)}</span>
                <span aria-hidden="true">•</span>
                <span>
                  {options.reportCount || 0} relatório{options.reportCount === 1 ? '' : 's'}
                </span>
              </span>
            </span>
          </div>
        ) : (
          <div className="rdo-active-project-card__identity">
            <span className="rdo-archived-project-card__kicker">{projectKicker}</span>
            <h3 className="rdo-archived-project-card__title">{title}</h3>
          </div>
        )}
        actions={
          <div className="rdo-archived-project-card__badges">
            {activeProject ? (
              <StatusPill
                status={pendingRegistration ? 'pending' : 'active'}
                label={stateLabel}
                tone={stateTone}
              />
            ) : null}
            {!activeProject ? (
              <>
                <IconButton
                  icon={DS_ICONS.restore}
                  label={`Restaurar projeto: ${title}`}
                  variant="secondary"
                  size="sm"
                  onClick={() => options.onToggleArchive(project)}
                />
                <IconButton
                  icon={DS_ICONS.edit}
                  label={`${pendingRegistration ? 'Revisar cadastro' : 'Editar'}: ${title}`}
                  variant="secondary"
                  size="sm"
                  onClick={() => options.onEdit(project)}
                />
                {options.onRemove ? (
                  <IconButton
                    icon={DS_ICONS.trash}
                    label={`Excluir permanentemente: ${title}`}
                    variant="danger"
                    size="sm"
                    onClick={() => options.onRemove?.(project)}
                  />
                ) : null}
              </>
            ) : null}
          </div>
        }
        footer={activeProject || reportsInDialog || options.reportSectionExpanded ? (
          <div className="rdo-archived-project-card__actions">
            {options.onUploadOldReports && !pendingRegistration ? (
              <Button variant="secondary" size="sm" type="button" onClick={() => options.onUploadOldReports?.(project)}>
                Upload de relatórios antigos
              </Button>
            ) : null}
            <Button
              variant="secondary"
              size="sm"
              type="button"
              aria-expanded={options.detailsExpanded}
              aria-controls={detailsRegionId}
              onClick={() => options.onToggleDetails(project)}
            >
              {options.detailsExpanded ? 'Ocultar detalhes' : 'Mostrar detalhes'}
            </Button>
            {activeProject ? (
              <>
                <Button
                  variant="secondary"
                  size="sm"
                  type="button"
                  onClick={() => options.onToggleArchive(project)}
                >
                  Arquivar
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  type="button"
                  aria-label={`${pendingRegistration ? 'Revisar cadastro' : 'Editar'}: ${title}`}
                  onClick={() => options.onEdit(project)}
                >
                  {pendingRegistration ? 'Revisar cadastro' : 'Editar'}
                </Button>
              </>
            ) : null}
            {surveyInfos.map((surveyInfo, index) => (
              <Badge
                key={`${project.id}-survey-badge-${index}`}
                tone={surveyInfo.className.includes('badge-ok')
                  ? 'success'
                  : surveyInfo.className.includes('badge-rev')
                    ? 'info'
                    : 'warning'}
              >
                {surveyInfo.label}
              </Badge>
            ))}
            {canSendSurvey && !canResendSurvey && options.onSendSurvey ? (
              <Button
                variant="secondary"
                size="sm"
                type="button"
                disabled={options.surveyPending}
                onClick={() => options.onSendSurvey?.(project)}
              >
                Enviar pesquisa
              </Button>
            ) : null}
            {canResendSurvey && survey && options.onResendSurvey ? (
              <Button
                variant="secondary"
                size="sm"
                type="button"
                disabled={options.surveyPending}
                onClick={() => options.onResendSurvey?.(survey)}
              >
                Reenviar pesquisa
              </Button>
            ) : null}
          </div>
        ) : undefined}
      >
        {activeProject ? (
          <dl
            className="rdo-project-card__overview"
            aria-label={`Resumo de ${title}`}
          >
            {overviewRows.map(([label, value]) => (
              <div className="rdo-project-card__overview-item" key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        ) : null}
        {pendingRegistration ? (
          <Alert tone="warning" title="Cadastro pendente">
            {automaticProjectReviewMessage(project)}
          </Alert>
        ) : null}
        {commercialPendenciaText ? (
          <Alert tone="warning" title="Revisão comercial pendente">
            {commercialPendenciaText}
          </Alert>
        ) : null}
        {options.children ? <div id={reportsRegionId}>{options.children}</div> : null}
        {options.detailsExpanded ? (
          <div className="rdo-archived-project-card__details" id={detailsRegionId}>
            <dl>
              {detailRows.map(([label, value]) => (
                <div className="rdo-archived-project-card__detail" key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
            {options.commercialPendencia ? <ProjectRevisionPicker projectId={project.id} /> : null}
          </div>
        ) : null}
      </Card>
    );
  }

  return (
    <article className={`card admin-card project-admin-card ${pendingRegistration ? 'project-admin-card-pending' : ''}`} key={project.id}>
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
          {automaticProjectReviewMessage(project)}
        </div>
      ) : null}
      {commercialPendenciaText ? (
        <div className="project-registration-alert">
          {commercialPendenciaText}
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
            <span className="det-label">Proposta</span>
            <span className="det-val">{project.contractCode || '-'}</span>
          </div>
          <div className="det-row">
            <span className="det-label">Local</span>
            <span className="det-val">{project.location || '-'}</span>
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
        <button
          className="mini-btn alt"
          type="button"
          aria-label={`${pendingRegistration ? 'Revisar cadastro' : 'Editar'}: ${title}`}
          onClick={() => options.onEdit(project)}
        >
          {pendingRegistration ? 'Revisar cadastro' : 'Editar'}
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
