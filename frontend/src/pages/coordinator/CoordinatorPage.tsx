import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { downloadReportPdf } from '../../api/reports';
import { useAuth } from '../../auth/AuthContext';
import { GroupedReportList } from '../../components/reports/GroupedReportList';
import { ReportSummaryCard } from '../../components/reports/ReportSummaryCard';
import { useToast } from '../../components/ui/Toast';
import { useProjects } from '../../hooks/useProjects';
import { useReports } from '../../hooks/useReports';
import { Shell } from '../../layout/Shell';
import { TopBar } from '../../layout/TopBar';
import { useRdoStore } from '../../store/rdoStore';
import type { Project, ReportSummary } from '../../types/domain';
import { downloadBlob } from '../../utils/download';
import { compareReportTypes, ProjectSortButton, sortProjects, sortReportsInGroup, type ProjectSortDirection } from '../../utils/projectSort';
import { reportDownloadFileName } from '../../utils/reportFileName';
import { matchesSearch, projectSearchParts, reportSearchParts } from '../../utils/search';
import { handleHorizontalTabListKeyDown } from '../../utils/tabKeyboard';

type CoordinatorTab = 'pending' | 'approved' | 'archived';

const TEXT = {
  archived: 'Arquivados',
  approved: 'Aprovados',
  coordinatorPanel: 'Painel do coordenador',
  downloadError: 'Não foi possível baixar o relatório.',
  loading: 'Carregando relatórios...',
  noArchived: 'Nenhum relatório arquivado.',
  noApproved: 'Nenhum relatório aprovado.',
  noPending: 'Nenhum relatório pendente.',
  pending: 'Pendentes',
  reports: 'Relatórios'
};

