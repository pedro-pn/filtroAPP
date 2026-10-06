import type { SignatureDocumentCard, SignatureDocumentList } from '../../../api/assinaturas';
import { AppIcon } from '../../../components/icons/AppIcon';
import { InfiniteScrollSentinel } from '../../../components/ui/InfiniteScrollSentinel';
import { DateInput } from '../../../components/ui/DateInput';
import { Alert, Button, EmptyState, Field, FilterBar, MetricCard, SearchInput, Select, Skeleton } from '../../../components/ui/ds';
import { DS_ICONS } from '../../../components/ui/ds/icons';
import { PageHeader } from '../../../layout/PageHeader';
import { DocumentCard } from './DocumentCard';
import { signatureDocumentStatusLabels } from '../utils/documentStatus';

interface DocumentLibraryProps {
  data?: SignatureDocumentList;
  loading: boolean;
  error: boolean;
  loadingMore: boolean;
  loadMoreError: boolean;
  archived: boolean;
  query: string;
  status: string;
  dateFrom?: string;
  dateTo?: string;
  newSignatures?: SignatureDocumentCard[];
  onQueryChange: (value: string) => void;
  onStatusChange: (value: string) => void;
  onDateFromChange: (value: string) => void;
  onDateToChange: (value: string) => void;
  onArchiveChange: (value: boolean) => void;
  onClearFilters: () => void;
  onRetry: () => void;
  onLoadMore: () => void;
  onNew: () => void;
  onOpen: (document: SignatureDocumentCard) => void;
}

