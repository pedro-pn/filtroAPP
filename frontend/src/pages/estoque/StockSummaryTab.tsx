import { Fragment, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { getStockSummary, type StockSummaryItem } from '../../api/estoque';
import { SearchBar } from '../../components/ui/SearchBar';
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
  const [search, setSearch] = useState('');
  const [itemId, setItemId] = useState('');
  const [type, setType] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [status, setStatus] = useState('');
  const summaryQuery = useQuery({
    queryKey: ['estoque', 'resumo'],
    queryFn: getStockSummary
  });
  const rows = useMemo(() => summaryQuery.data || [], [summaryQuery.data]);
  const categories = useMemo(() => [...new Map(rows.filter(row => row.item.category).map(row => [row.item.category!.id, row.item.category!.name])).entries()].sort((a, b) => a[1].localeCompare(b[1], 'pt-BR')), [rows]);
  const filteredRows = useMemo(() => {
    const term = search.trim().toLocaleLowerCase('pt-BR');
    return rows.filter(row => {
      if (itemId && row.item.id !== itemId) return false;
      if (type && row.item.type !== type) return false;
      if (categoryId && row.item.category?.id !== categoryId) return false;
      if (status === 'BELOW_MIN' && !row.belowMin) return false;
      if (status === 'EXPIRED' && !row.batches.some(batch => batch.expired)) return false;
      if (status === 'EXPIRING' && !row.batches.some(batch => batch.expiringSoon)) return false;
      if (status === 'INACTIVE' && row.item.isActive) return false;
      if (status === 'REGULAR' && (!row.item.isActive || alertBadges(row).length)) return false;
      if (!term) return true;
      return [row.item.code, row.item.name, row.item.category?.name, row.item.manufacturer, row.item.location, ...row.batches.flatMap(batch => [batch.lotNumber, batch.nfNumber, batch.supplier])]
        .some(value => value?.toLocaleLowerCase('pt-BR').includes(term));
    });
  }, [rows, search, itemId, type, categoryId, status]);

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
        <div className="sec">Estoque</div>
        {isManager ? (
          <button className="mini-btn" type="button" onClick={onRegisterMovement}>Registrar movimentação</button>
        ) : null}
      </div>

      <div className="stock-summary-filters">
        <SearchBar value={search} onChange={setSearch} placeholder="Buscar item, código ou lote" ariaLabel="Buscar no estoque" count={{ shown: filteredRows.length, total: rows.length }} />
        <select aria-label="Filtrar item" value={itemId} onChange={event => setItemId(event.target.value)}>
          <option value="">Todos os itens</option>
          {rows.map(row => <option key={row.item.id} value={row.item.id}>{row.item.code} — {row.item.name}</option>)}
        </select>
        <select aria-label="Filtrar tipo de item" value={type} onChange={event => setType(event.target.value)}>
          <option value="">Todos os tipos</option>
          <option value="FILTRO">Filtros</option>
          <option value="PRODUTO_QUIMICO">Produtos químicos</option>
        </select>
        <select aria-label="Filtrar categoria" value={categoryId} onChange={event => setCategoryId(event.target.value)}>
          <option value="">Todas as categorias</option>
          {categories.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>
        <select aria-label="Filtrar situação do estoque" value={status} onChange={event => setStatus(event.target.value)}>
          <option value="">Todas as situações</option>
          <option value="REGULAR">Regular</option>
          <option value="BELOW_MIN">Abaixo do mínimo</option>
          <option value="EXPIRING">Vencendo</option>
          <option value="EXPIRED">Lote vencido</option>
          <option value="INACTIVE">Inativo</option>
        </select>
      </div>

      {summaryQuery.isLoading ? <p className="placeholder-copy">Carregando resumo...</p> : null}
      {summaryQuery.isError ? <p className="equip-form-error">Não foi possível carregar o resumo.</p> : null}
      {!summaryQuery.isLoading && !filteredRows.length ? <p className="placeholder-copy">{rows.length ? 'Nenhum item corresponde aos filtros.' : 'Nenhum item cadastrado.'}</p> : null}

      {filteredRows.length ? (
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
              {filteredRows.map(row => {
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
