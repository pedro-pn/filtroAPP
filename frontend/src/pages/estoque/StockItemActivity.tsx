import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { getStockItemProjects, listStockMovements, type StockMovementReason, type StockMovementType } from '../../api/estoque';
import { BrandLoading } from '../../components/brand/BrandLoading';
import { Badge } from '../../components/ui/ds';
import { formatDateOnlyPtBr } from '../../utils/dateOnly';
import { StockFilter } from './StockFilter';
import { formatStockQuantity } from './stockQuantity';

const PAGE_SIZE = 10;
const reasonLabels: Record<StockMovementReason, string> = {
  COMPRA: 'Compra', DEVOLUCAO_OBRA: 'Devolução de obra', INVENTARIO: 'Inventário',
  USO_EM_PROJETO: 'Envio para obra', PERDA: 'Perda', DESCARTE_VALIDADE: 'Descarte por validade', ESTORNO: 'Estorno'
};

export function StockItemActivity({ itemId, unitLabel }: { itemId: string; unitLabel: string }) {
  const [projectId, setProjectId] = useState('');
  const [type, setType] = useState<StockMovementType | ''>('');
  const [includeReversed, setIncludeReversed] = useState(false);
  const [page, setPage] = useState(1);
  const projectsQuery = useQuery({
    queryKey: ['estoque', 'obras', itemId],
    queryFn: () => getStockItemProjects(itemId)
  });
  const historyQuery = useQuery({
    queryKey: ['estoque', 'historico', itemId, { projectId, type, includeReversed, page }],
    queryFn: () => listStockMovements({ itemId, projectId: projectId || undefined, type: type || undefined,
      includeReversed, page, pageSize: PAGE_SIZE })
  });
  const projects = projectsQuery.data || [];
  const history = historyQuery.data;
  const totalPages = Math.max(1, Math.ceil((history?.total || 0) / PAGE_SIZE));

  function selectProject(value: string) {
    setProjectId(value);
    setPage(1);
  }

  return (
    <div className="stock-item-activity">
      <section aria-label="Movimentação do produto por obra">
        <h3 className="sec">Por obra</h3>
        <p className="rel-meta">Quanto saiu para cada obra e quanto voltou ao estoque. Lançamentos cancelados não entram nestes totais.</p>
        {projectsQuery.isLoading ? <BrandLoading label="Carregando obras" inline size="sm" /> : null}
        {projectsQuery.isError ? <p role="alert">Não foi possível carregar as obras. <button type="button" className="mini-btn alt" onClick={() => projectsQuery.refetch()}>Tentar novamente</button></p> : null}
        {projectsQuery.isSuccess && !projects.length ? <p className="rel-meta">Este produto ainda não tem movimentações válidas em obras.</p> : null}
        {projects.length ? (
          <div className="stock-activity-table-wrap">
            <table className="equip-table stock-activity-table">
              <thead><tr><th>Obra</th><th>Saídas para a obra</th><th>Entradas da obra</th><th title="Saídas para a obra menos entradas devolvidas ao estoque">Saída líquida</th></tr></thead>
              <tbody>
                {projects.map(row => (
                  <tr key={row.project.id} className={projectId === row.project.id ? 'stock-activity-selected' : undefined}>
                    <td data-label="Obra"><button type="button" className="stock-project-button" aria-pressed={projectId === row.project.id} onClick={() => selectProject(projectId === row.project.id ? '' : row.project.id)}>
                      <strong>{row.project.name || row.project.code}</strong><span className="stock-table-muted">{row.project.code} · Ver histórico</span>
                    </button></td>
                    <td data-label="Saídas para a obra">{formatStockQuantity(row.outbound)} {unitLabel}</td>
                    <td data-label="Entradas da obra">{formatStockQuantity(row.inbound)} {unitLabel}</td>
                    <td data-label="Saída líquida"><strong>{formatStockQuantity(row.netOutbound)} {unitLabel}</strong></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      <section aria-label="Histórico do produto">
        <h3 className="sec">Entradas e saídas deste produto</h3>
        <p className="rel-meta">O saldo após cada movimento considera todo o histórico do produto, em todas as obras. {includeReversed ? 'Com estornos, o saldo acompanha cada lançamento de auditoria.' : 'Lançamentos cancelados ficam fora do cálculo.'}</p>
        <div className="stock-activity-filters">
          <StockFilter label="Filtrar obra do produto" value={projectId} onChange={selectProject} placeholder="Pesquisar obra"
            options={[{ value: '', label: 'Todas as obras' }, ...projects.map(row => ({ value: row.project.id, label: `${row.project.name} · ${row.project.code}` }))]} />
          <StockFilter label="Filtrar movimento do produto" value={type} onChange={value => { setType(value as StockMovementType | ''); setPage(1); }}
            options={[{ value: '', label: 'Entradas e saídas' }, { value: 'ENTRADA', label: 'Entradas' }, { value: 'SAIDA', label: 'Saídas' }]} />
          <label className="stock-history-toggle"><input type="checkbox" checked={includeReversed} onChange={event => { setIncludeReversed(event.target.checked); setPage(1); }} /> Mostrar estornos e lançamentos cancelados</label>
        </div>
        {historyQuery.isLoading ? <BrandLoading label="Carregando histórico" inline size="sm" /> : null}
        {historyQuery.isError ? <p role="alert">Não foi possível carregar o histórico. <button type="button" className="mini-btn alt" onClick={() => historyQuery.refetch()}>Tentar novamente</button></p> : null}
        {historyQuery.isSuccess && !history?.movements.length ? <p className="rel-meta">Nenhuma movimentação para este produto com os filtros selecionados.</p> : null}
        {history?.movements.length ? (
          <div className="stock-activity-table-wrap">
            <table className="equip-table stock-activity-table stock-product-history">
              <thead><tr><th>Data</th><th>Movimento</th><th>Obra / origem</th><th>Quantidade</th><th>Saldo após</th><th>Lote</th></tr></thead>
              <tbody>
                {history.movements.map(movement => (
                  <tr key={movement.id}>
                    <td data-label="Data">{formatDateOnlyPtBr(movement.date)}</td>
                    <td data-label="Movimento"><div className="stock-history-movement">
                      <Badge tone={movement.reversalOfId || movement.reversedById ? 'neutral' : movement.type === 'ENTRADA' ? 'success' : 'warning'}>{movement.type === 'ENTRADA' ? 'Entrada' : 'Saída'}</Badge>
                      {movement.romaneioEdit || movement.reversedByRomaneioEdit ? <Badge tone="info">Edição de romaneio</Badge> : null}
                      <span>{movement.romaneioEdit ? (movement.reversalOfId ? 'Compensação da edição' : 'Quantidade corrigida') : reasonLabels[movement.reason]}</span>
                      {movement.reversedById ? <span className="stock-table-muted">{movement.reversedByRomaneioEdit ? 'Substituída por edição' : 'Lançamento cancelado'}</span> : null}
                    </div></td>
                    <td data-label="Obra / origem">{movement.project ? <><strong>{movement.project.name || movement.project.code}</strong><span className="stock-table-muted">{movement.project.code}</span></> : movement.supplier || 'Estoque geral'}</td>
                    <td data-label="Quantidade"><strong>{movement.type === 'ENTRADA' ? '+' : '−'}{formatStockQuantity(movement.quantity)} {unitLabel}</strong></td>
                    <td data-label="Saldo após" className="stock-running-balance"><strong>{movement.balanceAfter == null ? '—' : `${formatStockQuantity(movement.balanceAfter)} ${unitLabel}`}</strong></td>
                    <td data-label="Lote">{movement.batch.lotNumber || 'Avulso'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        {(history?.total || 0) > PAGE_SIZE ? <div className="stock-history-pagination">
          <button type="button" className="mini-btn alt" disabled={page <= 1} onClick={() => setPage(value => value - 1)}>Anterior</button>
          <span className="rel-meta" aria-live="polite">Página {page} de {totalPages} · {history?.total} movimentações</span>
          <button type="button" className="mini-btn alt" disabled={page >= totalPages} onClick={() => setPage(value => value + 1)}>Próxima</button>
        </div> : null}
      </section>
    </div>
  );
}
