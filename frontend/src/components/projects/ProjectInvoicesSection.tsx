import { useEffect, useId, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight } from 'lucide-react';

import { getMissionGroupInvoices, getProjectInvoices, type ProjectInvoice, type TrackingDivision } from '../../api/acompanhamentoComercial';
import { AppIcon } from '../icons/AppIcon';
import { HelpTip } from '../ui/HelpTip';
import { Alert, Badge, Button, Card, DataTable, EmptyState, Pagination, Skeleton, sortTableRows, type DataTableColumn, type DataTableSort, type SemanticTone } from '../ui/ds';
import './ProjectInvoicesSection.ds.css';

const PAGE_SIZE = 10;
const brl = (value: number) => value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const formatDate = (value: string) => {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : '—';
};
const RECEIPT: Record<ProjectInvoice['receiptStatus'], { label: string; tone: SemanticTone }> = {
  RECEIVED: { label: 'Recebido', tone: 'success' },
  PARTIAL: { label: 'Recebido parcialmente', tone: 'warning' },
  OVERDUE: { label: 'Em atraso', tone: 'danger' },
  OPEN: { label: 'A receber', tone: 'warning' },
  UNKNOWN: { label: 'Não informado', tone: 'neutral' }
};
const invoiceLabel = (invoice: ProjectInvoice) => invoice.type === 'ND'
  ? `Nota de débito ${invoice.number}`
  : `${invoice.type === 'NFSE' ? 'NFS-e' : 'NF-e'} ${invoice.number}`;

function ReceiptStatus({ invoice }: { invoice: ProjectInvoice }) {
  const receipt = RECEIPT[invoice.receiptStatus] ?? RECEIPT.UNKNOWN;
  return <span className="acp-invoices-ds__receipt">
    <Badge tone={receipt.tone}>{receipt.label}</Badge>
    {invoice.installmentCount > 1 ? <small>{invoice.installmentCount} parcelas</small> : null}
  </span>;
}

