import { useEffect, useMemo, useState, type Dispatch, type FormEvent, type KeyboardEvent, type SetStateAction } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ReactNode } from 'react';

import { formatCnpj, normalizeCnpjInput } from '../../utils/formatCnpj';
import { compareReportTypes, ProjectSortButton, sortProjects, sortReportsInGroup } from '../../utils/projectSort';

import type { UserRole } from '../../types/auth';
import { downloadReportDocx, downloadReportPdf, downloadReportsBatch } from '../../api/reports';
import { useAuth } from '../../auth/AuthContext';
import { GroupedReportList } from '../../components/reports/GroupedReportList';
import { ReportSummaryCard } from '../../components/reports/ReportSummaryCard';
import { ReasonDialog } from '../../components/ui/ReasonDialog';
import { useToast } from '../../components/ui/Toast';
import { useCollaboratorMutations, useCollaborators } from '../../hooks/useCollaborators';
import { useCounterMutations, useCounters } from '../../hooks/useCounters';
import { useDraftMutations, useDrafts } from '../../hooks/useDrafts';
import { useManometerMutations, useManometers } from '../../hooks/useManometers';
import { useProjectMutations, useProjects } from '../../hooks/useProjects';
import { useReportMutations, useReports } from '../../hooks/useReports';
import { useUnitMutations, useUnits } from '../../hooks/useUnits';
import { useUserMutations, useUsers } from '../../hooks/useUsers';
import { Shell } from '../../layout/Shell';
import { TopBar } from '../../layout/TopBar';
import { useRdoStore } from '../../store/rdoStore';
import type {
  Collaborator,
  ClientSigner,
  InternalUserSummary,
  Manometer,
  ParticleCounter,
  Project,
  ReportDraft,
  ReportSummary,
  Unit,
  UnitCategory
} from '../../types/domain';
import { downloadBlob } from '../../utils/download';

type GestorTab =
  | 'pendentes'
  | 'aprovados'
  | 'arquivados'
  | 'projetos'
  | 'equipe'
  | 'usuarios'
  | 'equipamentos'
  | 'manometros'
  | 'contadores';

interface ProjectFormState {
  code: string;
  name: string;
  clientName: string;
  clientCnpj: string;
  clientEmailPrimary: string;
  clientEmailCc: string;
  clientSigners: ClientSigner[];
  contractCode: string;
  location: string;
  operatorId: string;
  visibleToCollaborators: boolean;
  isActive: boolean;
  workdayHours: string;
  weekendWorkdayHours: string;
  includesSaturday: boolean;
  includesSunday: boolean;
}

interface CollaboratorFormState {
  name: string;
  role: string;
  email: string;
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

interface UnitFormState {
  code: string;
  category: UnitCategory;
}

interface ManometerFormState {
  code: string;
  scale: string;
  calibrationCertCode: string;
  calibratedAt: string;
  expiresAt: string;
}

interface CounterFormState {
  code: string;
  serialNumber: string;
  calibratedAt: string;
  expiresAt: string;
}

const internalRoles: Array<Exclude<UserRole, 'CLIENT'>> = ['COLLABORATOR', 'COORDINATOR', 'MANAGER'];
const emptyProjectForm: ProjectFormState = {
  code: '',
  name: '',
  clientName: '',
  clientCnpj: '',
  clientEmailPrimary: '',
  clientEmailCc: '',
  clientSigners: [],
  contractCode: '',
  location: '',
  operatorId: '',
  visibleToCollaborators: true,
  isActive: true,
  workdayHours: '09:00',
  weekendWorkdayHours: '08:00',
  includesSaturday: false,
  includesSunday: false
};

const emptyCollaboratorForm: CollaboratorFormState = {
  name: '',
  role: '',
  email: '',
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

const emptyUnitForm: UnitFormState = {
  code: '',
  category: 'FILTRAGEM'
};

const emptyManometerForm: ManometerFormState = {
  code: '',
  scale: '',
  calibrationCertCode: '',
  calibratedAt: '',
  expiresAt: ''
};

const emptyCounterForm: CounterFormState = {
  code: '',
  serialNumber: '',
  calibratedAt: '',
  expiresAt: ''
};

function groupUnits(units: Unit[]) {
  return units.reduce<Record<string, Unit[]>>((acc, unit) => {
    if (!acc[unit.category]) acc[unit.category] = [];
    acc[unit.category].push(unit);
    return acc;
  }, {});
}

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
      name: signer.name.trim(),
      email: signer.email.trim().toLowerCase()
    }))
    .filter(signer => signer.name && signer.email)
    .filter(signer => {
      if (seen.has(signer.email)) return false;
      seen.add(signer.email);
      return true;
    });
}

