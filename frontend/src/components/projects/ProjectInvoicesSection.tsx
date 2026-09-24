import { useId, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight } from 'lucide-react';

import { getMissionGroupInvoices, getProjectInvoices, type ProjectInvoice } from '../../api/acompanhamentoComercial';
import { AppIcon } from '../icons/AppIcon';
import { HelpTip } from '../ui/HelpTip';
import { Alert, Badge, Button, Card, DataTable, EmptyState, Pagination, Skeleton, type DataTableColumn, type SemanticTone } from '../ui/ds';
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

function ReceiptStatus({ invoice }: { invoice: ProjectInvoice }) {
  const receipt = RECEIPT[invoice.receiptStatus] ?? RECEIPT.UNKNOWN;
  return <span className="acp-invoices-ds__receipt">
    <Badge tone={receipt.tone}>{receipt.label}</Badge>
    {invoice.installmentCount > 1 ? <small>{invoice.installmentCount} parcelas</small> : null}
  </span>;
}

export function ProjectInvoicesSection({ projectId, groupId }: { projectId?: string; groupId?: string }) {
  const titleId = useId();
  const [page, setPage] = useState(1);
  const query = useQuery({
    queryKey: ['project-invoices', groupId ? 'group' : 'project', groupId || projectId],
    queryFn: () => groupId ? getMissionGroupInvoices(groupId) : getProjectInvoices(projectId!),
    enabled: Boolean(groupId || projectId),
    staleTime: 60_000,
    refetchInterval: 60_000
  });
  const data = query.data;
  const hasSnapshot = Boolean(data?.lastSyncedAt);
  const pages = Math.max(1, Math.ceil((data?.invoices.length ?? 0) / PAGE_SIZE));
  const currentPage = Math.min(page, pages);
  const invoices = data?.invoices.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE) ?? [];
  const columns: DataTableColumn<ProjectInvoice>[] = [
    { key: 'number', header: 'Nota fiscal', rowHeader: true, render: invoice => <span className="acp-invoices-ds__cell">
      <strong>{invoice.type === 'NFSE' ? 'NFS-e' : 'NF-e'} {invoice.number}</strong>
      {invoice.series ? <small>Série {invoice.series}</small> : null}
    </span> },
    { key: 'issuedAt', header: 'Emissão', render: invoice => <time dateTime={invoice.issuedAt}>{formatDate(invoice.issuedAt)}</time> },
    ...(groupId ? [{ key: 'project', header: 'Missão', render: (invoice: ProjectInvoice) => <span className="acp-invoices-ds__wrap">{invoice.project.code} · {invoice.project.name}</span> }] : []),
    { key: 'customer', header: 'Tomador / cliente', render: invoice => <span className="acp-invoices-ds__cell">
      <span>{invoice.customerName || 'Não informado'}</span>
      {invoice.customerCnpj ? <small>{invoice.customerCnpj}</small> : null}
      {invoice.customerDiffers ? <small>Tomador diferente do cadastro do projeto</small> : null}
    </span> },
    { key: 'amount', header: 'Valor bruto', align: 'right', numeric: true, render: invoice => <strong className="acp-invoices-ds__amount">{brl(invoice.amount)}</strong> },
    { key: 'receipt', header: <HelpTip help="Situação dos títulos a receber da nota no Omie. O valor bruto faturado pode incluir retenções; ele não representa o valor líquido depositado.">Recebimento</HelpTip>, render: invoice => <ReceiptStatus invoice={invoice} /> }
  ];

  return <Card padding="sm" className="acp-invoices-ds" data-acp-project-invoices>
    <details open>
      <summary className="acp-detail-summary acp-invoices-ds__heading" aria-labelledby={titleId}>
        <AppIcon className="acp-invoices-ds__chevron" icon={ChevronRight} size="sm" />
        <span className="acp-invoices-ds__heading-copy">
          <strong id={titleId}>Faturamentos realizados</strong>
          <small>Notas fiscais emitidas no Omie{groupId ? ' para as missões do grupo' : ' para este projeto'}.</small>
        </span>
        {hasSnapshot && data ? <span className="acp-invoices-ds__total">
          <small>{data.count} {data.count === 1 ? 'nota fiscal' : 'notas fiscais'} · total bruto</small>
          <strong>{brl(data.total)}</strong>
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
          {data.invoices.length === 0 ? <EmptyState title="Nenhuma nota fiscal faturada"
            description={`Nenhuma nota encontrada para ${groupId ? 'as missões deste grupo' : 'este projeto'} na última consulta.`} />
            : <DataTable rows={invoices} columns={columns} getRowId={invoice => invoice.id}
              ariaLabel="Histórico de notas fiscais faturadas" density="compact" mobileBreakpoint="xl"
              mobile={{ renderItem: invoice => ({
                title: `${invoice.type === 'NFSE' ? 'NFS-e' : 'NF-e'} ${invoice.number}`,
                subtitle: invoice.series ? `Série ${invoice.series}` : undefined,
                status: <ReceiptStatus invoice={invoice} />,
                value: brl(invoice.amount),
                metadata: [
                  { label: 'Emissão', value: formatDate(invoice.issuedAt) },
                  ...(groupId ? [{ label: 'Missão', value: `${invoice.project.code} · ${invoice.project.name}` }] : []),
                  { label: 'Tomador / cliente', value: invoice.customerName || 'Não informado' },
                  ...(invoice.customerCnpj ? [{ label: 'CNPJ', value: invoice.customerCnpj }] : []),
                  ...(invoice.customerDiffers ? [{ label: 'Cadastro', value: 'Tomador diferente do projeto' }] : [])
                ]
              }) }} />}
          {pages > 1 ? <Pagination page={currentPage} total={data.invoices.length} pageSize={PAGE_SIZE}
            onPageChange={setPage} label="Páginas de faturamentos" /> : null}
          <footer className="acp-invoices-ds__foot">
            <span>Consulta de {new Date(data.lastSyncedAt!).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}{data.syncStatus === 'UPDATING' || query.isFetching ? ' · Atualizando…' : ''}</span>
            <span>Sem notas canceladas, remessas ou notas de débito. Faturamento pode ser parcial ou antecipado.</span>
          </footer>
        </> : null}
      </div>
    </details>
  </Card>;
}
