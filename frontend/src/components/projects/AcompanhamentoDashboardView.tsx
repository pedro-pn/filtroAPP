import type { DashboardItem, DashboardRow, RealizedCategory } from '../../api/acompanhamentoComercial';
import { Alert, Badge, BarList, Card, EmptyState, MetricCard, Skeleton } from '../ui/ds';
import { AcompanhamentoDashboardFilters, type DashboardFilterValues } from './AcompanhamentoDashboardFilters';
import { AcompanhamentoDashboardListing } from './AcompanhamentoDashboardListing';
import { brl, filterDashboardRows, fmt, itemKey, METRICS, toNum } from './acompanhamentoDashboardModel';
import { RealizedCategoryBreakdown } from './RealizedCategoryBreakdown';
import './AcompanhamentoDashboard.ds.css';

export interface AcompanhamentoDashboardViewProps {
  data?: DashboardItem[];
  loading: boolean;
  error: boolean;
  updating: boolean;
  onRetry: () => void;
  values: DashboardFilterValues;
  onChange: (patch: Partial<DashboardFilterValues>) => void;
  categories: RealizedCategory[];
  categoriesLoading: boolean;
  categoriesError: boolean;
  onRetryCategories: () => void;
  onOpen: (row: DashboardRow) => void;
}

export function AcompanhamentoDashboardView({ data, loading, error, updating, onRetry,
  values, onChange, categories, categoriesLoading, categoriesError, onRetryCategories, onOpen
}: AcompanhamentoDashboardViewProps) {
  const filtered = filterDashboardRows(data ?? [], values);
  const metric = METRICS.find(item => item.key === values.metricKey) ?? METRICS[0];
  const totals = {
    count: filtered.length,
    venda: filtered.reduce((sum, row) => sum + (toNum(row.salePrice) ?? 0), 0),
    custo: filtered.reduce((sum, row) => sum + (toNum(row.plannedTotalCost) ?? 0), 0),
    metric: filtered.reduce((sum, row) => sum + (metric.get(row) ?? 0), 0)
  };
  const chartData = filtered.map(row => ({ row, value: metric.get(row) ?? 0 }))
    .filter(item => item.value > 0).sort((a, b) => b.value - a.value).slice(0, 15);
  const maxValue = chartData.reduce((max, item) => Math.max(max, item.value), 0);
  const hasFilters = Boolean(values.search.trim() || values.modality !== 'todas' || values.status !== 'todos' || values.category);

  return (
    <div className="fv-ds acp-overview">
      <header className="acp-overview__heading">
        <div><h1>Visão dos projetos</h1><p>Compare o previsto e o realizado, acompanhe custos e consulte o cronograma.</p></div>
      </header>
      <AcompanhamentoDashboardFilters values={values} onChange={onChange} categories={categories}
        categoriesLoading={categoriesLoading} updating={updating} />
      {categoriesError ? <Alert tone="warning" title="Não foi possível atualizar as categorias"
        action={{ label: 'Tentar novamente', onClick: onRetryCategories }}>A busca e os demais filtros continuam disponíveis.</Alert> : null}
      {error ? <Alert tone="danger" title={data ? 'Não foi possível atualizar o dashboard' : 'Não foi possível carregar o dashboard'}
        action={{ label: 'Tentar novamente', onClick: onRetry }}>
        {data ? 'Exibindo a última consulta disponível. Os valores podem estar desatualizados.' : 'Tente novamente para consultar os dados dos projetos.'}
      </Alert> : null}
      <div id="acp-dashboard-results" className="acp-overview__results" aria-busy={loading || updating}>
        {loading ? (
          <div role="status" aria-label="Carregando acompanhamento" className="acp-overview__results">
            <div className="acp-overview__metrics">{[0, 1, 2, 3].map(id => <Skeleton key={id} variant="card" height="7rem" decorative />)}</div>
            <Skeleton variant="card" height="18rem" decorative />
          </div>
        ) : data ? filtered.length === 0 ? (
          <EmptyState variant={hasFilters ? 'search' : 'default'} title={hasFilters ? 'Nenhum projeto encontrado' : 'Nenhum projeto com proposta comercial'}
            description={hasFilters ? 'Ajuste os filtros para encontrar outros projetos.' : 'Importe o banco do comercial e cadastre a missão com o número da proposta.'}
            action={hasFilters ? { label: 'Limpar filtros', onClick: () => onChange({ search: '', modality: 'todas', status: 'todos', category: '' }) } : undefined} />
        ) : (
          <>
            <div className="acp-overview__metrics" data-acp-kpis>
              <MetricCard label="Projetos e grupos" value={totals.count} description="Itens exibidos neste recorte" />
              <MetricCard label="Venda prevista" value={brl(totals.venda)} description="Total dos itens filtrados" />
              <MetricCard label="Custo previsto" value={brl(totals.custo)} description="Total dos itens filtrados" />
              <MetricCard label={metric.label} value={fmt(totals.metric, metric.unit)} description="Soma dos itens filtrados" tone="info" />
            </div>
            <div className="acp-overview__charts">
              <Card title="Comparativo por projeto" actions={<Badge tone="neutral">Recorte filtrado</Badge>}>
                <p className="acp-overview__description">{metric.label} · até 15 maiores valores positivos.</p>
                {chartData.length ? <BarList aria-label={`${metric.label} por projeto`} items={chartData.map(({ row, value }) => ({
                  id: itemKey(row), label: row.code, description: row.name || row.clientName,
                  valueLabel: fmt(value, metric.unit), percentage: maxValue ? Math.max(2, (value / maxValue) * 100) : 0
                }))} /> : <EmptyState title="Sem valores positivos para comparar" description="Selecione outro indicador ou ajuste os filtros." />}
              </Card>
              <Card title="Realizado por categoria" actions={<Badge tone="neutral">Visão global</Badge>}>
                <p className="acp-overview__description">Compras do Omie de todos os projetos vinculados. Não acompanha os filtros acima.</p>
                <RealizedCategoryBreakdown appearance="design-system" />
              </Card>
            </div>
            <section className="acp-overview__listing" data-acp-dashboard-table aria-labelledby="acp-projects-title">
              <div className="acp-overview__heading"><div>
                <h2 id="acp-projects-title">Projetos e grupos ({filtered.length})</h2>
                <p>Selecione o nome do projeto para abrir o cronograma. Grupos apresentam valores consolidados.</p>
              </div></div>
              <AcompanhamentoDashboardListing rows={filtered} onOpen={onOpen} />
            </section>
          </>
        ) : null}
      </div>
    </div>
  );
}
