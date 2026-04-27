import { useMemo, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';

import type { UserRole } from '../../types/auth';
import { downloadReportDocx, downloadReportPdf } from '../../api/reports';
import { useAuth } from '../../auth/AuthContext';
import { ReportSummaryCard } from '../../components/reports/ReportSummaryCard';
import { ReasonDialog } from '../../components/ui/ReasonDialog';
import { useCollaboratorMutations, useCollaborators } from '../../hooks/useCollaborators';
import { useCounterMutations, useCounters } from '../../hooks/useCounters';
import { useEquipment, useEquipmentMutations } from '../../hooks/useEquipment';
import { useManometerMutations, useManometers } from '../../hooks/useManometers';
import { useProjectMutations, useProjects } from '../../hooks/useProjects';
import { useReportMutations, useReports } from '../../hooks/useReports';
import { useUnitMutations, useUnits } from '../../hooks/useUnits';
import { useUserMutations, useUsers } from '../../hooks/useUsers';
import { Shell } from '../../layout/Shell';
import { TopBar } from '../../layout/TopBar';
import type {
  Collaborator,
  InternalUserSummary,
  Manometer,
  ParticleCounter,
  Project,
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
  contractCode: string;
  location: string;
  operatorId: string;
  visibleToCollaborators: boolean;
  isActive: boolean;
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

interface EquipmentFormState {
  code: string;
  name: string;
  serviceTags: string;
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

const internalRoles: Array<Exclude<UserRole, 'CLIENT'>> = ['COLLABORATOR', 'MANAGER', 'COORDINATOR'];
const unitCategories: UnitCategory[] = ['FILTRAGEM', 'FLUSHING', 'LIMPEZA_QUIMICA', 'DESIDRATACAO', 'UTH', 'OUTRA'];

const emptyProjectForm: ProjectFormState = {
  code: '',
  name: '',
  clientName: '',
  clientCnpj: '',
  contractCode: '',
  location: '',
  operatorId: '',
  visibleToCollaborators: true,
  isActive: true
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

const emptyEquipmentForm: EquipmentFormState = {
  code: '',
  name: '',
  serviceTags: ''
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

function formatUnitCategory(category: UnitCategory) {
  const labels: Record<UnitCategory, string> = {
    FILTRAGEM: 'Filtragem',
    FLUSHING: 'Flushing',
    LIMPEZA_QUIMICA: 'Limpeza qu\u00edmica',
    DESIDRATACAO: 'Desidrata\u00e7\u00e3o',
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

function formatDate(value?: string | null) {
  if (!value) return 'N\u00e3o informado';
  return new Date(value).toLocaleDateString('pt-BR');
}

function projectToForm(project: Project): ProjectFormState {
  return {
    code: project.code,
    name: project.name,
    clientName: project.clientName,
    clientCnpj: project.clientCnpj,
    contractCode: project.contractCode,
    location: project.location,
    operatorId: project.operatorId || '',
    visibleToCollaborators: project.visibleToCollaborators,
    isActive: project.isActive
  };
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

function equipmentToForm(item: { code: string; name: string; serviceTags: string[] }) {
  return {
    code: item.code,
    name: item.name,
    serviceTags: item.serviceTags.join(', ')
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

function renderProjectCard(project: Project, options: { onEdit: (project: Project) => void; onToggleArchive: (project: Project) => void; }) {
  return (
    <article className="admin-card-react" key={project.id}>
      <div className="admin-card-head">
        <div>
          <div className="admin-card-title">
            {project.code} - {project.name}
          </div>
          <div className="admin-card-subtitle">
            {project.clientName} - {project.contractCode}
          </div>
        </div>
        <div className="admin-card-actions">
          <button className="secondary-button" type="button" onClick={() => options.onEdit(project)}>
            Editar
          </button>
          <button className="secondary-button" type="button" onClick={() => options.onToggleArchive(project)}>
            {project.isActive ? 'Arquivar' : 'Desarquivar'}
          </button>
        </div>
      </div>
      <div className="admin-card-meta">
        <span>Local: {project.location}</span>
        <span>Cliente: {project.clientName}</span>
        <span>Status: {project.isActive ? 'Ativo' : 'Arquivado'}</span>
        <span>{'Vis\u00edvel para colaboradores'}: {project.visibleToCollaborators ? 'Sim' : 'N\u00e3o'}</span>
      </div>
    </article>
  );
}

export function GestorPage() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const [tab, setTab] = useState<GestorTab>('pendentes');

  const [projectForm, setProjectForm] = useState<ProjectFormState>(emptyProjectForm);
  const [projectEditingId, setProjectEditingId] = useState<string | null>(null);
  const [projectMessage, setProjectMessage] = useState<string | null>(null);

  const [collaboratorForm, setCollaboratorForm] = useState<CollaboratorFormState>(emptyCollaboratorForm);
  const [collaboratorEditingId, setCollaboratorEditingId] = useState<string | null>(null);
  const [collaboratorMessage, setCollaboratorMessage] = useState<string | null>(null);

  const [userForm, setUserForm] = useState<UserFormState>(emptyUserForm);
  const [userEditingId, setUserEditingId] = useState<string | null>(null);
  const [userMessage, setUserMessage] = useState<string | null>(null);

  const [equipmentForm, setEquipmentForm] = useState<EquipmentFormState>(emptyEquipmentForm);
  const [equipmentEditingId, setEquipmentEditingId] = useState<string | null>(null);
  const [equipmentMessage, setEquipmentMessage] = useState<string | null>(null);

  const [unitForm, setUnitForm] = useState<UnitFormState>(emptyUnitForm);
  const [unitEditingId, setUnitEditingId] = useState<string | null>(null);
  const [unitMessage, setUnitMessage] = useState<string | null>(null);

  const [manometerForm, setManometerForm] = useState<ManometerFormState>(emptyManometerForm);
  const [manometerEditingId, setManometerEditingId] = useState<string | null>(null);
  const [manometerMessage, setManometerMessage] = useState<string | null>(null);

  const [counterForm, setCounterForm] = useState<CounterFormState>(emptyCounterForm);
  const [counterEditingId, setCounterEditingId] = useState<string | null>(null);
  const [counterMessage, setCounterMessage] = useState<string | null>(null);
  const [reportMessage, setReportMessage] = useState<string | null>(null);
  const [returnReport, setReturnReport] = useState<ReportSummary | null>(null);

  const reportsQuery = useReports();
  const activeProjectsQuery = useProjects(true);
  const archivedProjectsQuery = useProjects(false);
  const collaboratorsQuery = useCollaborators();
  const usersQuery = useUsers('internal');
  const equipmentQuery = useEquipment();
  const unitsQuery = useUnits();
  const manometersQuery = useManometers();
  const countersQuery = useCounters();

  const projectMutations = useProjectMutations();
  const reportMutations = useReportMutations();
  const collaboratorMutations = useCollaboratorMutations();
  const userMutations = useUserMutations();
  const equipmentMutations = useEquipmentMutations();
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

  const groupedUnits = useMemo(() => groupUnits(unitsQuery.data || []), [unitsQuery.data]);

  async function handleLogout() {
    await logout();
    navigate('/', { replace: true });
  }

  function resetProjectForm() {
    setProjectForm(emptyProjectForm);
    setProjectEditingId(null);
  }

  function resetCollaboratorForm() {
    setCollaboratorForm(emptyCollaboratorForm);
    setCollaboratorEditingId(null);
  }

  function resetUserForm() {
    setUserForm(emptyUserForm);
    setUserEditingId(null);
  }

  function resetEquipmentForm() {
    setEquipmentForm(emptyEquipmentForm);
    setEquipmentEditingId(null);
  }

  function resetUnitForm() {
    setUnitForm(emptyUnitForm);
    setUnitEditingId(null);
  }

  function resetManometerForm() {
    setManometerForm(emptyManometerForm);
    setManometerEditingId(null);
  }

  function resetCounterForm() {
    setCounterForm(emptyCounterForm);
    setCounterEditingId(null);
  }

  async function handleProjectSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setProjectMessage(null);

    const payload = {
      code: projectForm.code.trim(),
      name: projectForm.name.trim(),
      clientName: projectForm.clientName.trim(),
      clientCnpj: projectForm.clientCnpj.trim(),
      contractCode: projectForm.contractCode.trim(),
      location: projectForm.location.trim(),
      visibleToCollaborators: projectForm.visibleToCollaborators,
      isActive: projectForm.isActive,
      operatorId: projectForm.operatorId || null
    };

    try {
      if (projectEditingId) {
        await projectMutations.updateProject.mutateAsync({ id: projectEditingId, payload });
        setProjectMessage('Projeto atualizado.');
      } else {
        await projectMutations.createProject.mutateAsync(payload);
        setProjectMessage('Projeto criado.');
      }
      resetProjectForm();
    } catch (error) {
      setProjectMessage(error instanceof Error ? error.message : 'N\u00e3o foi poss\u00edvel salvar o projeto.');
    }
  }

  async function handleProjectToggleArchive(project: Project) {
    setProjectMessage(null);
    try {
      await projectMutations.updateProject.mutateAsync({
        id: project.id,
        payload: { isActive: !project.isActive }
      });
      setProjectMessage(project.isActive ? 'Projeto arquivado.' : 'Projeto desarquivado.');
    } catch (error) {
      setProjectMessage(error instanceof Error ? error.message : 'N\u00e3o foi poss\u00edvel atualizar o projeto.');
    }
  }

  async function handleCollaboratorSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCollaboratorMessage(null);

    const payload = {
      name: collaboratorForm.name.trim(),
      role: collaboratorForm.role.trim(),
      email: collaboratorForm.email.trim() || null,
      isActive: collaboratorForm.isActive
    };

    try {
      if (collaboratorEditingId) {
        await collaboratorMutations.updateCollaborator.mutateAsync({ id: collaboratorEditingId, payload });
        setCollaboratorMessage('Colaborador atualizado.');
      } else {
        await collaboratorMutations.createCollaborator.mutateAsync(payload);
        setCollaboratorMessage('Colaborador criado.');
      }
      resetCollaboratorForm();
    } catch (error) {
      setCollaboratorMessage(error instanceof Error ? error.message : 'N\u00e3o foi poss\u00edvel salvar o colaborador.');
    }
  }

  async function handleCollaboratorToggle(collaborator: Collaborator) {
    setCollaboratorMessage(null);
    try {
      if (collaborator.isActive) {
        await collaboratorMutations.removeCollaborator.mutateAsync(collaborator.id);
        setCollaboratorMessage('Colaborador desativado.');
      } else {
        await collaboratorMutations.updateCollaborator.mutateAsync({
          id: collaborator.id,
          payload: { isActive: true }
        });
        setCollaboratorMessage('Colaborador reativado.');
      }
    } catch (error) {
      setCollaboratorMessage(error instanceof Error ? error.message : 'N\u00e3o foi poss\u00edvel atualizar o colaborador.');
    }
  }

  async function handleUserSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setUserMessage(null);

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
        setUserMessage('Usu\u00e1rio atualizado.');
      } else {
        await userMutations.createUser.mutateAsync({
          ...basePayload,
          password: userForm.password.trim()
        });
        setUserMessage('Usu\u00e1rio criado.');
      }
      resetUserForm();
    } catch (error) {
      setUserMessage(error instanceof Error ? error.message : 'N\u00e3o foi poss\u00edvel salvar o usu\u00e1rio.');
    }
  }

  async function handleUserDelete(id: string) {
    setUserMessage(null);
    try {
      await userMutations.removeUser.mutateAsync(id);
      setUserMessage('Usu\u00e1rio removido.');
      if (userEditingId === id) resetUserForm();
    } catch (error) {
      setUserMessage(error instanceof Error ? error.message : 'N\u00e3o foi poss\u00edvel remover o usu\u00e1rio.');
    }
  }

  async function handleEquipmentSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setEquipmentMessage(null);

    const payload = {
      code: equipmentForm.code.trim(),
      name: equipmentForm.name.trim(),
      serviceTags: equipmentForm.serviceTags
        .split(',')
        .map(item => item.trim())
        .filter(Boolean)
    };

    try {
      if (equipmentEditingId) {
        await equipmentMutations.updateEquipment.mutateAsync({ id: equipmentEditingId, payload });
        setEquipmentMessage('Equipamento atualizado.');
      } else {
        await equipmentMutations.createEquipment.mutateAsync(payload);
        setEquipmentMessage('Equipamento criado.');
      }
      resetEquipmentForm();
    } catch (error) {
      setEquipmentMessage(error instanceof Error ? error.message : 'N\u00e3o foi poss\u00edvel salvar o equipamento.');
    }
  }

  async function handleEquipmentDeactivate(id: string) {
    setEquipmentMessage(null);
    try {
      await equipmentMutations.removeEquipment.mutateAsync(id);
      setEquipmentMessage('Equipamento desativado.');
      if (equipmentEditingId === id) resetEquipmentForm();
    } catch (error) {
      setEquipmentMessage(error instanceof Error ? error.message : 'N\u00e3o foi poss\u00edvel atualizar o equipamento.');
    }
  }

  async function handleUnitSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setUnitMessage(null);

    const payload = {
      code: unitForm.code.trim(),
      category: unitForm.category
    };

    try {
      if (unitEditingId) {
        await unitMutations.updateUnit.mutateAsync({ id: unitEditingId, payload });
        setUnitMessage('Unidade atualizada.');
      } else {
        await unitMutations.createUnit.mutateAsync(payload);
        setUnitMessage('Unidade criada.');
      }
      resetUnitForm();
    } catch (error) {
      setUnitMessage(error instanceof Error ? error.message : 'N\u00e3o foi poss\u00edvel salvar a unidade.');
    }
  }

  async function handleUnitDelete(id: string) {
    setUnitMessage(null);
    try {
      await unitMutations.removeUnit.mutateAsync(id);
      setUnitMessage('Unidade removida.');
      if (unitEditingId === id) resetUnitForm();
    } catch (error) {
      setUnitMessage(error instanceof Error ? error.message : 'N\u00e3o foi poss\u00edvel remover a unidade.');
    }
  }

  async function handleManometerSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setManometerMessage(null);

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
        setManometerMessage('Manômetro atualizado.');
      } else {
        await manometerMutations.createManometer.mutateAsync(payload);
        setManometerMessage('Manômetro criado.');
      }
      resetManometerForm();
    } catch (error) {
      setManometerMessage(error instanceof Error ? error.message : 'Não foi possível salvar o manômetro.');
    }
  }

  async function handleManometerDeactivate(id: string) {
    setManometerMessage(null);
    try {
      await manometerMutations.removeManometer.mutateAsync(id);
      setManometerMessage('Manômetro desativado.');
      if (manometerEditingId === id) resetManometerForm();
    } catch (error) {
      setManometerMessage(error instanceof Error ? error.message : 'Não foi possível atualizar o manômetro.');
    }
  }

  async function handleCounterSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCounterMessage(null);

    const payload = {
      code: counterForm.code.trim(),
      serialNumber: counterForm.serialNumber.trim(),
      calibratedAt: counterForm.calibratedAt,
      expiresAt: counterForm.expiresAt
    };

    try {
      if (counterEditingId) {
        await counterMutations.updateCounter.mutateAsync({ id: counterEditingId, payload });
        setCounterMessage('Contador atualizado.');
      } else {
        await counterMutations.createCounter.mutateAsync(payload);
        setCounterMessage('Contador criado.');
      }
      resetCounterForm();
    } catch (error) {
      setCounterMessage(error instanceof Error ? error.message : 'Não foi possível salvar o contador.');
    }
  }

  async function handleCounterDeactivate(id: string) {
    setCounterMessage(null);
    try {
      await counterMutations.removeCounter.mutateAsync(id);
      setCounterMessage('Contador desativado.');
      if (counterEditingId === id) resetCounterForm();
    } catch (error) {
      setCounterMessage(error instanceof Error ? error.message : 'Não foi possível atualizar o contador.');
    }
  }

  async function handleReportStatus(report: ReportSummary, status: 'APPROVED' | 'RETURNED', reviewNotes?: string | null) {
    setReportMessage(null);

    try {
      await reportMutations.updateStatus.mutateAsync({
        id: report.id,
        payload: { status, reviewNotes }
      });
      if (status === 'RETURNED') setReturnReport(null);
      setReportMessage(status === 'APPROVED' ? 'Relat\u00f3rio aprovado.' : 'Relat\u00f3rio devolvido.');
    } catch (error) {
      setReportMessage(error instanceof Error ? error.message : 'N\u00e3o foi poss\u00edvel revisar o relat\u00f3rio.');
    }
  }

  async function handleReportDownload(report: ReportSummary, format: 'pdf' | 'docx') {
    setReportMessage(null);
    const fileName = `${report.reportType}_${report.sequenceNumber || report.id}.${format}`;

    try {
      const blob = format === 'pdf' ? await downloadReportPdf(report.id) : await downloadReportDocx(report.id);
      downloadBlob(blob, fileName);
    } catch (error) {
      setReportMessage(error instanceof Error ? error.message : 'N\u00e3o foi poss\u00edvel baixar o relat\u00f3rio.');
    }
  }

  function renderManagerReportActions(report: ReportSummary) {
    const canReview = report.status !== 'SIGNED';

    return (
      <>
        <button className="secondary-button" type="button" onClick={() => void handleReportDownload(report, 'pdf')}>
          PDF
        </button>
        <button className="secondary-button" type="button" onClick={() => void handleReportDownload(report, 'docx')}>
          DOCX
        </button>
        {canReview && report.status !== 'APPROVED' ? (
          <button className="primary-button" type="button" onClick={() => void handleReportStatus(report, 'APPROVED')}>
            Aprovar
          </button>
        ) : null}
        {canReview && report.status !== 'RETURNED' ? (
          <button className="secondary-button" type="button" onClick={() => setReturnReport(report)}>
            Devolver
          </button>
        ) : null}
      </>
    );
  }

  function renderReportTabContent() {
    const visibleReports =
      tab === 'pendentes' ? pendingReports : tab === 'arquivados' ? archivedReports : approvedReports;

    if (reportsQuery.isLoading) return <div className="page-card placeholder-copy">{'Carregando relat\u00f3rios...'}</div>;

    if (!visibleReports.length) {
      return (
        <div className="page-card placeholder-copy">
          {tab === 'pendentes'
            ? 'Nenhum relat\u00f3rio pendente.'
            : tab === 'arquivados'
              ? 'Nenhum relat\u00f3rio arquivado.'
              : 'Nenhum relat\u00f3rio aprovado.'}
        </div>
      );
    }

    return (
      <>
        {reportMessage ? <div className="page-card inline-success">{reportMessage}</div> : null}
        {visibleReports.map(report => (
          <ReportSummaryCard key={report.id} report={report} actions={renderManagerReportActions(report)} />
        ))}
        <ReasonDialog
          open={!!returnReport}
          title="Devolver relat\u00f3rio"
          description="Informe o motivo da devolu\u00e7\u00e3o do relat\u00f3rio."
          label="Motivo"
          confirmLabel="Devolver"
          requiredMessage="Informe um motivo para devolver o relat\u00f3rio."
          isSubmitting={reportMutations.updateStatus.isPending}
          onCancel={() => setReturnReport(null)}
          onConfirm={reason => {
            if (returnReport) void handleReportStatus(returnReport, 'RETURNED', reason);
          }}
        />
      </>
    );
  }

  function renderProjectsTab() {
    const activeProjects = activeProjectsQuery.data || [];
    const archivedProjects = archivedProjectsQuery.data || [];

    if (activeProjectsQuery.isLoading || archivedProjectsQuery.isLoading) {
      return <div className="page-card placeholder-copy">Carregando projetos...</div>;
    }

    return (
      <>
        <section className="page-card">
          <div className="section-title">{projectEditingId ? 'Editar projeto' : 'Novo projeto'}</div>
          {projectMessage ? <div className="inline-success">{projectMessage}</div> : null}
          <form className="admin-form-grid" onSubmit={handleProjectSubmit}>
            <div className="field-group">
              <label htmlFor="project-code">{'C\u00f3digo'}</label>
              <input
                id="project-code"
                value={projectForm.code}
                onChange={event => setProjectForm(current => ({ ...current, code: event.target.value }))}
                required
              />
            </div>
            <div className="field-group">
              <label htmlFor="project-name">Nome</label>
              <input
                id="project-name"
                value={projectForm.name}
                onChange={event => setProjectForm(current => ({ ...current, name: event.target.value }))}
                required
              />
            </div>
            <div className="field-group">
              <label htmlFor="project-client-name">Cliente</label>
              <input
                id="project-client-name"
                value={projectForm.clientName}
                onChange={event => setProjectForm(current => ({ ...current, clientName: event.target.value }))}
                required
              />
            </div>
            <div className="field-group">
              <label htmlFor="project-client-cnpj">CNPJ</label>
              <input
                id="project-client-cnpj"
                value={projectForm.clientCnpj}
                onChange={event => setProjectForm(current => ({ ...current, clientCnpj: event.target.value }))}
                required
              />
            </div>
            <div className="field-group">
              <label htmlFor="project-contract">Contrato</label>
              <input
                id="project-contract"
                value={projectForm.contractCode}
                onChange={event => setProjectForm(current => ({ ...current, contractCode: event.target.value }))}
                required
              />
            </div>
            <div className="field-group">
              <label htmlFor="project-location">Local</label>
              <input
                id="project-location"
                value={projectForm.location}
                onChange={event => setProjectForm(current => ({ ...current, location: event.target.value }))}
                required
              />
            </div>
            <div className="field-group">
              <label htmlFor="project-operator">{'Colaborador respons\u00e1vel'}</label>
              <select
                id="project-operator"
                value={projectForm.operatorId}
                onChange={event => setProjectForm(current => ({ ...current, operatorId: event.target.value }))}
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
                checked={projectForm.visibleToCollaborators}
                onChange={event =>
                  setProjectForm(current => ({ ...current, visibleToCollaborators: event.target.checked }))
                }
              />
              {'Vis\u00edvel para colaboradores'}
            </label>
            <label className="checkbox-line">
              <input
                type="checkbox"
                checked={projectForm.isActive}
                onChange={event => setProjectForm(current => ({ ...current, isActive: event.target.checked }))}
              />
              Projeto ativo
            </label>
            <div className="admin-form-actions">
              <button className="primary-button" type="submit" disabled={projectMutations.createProject.isPending || projectMutations.updateProject.isPending}>
                {projectEditingId ? 'Salvar projeto' : 'Criar projeto'}
              </button>
              {projectEditingId ? (
                <button className="secondary-button" type="button" onClick={resetProjectForm}>
                  {'Cancelar edi\u00e7\u00e3o'}
                </button>
              ) : null}
            </div>
          </form>
        </section>

        <section className="page-card">
          <div className="section-title">Projetos ativos</div>
          {activeProjects.length ? (
            <div className="admin-stack">
              {activeProjects.map(project =>
                renderProjectCard(project, {
                  onEdit: item => {
                    setProjectEditingId(item.id);
                    setProjectForm(projectToForm(item));
                    setProjectMessage(null);
                  },
                  onToggleArchive: handleProjectToggleArchive
                })
              )}
            </div>
          ) : (
            <p className="placeholder-copy">Nenhum projeto ativo.</p>
          )}
        </section>

        <section className="page-card">
          <div className="section-title">Projetos arquivados</div>
          {archivedProjects.length ? (
            <div className="admin-stack">
              {archivedProjects.map(project =>
                renderProjectCard(project, {
                  onEdit: item => {
                    setProjectEditingId(item.id);
                    setProjectForm(projectToForm(item));
                    setProjectMessage(null);
                  },
                  onToggleArchive: handleProjectToggleArchive
                })
              )}
            </div>
          ) : (
            <p className="placeholder-copy">Nenhum projeto arquivado.</p>
          )}
        </section>
      </>
    );
  }

  function renderEquipeTab() {
    if (collaboratorsQuery.isLoading) {
      return <div className="page-card placeholder-copy">Carregando colaboradores...</div>;
    }

    const collaborators = collaboratorsQuery.data || [];

    return (
      <>
        <section className="page-card">
          <div className="section-title">{collaboratorEditingId ? 'Editar colaborador' : 'Novo colaborador'}</div>
          {collaboratorMessage ? <div className="inline-success">{collaboratorMessage}</div> : null}
          <form className="admin-form-grid" onSubmit={handleCollaboratorSubmit}>
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
                className="primary-button"
                type="submit"
                disabled={
                  collaboratorMutations.createCollaborator.isPending ||
                  collaboratorMutations.updateCollaborator.isPending
                }
              >
                {collaboratorEditingId ? 'Salvar colaborador' : 'Criar colaborador'}
              </button>
              {collaboratorEditingId ? (
                <button className="secondary-button" type="button" onClick={resetCollaboratorForm}>
                  {'Cancelar edi\u00e7\u00e3o'}
                </button>
              ) : null}
            </div>
          </form>
        </section>

        <section className="page-card">
          <div className="section-title">Colaboradores</div>
          {collaborators.length ? (
            <div className="admin-stack">
              {collaborators.map(collaborator => (
                <article className="admin-card-react" key={collaborator.id}>
                  <div className="admin-card-head">
                    <div>
                      <div className="admin-card-title">{collaborator.name}</div>
                      <div className="admin-card-subtitle">{collaborator.role}</div>
                    </div>
                    <div className="admin-card-actions">
                      <button
                        className="secondary-button"
                        type="button"
                        onClick={() => {
                          setCollaboratorEditingId(collaborator.id);
                          setCollaboratorForm(collaboratorToForm(collaborator));
                          setCollaboratorMessage(null);
                        }}
                      >
                        Editar
                      </button>
                      <button
                        className="secondary-button"
                        type="button"
                        onClick={() => void handleCollaboratorToggle(collaborator)}
                      >
                        {collaborator.isActive ? 'Desativar' : 'Reativar'}
                      </button>
                    </div>
                  </div>
                  <div className="admin-card-meta">
                    <span>{collaborator.code}</span>
                    <span>{collaborator.email || 'Sem e-mail'}</span>
                    <span>{collaborator.isActive ? 'Ativo' : 'Inativo'}</span>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <p className="placeholder-copy">Nenhum colaborador cadastrado.</p>
          )}
        </section>
      </>
    );
  }

  function renderUsuariosTab() {
    const users = usersQuery.data || [];

    if (usersQuery.isLoading) {
      return <div className="page-card placeholder-copy">{'Carregando usu\u00e1rios...'}</div>;
    }

    return (
      <>
        <section className="page-card">
          <div className="section-title">{userEditingId ? 'Editar usuário' : 'Novo usuário interno'}</div>
          {userMessage ? <div className="inline-success">{userMessage}</div> : null}
          <form className="admin-form-grid" onSubmit={handleUserSubmit}>
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
                className="primary-button"
                type="submit"
                disabled={userMutations.createUser.isPending || userMutations.updateUser.isPending}
              >
                {userEditingId ? 'Salvar usuário' : 'Criar usuário'}
              </button>
              {userEditingId ? (
                <button className="secondary-button" type="button" onClick={resetUserForm}>
                  Cancelar edição
                </button>
              ) : null}
            </div>
          </form>
        </section>

        <section className="page-card">
          <div className="section-title">Usuários internos</div>
          {users.length ? (
            <div className="admin-stack">
              {users.map(item => (
                <article className="admin-card-react" key={item.id}>
                  <div className="admin-card-head">
                    <div>
                      <div className="admin-card-title">{item.name}</div>
                      <div className="admin-card-subtitle">{item.username}</div>
                    </div>
                    <div className="admin-card-actions">
                      <button
                        className="secondary-button"
                        type="button"
                        onClick={() => {
                          setUserEditingId(item.id);
                          setUserForm(userToForm(item));
                          setUserMessage(null);
                        }}
                      >
                        Editar
                      </button>
                      <button className="secondary-button" type="button" onClick={() => void handleUserDelete(item.id)}>
                        Excluir
                      </button>
                    </div>
                  </div>
                  <div className="admin-card-meta">
                    <span>{item.email || 'Sem e-mail'}</span>
                    <span>{formatUserRole(item.role)}</span>
                    <span>{item.collaborator?.name || 'Sem colaborador vinculado'}</span>
                    <span>{item.isActive ? 'Ativo' : 'Inativo'}</span>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <p className="placeholder-copy">Nenhum usuário interno cadastrado.</p>
          )}
        </section>
      </>
    );
  }

  function renderEquipamentosTab() {
    const equipment = equipmentQuery.data || [];
    const units = unitsQuery.data || [];

    if (equipmentQuery.isLoading || unitsQuery.isLoading) {
      return <div className="page-card placeholder-copy">Carregando equipamentos e unidades...</div>;
    }

    return (
      <>
        <section className="page-card">
          <div className="section-title">{equipmentEditingId ? 'Editar equipamento' : 'Novo equipamento'}</div>
          {equipmentMessage ? <div className="inline-success">{equipmentMessage}</div> : null}
          <form className="admin-form-grid" onSubmit={handleEquipmentSubmit}>
            <div className="field-group">
              <label htmlFor="equipment-code">Código</label>
              <input
                id="equipment-code"
                value={equipmentForm.code}
                onChange={event => setEquipmentForm(current => ({ ...current, code: event.target.value }))}
                required
              />
            </div>
            <div className="field-group">
              <label htmlFor="equipment-name">Nome</label>
              <input
                id="equipment-name"
                value={equipmentForm.name}
                onChange={event => setEquipmentForm(current => ({ ...current, name: event.target.value }))}
                required
              />
            </div>
            <div className="field-group">
              <label htmlFor="equipment-tags">Tags de serviço</label>
              <input
                id="equipment-tags"
                value={equipmentForm.serviceTags}
                onChange={event => setEquipmentForm(current => ({ ...current, serviceTags: event.target.value }))}
                placeholder="RDO, RLQ, RCPU"
              />
            </div>
            <div className="admin-form-actions">
              <button
                className="primary-button"
                type="submit"
                disabled={equipmentMutations.createEquipment.isPending || equipmentMutations.updateEquipment.isPending}
              >
                {equipmentEditingId ? 'Salvar equipamento' : 'Criar equipamento'}
              </button>
              {equipmentEditingId ? (
                <button className="secondary-button" type="button" onClick={resetEquipmentForm}>
                  Cancelar edição
                </button>
              ) : null}
            </div>
          </form>
        </section>

        <section className="page-card">
          <div className="section-title">{unitEditingId ? 'Editar unidade' : 'Nova unidade'}</div>
          {unitMessage ? <div className="inline-success">{unitMessage}</div> : null}
          <form className="admin-form-grid" onSubmit={handleUnitSubmit}>
            <div className="field-group">
              <label htmlFor="unit-code">Código</label>
              <input
                id="unit-code"
                value={unitForm.code}
                onChange={event => setUnitForm(current => ({ ...current, code: event.target.value }))}
                required
              />
            </div>
            <div className="field-group">
              <label htmlFor="unit-category">Categoria</label>
              <select
                id="unit-category"
                value={unitForm.category}
                onChange={event => setUnitForm(current => ({ ...current, category: event.target.value as UnitCategory }))}
              >
                {unitCategories.map(category => (
                  <option key={category} value={category}>
                    {formatUnitCategory(category)}
                  </option>
                ))}
              </select>
            </div>
            <div className="admin-form-actions">
              <button
                className="primary-button"
                type="submit"
                disabled={unitMutations.createUnit.isPending || unitMutations.updateUnit.isPending}
              >
                {unitEditingId ? 'Salvar unidade' : 'Criar unidade'}
              </button>
              {unitEditingId ? (
                <button className="secondary-button" type="button" onClick={resetUnitForm}>
                  Cancelar edição
                </button>
              ) : null}
            </div>
          </form>
        </section>

        <section className="page-card">
          <div className="section-title">Equipamentos</div>
          {equipment.length ? (
            <div className="admin-stack">
              {equipment.map(item => (
                <article className="admin-card-react" key={item.id}>
                  <div className="admin-card-head">
                    <div>
                      <div className="admin-card-title">{item.code}</div>
                      <div className="admin-card-subtitle">{item.name}</div>
                    </div>
                    <div className="admin-card-actions">
                      <button
                        className="secondary-button"
                        type="button"
                        onClick={() => {
                          setEquipmentEditingId(item.id);
                          setEquipmentForm(equipmentToForm(item));
                          setEquipmentMessage(null);
                        }}
                      >
                        Editar
                      </button>
                      <button className="secondary-button" type="button" onClick={() => void handleEquipmentDeactivate(item.id)}>
                        Desativar
                      </button>
                    </div>
                  </div>
                  <div className="admin-card-meta">
                    <span>{item.serviceTags.join(', ') || 'Sem tags de serviço'}</span>
                    <span>{item.isActive ? 'Ativo' : 'Inativo'}</span>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <p className="placeholder-copy">Nenhum equipamento cadastrado.</p>
          )}
        </section>

        <section className="page-card">
          <div className="section-title">Unidades</div>
          {units.length ? (
            <div className="admin-stack">
              {Object.entries(groupedUnits).map(([category, categoryUnits]) => (
                <article className="admin-card-react" key={category}>
                  <div className="admin-card-title">{formatUnitCategory(category as UnitCategory)}</div>
                  <div className="admin-list">
                    {categoryUnits.map(unit => (
                      <div className="admin-list-row" key={unit.id}>
                        <span>{unit.code}</span>
                        <div className="admin-card-actions">
                          <button
                            className="secondary-button"
                            type="button"
                            onClick={() => {
                              setUnitEditingId(unit.id);
                              setUnitForm(unitToForm(unit));
                              setUnitMessage(null);
                            }}
                          >
                            Editar
                          </button>
                          <button className="secondary-button" type="button" onClick={() => void handleUnitDelete(unit.id)}>
                            Excluir
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <p className="placeholder-copy">Nenhuma unidade cadastrada.</p>
          )}
        </section>
      </>
    );
  }

  function renderManometrosTab() {
    const manometers = manometersQuery.data || [];

    if (manometersQuery.isLoading) {
      return <div className="page-card placeholder-copy">Carregando manômetros...</div>;
    }

    return (
      <>
        <section className="page-card">
          <div className="section-title">{manometerEditingId ? 'Editar manômetro' : 'Novo manômetro'}</div>
          {manometerMessage ? <div className="inline-success">{manometerMessage}</div> : null}
          <form className="admin-form-grid" onSubmit={handleManometerSubmit}>
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
                className="primary-button"
                type="submit"
                disabled={manometerMutations.createManometer.isPending || manometerMutations.updateManometer.isPending}
              >
                {manometerEditingId ? 'Salvar manômetro' : 'Criar manômetro'}
              </button>
              {manometerEditingId ? (
                <button className="secondary-button" type="button" onClick={resetManometerForm}>
                  Cancelar edição
                </button>
              ) : null}
            </div>
          </form>
        </section>

        <section className="page-card">
          <div className="section-title">Manômetros</div>
          {manometers.length ? (
            <div className="admin-stack">
              {manometers.map(item => (
                <article className="admin-card-react" key={item.id}>
                  <div className="admin-card-head">
                    <div>
                      <div className="admin-card-title">{item.code} - {item.scale}</div>
                      <div className="admin-card-subtitle">Certificado {item.calibrationCertCode}</div>
                    </div>
                    <div className="admin-card-actions">
                      <button
                        className="secondary-button"
                        type="button"
                        onClick={() => {
                          setManometerEditingId(item.id);
                          setManometerForm(manometerToForm(item));
                          setManometerMessage(null);
                        }}
                      >
                        Editar
                      </button>
                      <button className="secondary-button" type="button" onClick={() => void handleManometerDeactivate(item.id)}>
                        Desativar
                      </button>
                    </div>
                  </div>
                  <div className="admin-card-meta">
                    <span>Calibração: {formatDate(item.calibratedAt)}</span>
                    <span>Vencimento: {formatDate(item.expiresAt)}</span>
                    <span>{item.isActive ? 'Ativo' : 'Inativo'}</span>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <p className="placeholder-copy">Nenhum manômetro cadastrado.</p>
          )}
        </section>
      </>
    );
  }

  function renderContadoresTab() {
    const counters = countersQuery.data || [];

    if (countersQuery.isLoading) {
      return <div className="page-card placeholder-copy">Carregando contadores...</div>;
    }

    return (
      <>
        <section className="page-card">
          <div className="section-title">{counterEditingId ? 'Editar contador' : 'Novo contador'}</div>
          {counterMessage ? <div className="inline-success">{counterMessage}</div> : null}
          <form className="admin-form-grid" onSubmit={handleCounterSubmit}>
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
                className="primary-button"
                type="submit"
                disabled={counterMutations.createCounter.isPending || counterMutations.updateCounter.isPending}
              >
                {counterEditingId ? 'Salvar contador' : 'Criar contador'}
              </button>
              {counterEditingId ? (
                <button className="secondary-button" type="button" onClick={resetCounterForm}>
                  {'Cancelar edi\u00e7\u00e3o'}
                </button>
              ) : null}
            </div>
          </form>
        </section>

        <section className="page-card">
          <div className="section-title">Contadores</div>
          {counters.length ? (
            <div className="admin-stack">
              {counters.map(item => (
                <article className="admin-card-react" key={item.id}>
                  <div className="admin-card-head">
                    <div>
                      <div className="admin-card-title">{item.code}</div>
                      <div className="admin-card-subtitle">Serial {item.serialNumber}</div>
                    </div>
                    <div className="admin-card-actions">
                      <button
                        className="secondary-button"
                        type="button"
                        onClick={() => {
                          setCounterEditingId(item.id);
                          setCounterForm(counterToForm(item));
                          setCounterMessage(null);
                        }}
                      >
                        Editar
                      </button>
                      <button className="secondary-button" type="button" onClick={() => void handleCounterDeactivate(item.id)}>
                        Desativar
                      </button>
                    </div>
                  </div>
                  <div className="admin-card-meta">
                    <span>{'Calibra\u00e7\u00e3o'}: {formatDate(item.calibratedAt)}</span>
                    <span>Vencimento: {formatDate(item.expiresAt)}</span>
                    <span>{item.isActive ? 'Ativo' : 'Inativo'}</span>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <p className="placeholder-copy">Nenhum contador cadastrado.</p>
          )}
        </section>
      </>
    );
  }

  function renderTabContent() {
    if (tab === 'pendentes' || tab === 'aprovados' || tab === 'arquivados') return renderReportTabContent();
    if (tab === 'projetos') return renderProjectsTab();
    if (tab === 'equipe') return renderEquipeTab();
    if (tab === 'usuarios') return renderUsuariosTab();
    if (tab === 'equipamentos') return renderEquipamentosTab();
    if (tab === 'manometros') return renderManometrosTab();
    return renderContadoresTab();
  }

  return (
    <Shell>
      <TopBar
        title="Painel do gestor"
        subtitle={user?.name}
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

      <main className="page-scroll">
        <section className="page-card">
          <div className="section-title">Resumo</div>
          <div className="stats-grid">
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

        <section className="page-card">
          <div className="section-title">Painel</div>
          <div className="filter-tabs">
            <button className={`filter-tab ${tab === 'pendentes' ? 'active' : ''}`} type="button" onClick={() => setTab('pendentes')}>
              Pendentes
            </button>
            <button className={`filter-tab ${tab === 'aprovados' ? 'active' : ''}`} type="button" onClick={() => setTab('aprovados')}>
              Aprovados
            </button>
            <button className={`filter-tab ${tab === 'arquivados' ? 'active' : ''}`} type="button" onClick={() => setTab('arquivados')}>
              Arquivados
            </button>
            <button className={`filter-tab ${tab === 'projetos' ? 'active' : ''}`} type="button" onClick={() => setTab('projetos')}>
              Projetos
            </button>
            <button className={`filter-tab ${tab === 'equipe' ? 'active' : ''}`} type="button" onClick={() => setTab('equipe')}>
              Equipe
            </button>
            <button className={`filter-tab ${tab === 'usuarios' ? 'active' : ''}`} type="button" onClick={() => setTab('usuarios')}>
              {'Usu\u00e1rios'}
            </button>
            <button className={`filter-tab ${tab === 'equipamentos' ? 'active' : ''}`} type="button" onClick={() => setTab('equipamentos')}>
              Equipamentos
            </button>
            <button className={`filter-tab ${tab === 'manometros' ? 'active' : ''}`} type="button" onClick={() => setTab('manometros')}>
              {'Man\u00f4metros'}
            </button>
            <button className={`filter-tab ${tab === 'contadores' ? 'active' : ''}`} type="button" onClick={() => setTab('contadores')}>
              Contadores
            </button>
          </div>
        </section>

        {renderTabContent()}
      </main>
    </Shell>
  );
}