function defaultSignerName(email: string) {
  return email.split('@')[0] || email;
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

function formatUnitCategory(category: UnitCategory) {
  const labels: Record<UnitCategory, string> = {
    FILTRAGEM: 'Filtragem',
    FLUSHING: 'Flushing',
    LIMPEZA_QUIMICA: 'Limpeza química',
    DESIDRATACAO: 'Desidratação',
    UTH: 'UTH',
    OUTRA: 'Outra'
  };

  return labels[category] || category;
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

function normalizeSearchValue(value: unknown) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function matchesSearch(parts: unknown[], query: string) {
  const term = normalizeSearchValue(query.trim());
  if (!term) return true;
  return normalizeSearchValue(parts.join(' ')).includes(term);
}

function projectSearchParts(project: Project) {
  return [
    project.code,
    project.name,
    project.clientName,
    project.clientCnpj,
    project.clientEmailPrimary,
    ...(project.clientEmailCc || []),
    ...(project.clientSigners || []).flatMap(signer => [signer.name, signer.email]),
    project.contractCode,
    project.location,
    project.operator?.name,
    formatProjectSequences(project)
  ];
}

function reportSearchParts(report: ReportSummary) {
  return [
    report.reportType,
    report.sequenceNumber,
    report.status,
    report.reportDate,
    report.project?.code,
    report.project?.name,
    report.project?.clientName,
    report.project?.clientCnpj,
    report.createdBy?.name,
    report.createdBy?.collaborator?.name,
    ...(report.collaborators || []).map(item => item.collaborator?.name),
    ...(report.services || []).flatMap(service => [
      service.serviceType,
      service.equipment?.code,
      service.equipment?.name,
      service.system,
      service.material
    ])
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

function unitSearchParts(unit: Unit) {
  return [unit.code, formatUnitCategory(unit.category)];
}

function manometerSearchParts(item: Manometer) {
  return [item.code, item.scale, item.calibrationCertCode, formatDate(item.calibratedAt), formatDate(item.expiresAt)];
}

function counterSearchParts(item: ParticleCounter) {
  return [item.code, item.serialNumber, formatDate(item.calibratedAt), formatDate(item.expiresAt)];
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
    .map(signer => [signer.name, signer.email].filter(Boolean).join(' - '))
    .filter(Boolean)
    .join(', ');
}

function formatProjectSequences(project: Project) {
  const sequences = project.reportSequences || [];
  if (!sequences.length) return 'Sem sequenciais cadastrados';
  return sequences
    .map(sequence => `${sequence.reportType}: próximo ${sequence.nextNumber}`)
    .join(', ');
}

function projectToForm(project: Project): ProjectFormState {
  return {
    code: project.code,
    name: project.name,
    clientName: project.clientName,
    clientCnpj: project.clientCnpj,
    clientEmailPrimary: project.clientEmailPrimary || '',
    clientEmailCc: parseEmailList([...(project.clientEmailCc || []), ...(project.clientSigners || []).map(signer => signer.email)].join('\n')).join('\n'),
    clientSigners: (project.clientSigners || []).map(signer => ({
      name: signer.name || '',
      email: signer.email || ''
    })),
    contractCode: project.contractCode,
    location: project.location,
    operatorId: project.operatorId || '',
    visibleToCollaborators: project.visibleToCollaborators,
    isActive: project.isActive,
    workdayHours: project.workdayHours || '09:00',
    weekendWorkdayHours: project.weekendWorkdayHours || '08:00',
    includesSaturday: project.includesSaturday ?? false,
    includesSunday: project.includesSunday ?? false
  };
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
          : [...current.clientSigners, { email: normalizedEmail, name: defaultSignerName(normalizedEmail) }]
      };
    });
  }

  function updateSignerName(email: string, name: string) {
    setForm(current => ({
      ...current,
      clientSigners: current.clientSigners.map(signer => (
        signer.email.trim().toLowerCase() === email ? { ...signer, name } : signer
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
                    <input
                      className="cc-name-input"
                      type="text"
                      value={signer.name}
                      placeholder="Nome do assinante"
                      onChange={event => updateSignerName(email, event.target.value)}
                    />
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

function collaboratorToForm(collaborator: Collaborator): CollaboratorFormState {
  return {
    name: collaborator.name,
    role: collaborator.role,
    email: collaborator.email || '',
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

function unitToForm(unit: Unit): UnitFormState {
  return {
    code: unit.code,
    category: unit.category
  };
}

function toDateInput(value?: string | null) {
  if (!value) return '';
  return new Date(value).toISOString().slice(0, 10);
}

function manometerToForm(item: Manometer): ManometerFormState {
  return {
    code: item.code,
    scale: item.scale,
    calibrationCertCode: item.calibrationCertCode,
    calibratedAt: toDateInput(item.calibratedAt),
    expiresAt: toDateInput(item.expiresAt)
  };
}

function counterToForm(item: ParticleCounter): CounterFormState {
  return {
    code: item.code,
    serialNumber: item.serialNumber,
    calibratedAt: toDateInput(item.calibratedAt),
    expiresAt: toDateInput(item.expiresAt)
  };
}

function renderProjectCard(
  project: Project,
  options: {
    onEdit: (project: Project) => void;
    onToggleArchive: (project: Project) => void;
    onRemove: (project: Project) => void;
    detailsExpanded: boolean;
    onToggleDetails: (project: Project) => void;
    reportSectionExpanded?: boolean;
    reportCount?: number;
    onToggleReports?: (project: Project) => void;
    children?: ReactNode;
  }
) {
  return (
    <article className="card admin-card project-admin-card" key={project.id}>
      <div className="project-admin-head">
        {options.onToggleReports ? (
          <button className="project-admin-toggle" type="button" onClick={() => options.onToggleReports?.(project)}>
            <span className="project-admin-title">{project.code} - {project.name}</span>
            <span className="rtype-count">{options.reportCount || 0} relatório{options.reportCount === 1 ? '' : 's'}</span>
            <span className="rtype-chevron">{options.reportSectionExpanded ? '▾' : '▸'}</span>
          </button>
        ) : (
          <div className="project-admin-title">
            {project.code} - {project.name}
          </div>
        )}
        <span className={`badge ${(project.includesSaturday || project.includesSunday) ? 'badge-ok' : 'badge-pen'}`}>
          {(project.includesSaturday || project.includesSunday) ? 'Escala estendida' : 'Escala padrão'}
        </span>
      </div>
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
          <div className="det-row">
            <span className="det-label">Operador</span>
            <span className="det-val">{project.operator?.name || '-'}</span>
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
        <button className="mini-btn danger" type="button" onClick={() => options.onRemove(project)}>
          Remover
        </button>
        {!project.isActive ? (
          <span className="badge badge-rev">Arquivado</span>
        ) : null}
      </div>
    </article>
  );
}

export function GestorPage() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const { hydrate, reset } = useRdoStore();
  const showToast = useToast();
  const [tab, setTab] = useState<GestorTab>('pendentes');
  const [gestorSearch, setGestorSearch] = useState('');
  const projectDetailsStorageKey = `gestor-project-details-collapsed:${user?.id || 'anonymous'}`;
  const [collapsedProjectDetailIds, setCollapsedProjectDetailIds] = useState<string[]>([]);

  const [projectForm, setProjectForm] = useState<ProjectFormState>(emptyProjectForm);
  const [projectEditingId, setProjectEditingId] = useState<string | null>(null);
  const [showProjectForm, setShowProjectForm] = useState(false);

  const [collaboratorForm, setCollaboratorForm] = useState<CollaboratorFormState>(emptyCollaboratorForm);
  const [collaboratorEditingId, setCollaboratorEditingId] = useState<string | null>(null);
  const [showCollaboratorForm, setShowCollaboratorForm] = useState(false);

  const [userForm, setUserForm] = useState<UserFormState>(emptyUserForm);
  const [userEditingId, setUserEditingId] = useState<string | null>(null);
  const [showUserForm, setShowUserForm] = useState(false);
  const [userAdminGroup, setUserAdminGroup] = useState<'internal' | 'client'>('internal');

  const [unitForm, setUnitForm] = useState<UnitFormState>(emptyUnitForm);
  const [unitEditingId, setUnitEditingId] = useState<string | null>(null);
  const [showUnitForm, setShowUnitForm] = useState(false);

  const [manometerForm, setManometerForm] = useState<ManometerFormState>(emptyManometerForm);
  const [manometerEditingId, setManometerEditingId] = useState<string | null>(null);
  const [showManometerForm, setShowManometerForm] = useState(false);

  const [counterForm, setCounterForm] = useState<CounterFormState>(emptyCounterForm);
  const [counterEditingId, setCounterEditingId] = useState<string | null>(null);
  const [showCounterForm, setShowCounterForm] = useState(false);
  const [returnReport, setReturnReport] = useState<ReportSummary | null>(null);
  const [selectedReportIds, setSelectedReportIds] = useState<string[]>([]);
  const [projectSortDir, setProjectSortDir] = useState<'asc' | 'desc'>('asc');
  const [closedArchivedProjectIds, setClosedArchivedProjectIds] = useState<string[]>([]);
  const [closedArchivedTypeKeys, setClosedArchivedTypeKeys] = useState<string[]>([]);
  const [archivedTypeSortDirections, setArchivedTypeSortDirections] = useState<Record<string, 'asc' | 'desc'>>({});

  const reportsQuery = useReports();
  const draftsQuery = useDrafts();
  const activeProjectsQuery = useProjects(true);
  const archivedProjectsQuery = useProjects(false);
  const collaboratorsQuery = useCollaborators();
  const internalUsersQuery = useUsers('internal');
  const clientUsersQuery = useUsers('client');
  const unitsQuery = useUnits();
  const manometersQuery = useManometers();
  const countersQuery = useCounters();

  const projectMutations = useProjectMutations();
  const reportMutations = useReportMutations();
  const draftMutations = useDraftMutations();
  const collaboratorMutations = useCollaboratorMutations();
  const userMutations = useUserMutations();
  const unitMutations = useUnitMutations();
  const manometerMutations = useManometerMutations();
  const counterMutations = useCounterMutations();

  const pendingReports = useMemo(
    () => (reportsQuery.data || []).filter(report => report.status === 'PENDING' || report.status === 'RETURNED'),
    [reportsQuery.data]
  );

  const approvedReports = useMemo(
    () =>
      (reportsQuery.data || []).filter(
        report =>
          (report.status === 'APPROVED' || report.status === 'SIGNED') && report.project?.isActive !== false
      ),
    [reportsQuery.data]
  );

  const archivedReports = useMemo(
    () =>
      (reportsQuery.data || []).filter(
        report =>
          (report.status === 'APPROVED' || report.status === 'SIGNED') && report.project?.isActive === false
      ),
    [reportsQuery.data]
  );

  const clientGroupingProjects = useMemo(
    () => [...(activeProjectsQuery.data || []), ...(archivedProjectsQuery.data || [])],
    [activeProjectsQuery.data, archivedProjectsQuery.data]
  );

  useEffect(() => {
    setGestorSearch('');
  }, [tab]);

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

  async function handleLogout() {
    await logout();
    navigate('/', { replace: true });
  }

  function handleNewReport() {
    reset();
    navigate('/relatorio/novo');
  }

  function handleResumeDraft(draft: ReportDraft) {
    const payload = draft.payload || {};

    hydrate({
      draftId: draft.id,
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

    navigate('/relatorio/novo');
  }

  function resetProjectForm() {
    setProjectForm(emptyProjectForm);
    setProjectEditingId(null);
    setShowProjectForm(false);
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

  function resetUnitForm() {
    setUnitForm(emptyUnitForm);
    setUnitEditingId(null);
    setShowUnitForm(false);
  }

  function resetManometerForm() {
    setManometerForm(emptyManometerForm);
    setManometerEditingId(null);
    setShowManometerForm(false);
  }

  function resetCounterForm() {
    setCounterForm(emptyCounterForm);
    setCounterEditingId(null);
    setShowCounterForm(false);
  }

  async function handleProjectSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const payload = {
      code: projectForm.code.trim(),
      name: projectForm.name.trim(),
      clientName: projectForm.clientName.trim(),
      clientCnpj: projectForm.clientCnpj.trim(),
      clientEmailPrimary: projectForm.clientEmailPrimary.trim().toLowerCase(),
      clientEmailCc: parseEmailList(projectForm.clientEmailCc),
      clientSigners: cleanSigners(projectForm.clientSigners),
      contractCode: projectForm.contractCode.trim(),
      location: projectForm.location.trim(),
      visibleToCollaborators: projectForm.visibleToCollaborators,
      isActive: projectForm.isActive,
      operatorId: projectForm.operatorId || null,
      workdayHours: projectForm.workdayHours || '09:00',
      weekendWorkdayHours: projectForm.weekendWorkdayHours || '08:00',
      includesSaturday: projectForm.includesSaturday,
      includesSunday: projectForm.includesSunday
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

  async function handleProjectToggleArchive(project: Project) {
    try {
      await projectMutations.updateProject.mutateAsync({
        id: project.id,
        payload: { isActive: !project.isActive }
      });
      showToast(project.isActive ? 'Projeto arquivado.' : 'Projeto desarquivado.', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Não foi possível atualizar o projeto.', 'error');
    }
  }

  async function handleProjectRemove(project: Project) {
    if (!window.confirm('Remover este projeto?')) return;

    try {
      await projectMutations.removeProject.mutateAsync(project.id);
      if (projectEditingId === project.id) resetProjectForm();
      showToast('Projeto removido.', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Não foi possível remover o projeto.', 'error');
    }
  }

  async function handleCollaboratorSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const payload = {
      name: collaboratorForm.name.trim(),
      role: collaboratorForm.role.trim(),
      email: collaboratorForm.email.trim() || null,
      isActive: collaboratorForm.isActive
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

  async function handleUnitSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const payload = {
      code: unitForm.code.trim(),
      category: unitForm.category
    };

    try {
      if (unitEditingId) {
        await unitMutations.updateUnit.mutateAsync({ id: unitEditingId, payload });
        showToast('Unidade atualizada.', 'success');
      } else {
        await unitMutations.createUnit.mutateAsync(payload);
        showToast('Unidade criada.', 'success');
      }
      resetUnitForm();
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Não foi possível salvar a unidade.', 'error');
    }
  }

  async function handleUnitDelete(id: string) {
    try {
      await unitMutations.removeUnit.mutateAsync(id);
      showToast('Unidade removida.', 'success');
      if (unitEditingId === id) resetUnitForm();
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Não foi possível remover a unidade.', 'error');
    }
  }

  async function handleManometerSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const payload = {
      code: manometerForm.code.trim(),
      scale: manometerForm.scale.trim(),
      calibrationCertCode: manometerForm.calibrationCertCode.trim(),
      calibratedAt: manometerForm.calibratedAt,
      expiresAt: manometerForm.expiresAt
    };

    try {
      if (manometerEditingId) {
        await manometerMutations.updateManometer.mutateAsync({ id: manometerEditingId, payload });
        showToast('Manômetro atualizado.', 'success');
      } else {
        await manometerMutations.createManometer.mutateAsync(payload);
        showToast('Manômetro criado.', 'success');
      }
      resetManometerForm();
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Não foi possível salvar o manômetro.', 'error');
    }
  }

  async function handleManometerDeactivate(id: string) {
    try {
      await manometerMutations.removeManometer.mutateAsync(id);
      showToast('Manômetro removido.', 'success');
      if (manometerEditingId === id) resetManometerForm();
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Não foi possível remover o manômetro.', 'error');
    }
  }

  async function handleCounterSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const payload = {
      code: counterForm.code.trim(),
      serialNumber: counterForm.serialNumber.trim(),
      calibratedAt: counterForm.calibratedAt,
      expiresAt: counterForm.expiresAt
    };

    try {
      if (counterEditingId) {
        await counterMutations.updateCounter.mutateAsync({ id: counterEditingId, payload });
        showToast('Contador atualizado.', 'success');
      } else {
        await counterMutations.createCounter.mutateAsync(payload);
        showToast('Contador criado.', 'success');
      }
      resetCounterForm();
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Não foi possível salvar o contador.', 'error');
    }
  }

  async function handleCounterDeactivate(id: string) {
    try {
      await counterMutations.removeCounter.mutateAsync(id);
      showToast('Contador removido.', 'success');
      if (counterEditingId === id) resetCounterForm();
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Não foi possível remover o contador.', 'error');
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
    const fileName = `${report.reportType}_${report.sequenceNumber || report.id}.${format}`;
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
    if (!window.confirm('Excluir este relatório permanentemente?')) return;

    try {
      await reportMutations.deleteReport.mutateAsync(report.id);
      setSelectedReportIds(current => current.filter(id => id !== report.id));
      showToast('Relatório excluído.', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Não foi possível excluir o relatório.', 'error');
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

    return (
      <>
        <span className="report-download-actions">
          <button className="mini-btn alt" type="button" onClick={() => void handleReportDownload(report, 'pdf')}>
            PDF
          </button>
          <button className="mini-btn alt" type="button" onClick={() => void handleReportDownload(report, 'docx')}>
            DOCX
          </button>
        </span>
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
            className="icon-button danger-icon-button"
            type="button"
            title="Excluir relatório"
            aria-label="Excluir relatório"
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
        renderTypeActions={renderBatchReportActions}
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

    return Object.entries(byType)
      .sort(([a], [b]) => compareReportTypes(a, b))
      .map(([reportType, typeReports]) => {
        const typeKey = `${projectId || 'project'}-${reportType}`;
        const typeClosed = closedArchivedTypeKeys.includes(typeKey);
        const typeSortDirection = archivedTypeSortDirections[typeKey] || 'asc';

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
                {typeReports.length} relatório{typeReports.length !== 1 ? 's' : ''}
              </span>
              <span onClick={event => event.stopPropagation()}>
                <ProjectSortButton direction={typeSortDirection} onToggle={() => toggleArchivedTypeSort(typeKey)} />
              </span>
              <span className="rtype-chevron">{typeClosed ? '▸' : '▾'}</span>
            </div>
            {!typeClosed ? (
              <div className="report-type-list">
                {sortReportsInGroup(typeReports, typeSortDirection).map(report => (
                  <ReportSummaryCard key={report.id} report={report} actions={renderManagerReportActions(report)} />
                ))}
              </div>
            ) : null}
          </div>
        );
      });
  }

  function renderReportTabContent() {
    const sourceReports =
      tab === 'pendentes' ? pendingReports : tab === 'arquivados' ? archivedReports : approvedReports;
    const visibleReports =
      tab === 'aprovados' || tab === 'arquivados'
        ? sourceReports.filter(report => matchesSearch(reportSearchParts(report), gestorSearch))
        : sourceReports;

    if (reportsQuery.isLoading) return <div className="page-card placeholder-copy">Carregando relatórios...</div>;

    const topActions = (
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginBottom: 12 }}>
        <ProjectSortButton
          direction={projectSortDir}
          onToggle={() => setProjectSortDir(direction => direction === 'asc' ? 'desc' : 'asc')}
        />
        {tab === 'pendentes' ? (
          <button className="mini-btn" type="button" onClick={handleNewReport}>
            + Criar Relatório
          </button>
        ) : null}
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

    return (
      <>
        {topActions}
        {draftsBlock}
        {renderProjectReportGroups(visibleReports)}
        {reasonDialog}
      </>
    );
  }

  function renderProjectsTab() {
    const activeProjects = (activeProjectsQuery.data || [])
      .filter(project => project.isActive !== false)
      .filter(project => matchesSearch(projectSearchParts(project), gestorSearch));

    if (activeProjectsQuery.isLoading) {
      return <div className="page-card placeholder-copy">Carregando projetos...</div>;
    }

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
                <div className="field-group">
                  <label htmlFor="project-visible">Exibir para colaboradores</label>
                  <select id="project-visible" value={projectForm.visibleToCollaborators ? 'true' : 'false'} onChange={event => setProjectForm(current => ({ ...current, visibleToCollaborators: event.target.value === 'true' }))}>
                    <option value="true">Sim</option>
                    <option value="false">Não</option>
                  </select>
                </div>
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

        {activeProjects.length ? (
          <div className="admin-stack">
            {sortProjects(activeProjects, projectSortDir).map(project =>
              renderProjectCard(project, {
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
                      <div className="field-group">
                        <label htmlFor={`project-visible-${project.id}`}>Exibir para colaboradores</label>
                        <select id={`project-visible-${project.id}`} value={projectForm.visibleToCollaborators ? 'true' : 'false'} onChange={event => setProjectForm(current => ({ ...current, visibleToCollaborators: event.target.value === 'true' }))}>
                          <option value="true">Sim</option>
                          <option value="false">Não</option>
                        </select>
                      </div>
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
                onToggleDetails: toggleProjectDetails
              })
            )}
          </div>
        ) : (
          <div className="card admin-card">
            <div className="placeholder-copy">Nenhum projeto ativo.</div>
          </div>
        )}

      </>
    );
  }

  function renderArchivedProjectsTab() {
    const archivedProjects = (archivedProjectsQuery.data || []).filter(project => project.isActive === false);

    if (archivedProjectsQuery.isLoading || reportsQuery.isLoading) {
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
          visible: projectMatches || filteredProjectReports.length > 0
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
                onToggleReports: item => toggleArchivedProject(item.id)
              });
            })}
          </div>
        ) : (
          <p className="placeholder-copy">
            {gestorSearch.trim() ? 'Nenhum projeto arquivado encontrado.' : 'Nenhum projeto arquivado.'}
          </p>
        )}
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
                onClick={() => {
                  setShowCollaboratorForm(true);
                }}
              >
                + Novo colaborador
              </button>
            ) : null}
          </div>
          {showCollaboratorForm && !collaboratorEditingId ? (
          <form className="admin-inline-form admin-form-grid" onSubmit={handleCollaboratorSubmit}>
            <div className="admin-toolbar full">
              <div className="sec">Novo colaborador</div>
              <button className="mini-btn alt" type="button" onClick={resetCollaboratorForm}>Cancelar</button>
            </div>
            <div className="field-group">
              <label htmlFor="collaborator-name">Nome</label>
              <input
                id="collaborator-name"
                value={collaboratorForm.name}
                onChange={event => setCollaboratorForm(current => ({ ...current, name: event.target.value }))}
                required
              />
            </div>
            <div className="field-group">
              <label htmlFor="collaborator-role">Cargo</label>
              <input
                id="collaborator-role"
                value={collaboratorForm.role}
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
                onChange={event => setCollaboratorForm(current => ({ ...current, email: event.target.value }))}
              />
            </div>
            <label className="checkbox-line">
              <input
                type="checkbox"
                checked={collaboratorForm.isActive}
                onChange={event => setCollaboratorForm(current => ({ ...current, isActive: event.target.checked }))}
              />
              Colaborador ativo
            </label>
            <div className="admin-form-actions">
              <button
                className="mini-btn"
                type="submit"
                disabled={
                  collaboratorMutations.createCollaborator.isPending ||
                  collaboratorMutations.updateCollaborator.isPending
                }
              >
                {collaboratorEditingId ? 'Salvar colaborador' : 'Criar colaborador'}
              </button>
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
                    <div className="admin-actions">
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
                    <form className="admin-inline-form admin-form-grid" onSubmit={handleCollaboratorSubmit}>
                      <div className="field-group">
                        <label>Nome</label>
                        <input value={collaboratorForm.name} onChange={event => setCollaboratorForm(current => ({ ...current, name: event.target.value }))} required />
                      </div>
                      <div className="field-group">
                        <label>Cargo</label>
                        <input value={collaboratorForm.role} onChange={event => setCollaboratorForm(current => ({ ...current, role: event.target.value }))} required />
                      </div>
                      <div className="field-group">
                        <label>E-mail</label>
                        <input type="email" value={collaboratorForm.email} onChange={event => setCollaboratorForm(current => ({ ...current, email: event.target.value }))} />
                      </div>
                      <div className="admin-form-actions">
                        <button className="mini-btn" type="submit" disabled={collaboratorMutations.updateCollaborator.isPending}>Salvar colaborador</button>
                        <button className="mini-btn alt" type="button" onClick={resetCollaboratorForm}>Cancelar edição</button>
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
          <div className="filter-tabs">
            <button
              className={`filter-tab ${showInternal ? 'active' : ''}`}
              type="button"
              onClick={() => {
                setUserAdminGroup('internal');
              }}
            >
              Internos
            </button>
            <button
              className={`filter-tab ${!showInternal ? 'active' : ''}`}
              type="button"
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
                onClick={() => {
                  setShowUserForm(true);
                }}
              >
                + Novo usuário
              </button>
          ) : null}
          </div>
          {showUserForm && !userEditingId ? (
          <form className="admin-inline-form admin-form-grid" onSubmit={handleUserSubmit}>
            <div className="admin-toolbar full">
              <div className="sec">Novo usuário</div>
              <button className="mini-btn alt" type="button" onClick={resetUserForm}>Cancelar</button>
            </div>
            <div className="field-group">
              <label htmlFor="user-username">Usuário</label>
              <input
                id="user-username"
                value={userForm.username}
                onChange={event => setUserForm(current => ({ ...current, username: event.target.value }))}
                required
              />
            </div>
            <div className="field-group">
              <label htmlFor="user-name">Nome</label>
              <input
                id="user-name"
                value={userForm.name}
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
                onChange={event => setUserForm(current => ({ ...current, email: event.target.value }))}
              />
            </div>
            <div className="field-group">
              <label htmlFor="user-password">
                {userEditingId ? 'Nova senha (opcional)' : 'Senha'}
              </label>
              <input
                id="user-password"
                type="password"
                value={userForm.password}
                onChange={event => setUserForm(current => ({ ...current, password: event.target.value }))}
                required={!userEditingId}
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
              <label htmlFor="user-collaborator">Colaborador vinculado</label>
              <select
                id="user-collaborator"
                value={userForm.collaboratorId}
                onChange={event => setUserForm(current => ({ ...current, collaboratorId: event.target.value }))}
              >
                <option value="">Nenhum</option>
                {(collaboratorsQuery.data || [])
                  .filter(item => item.isActive)
                  .map(item => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
              </select>
            </div>
            <label className="checkbox-line">
              <input
                type="checkbox"
                checked={userForm.isActive}
                onChange={event => setUserForm(current => ({ ...current, isActive: event.target.checked }))}
              />
              Usuário ativo
            </label>
            <div className="admin-form-actions">
              <button
                className="mini-btn"
                type="submit"
                disabled={userMutations.createUser.isPending || userMutations.updateUser.isPending}
              >
                {userEditingId ? 'Salvar usuário' : 'Criar usuário'}
              </button>
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
                    <form className="admin-inline-form admin-form-grid" onSubmit={handleUserSubmit}>
                      <div className="admin-toolbar full">
                        <div className="sec">Editar usuário</div>
                        <button className="mini-btn alt" type="button" onClick={resetUserForm}>Cancelar</button>
                      </div>
                      <div className="field-group"><label>Usuário</label><input value={userForm.username} onChange={event => setUserForm(current => ({ ...current, username: event.target.value }))} required readOnly /></div>
                      <div className="field-group"><label>Nome</label><input value={userForm.name} onChange={event => setUserForm(current => ({ ...current, name: event.target.value }))} required /></div>
                      <div className="field-group"><label>E-mail</label><input type="email" value={userForm.email} onChange={event => setUserForm(current => ({ ...current, email: event.target.value }))} /></div>
                      <div className="field-group"><label>Nova senha (opcional)</label><input type="password" value={userForm.password} onChange={event => setUserForm(current => ({ ...current, password: event.target.value }))} /></div>
                      <div className="field-group">
                        <label>Perfil</label>
                        <select value={userForm.role} onChange={event => setUserForm(current => ({ ...current, role: event.target.value as Exclude<UserRole, 'CLIENT'> }))}>
                          {internalRoles.map(role => <option key={role} value={role}>{formatUserRole(role)}</option>)}
                        </select>
                      </div>
                      <div className="field-group">
                        <label>Colaborador vinculado</label>
                        <select value={userForm.collaboratorId} onChange={event => setUserForm(current => ({ ...current, collaboratorId: event.target.value }))}>
                          <option value="">Nenhum</option>
                          {(collaboratorsQuery.data || [])
                            .filter(collaborator => collaborator.isActive)
                            .map(collaborator => (
                              <option key={collaborator.id} value={collaborator.id}>
                                {collaborator.name}
                              </option>
                            ))}
                        </select>
                      </div>
                      <label className="checkbox-line">
                        <input
                          type="checkbox"
                          checked={userForm.isActive}
                          onChange={event => setUserForm(current => ({ ...current, isActive: event.target.checked }))}
                        />
                        Usuário ativo
                      </label>
                      <div className="admin-form-actions">
                        <button className="mini-btn" type="submit" disabled={userMutations.updateUser.isPending}>Salvar usuário</button>
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
        <section className="page-card">
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

            const projectLabelForCnpj = (cnpj: string) => {
              const project = clientGroupingProjects.find(item => item.clientCnpj.replace(/\D/g, '') === cnpj);
              if (!project) return '';
              const projectName = [project.code, project.name].filter(Boolean).join(' - ');
              return projectName || project.clientName || project.name;
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
                if (!groups[cnpj]) groups[cnpj] = { cnpj, clientName: projectLabelForCnpj(cnpj), primary: null, cc: [] };
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
                <div className="card admin-card" key={item.id}>
                  <div className="admin-item-row">
                    <div className="admin-item-main">
                      <div className="admin-item-title">{item.name || 'Cliente'}</div>
                      <div className="admin-item-sub">{item.email || item.username}{item.isActive === false ? ' - Inativo' : ''}</div>
                    </div>
                    <div className="admin-actions">
                      {isCc ? <span className="status-pill status-pending" style={{ fontSize: 10 }}>CC / Assinante</span> : null}
                      <span className={`status-pill ${item.isActive ? 'status-approved' : 'status-returned'}`}>{item.isActive ? 'Ativo' : 'Inativo'}</span>
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
                {Object.values(groups).map(g => (
                  <article className="card admin-card" key={g.cnpj}>
                    <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 2 }}>
                      {g.clientName || projectLabelForCnpj(g.cnpj) || g.cnpj}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--mu)', marginBottom: 4 }}>{formatCnpj(g.cnpj)}</div>
                    {g.primary ? renderClientCard(g.primary, false) : null}
                    {g.cc.map(u => renderClientCard(u, true))}
                  </article>
                ))}
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

  function renderEquipamentosTab() {
    const units = (unitsQuery.data || [])
      .filter(item => matchesSearch(unitSearchParts(item), gestorSearch));
    const visibleGroupedUnits = groupUnits(units);

    if (unitsQuery.isLoading) {
      return <div className="page-card placeholder-copy">Carregando unidades...</div>;
    }

    return units.length ? (
      <div className="admin-stack">
        {Object.entries(visibleGroupedUnits).map(([category, categoryUnits]) => (
          <article className="card admin-card" key={category}>
            <div className="admin-section-head admin-card-toolbar">
              <div className="admin-card-title">{formatUnitCategory(category as UnitCategory)}</div>
              <button
                className="mini-btn alt"
                type="button"
                onClick={() => {
                  setUnitEditingId(null);
                  setShowUnitForm(true);
                  setUnitForm({ code: '', category: category as UnitCategory });
                }}
              >
                + Nova unidade
              </button>
            </div>
            {showUnitForm && !unitEditingId && unitForm.category === category ? (
              <form className="admin-inline-form admin-form-grid" onSubmit={handleUnitSubmit}>
                <div className="field-group">
                  <label>Código</label>
                  <input
                    value={unitForm.code}
                    onChange={event => setUnitForm(current => ({ ...current, code: event.target.value }))}
                    required
                  />
                </div>
                <div className="field-group">
                  <label>Categoria</label>
                  <input value={formatUnitCategory(category as UnitCategory)} readOnly />
                </div>
                <div className="admin-form-actions">
                  <button
                    className="mini-btn"
                    type="submit"
                    disabled={unitMutations.createUnit.isPending || unitMutations.updateUnit.isPending}
                  >
                    Criar unidade
                  </button>
                  <button className="mini-btn alt" type="button" onClick={resetUnitForm}>
                    Cancelar
                  </button>
                </div>
              </form>
            ) : null}
            <div className="admin-list">
              {categoryUnits.map(unit => (
                <div className="admin-list-row" key={unit.id}>
                  <span>{unit.code}</span>
                  <div className="admin-card-actions">
                    <button
                      className="mini-btn alt"
                      type="button"
                      onClick={() => {
                        setUnitEditingId(unit.id);
                        setShowUnitForm(true);
                        setUnitForm(unitToForm(unit));
                      }}
                    >
                      Editar
                    </button>
                    <button className="mini-btn danger" type="button" onClick={() => void handleUnitDelete(unit.id)}>
                      Remover
                    </button>
                  </div>
                  {unitEditingId === unit.id ? (
                    <form className="admin-inline-form admin-form-grid" onSubmit={handleUnitSubmit}>
                      <div className="field-group"><label>Código</label><input value={unitForm.code} onChange={event => setUnitForm(current => ({ ...current, code: event.target.value }))} required /></div>
                      <div className="field-group"><label>Categoria</label><input value={formatUnitCategory(unit.category)} readOnly /></div>
                      <div className="admin-form-actions">
                        <button className="mini-btn" type="submit" disabled={unitMutations.updateUnit.isPending}>Salvar unidade</button>
                        <button className="mini-btn alt" type="button" onClick={resetUnitForm}>Cancelar edição</button>
                      </div>
                    </form>
                  ) : null}
                </div>
              ))}
            </div>
          </article>
        ))}
      </div>
    ) : (
      <div className="card admin-card">
        <p className="placeholder-copy">Nenhuma unidade cadastrada.</p>
      </div>
    );
  }

  function renderManometrosTab() {
    const manometers = (manometersQuery.data || [])
      .filter(item => item.isActive !== false)
      .filter(item => matchesSearch(manometerSearchParts(item), gestorSearch));

    if (manometersQuery.isLoading) {
      return <div className="page-card placeholder-copy">Carregando manômetros...</div>;
    }

    return (
      <>
        <div className="admin-toolbar">
          <div className="sec">{manometerEditingId ? 'Editar manômetro' : 'Manômetros'}</div>
          {!showManometerForm && !manometerEditingId ? (
            <button
              className="mini-btn"
              type="button"
              onClick={() => {
                setShowManometerForm(true);
              }}
            >
              + Novo manômetro
            </button>
          ) : null}
        </div>
          {showManometerForm && !manometerEditingId ? (
          <form className="admin-inline-form admin-form-grid" onSubmit={handleManometerSubmit}>
            <div className="field-group">
              <label htmlFor="manometer-code">Código</label>
              <input
                id="manometer-code"
                value={manometerForm.code}
                onChange={event => setManometerForm(current => ({ ...current, code: event.target.value }))}
                required
              />
            </div>
            <div className="field-group">
              <label htmlFor="manometer-scale">Escala</label>
              <input
                id="manometer-scale"
                value={manometerForm.scale}
                onChange={event => setManometerForm(current => ({ ...current, scale: event.target.value }))}
                required
              />
            </div>
            <div className="field-group">
              <label htmlFor="manometer-cert">Certificado</label>
              <input
                id="manometer-cert"
                value={manometerForm.calibrationCertCode}
                onChange={event =>
                  setManometerForm(current => ({ ...current, calibrationCertCode: event.target.value }))
                }
                required
              />
            </div>
            <div className="field-group">
              <label htmlFor="manometer-calibrated">Calibração</label>
              <input
                id="manometer-calibrated"
                type="date"
                value={manometerForm.calibratedAt}
                onChange={event => setManometerForm(current => ({ ...current, calibratedAt: event.target.value }))}
                required
              />
            </div>
            <div className="field-group">
              <label htmlFor="manometer-expires">Vencimento</label>
              <input
                id="manometer-expires"
                type="date"
                value={manometerForm.expiresAt}
                onChange={event => setManometerForm(current => ({ ...current, expiresAt: event.target.value }))}
                required
              />
            </div>
            <div className="admin-form-actions">
              <button
                className="mini-btn"
                type="submit"
                disabled={manometerMutations.createManometer.isPending || manometerMutations.updateManometer.isPending}
              >
                {manometerEditingId ? 'Salvar manômetro' : 'Criar manômetro'}
              </button>
              {manometerEditingId ? (
                <button className="mini-btn alt" type="button" onClick={resetManometerForm}>
                  Cancelar edição
                </button>
              ) : (
                <button className="mini-btn alt" type="button" onClick={resetManometerForm}>
                  Cancelar
                </button>
              )}
            </div>
          </form>
          ) : null}

          {manometers.length ? (
            <div className="admin-stack">
              {manometers.map(item => (
                <article className="card admin-card" key={item.id}>
                  <div className="admin-item-row">
                    <div className="admin-item-main">
                      <div className="admin-item-title">{item.code} - {item.scale}</div>
                      <div className="admin-item-sub">
                        Certificado {item.calibrationCertCode} - Calibração: {formatDate(item.calibratedAt)} - Vencimento: {formatDate(item.expiresAt)}
                      </div>
                    </div>
                    <div className="admin-actions">
                      <button
                        className="mini-btn alt"
                        type="button"
                        onClick={() => {
                          setManometerEditingId(item.id);
                          setShowManometerForm(true);
                          setManometerForm(manometerToForm(item));
                        }}
                      >
                        Editar
                      </button>
                      <button className="mini-btn danger" type="button" onClick={() => void handleManometerDeactivate(item.id)}>
                        Remover
                      </button>
                    </div>
                  </div>
                  {manometerEditingId === item.id ? (
                    <form className="admin-inline-form admin-form-grid" onSubmit={handleManometerSubmit}>
                      <div className="field-group"><label>Código</label><input value={manometerForm.code} onChange={event => setManometerForm(current => ({ ...current, code: event.target.value }))} required /></div>
                      <div className="field-group"><label>Escala</label><input value={manometerForm.scale} onChange={event => setManometerForm(current => ({ ...current, scale: event.target.value }))} required /></div>
                      <div className="field-group"><label>Certificado</label><input value={manometerForm.calibrationCertCode} onChange={event => setManometerForm(current => ({ ...current, calibrationCertCode: event.target.value }))} required /></div>
                      <div className="field-group"><label>Calibração</label><input type="date" value={manometerForm.calibratedAt} onChange={event => setManometerForm(current => ({ ...current, calibratedAt: event.target.value }))} required /></div>
                      <div className="field-group"><label>Vencimento</label><input type="date" value={manometerForm.expiresAt} onChange={event => setManometerForm(current => ({ ...current, expiresAt: event.target.value }))} required /></div>
                      <div className="admin-form-actions">
                        <button className="mini-btn" type="submit" disabled={manometerMutations.updateManometer.isPending}>Salvar manômetro</button>
                        <button className="mini-btn alt" type="button" onClick={resetManometerForm}>Cancelar edição</button>
                      </div>
                    </form>
                  ) : null}
                </article>
              ))}
            </div>
          ) : (
            <div className="card admin-card">
              <p className="placeholder-copy">Nenhum manômetro cadastrado.</p>
            </div>
          )}
      </>
    );
  }

  function renderContadoresTab() {
    const counters = (countersQuery.data || [])
      .filter(item => item.isActive !== false)
      .filter(item => matchesSearch(counterSearchParts(item), gestorSearch));

    if (countersQuery.isLoading) {
      return <div className="page-card placeholder-copy">Carregando contadores...</div>;
    }

    return (
      <>
        <div className="admin-toolbar">
          <div className="sec">{counterEditingId ? 'Editar contador' : 'Contadores'}</div>
          {!showCounterForm && !counterEditingId ? (
            <button
              className="mini-btn"
              type="button"
              onClick={() => {
                setShowCounterForm(true);
              }}
            >
              + Novo contador
            </button>
          ) : null}
        </div>
          {showCounterForm && !counterEditingId ? (
          <form className="admin-inline-form admin-form-grid" onSubmit={handleCounterSubmit}>
            <div className="field-group">
              <label htmlFor="counter-code">Código</label>
              <input
                id="counter-code"
                value={counterForm.code}
                onChange={event => setCounterForm(current => ({ ...current, code: event.target.value }))}
                required
              />
            </div>
            <div className="field-group">
              <label htmlFor="counter-serial">Serial</label>
              <input
                id="counter-serial"
                value={counterForm.serialNumber}
                onChange={event => setCounterForm(current => ({ ...current, serialNumber: event.target.value }))}
                required
              />
            </div>
            <div className="field-group">
              <label htmlFor="counter-calibrated">Calibração</label>
              <input
                id="counter-calibrated"
                type="date"
                value={counterForm.calibratedAt}
                onChange={event => setCounterForm(current => ({ ...current, calibratedAt: event.target.value }))}
                required
              />
            </div>
            <div className="field-group">
              <label htmlFor="counter-expires">Vencimento</label>
              <input
                id="counter-expires"
                type="date"
                value={counterForm.expiresAt}
                onChange={event => setCounterForm(current => ({ ...current, expiresAt: event.target.value }))}
                required
              />
            </div>
            <div className="admin-form-actions">
              <button
                className="mini-btn"
                type="submit"
                disabled={counterMutations.createCounter.isPending || counterMutations.updateCounter.isPending}
              >
                {counterEditingId ? 'Salvar contador' : 'Criar contador'}
              </button>
              {counterEditingId ? (
                <button className="mini-btn alt" type="button" onClick={resetCounterForm}>
                  {'Cancelar edição'}
                </button>
              ) : (
                <button className="mini-btn alt" type="button" onClick={resetCounterForm}>
                  Cancelar
                </button>
              )}
            </div>
          </form>
          ) : null}

          {counters.length ? (
            <div className="admin-stack">
              {counters.map(item => (
                <article className="card admin-card" key={item.id}>
                  <div className="admin-item-row">
                    <div className="admin-item-main">
                      <div className="admin-item-title">{item.code}</div>
                      <div className="admin-item-sub">
                        Serial {item.serialNumber} - Calibração: {formatDate(item.calibratedAt)} - Vencimento: {formatDate(item.expiresAt)}
                      </div>
                    </div>
                    <div className="admin-actions">
                      <button
                        className="mini-btn alt"
                        type="button"
                        onClick={() => {
                          setCounterEditingId(item.id);
                          setShowCounterForm(true);
                          setCounterForm(counterToForm(item));
                        }}
                      >
                        Editar
                      </button>
                      <button className="mini-btn danger" type="button" onClick={() => void handleCounterDeactivate(item.id)}>
                        Remover
                      </button>
                    </div>
                  </div>
                  {counterEditingId === item.id ? (
                    <form className="admin-inline-form admin-form-grid" onSubmit={handleCounterSubmit}>
                      <div className="field-group"><label>Código</label><input value={counterForm.code} onChange={event => setCounterForm(current => ({ ...current, code: event.target.value }))} required /></div>
                      <div className="field-group"><label>Serial</label><input value={counterForm.serialNumber} onChange={event => setCounterForm(current => ({ ...current, serialNumber: event.target.value }))} required /></div>
                      <div className="field-group"><label>Calibração</label><input type="date" value={counterForm.calibratedAt} onChange={event => setCounterForm(current => ({ ...current, calibratedAt: event.target.value }))} required /></div>
                      <div className="field-group"><label>Vencimento</label><input type="date" value={counterForm.expiresAt} onChange={event => setCounterForm(current => ({ ...current, expiresAt: event.target.value }))} required /></div>
                      <div className="admin-form-actions">
                        <button className="mini-btn" type="submit" disabled={counterMutations.updateCounter.isPending}>Salvar contador</button>
                        <button className="mini-btn alt" type="button" onClick={resetCounterForm}>Cancelar edição</button>
                      </div>
                    </form>
                  ) : null}
                </article>
              ))}
            </div>
          ) : (
            <div className="card admin-card">
              <p className="placeholder-copy">Nenhum contador cadastrado.</p>
            </div>
          )}
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
      equipamentos: 'Buscar em unidades',
      manometros: 'Buscar em manômetros',
      contadores: 'Buscar em contadores'
    };
    const label = labels[tab];
    if (!label) return null;

    return (
      <div className="admin-search-row">
        <input
          aria-label={label}
          placeholder={label}
          value={gestorSearch}
          onChange={event => setGestorSearch(event.target.value)}
        />
      </div>
    );
  }

  function renderTabContent() {
    if (tab === 'pendentes' || tab === 'aprovados') return renderReportTabContent();
    if (tab === 'projetos') return renderProjectsTab();
    if (tab === 'arquivados') return renderArchivedProjectsTab();
    if (tab === 'equipe') return renderEquipeTab();
    if (tab === 'usuarios') return renderUsuariosTab();
    if (tab === 'equipamentos') return renderEquipamentosTab();
    if (tab === 'manometros') return renderManometrosTab();
    return renderContadoresTab();
  }

  function renderReportSummary() {
    if (tab !== 'pendentes' && tab !== 'aprovados') return null;

    return (
      <section className="page-card summary-card-compact">
        <div className="section-title">Resumo</div>
        <div className="stats-grid stats-grid-compact">
          <div className="stat-card-react">
            <div className="stat-number-react">{pendingReports.length}</div>
            <div className="stat-label-react">Pendentes/devolvidos</div>
          </div>
          <div className="stat-card-react">
            <div className="stat-number-react">{approvedReports.length}</div>
            <div className="stat-label-react">Aprovados/assinados</div>
          </div>
          <div className="stat-card-react">
            <div className="stat-number-react">{archivedReports.length}</div>
            <div className="stat-label-react">Arquivados</div>
          </div>
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
            <button className="topbar-chip" type="button" onClick={() => navigate('/conta')}>
              Conta
            </button>
            <button className="topbar-chip" type="button" onClick={handleLogout}>
              Sair
            </button>
          </>
        }
      />

      <div className="nav-tabs-wrap">
        <div className="nav-tabs">
          <button className={`nav-tab ${tab === 'pendentes' ? 'active' : ''}`} type="button" onClick={() => setTab('pendentes')}>
            Pendentes
          </button>
          <button className={`nav-tab ${tab === 'aprovados' ? 'active' : ''}`} type="button" onClick={() => setTab('aprovados')}>
            Aprovados
          </button>
          <button className={`nav-tab ${tab === 'projetos' ? 'active' : ''}`} type="button" onClick={() => setTab('projetos')}>
            Projetos
          </button>
          <button className={`nav-tab ${tab === 'arquivados' ? 'active' : ''}`} type="button" onClick={() => setTab('arquivados')}>
            Arquivados
          </button>
          <button className={`nav-tab ${tab === 'equipe' ? 'active' : ''}`} type="button" onClick={() => setTab('equipe')}>
            Equipe
          </button>
          <button className={`nav-tab ${tab === 'usuarios' ? 'active' : ''}`} type="button" onClick={() => setTab('usuarios')}>
            Usuários
          </button>
          <button className={`nav-tab ${tab === 'equipamentos' ? 'active' : ''}`} type="button" onClick={() => setTab('equipamentos')}>
            Unidades
          </button>
          <button className={`nav-tab ${tab === 'manometros' ? 'active' : ''}`} type="button" onClick={() => setTab('manometros')}>
            {'Manômetros'}
          </button>
          <button className={`nav-tab ${tab === 'contadores' ? 'active' : ''}`} type="button" onClick={() => setTab('contadores')}>
            Contadores
          </button>
        </div>
      </div>

      <main className="page-scroll">
        {renderReportSummary()}
        {renderGestorSearch()}
        {renderTabContent()}
      </main>
    </Shell>
  );
}
