import { ReportSummaryCard } from '../../components/reports/ReportSummaryCard';
import { Shell } from '../../layout/Shell';
import { TopBar } from '../../layout/TopBar';
import { useReports } from '../../hooks/useReports';

export function MyReportsPage() {
  const reportsQuery = useReports({ mine: true });
  const reports = (reportsQuery.data || []).filter(report => report.project?.isActive !== false);

  return (
    <Shell>
      <TopBar title="Meus relatórios" subtitle="Projetos ativos" />
      <main className="page-scroll">
        {reportsQuery.isLoading ? <div className="page-card placeholder-copy">Carregando relatórios...</div> : null}
        {!reportsQuery.isLoading && !reports.length ? (
          <div className="page-card placeholder-copy">Nenhum relatório enviado por você.</div>
        ) : null}
        {reports.map(report => (
          <ReportSummaryCard key={report.id} report={report} />
        ))}
      </main>
    </Shell>
  );
}