export function ProjectInvoicesSection({ projectId, groupId, division }: { projectId?: string; groupId?: string; division?: TrackingDivision | null }) {
  const titleId = useId();
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<DataTableSort | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const query = useQuery({
    queryKey: ['project-invoices', groupId ? 'group' : 'project', groupId || projectId],
    queryFn: () => groupId ? getMissionGroupInvoices(groupId) : getProjectInvoices(projectId!),
    enabled: Boolean(groupId || projectId),
    staleTime: 60_000,
    refetchInterval: 60_000
  });
  const data = query.data;
  const hasSnapshot = Boolean(data?.lastSyncedAt);
  const visibleInvoices = (data?.invoices ?? []).filter(invoice => !division || (
    invoice.issuedAt.slice(0, 10) >= division.startDate && invoice.issuedAt.slice(0, 10) <= (division.endDate ?? new Date().toISOString().slice(0, 10))
  ));
  const visibleTotal = visibleInvoices.reduce((sum, invoice) => sum + invoice.amount, 0);
  const pages = Math.max(1, Math.ceil(visibleInvoices.length / PAGE_SIZE));
  const currentPage = Math.min(page, pages);
  useEffect(() => {
    if (listRef.current) listRef.current.style.minHeight = '';
  }, [projectId, groupId, division?.key, division?.startDate, division?.endDate, visibleInvoices.length]);

  function changePage(nextPage: number) {
    if (nextPage === currentPage) return;
    // A última página pode ter menos documentos; preserve a posição da paginação.
    if (listRef.current) {
      const height = listRef.current.getBoundingClientRect().height;
      listRef.current.style.minHeight = `${height}px`;
    }
    setPage(nextPage);
  }
  const columns: DataTableColumn<ProjectInvoice>[] = [
    { key: 'number', sortValue: invoice => invoice.number, header: 'Documento', rowHeader: true, render: invoice => <span className="acp-invoices-ds__cell">
      <strong>{invoiceLabel(invoice)}</strong>
      {invoice.series ? <small>Série {invoice.series}</small> : null}
    </span> },
    { key: 'issuedAt', sortValue: invoice => invoice.issuedAt, header: 'Emissão', render: invoice => <time dateTime={invoice.issuedAt}>{formatDate(invoice.issuedAt)}</time> },
    ...(groupId ? [{ key: 'project', header: 'Missão', render: (invoice: ProjectInvoice) => <span className="acp-invoices-ds__wrap">{invoice.project.code} · {invoice.project.name}</span> }] : []),
    { key: 'customer', sortValue: invoice => invoice.customerName, header: 'Tomador / cliente', render: invoice => <span className="acp-invoices-ds__cell">
      <span>{invoice.customerName || 'Não informado'}</span>
      {invoice.customerCnpj ? <small>{invoice.customerCnpj}</small> : null}
      {invoice.customerDiffers ? <small>Tomador diferente do cadastro do projeto</small> : null}
    </span> },
    { key: 'amount', sortValue: invoice => invoice.amount, header: 'Valor bruto', align: 'right', numeric: true, render: invoice => <strong className="acp-invoices-ds__amount">{brl(invoice.amount)}</strong> },
    { key: 'receipt', sortValue: invoice => RECEIPT[invoice.receiptStatus]?.label, header: <HelpTip help="Situação dos títulos a receber do documento no Omie. O valor bruto faturado pode incluir retenções; ele não representa o valor líquido depositado.">Recebimento</HelpTip>, render: invoice => <ReceiptStatus invoice={invoice} /> }
  ];
  const invoices = sortTableRows(visibleInvoices, columns, sort).slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  return <Card padding="sm" className="acp-invoices-ds" data-acp-project-invoices>
    <details open>
      <summary className="acp-detail-summary acp-invoices-ds__heading" aria-labelledby={titleId}>
        <AppIcon className="acp-invoices-ds__chevron" icon={ChevronRight} size="sm" />
        <span className="acp-invoices-ds__heading-copy">
          <strong id={titleId}>Faturamentos realizados</strong>
          <small>Notas fiscais e notas de débito do Omie{groupId ? ' para as missões do grupo' : ' para este projeto'}.</small>
        </span>
        {hasSnapshot && data ? <span className="acp-invoices-ds__total">
          <small>{visibleInvoices.length} {visibleInvoices.length === 1 ? 'documento' : 'documentos'} · total bruto</small>
          <strong>{brl(visibleTotal)}</strong>
        </span> : null}
      </summary>
      <div className="acp-invoices-ds__body">
        {query.isLoading ? <Skeleton variant="table-rows" lines={4} label="Carregando faturamentos" /> : null}
        {query.isError && !hasSnapshot ? <EmptyState variant="error" title="Não foi possível carregar os faturamentos."
          action={<Button type="button" size="sm" variant="secondary" disabled={query.isFetching} onClick={() => void query.refetch()}>Tentar novamente</Button>} /> : null}
        {query.isError && hasSnapshot ? <Alert tone="warning" action={{ label: 'Tentar novamente', onClick: () => void query.refetch() }}>
          Não foi possível atualizar os faturamentos. Exibindo o histórico da última consulta concluída.
        </Alert> : null}
        {data?.syncStatus === 'STALE' && !query.isError ? <Alert tone="warning">
          A última atualização no Omie falhou. Exibindo o histórico da última consulta concluída.
        </Alert> : null}
        {!query.isLoading && !query.isError && data && !hasSnapshot ? <Alert tone={data.syncStatus === 'ERROR' ? 'warning' : 'info'}>
          {data.syncStatus === 'ERROR' ? 'Não foi possível consultar o histórico no Omie. A consulta será repetida automaticamente.'
            : data.syncStatus === 'UPDATING' ? 'Consultando o histórico de faturamentos no Omie…'
              : 'Aguardando a primeira consulta do histórico no Omie.'}
        </Alert> : null}
        {hasSnapshot && data ? <>
          {data.linkedProjectCount < data.projectCount ? <Alert tone="warning">
            {groupId ? 'Há missões deste grupo sem vínculo com um projeto no Omie.' : 'Este projeto ainda não possui vínculo com um projeto no Omie.'}
          </Alert> : null}
          {visibleInvoices.length === 0 ? <EmptyState title="Nenhum faturamento encontrado"
            description={`Nenhum documento encontrado para ${groupId ? 'as missões deste grupo' : 'este projeto'} na última consulta.`} />
            : <div ref={listRef} className="acp-invoices-ds__list">
              <DataTable rows={invoices} columns={columns.map(column => ({ ...column, sortable: true }))} getRowId={invoice => invoice.id}
              sort={sort} onSortChange={next => { setSort(next); setPage(1); }}
              ariaLabel="Histórico de faturamentos" layout="cards" density="compact" mobileBreakpoint="xl"
              mobile={{ renderItem: invoice => ({
                title: invoiceLabel(invoice),
                subtitle: invoice.series ? `Série ${invoice.series}` : undefined,
                status: <ReceiptStatus invoice={invoice} />,
                value: brl(invoice.amount),
                metadata: [
                  { label: 'Emissão', value: formatDate(invoice.issuedAt) },
                  ...(groupId ? [{ label: 'Missão', value: `${invoice.project.code} · ${invoice.project.name}` }] : []),
                  { label: 'Tomador / cliente', value: invoice.customerName || 'Não informado' },
                  ...(invoice.customerCnpj ? [{ label: 'CNPJ', value: invoice.customerCnpj }] : []),
                  ...(invoice.customerDiffers ? [{ label: 'Cadastro', value: 'Tomador diferente do cadastro do projeto' }] : [])
                ]
              }) }} />
            </div>}
          {pages > 1 ? <Pagination page={currentPage} total={visibleInvoices.length} pageSize={PAGE_SIZE}
            onPageChange={changePage} label="Páginas de faturamentos" /> : null}
          <footer className="acp-invoices-ds__foot">
            <span>Consulta de {new Date(data.lastSyncedAt!).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}{data.syncStatus === 'UPDATING' || query.isFetching ? ' · Atualizando…' : ''}</span>
            <span>Inclui notas fiscais e notas de débito. Exclui documentos cancelados e remessas. Faturamento pode ser parcial ou antecipado.</span>
          </footer>
        </> : null}
      </div>
    </details>
  </Card>;
}
