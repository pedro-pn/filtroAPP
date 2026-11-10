import { OverviewCountCard, DesignSystemOverviewCountCard } from './StatsCountCards';
import { useState } from 'react';
import { useUsefulQueryContent } from '../../observability/useUsefulContent';
import { BrandLoading } from '../brand/BrandLoading';
import { SortableTable } from '../ui/SortableTable';
import { AppIcon } from '../icons/AppIcon';
import { DS_ICONS } from '../ui/ds/icons';
import { Alert, Button, Card, DataTable, EmptyState, type DataTableColumn } from '../ui/ds';
import { useStatsOverview } from '../../hooks/useProjectStats';
import type { StatsOverviewProject, StatsOverviewResponse } from '../../api/statistics';
import './StatsDashboard.ds.css';

// ─── Stats Overview (mini dashboard na aba) ───────────────────────────────────

const REPORT_TYPE_LABELS: Record<string, string> = {
  RDO: 'RDO',
  RTP: 'RTP',
  RLQ: 'RLQ',
  RCPU: 'RCPU',
  RLM: 'RLM',
  RLF: 'RLF',
  RLI: 'RLI'
};

const ALL_REPORT_TYPES = ['RDO', 'RTP', 'RLQ', 'RCPU', 'RLM', 'RLF', 'RLI'];

function TopProjectsBar({ rows }: { rows: StatsOverviewProject[] }) {
  const maxRdo = Math.max(...rows.map((r) => r.rdoCount), 1);
  return (
    <div className="stats-ov-bar-list">
      {rows.map((row) => (
        <div key={row.projectId} className="stats-ov-bar-row">
          <span className="stats-ov-bar-code">{row.code}</span>
          <span className="stats-ov-bar-name">{row.name}</span>
          <div className="stats-ov-bar-track">
            <div
              className="stats-ov-bar-fill"
              style={{ width: `${(row.rdoCount / maxRdo) * 100}%` }}
            />
          </div>
          <span className="stats-ov-bar-count">{row.rdoCount}</span>
        </div>
      ))}
    </div>
  );
}