export function CoordinatorPage() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const { reset } = useRdoStore();
  const [tab, setTab] = useState<CoordinatorTab>('pending');
  const [search, setSearch] = useState('');
  const [projectSortDir, setProjectSortDir] = useState<ProjectSortDirection>('asc');
  const [closedArchivedProjectIds, setClosedArchivedProjectIds] = useState<string[]>([]);
  const [closedArchivedTypeKeys, setClosedArchivedTypeKeys] = useState<string[]>([]);
  const [archivedTypeSortDirections, setArchivedTypeSortDirections] = useState<Record<string, ProjectSortDirection>>({});
  const showToast = useToast();
  const reportsQuery = useReports();
  const archivedProjectsQuery = useProjects(false);

  const pendingReports = useMemo(
    () =>
      (reportsQuery.data || []).filter(
        report => report.createdByUserId === user?.id && (report.status === 'PENDING' || report.status === 'RETURNED')
      ),
    [reportsQuery.data, user?.id]
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

  const visibleReports = useMemo(() => {
    const sourceReports = tab === 'pending' ? pendingReports : tab === 'archived' ? archivedReports : approvedReports;
    return sourceReports.filter(report => matchesSearch(reportSearchParts(report), search));
  }, [approvedReports, archivedReports, pendingReports, search, tab]);

  async function handleLogout() {
    await logout();
    navigate('/', { replace: true });
  }

  function handleNewReport() {
    reset();
    navigate('/relatorio/novo');
  }

  async function handleDownloadPdf(report: ReportSummary) {
    showToast('Gerando PDF...', 'info');
    try {
      const blob = await downloadReportPdf(report.id);
      downloadBlob(blob, reportDownloadFileName(report, 'pdf'));
      showToast('PDF gerado com sucesso.', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : TEXT.downloadError, 'error');
    }
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

  function renderReportActions(report: ReportSummary) {
    return (
      <button className="secondary-button" type="button" onClick={() => void handleDownloadPdf(report)}>
        PDF
      </button>
    );
  }

  function renderReportGroups() {
    return (
      <GroupedReportList
        reports={visibleReports}
        archived={tab === 'archived'}
        sortDirection={projectSortDir}
        showTypeSort
        storageKey={`coordinator-report-groups:${user?.id || user?.username || 'anonymous'}:${tab}`}
        renderReport={report => (
          <ReportSummaryCard key={report.id} report={report} actions={renderReportActions(report)} />
        )}
      />
    );
  }

  function renderArchivedReportTypeSections(reports: ReportSummary[], projectId: string) {
    const byType = reports.reduce<Record<string, ReportSummary[]>>((acc, report) => {
      if (!acc[report.reportType]) acc[report.reportType] = [];
      acc[report.reportType].push(report);
      return acc;
    }, {});

    return Object.entries(byType)
      .sort(([a], [b]) => compareReportTypes(a, b))
      .map(([reportType, typeReports]) => {
        const typeKey = `${projectId}-${reportType}`;
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
                  <ReportSummaryCard key={report.id} report={report} actions={renderReportActions(report)} />
                ))}
              </div>
            ) : null}
          </div>
        );
      });
  }

  function renderProjectCard(project: Project, projectReports: ReportSummary[]) {
    const projectClosed = closedArchivedProjectIds.includes(project.id);

    return (
      <article className="card admin-card" key={project.id}>
        <div className="admin-card-head">
          <div>
            <div className="admin-card-title">
              {project.code} - {project.name}
              <span className="badge badge-rev" style={{ textTransform: 'none', marginLeft: 6 }}>
                Arquivado
              </span>
            </div>
            <div className="admin-card-meta">
              <span>{project.clientName}</span>
              <span>{project.location}</span>
              <span>{projectReports.length} relatório{projectReports.length !== 1 ? 's' : ''}</span>
            </div>
          </div>
          <div className="admin-card-actions">
            <button className="mini-btn alt" type="button" onClick={() => toggleArchivedProject(project.id)}>
              {projectClosed ? 'Ver relatórios' : 'Ocultar relatórios'}
            </button>
          </div>
        </div>
        <div className="det-section" style={{ marginTop: 12 }}>
          <div className="det-row"><span className="det-label">Cliente</span><span className="det-val">{project.clientName}</span></div>
          <div className="det-row"><span className="det-label">Contrato</span><span className="det-val">{project.contractCode || '-'}</span></div>
          <div className="det-row"><span className="det-label">Local</span><span className="det-val">{project.location || '-'}</span></div>
          <div className="det-row"><span className="det-label">Líder</span><span className="det-val">{project.operator?.name || 'Não informado'}</span></div>
        </div>
        {!projectClosed ? (
          projectReports.length ? (
            <div className="admin-stack" style={{ marginTop: 14 }}>
              {renderArchivedReportTypeSections(projectReports, project.id)}
            </div>
          ) : (
            <div className="placeholder-copy" style={{ marginTop: 14 }}>
              Nenhum relatório aprovado neste projeto arquivado.
            </div>
          )
        ) : null}
      </article>
    );
  }

  function renderArchivedTab() {
    const archivedProjects = (archivedProjectsQuery.data || []).filter(project => project.isActive === false);

    if (archivedProjectsQuery.isLoading || reportsQuery.isLoading) {
      return <div className="page-card placeholder-copy">Carregando projetos arquivados...</div>;
    }

    const projectCards = sortProjects(archivedProjects, projectSortDir)
      .map(project => {
        const projectReports = archivedReports.filter(report => report.projectId === project.id);
        const projectMatches = matchesSearch(projectSearchParts(project), search);
        const filteredReports = projectMatches
          ? projectReports
          : projectReports.filter(report => matchesSearch(reportSearchParts(report), search));
        return {
          project,
          projectReports: filteredReports,
          visible: projectMatches || filteredReports.length > 0
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
        {projectCards.length ? (
          <div className="admin-stack">
            {projectCards.map(({ project, projectReports }) => renderProjectCard(project, projectReports))}
          </div>
        ) : (
          <p className="placeholder-copy">
            {search.trim() ? 'Nenhum projeto arquivado encontrado.' : TEXT.noArchived}
          </p>
        )}
      </section>
    );
  }

  function renderTabContent() {
    if (tab === 'archived') return renderArchivedTab();

    if (reportsQuery.isLoading) return <div className="page-card placeholder-copy">{TEXT.loading}</div>;

    return (
      <>
        <div className="admin-create-toolbar">
          {tab === 'pending' ? (
            <button className="mini-btn" type="button" onClick={handleNewReport}>
              + Criar Relatório
            </button>
          ) : null}
          <ProjectSortButton
            direction={projectSortDir}
            onToggle={() => setProjectSortDir(direction => direction === 'asc' ? 'desc' : 'asc')}
          />
        </div>
        {!visibleReports.length ? (
          <div className="page-card placeholder-copy">
            {tab === 'pending' ? TEXT.noPending : TEXT.noApproved}
          </div>
        ) : null}
        {renderReportGroups()}
      </>
    );
  }

  return (
    <Shell>
      <TopBar
        title={TEXT.coordinatorPanel}
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
        <div className="nav-tabs" role="tablist" aria-label="Seções do coordenador" onKeyDown={handleHorizontalTabListKeyDown}>
          <button className={`nav-tab ${tab === 'pending' ? 'active' : ''}`} type="button" role="tab" aria-selected={tab === 'pending'} onClick={() => setTab('pending')}>
            {TEXT.pending}
            <span className="nav-tab-count">{pendingReports.length}</span>
          </button>
          <button className={`nav-tab ${tab === 'approved' ? 'active' : ''}`} type="button" role="tab" aria-selected={tab === 'approved'} onClick={() => setTab('approved')}>
            {TEXT.approved}
          </button>
          <button className={`nav-tab ${tab === 'archived' ? 'active' : ''}`} type="button" role="tab" aria-selected={tab === 'archived'} onClick={() => setTab('archived')}>
            {TEXT.archived}
          </button>
        </div>
      </div>
      <main className="page-scroll">
        <section className="page-card">
          <div className="section-title">{TEXT.reports}</div>
          <div className="admin-search-row">
            <input
              aria-label={`Buscar em ${tab === 'pending' ? 'pendentes' : tab === 'archived' ? 'arquivados' : 'aprovados'}`}
              placeholder={`Buscar em ${tab === 'pending' ? 'pendentes' : tab === 'archived' ? 'arquivados' : 'aprovados'}`}
              value={search}
              onChange={event => setSearch(event.target.value)}
            />
          </div>
        </section>
        {renderTabContent()}
      </main>
    </Shell>
  );
}
