import type { SignatureDocumentCard, SignatureDocumentList } from '../../../api/assinaturas';
import { AppIcon } from '../../../components/icons/AppIcon';
import { Alert, Button, EmptyState, Field, FilterBar, MetricCard, SearchInput, Select, Skeleton } from '../../../components/ui/ds';
import { DS_ICONS } from '../../../components/ui/ds/icons';
import { PageHeader } from '../../../layout/PageHeader';
import { DocumentCard } from './DocumentCard';
import { signatureDocumentStatusLabels } from '../utils/documentStatus';

interface DocumentLibraryProps {
  data?: SignatureDocumentList;
  loading: boolean;
  error: boolean;
  archived: boolean;
  query: string;
  status: string;
  onQueryChange: (value: string) => void;
  onStatusChange: (value: string) => void;
  onArchiveChange: (value: boolean) => void;
  onClearFilters: () => void;
  onRetry: () => void;
  onNew: () => void;
  onOpen: (document: SignatureDocumentCard) => void;
}

export function DocumentLibrary({ data, loading, error, archived, query, status, onQueryChange, onStatusChange, onArchiveChange, onClearFilters, onRetry, onNew, onOpen }: DocumentLibraryProps) {
  const items = data?.items || [];
  const filtered = Boolean(query || status);
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
        label="Busca e status dos documentos"
        resultsId="signature-document-results"
        search={<SearchInput value={query} onChange={onQueryChange} label="Buscar documentos" placeholder="Buscar por título ou arquivo" />}
        actions={
          <Field id="signature-status-filter" label="Status" optionalText={null}>
            <Select value={status} onChange={event => onStatusChange(event.target.value)}>
              <option value="">Todos</option>
              {Object.entries(signatureDocumentStatusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </Select>
          </Field>
        }
        activeFilters={[
          ...(query ? [{ id: 'query', label: `Busca: ${query}`, onRemove: () => onQueryChange('') }] : []),
          ...(status ? [{ id: 'status', label: `Status: ${selectedStatusLabel}`, onRemove: () => onStatusChange('') }] : [])
        ]}
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
          <div className="signature-document-list"><Skeleton variant="card" label="Carregando documentos..." /><Skeleton variant="card" /><Skeleton variant="card" /></div>
        ) : error ? (
          <EmptyState variant="error" title="Não foi possível carregar os documentos." action={{ label: 'Tentar novamente', onClick: onRetry }} />
        ) : items.length ? (
          <div className="signature-document-list">{items.map(document => <DocumentCard key={document.id} document={document} onOpen={() => onOpen(document)} />)}</div>
        ) : (
          <EmptyState
            variant={filtered ? 'search' : archived ? 'default' : 'create'}
            title={filtered ? 'Nenhum documento encontrado.' : archived ? 'Nenhum documento arquivado.' : 'Nenhum documento ainda.'}
            description={filtered ? 'Ajuste a busca ou o status para encontrar o documento.' : archived ? 'Os documentos arquivados aparecerão aqui.' : 'Envie um PDF para iniciar a coleta de assinaturas.'}
            action={filtered ? { label: 'Limpar filtros', onClick: onClearFilters } : archived ? undefined : { label: 'Novo documento', onClick: onNew }}
          />
        )}
      </div>
      {!loading && !error && data?.nextCursor ? <Alert tone="info">Exibindo um recorte dos documentos. Use a busca ou o status para localizar outros resultados.</Alert> : null}
    </section>
  );
}
