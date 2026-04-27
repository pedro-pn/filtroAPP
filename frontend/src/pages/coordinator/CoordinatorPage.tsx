import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { downloadReportPdf } from '../../api/reports';
import { useAuth } from '../../auth/AuthContext';
import { ReportSummaryCard } from '../../components/reports/ReportSummaryCard';
import { useReports } from '../../hooks/useReports';
import { Shell } from '../../layout/Shell';
import { TopBar } from '../../layout/TopBar';
import type { ReportSummary } from '../../types/domain';
import { downloadBlob } from '../../utils/download';
import { groupByProject } from '../../utils/groupByProject';

type CoordinatorTab = 'approved' | 'archived';

const TEXT = {
  archived: 'Arquivados',
  approved: 'Aprovados',
  coordinatorPanel: 'Painel do coordenador',
  downloadError: 'N\u00e3o foi poss\u00edvel baixar o relat\u00f3rio.',
  loading: 'Carregando relat\u00f3rios...',
  noArchived: 'Nenhum relat\u00f3rio arquivado.',
  noApproved: 'Nenhum relat\u00f3rio aprovado.',
  reports: 'Relat\u00f3rios'
};

export function CoordinatorPage() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const [tab, setTab] = useState<CoordinatorTab>('approved');
  const [message, setMessage] = useState<string | null>(null);
  const reportsQuery = useReports();

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

  const visibleReports = tab === 'archived' ? archivedReports : approvedReports;

  async function handleLogout() {
    await logout();
    navigate('/', { replace: true });
  }

  async function handleDownloadPdf(report: ReportSummary) {
    setMessage(null);
    try {
      const blob = await downloadReportPdf(report.id);
      downloadBlob(blob, `${report.reportType}_${report.sequenceNumber || report.id}.pdf`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : TEXT.downloadError);
    }
  }

  return (
    <Shell>
      <TopBar
        title={TEXT.coordinatorPanel}
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
          <div className="section-title">{TEXT.reports}</div>
          <div className="filter-tabs">
            <button
              className={`filter-tab ${tab === 'approved' ? 'active' : ''}`}
              type="button"
              onClick={() => setTab('approved')}
            >
              {TEXT.approved}
            </button>
            <button
              className={`filter-tab ${tab === 'archived' ? 'active' : ''}`}
              type="button"
              onClick={() => setTab('archived')}
            >
              {TEXT.archived}
            </button>
          </div>
        </section>

        {message ? <div className="page-card inline-error">{message}</div> : null}
        {reportsQuery.isLoading ? <div className="page-card placeholder-copy">{TEXT.loading}</div> : null}
        {!reportsQuery.isLoading && !visibleReports.length ? (
          <div className="page-card placeholder-copy">
            {tab === 'archived' ? TEXT.noArchived : TEXT.noApproved}
          </div>
        ) : null}
        {tab === 'archived'
          ? groupByProject(visibleReports).map(group => (
              <div key={group.projectId}>
                <div className="project-group-header">
                  <span className="project-group-code">{group.projectCode}</span>
                  <span className="project-group-name project-group-name--archived">{group.projectName}</span>
                  <span className="project-group-badge">Arquivado</span>
                </div>
                {group.reports.map(report => (
                  <ReportSummaryCard
                    key={report.id}
                    report={report}
                    actions={
                      <button className="secondary-button" type="button" onClick={() => void handleDownloadPdf(report)}>
                        PDF
                      </button>
                    }
                  />
                ))}
              </div>
            ))
          : visibleReports.map(report => (
              <ReportSummaryCard
                key={report.id}
                report={report}
                actions={
                  <button className="secondary-button" type="button" onClick={() => void handleDownloadPdf(report)}>
                    PDF
                  </button>
                }
              />
            ))}
      </main>
    </Shell>
  );
}
