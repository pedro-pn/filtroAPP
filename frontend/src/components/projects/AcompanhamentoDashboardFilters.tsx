import type { RealizedCategory } from '../../api/acompanhamentoComercial';
import { Field, FilterBar, SearchInput, Select, type ActiveFilter } from '../ui/ds';
import { METRICS, type DashboardFilters } from './acompanhamentoDashboardModel';

export interface DashboardFilterValues extends DashboardFilters { category: string; metricKey: string }

export function AcompanhamentoDashboardFilters({ values, onChange, categories, categoriesLoading, updating, metrics }: {
  values: DashboardFilterValues;
  onChange: (patch: Partial<DashboardFilterValues>) => void;
  categories: RealizedCategory[];
  categoriesLoading: boolean;
  updating: boolean;
  metrics: typeof METRICS;
}) {
  const active: ActiveFilter[] = [];
  if (values.search.trim()) active.push({ id: 'search', label: `Busca: ${values.search}`, onRemove: () => onChange({ search: '' }) });
  if (values.modality !== 'todas') active.push({ id: 'modality', label: values.modality === 'INLOCO' ? 'In loco' : 'Na sede', onRemove: () => onChange({ modality: 'todas' }) });
  if (values.status !== 'todos') active.push({ id: 'status', label: values.status === 'andamento' ? 'Em andamento' : 'Arquivados', onRemove: () => onChange({ status: 'todos' }) });
  if (values.category) active.push({ id: 'category', label: categories.find(c => c.categoriaCodigo === values.category)?.categoria ?? values.category, onRemove: () => onChange({ category: '' }) });

  return (
    <div data-acp-dashboard-filters>
      <FilterBar label="Filtros do acompanhamento" resultsId="acp-dashboard-results" loading={updating}
        mobileTitle="Filtrar acompanhamento" mobileDescription="Defina os projetos e o indicador. A categoria de gasto filtra os valores realizados."
        search={<SearchInput label="Buscar missão, cliente ou proposta" placeholder="Missão, cliente ou proposta"
          size="sm" value={values.search} onChange={search => onChange({ search })} />}
        activeFilters={active}
        onClear={() => onChange({ search: '', modality: 'todas', status: 'todos', category: '' })}>
        <Field id="acp-modality" label="Modalidade" optionalText="">
          <Select size="sm" value={values.modality} onChange={e => onChange({ modality: e.target.value as DashboardFilters['modality'] })}>
            <option value="todas">Todas</option><option value="INLOCO">In loco</option><option value="POP_SEDE">Na sede</option>
          </Select>
        </Field>
        <Field id="acp-status" label="Situação" optionalText="">
          <Select size="sm" value={values.status} onChange={e => onChange({ status: e.target.value as DashboardFilters['status'] })}>
            <option value="todos">Todos</option><option value="andamento">Em andamento</option><option value="arquivados">Arquivados</option>
          </Select>
        </Field>
        <Field id="acp-category" label="Categoria de gasto" optionalText="" helperText="Filtra os valores realizados.">
          <Select size="sm" value={values.category} disabled={categoriesLoading} onChange={e => onChange({ category: e.target.value })}>
            <option value="">{categoriesLoading ? 'Carregando categorias…' : 'Todas'}</option>
            {values.category && !categories.some(c => c.categoriaCodigo === values.category)
              ? <option value={values.category}>{values.category}</option> : null}
            {categories.filter(c => c.categoriaCodigo).map(c => <option key={c.categoriaCodigo} value={c.categoriaCodigo!}>{c.categoria}</option>)}
          </Select>
        </Field>
        <Field id="acp-metric" label="Indicador" optionalText="">
          <Select size="sm" value={metrics.some(metric => metric.key === values.metricKey) ? values.metricKey : metrics[0].key} onChange={e => onChange({ metricKey: e.target.value })}>
            {metrics.map(metric => <option key={metric.key} value={metric.key}>{metric.label}</option>)}
          </Select>
        </Field>
      </FilterBar>
    </div>
  );
}