function ReportTypeTable({ rows }: { rows: StatsOverviewProject[] }) {
  const usedTypes = ALL_REPORT_TYPES.filter(t => rows.some(r => (r.reportCounts[t] ?? 0) > 0));

  return (
    <div style={{ overflowX: 'auto' }}>
      <SortableTable className="stats-ov-type-table">
        <thead>
          <tr>
            <th>Projeto</th>
            {usedTypes.map(t => <th key={t}>{REPORT_TYPE_LABELS[t]}</th>)}
            <th>Total</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(row => {
            const total = Object.values(row.reportCounts).reduce((a, b) => (a as number) + (b as number), 0) as number;
            return (
              <tr key={row.projectId}>
                <td className="stats-ov-type-project">
                  <span className="stats-ov-type-code">{row.code}</span>
                  <span className="stats-ov-type-name">{row.name}</span>
                </td>
                {usedTypes.map(t => (
                  <td key={t} className="stats-ov-type-num" data-sort-value={row.reportCounts[t] ?? 0}>
                    {row.reportCounts[t]
                      ? <strong>{row.reportCounts[t]}</strong>
                      : <span className="stats-ov-type-zero">—</span>}
                  </td>
                ))}
                <td className="stats-ov-type-num stats-ov-type-total" data-sort-value={total}>{total || '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </SortableTable>
    </div>
  );
}

type StatsOverviewAppearance = 'legacy' | 'design-system';

interface StatsOverviewProps {
  appearance?: StatsOverviewAppearance;
}

function reportCountTotal(row: StatsOverviewProject) {
  return Object.values(row.reportCounts).reduce(
    (total: number, count) => total + (count ?? 0),
    0
  );
}

function DesignSystemTopProjectsBar({
  rows
}: {
  rows: StatsOverviewProject[];
}) {
  const maxRdo = Math.max(...rows.map((row) => row.rdoCount), 1);

  return (
    <div className="rdo-stats-overview__bar-list" role="list">
      {rows.map((row) => (
        <div
          className="rdo-stats-overview__bar-row"
          key={row.projectId}
          role="listitem"
        >
          <div className="rdo-stats-overview__bar-copy">
            <span className="rdo-stats-overview__bar-code">{row.code}</span>
            <span className="rdo-stats-overview__bar-name">{row.name}</span>
          </div>
          <span
            className="rdo-stats-overview__bar-count"
            aria-label={`${row.rdoCount} RDOs aprovados ou assinados`}
          >
            {row.rdoCount}
          </span>
          <div
            className="rdo-stats-overview__bar-track"
            role="progressbar"
            aria-label={`${row.code}: RDOs aprovados ou assinados`}
            aria-valuemin={0}
            aria-valuemax={maxRdo}
            aria-valuenow={row.rdoCount}
          >
            <div
              className="rdo-stats-overview__bar-fill"
              style={{ width: `${(row.rdoCount / maxRdo) * 100}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function DesignSystemReportTypeTable({
  rows
}: {
  rows: StatsOverviewProject[];
}) {
  const usedTypes = ALL_REPORT_TYPES.filter((type) =>
    rows.some((row) => (row.reportCounts[type] ?? 0) > 0)
  );
  const columns: DataTableColumn<StatsOverviewProject>[] = [
    {
      key: 'project',
      header: 'Projeto',
      rowHeader: true,
      render: (row) => (
        <span className="stats-ov-type-project rdo-stats-overview__project">
          <span className="stats-ov-type-code">{row.code}</span>
          <span className="stats-ov-type-name">{row.name}</span>
        </span>
      )
    },
    ...usedTypes.map<DataTableColumn<StatsOverviewProject>>((type) => ({
      key: type,
      header: REPORT_TYPE_LABELS[type],
      align: 'center',
      numeric: true,
      render: (row) =>
        row.reportCounts[type] ? (
          <strong>{row.reportCounts[type]}</strong>
        ) : (
          <span className="rdo-stats-overview__zero">—</span>
        )
    })),
    {
      key: 'total',
      header: 'Total',
      align: 'center',
      numeric: true,
      render: (row) => (
        <strong className="rdo-stats-overview__total">
          {reportCountTotal(row) || '—'}
        </strong>
      )
    }
  ];

  return (
    <DataTable
      className="rdo-stats-overview__table"
      rows={rows}
      columns={columns}
      getRowId={(row) => row.projectId}
      ariaLabel="Relatórios por projeto e tipo"
      density="compact"
      mobile={{
        ariaLabel: 'Relatórios por projeto e tipo',
        renderItem: (row) => ({
          title: row.code,
          subtitle: row.name,
          value: (
            <span
              aria-label={
                reportCountTotal(row)
                  ? `Total: ${reportCountTotal(row)}`
                  : 'Total: nenhum relatório'
              }
            >
              {reportCountTotal(row) || '—'}
            </span>
          ),
          metadata: usedTypes
            .filter((type) => (row.reportCounts[type] ?? 0) > 0)
            .map((type) => ({
              label: REPORT_TYPE_LABELS[type],
              value: row.reportCounts[type]
            }))
        })
      }}
    />
  );
}

function DesignSystemStatsOverviewLoading() {
  return (
    <div
      className="rdo-manager-stats-overview rdo-stats-overview rdo-stats-overview--loading"
      role="status"
      aria-label="Carregando visão geral..."
      aria-busy="true"
    >
      <span className="fv-sr-only">Carregando visão geral...</span>
      <BrandLoading decorative />
    </div>
  );
}

function DesignSystemStatsOverview({
  data,
  top10,
  tableRows,
  totalProjectsWithReports,
  showAll,
  onShowAll
}: {
  data: StatsOverviewResponse;
  top10: StatsOverviewProject[];
  tableRows: StatsOverviewProject[];
  totalProjectsWithReports: number;
  showAll: boolean;
  onShowAll: () => void;
}) {
  return (
    <div className="rdo-manager-stats-overview rdo-stats-overview">
      <section
        className="rdo-stats-overview__section rdo-stats-overview__summary"
        aria-label="Resumo dos projetos"
      >
        <div className="rdo-stats-overview__count-grid">
          <DesignSystemOverviewCountCard
            label="Em andamento"
            value={data.projectCounts.active}
            description="Projetos em operação"
            tone="success"
            icon={<AppIcon icon={DS_ICONS.alertSuccess} size="md" />}
          />
          <DesignSystemOverviewCountCard
            label="Arquivados / finalizados"
            value={data.projectCounts.archived}
            description="Fora da operação ativa"
            tone="neutral"
            icon={<AppIcon icon={DS_ICONS.emptyDefault} size="md" />}
          />
          <DesignSystemOverviewCountCard
            label="Total"
            value={data.projectCounts.total}
            description="Projetos na base atual"
            tone="brand"
            icon={<AppIcon icon={DS_ICONS.fileText} size="md" />}
          />
        </div>
      </section>

      {top10.length > 0 ? (
        <Card
          className="rdo-stats-overview__section"
          title={
            <h2 className="rdo-stats-overview__title">
              Projetos com mais RDOs aprovados / assinados
            </h2>
          }
        >
          <DesignSystemTopProjectsBar rows={top10} />
        </Card>
      ) : null}

      {tableRows.length > 0 ? (
        <Card
          className="rdo-stats-overview__section"
          title={
            <h2 className="rdo-stats-overview__title">
              Relatórios por projeto e tipo
            </h2>
          }
        >
          <DesignSystemReportTypeTable rows={tableRows} />
          {totalProjectsWithReports > 15 && !showAll ? (
            <div className="rdo-stats-overview__show-more">
              <Button variant="secondary" fullWidth onClick={onShowAll}>
                Ver todos os {totalProjectsWithReports} projetos
              </Button>
            </div>
          ) : null}
        </Card>
      ) : null}

      {data.byProject.length === 0 ? (
        <Card className="rdo-stats-overview__section">
          <EmptyState
            title="Nenhum relatório aprovado ou assinado encontrado."
            description="Os dados aparecerão aqui quando houver relatórios disponíveis."
          />
        </Card>
      ) : null}
    </div>
  );
}

export function StatsOverview({
  appearance = 'legacy'
}: StatsOverviewProps = {}) {
  const overviewQuery = useStatsOverview();
  const { data, isLoading, isError } = overviewQuery;
  useUsefulQueryContent('gestor:estatisticas', 'overview', [overviewQuery], appearance === 'design-system');
  const [showAll, setShowAll] = useState(false);

  if (isLoading) {
    return appearance === 'design-system' ? (
      <DesignSystemStatsOverviewLoading />
    ) : (
      <div className="page-card placeholder-copy">
        <BrandLoading label="Carregando visão geral" /></div>
    );
  }
  if (isError) {
    return appearance === 'design-system' ? (
      <div className="rdo-manager-stats-overview rdo-stats-overview">
        <Alert tone="danger" title="Erro ao carregar dados." />
      </div>
    ) : (
      <div
        className="page-card placeholder-copy"
        style={{ color: 'var(--rd)' }}
      >
        Erro ao carregar dados.
      </div>
    );
  }
  if (!data) return null;

  const top10 = data.byProject.slice(0, 10);
  const withReports = data.byProject.filter(
    (r) => Object.keys(r.reportCounts).length > 0
  );
  const tableRows = showAll ? withReports : withReports.slice(0, 15);

  if (appearance === 'design-system') {
    return (
      <DesignSystemStatsOverview
        data={data}
        top10={top10}
        tableRows={tableRows}
        totalProjectsWithReports={withReports.length}
        showAll={showAll}
        onShowAll={() => setShowAll(true)}
      />
    );
  }

  return (
    <div className="stats-ov-wrap">
      {/* Contadores */}
      <div className="survey-dash-card stats-ov-section">
        <div className="survey-dash-card-title">Projetos</div>
        <div className="stats-ov-count-row">
          <OverviewCountCard label="Em andamento" value={data.projectCounts.active} />
          <OverviewCountCard label="Arquivados / finalizados" value={data.projectCounts.archived} />
          <OverviewCountCard label="Total" value={data.projectCounts.total} />
        </div>
      </div>

      {/* Top por RDOs */}
      {top10.length > 0 && (
        <div className="survey-dash-card stats-ov-section">
          <div className="survey-dash-card-title">Projetos com mais RDOs aprovados / assinados</div>
          <TopProjectsBar rows={top10} />
        </div>
      )}

      {/* Relatórios por tipo */}
      {tableRows.length > 0 && (
        <div className="survey-dash-card stats-ov-section">
          <div className="survey-dash-card-title">Relatórios por projeto e tipo</div>
          <ReportTypeTable rows={tableRows} />
          {withReports.length > 15 && !showAll && (
            <button type="button" className="stats-ov-show-more" onClick={() => setShowAll(true)}>
              Ver todos os {withReports.length} projetos
            </button>
          )}
        </div>
      )}

      {data.byProject.length === 0 && (
        <div className="survey-dash-card">
          <div className="stats-empty">Nenhum relatório aprovado ou assinado encontrado.</div>
        </div>
      )}
    </div>
  );
}
