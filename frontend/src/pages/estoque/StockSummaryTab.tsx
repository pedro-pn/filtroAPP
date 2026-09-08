import { Fragment, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { getStockSummary, type StockSummaryItem } from '../../api/estoque';
import { formatDateOnlyPtBr } from '../../utils/dateOnly';

interface Props {
  isManager: boolean;
  onRegisterMovement: () => void;
}

function alertBadges(row: StockSummaryItem) {
  const badges: string[] = [];
  if (row.belowMin) badges.push('Abaixo do mínimo');
  if (row.batches.some(batch => batch.expired)) badges.push('Lote vencido');
  if (row.batches.some(batch => batch.expiringSoon)) badges.push('Vencendo');
  return badges;
}

function typeLabel(type: StockSummaryItem['item']['type']) {
  return type === 'FILTRO' ? 'Filtro' : 'Produto químico';
}

function itemDetailFields(row: StockSummaryItem) {
  const common = [
    ['Categoria', row.item.category?.name],
    ['Fabricante', row.item.manufacturer],
    ['Localização', row.item.location]
  ];
  const technical = row.item.type === 'FILTRO'
    ? [
        ['Modelo', row.item.filterModel],
        ['Tipo do filtro', row.item.filterKind],
        ['Micragem', row.item.filterMicron]
      ]
    : [
        ['Número ONU', row.item.unNumber],
        ['Número CAS', row.item.casNumber]
      ];
  return [...common, ...technical].filter((field): field is [string, string] => Boolean(field[1]));
}

function batchStatus(batch: StockSummaryItem['batches'][number]) {
  if (batch.expired) return <span className="badge danger">Vencido</span>;
  if (batch.expiringSoon) return <span className="badge danger">Vencendo</span>;
  return <span className="badge">Regular</span>;
}

export function StockSummaryTab({ isManager, onRegisterMovement }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const summaryQuery = useQuery({
    queryKey: ['estoque', 'resumo'],
    queryFn: getStockSummary
  });
  const rows = useMemo(() => summaryQuery.data || [], [summaryQuery.data]);

  function toggle(itemId: string) {
    setExpanded(current => {
      const next = new Set(current);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  }

  return (
    <section className="page-card">
      <div className="admin-toolbar">
        <div className="sec">Resumo</div>
        {isManager ? (
          <button className="mini-btn" type="button" onClick={onRegisterMovement}>Registrar movimentação</button>
        ) : null}
      </div>

      {summaryQuery.isLoading ? <p className="placeholder-copy">Carregando resumo...</p> : null}
      {summaryQuery.isError ? <p className="equip-form-error">Não foi possível carregar o resumo.</p> : null}
      {!summaryQuery.isLoading && !rows.length ? <p className="placeholder-copy">Nenhum item cadastrado.</p> : null}

      {rows.length ? (
        <div className="equip-table-wrap stock-summary-table-wrap">
          <table className="equip-table stock-summary-table">
            <thead>
              <tr>
                <th>Código</th>
                <th>Produto</th>
                <th>Categoria</th>
                <th>Tipo</th>
                <th>Unidade</th>
                <th>Saldo total</th>
                <th>Estoque mínimo</th>
                <th>Status</th>
                <th aria-label="Detalhes" />
              </tr>
            </thead>
            <tbody>
              {rows.map(row => {
                const isExpanded = expanded.has(row.item.id);
                const badges = alertBadges(row);
                const detailId = `stock-summary-detail-${row.item.id}`;
                const details = itemDetailFields(row);
                return (
                  <Fragment key={row.item.id}>
                    <tr className="stock-summary-item-row" onClick={() => toggle(row.item.id)}>
                      <td>{row.item.code}</td>
                      <td>
                        <button
                          className="stock-summary-product-button"
                          type="button"
                          aria-expanded={isExpanded}
                          aria-controls={detailId}
                          onClick={event => {
                            event.stopPropagation();
                            toggle(row.item.id);
                          }}
                        >
                          <span aria-hidden="true">{isExpanded ? '▾' : '›'}</span>
                          <strong>{row.item.name}</strong>
                        </button>
                      </td>
                      <td>{row.item.category?.name || '-'}</td>
                      <td>{typeLabel(row.item.type)}</td>
                      <td>{row.item.unitLabel}</td>
                      <td>{row.balance}</td>
                      <td>{row.item.minQuantity || '-'}</td>
                      <td>
                        <div className="stock-summary-status">
                          {badges.map(label => <span key={label} className="badge danger">{label}</span>)}
                          {!row.item.isActive ? <span className="badge">Inativo</span> : null}
                          {!badges.length && row.item.isActive ? <span className="badge">Regular</span> : null}
                        </div>
                      </td>
                      <td>
                        <button
                          className="mini-btn alt stock-summary-detail-button"
                          type="button"
                          aria-expanded={isExpanded}
                          aria-controls={detailId}
                          onClick={event => {
                            event.stopPropagation();
                            toggle(row.item.id);
                          }}
                        >
                          {isExpanded ? 'Ocultar' : 'Detalhes'}
                        </button>
                      </td>
                    </tr>
                    {isExpanded ? (
                      <tr className="stock-summary-detail-row" id={detailId}>
                        <td colSpan={9}>
                          <div className="stock-summary-detail">
                            {details.length ? (
                              <dl className="stock-summary-metadata">
                                {details.map(([label, value]) => (
                                  <div key={label}>
                                    <dt>{label}</dt>
                                    <dd>{value}</dd>
                                  </div>
                                ))}
                              </dl>
                            ) : null}
                            {row.item.description ? (
                              <div className="stock-summary-description">
                                <span>Descrição</span>
                                <p>{row.item.description}</p>
                              </div>
                            ) : null}
                            <div className="sec">Lotes com saldo</div>
                            <div className="equip-table-wrap stock-summary-batches-wrap">
                              <table className="equip-table stock-summary-batches-table">
                                <thead>
                                  <tr>
                                    <th>Lote</th>
                                    <th>Validade</th>
                                    <th>NF</th>
                                    <th>Fornecedor</th>
                                    <th>Saldo</th>
                                    <th>Status</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {row.batches.map(batch => (
                                    <tr key={batch.id}>
                                      <td data-label="Lote">{batch.lotNumber || 'Avulso'}</td>
                                      <td data-label="Validade">{formatDateOnlyPtBr(batch.expiryDate)}</td>
                                      <td data-label="NF">{batch.nfNumber || '-'}</td>
                                      <td data-label="Fornecedor">{batch.supplier || '-'}</td>
                                      <td data-label="Saldo">{batch.balance} {row.item.unitLabel}</td>
                                      <td data-label="Status">{batchStatus(batch)}</td>
                                    </tr>
                                  ))}
                                  {!row.batches.length ? (
                                    <tr><td colSpan={6}>Nenhum lote com saldo disponível.</td></tr>
                                  ) : null}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
