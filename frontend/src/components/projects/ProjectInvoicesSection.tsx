import { useId, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { getMissionGroupInvoices, getProjectInvoices, type ProjectInvoice } from '../../api/acompanhamentoComercial';
import { HelpTip } from '../ui/HelpTip';

const PAGE_SIZE = 10;
const brl = (value: number) => value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const formatDate = (value: string) => {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : '—';
};
const RECEIPT: Record<ProjectInvoice['receiptStatus'], { label: string; badge: string }> = {
  RECEIVED: { label: 'Recebido', badge: 'badge-ok' },
  PARTIAL: { label: 'Recebido parcialmente', badge: 'badge-pen' },
  OVERDUE: { label: 'Em atraso', badge: 'badge-rej' },
  OPEN: { label: 'A receber', badge: 'badge-pen' },
  UNKNOWN: { label: 'Não informado', badge: '' }
};

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

  return (
    <section className="page-card acp-det-block acp-invoices" aria-labelledby={titleId} data-acp-project-invoices>
      <header className="acp-invoices-head">
        <div>
          <h3 className="acp-det-sub" id={titleId}>Faturamentos realizados</h3>
          <p>Notas fiscais emitidas no Omie{groupId ? ' para as missões do grupo' : ' para este projeto'}.</p>
        </div>
        {hasSnapshot && data && !query.isError ? (
          <div className="acp-invoices-total">
            <span>{data.count} {data.count === 1 ? 'nota fiscal' : 'notas fiscais'} · total bruto</span>
            <strong>{brl(data.total)}</strong>
          </div>
        ) : null}
      </header>
      {query.isLoading ? <p className="placeholder-copy" role="status">Carregando faturamentos…</p> : query.isError ? (
        <div className="acp-invoices-feedback" role="alert">
          <span>Não foi possível carregar os faturamentos.</span>
          <button type="button" className="mini-btn alt" disabled={query.isFetching} onClick={() => void query.refetch()}>Tentar novamente</button>
        </div>
      ) : data ? (
        <>
          {data.syncStatus === 'STALE' ? <p className="acp-invoices-notice" role="status">A última atualização no Omie falhou. Exibindo o histórico da última consulta concluída.</p> : null}
          {!hasSnapshot ? (
            <p className="placeholder-copy" role="status">
              {data.syncStatus === 'ERROR' ? 'Não foi possível consultar o histórico no Omie. A consulta será repetida automaticamente.'
                : data.syncStatus === 'UPDATING' ? 'Consultando o histórico de faturamentos no Omie…'
                  : 'Aguardando a primeira consulta do histórico no Omie.'}
            </p>
          ) : (
            <>
              {data.linkedProjectCount < data.projectCount ? (
                <p className="acp-invoices-notice">{groupId ? 'Há missões deste grupo sem vínculo com um projeto no Omie.' : 'Este projeto ainda não possui vínculo com um projeto no Omie.'}</p>
              ) : null}
              {invoices.length === 0 ? (
                <p className="placeholder-copy">Nenhuma nota fiscal faturada encontrada para {groupId ? 'as missões deste grupo' : 'este projeto'} na última consulta.</p>
              ) : (
                <>
                  <table className="acp-invoices-table">
                    <caption className="sr-only">Histórico de notas fiscais faturadas</caption>
                    <thead><tr>
                      <th scope="col">Nota fiscal</th><th scope="col">Emissão</th>
                      {groupId ? <th scope="col">Missão</th> : null}
                      <th scope="col">Tomador / cliente</th><th scope="col">Valor bruto</th>
                      <th scope="col"><HelpTip help="Situação dos títulos a receber da nota no Omie. O valor bruto faturado pode incluir retenções; ele não representa o valor líquido depositado.">Recebimento</HelpTip></th>
                    </tr></thead>
                    <tbody>{invoices.map(invoice => {
                      const receipt = RECEIPT[invoice.receiptStatus] ?? RECEIPT.UNKNOWN;
                      return (
                        <tr key={invoice.id}>
                          <td data-label="Nota fiscal"><strong>{invoice.type === 'NFSE' ? 'NFS-e' : 'NF-e'} {invoice.number}</strong>{invoice.series ? <small>Série {invoice.series}</small> : null}</td>
                          <td data-label="Emissão"><time dateTime={invoice.issuedAt}>{formatDate(invoice.issuedAt)}</time></td>
                          {groupId ? <td data-label="Missão">{invoice.project.code} · {invoice.project.name}</td> : null}
                          <td data-label="Tomador / cliente">{invoice.customerName || 'Não informado'}{invoice.customerCnpj ? <small>{invoice.customerCnpj}</small> : null}
                            {invoice.customerDiffers ? <small className="acp-invoices-different">Tomador diferente do cadastro do projeto</small> : null}
                          </td>
                          <td data-label="Valor bruto" className="acp-invoices-amount">{brl(invoice.amount)}</td>
                          <td data-label="Recebimento"><span className={`badge ${receipt.badge}`}>{receipt.label}</span>{invoice.installmentCount > 1 ? <small>{invoice.installmentCount} parcelas</small> : null}</td>
                        </tr>
                      );
                    })}</tbody>
                  </table>
                  {pages > 1 ? <nav className="acp-invoices-pagination" aria-label="Páginas de faturamentos">
                    <button type="button" className="mini-btn alt" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>Anterior</button>
                    <span aria-live="polite">Página {currentPage} de {pages} · {data.count} notas</span>
                    <button type="button" className="mini-btn alt" disabled={currentPage === pages} onClick={() => setPage(currentPage + 1)}>Próxima</button>
                  </nav> : null}
                </>
              )}
              <footer className="acp-invoices-foot">
                <span>Consulta de {new Date(data.lastSyncedAt!).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}{data.syncStatus === 'UPDATING' ? ' · Atualizando…' : ''}</span>
                <span>Sem notas canceladas, remessas ou notas de débito. Faturamento pode ser parcial ou antecipado.</span>
              </footer>
            </>
          )}
        </>
      ) : null}
    </section>
  );
}