export function DocumentLibrary({ data, loading, error, loadingMore, loadMoreError, archived, query, status, dateFrom = '', dateTo = '', newSignatures = [], onQueryChange, onStatusChange, onDateFromChange, onDateToChange, onArchiveChange, onClearFilters, onRetry, onLoadMore, onNew, onOpen }: DocumentLibraryProps) {
  const items = data?.items || [];
  const filtered = Boolean(query || status || dateFrom || dateTo);
  const highlighted = archived ? [] : newSignatures;
  const highlightedIds = new Set(highlighted.map(document => document.id));
  const remaining = items.filter(document => !highlightedIds.has(document.id));
  const inProgress = remaining.filter(document => document.status !== 'CONCLUIDO');
  const recentlySigned = remaining.filter(document => document.status === 'CONCLUIDO')
    .sort((a, b) => (b.completedAt || b.createdAt).localeCompare(a.completedAt || a.createdAt));
  const formatDate = (value: string) => value.split('-').reverse().join('/');
  const selectedStatusLabel = Object.entries(signatureDocumentStatusLabels).find(([value]) => value === status)?.[1] || status;
  return (
    <section className="fv-ds assinaturas-library" aria-label="Biblioteca de documentos">
      <PageHeader
        title="Documentos"
        description="Prepare e acompanhe suas solicitações de assinatura."
        actions={<span data-signature-new-document><Button variant="primary" iconLeft={<AppIcon icon={DS_ICONS.plus} size="sm" />} onClick={onNew}>Novo documento</Button></span>}
      />
      <div className="assinaturas-library__tabs" role="group" aria-label="Lista de documentos">
        <Button variant={archived ? 'secondary' : 'primary'} aria-pressed={!archived} onClick={() => onArchiveChange(false)} iconLeft={<AppIcon icon={DS_ICONS.fileText} size="sm" />}>Ativos</Button>
        <Button variant={archived ? 'primary' : 'secondary'} aria-pressed={archived} onClick={() => onArchiveChange(true)} iconLeft={<AppIcon icon={DS_ICONS.archive} size="sm" />}>Arquivados</Button>
      </div>
      <FilterBar
        className="assinaturas-library__filters"
        label="Busca, status e data dos documentos"
        resultsId="signature-document-results"
        search={<SearchInput value={query} onChange={onQueryChange} label="Buscar documentos" placeholder="Buscar por título ou arquivo" />}
        actions={
          <>
          <Field id="signature-status-filter" label="Status" optionalText={null}>
            <Select value={status} onChange={event => onStatusChange(event.target.value)}>
              <option value="">Todos</option>
              {Object.entries(signatureDocumentStatusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </Select>
          </Field>
          <Field id="signature-date-from-filter" label="Criado a partir de" optionalText={null}>
            <span className="fv-control-shell fv-control-shell--md">
              <DateInput id="signature-date-from-filter-control" className="fv-input" value={dateFrom} max={dateTo || undefined} onCommit={onDateFromChange} />
            </span>
          </Field>
          <Field id="signature-date-to-filter" label="Criado até" optionalText={null}>
            <span className="fv-control-shell fv-control-shell--md">
              <DateInput id="signature-date-to-filter-control" className="fv-input" value={dateTo} min={dateFrom || undefined} onCommit={onDateToChange} />
            </span>
          </Field>
          </>
        }
        activeFilters={[
          ...(query ? [{ id: 'query', label: `Busca: ${query}`, onRemove: () => onQueryChange('') }] : []),
          ...(status ? [{ id: 'status', label: `Status: ${selectedStatusLabel}`, onRemove: () => onStatusChange('') }] : []),
          ...(dateFrom ? [{ id: 'dateFrom', label: `Criado a partir de: ${formatDate(dateFrom)}`, onRemove: () => onDateFromChange('') }] : []),
          ...(dateTo ? [{ id: 'dateTo', label: `Criado até: ${formatDate(dateTo)}`, onRemove: () => onDateToChange('') }] : [])
        ]}
        clearPlacement="chips"
        onClear={filtered ? onClearFilters : undefined}
      />
      {!loading && !error && data ? (
        <section className="assinaturas-library__metrics" aria-label="Resumo dos documentos exibidos">
          <MetricCard label="Nesta lista" value={items.length} description={data.nextCursor ? 'Recorte carregado' : archived ? 'Documentos arquivados' : 'Documentos ativos'} />
          <MetricCard label="Aguardando" value={items.filter(item => item.status === 'AGUARDANDO_ASSINATURAS').length} description="Assinaturas pendentes" tone="warning" />
          <MetricCard label="Concluídos" value={items.filter(item => item.status === 'CONCLUIDO').length} description="PDF final disponível" tone="success" />
        </section>
      ) : null}
      <div id="signature-document-results" aria-busy={loading || undefined}>
        {loading ? (
          <div className="signature-document-list"><Skeleton variant="card" label="Carregando documentos..." /></div>
        ) : error ? (
          <EmptyState variant="error" title="Não foi possível carregar os documentos." action={{ label: 'Tentar novamente', onClick: onRetry }} />
        ) : items.length ? (
          <div className="assinaturas-library__sections">
            {inProgress.length ? (
              <section aria-label={archived ? 'Documentos arquivados' : 'Documentos em andamento'}>
                <h2>{archived ? 'Documentos arquivados' : 'Documentos em andamento'}</h2>
                <div className="signature-document-list">{inProgress.map(document => <DocumentCard key={document.id} document={document} onOpen={() => onOpen(document)} />)}</div>
              </section>
            ) : null}
            {highlighted.length ? (
              <section className="assinaturas-library__new-signatures" aria-label="Novas assinaturas">
                <h2>Novas assinaturas</h2>
                <p>Documentos com assinaturas que você ainda não abriu.</p>
                <div className="signature-document-list">{highlighted.map(document => <DocumentCard key={document.id} document={document} onOpen={() => onOpen(document)} />)}</div>
              </section>
            ) : null}
            {recentlySigned.length ? (
              <section aria-label="Assinados recentemente">
                <h2>Assinados recentemente</h2>
                <div className="signature-document-list">{recentlySigned.map(document => <DocumentCard key={document.id} document={document} onOpen={() => onOpen(document)} />)}</div>
              </section>
            ) : null}
          </div>
        ) : (
          <EmptyState
            variant={filtered ? 'search' : archived ? 'default' : 'create'}
            title={filtered ? 'Nenhum documento encontrado.' : archived ? 'Nenhum documento arquivado.' : 'Nenhum documento ainda.'}
            description={filtered ? 'Ajuste a busca, o status ou as datas para encontrar o documento.' : archived ? 'Os documentos arquivados aparecerão aqui.' : 'Envie um PDF para iniciar a coleta de assinaturas.'}
            action={filtered ? { label: 'Limpar filtros', onClick: onClearFilters } : archived ? undefined : { label: 'Novo documento', onClick: onNew }}
          />
        )}
      </div>
      {!loading && !error && data?.nextCursor ? (
        <div className="assinaturas-library__load-more">
          <InfiniteScrollSentinel className="assinaturas-library__sentinel" hasMore={!loadMoreError} isLoading={loadingMore} onLoadMore={onLoadMore} />
          {loadMoreError ? (
            <Alert tone="danger" action={{ label: 'Tentar novamente', onClick: onLoadMore }}>
              Não foi possível carregar mais documentos.
            </Alert>
          ) : (
            <>
              <p role="status" aria-live="polite">{loadingMore ? 'Carregando mais documentos...' : 'Há mais documentos nesta lista. Role para carregar ou use o botão abaixo.'}</p>
              <Button variant="secondary" loading={loadingMore} disabled={loadingMore} aria-controls="signature-document-results" onClick={onLoadMore}>Carregar mais documentos</Button>
            </>
          )}
        </div>
      ) : null}
    </section>
  );
}
