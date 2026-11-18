import type { DashboardItem, DashboardRow } from '../../api/acompanhamentoComercial';
import { HelpTip } from '../ui/HelpTip';
import { Badge, Button, DataTable, type DataTableColumn } from '../ui/ds';
import { brl, hasAdditionalValue, isGroupRow, itemKey, pct, toNum } from './acompanhamentoDashboardModel';

function BudgetValue({ total, original, additional }: {
  total?: string | number | null;
  original?: string | number | null;
  additional?: string | number | null;
}) {
  return <span className="acp-overview__cell">
    <strong>{brl(toNum(total))}</strong>
    {hasAdditionalValue(additional) ? <small>Original: {brl(toNum(original))}<br />Adicional: {brl(toNum(additional))}</small> : null}
  </span>;
}

function Execution({ row }: { row: DashboardItem }) {
  return <span className="acp-overview__cell">
    <strong>Avanço: {pct(row.progressPct)}</strong>
    <small>Dias previstos / trabalhados: {row.plannedDays ?? '—'} / {row.workedDays ?? '—'}</small>
    <small>{row.rdoCount} RDOs</small>
  </span>;
}

function Members({ row }: { row: DashboardItem }) {
  return isGroupRow(row) ? <span className="acp-overview__members"><Badge tone="info">Grupo</Badge>
    <span>Missões: {row.members.map(member => member.code).join(' · ')}</span>
  </span> : null;
}

const sale = (row: DashboardItem) => <BudgetValue total={row.salePrice} original={row.originalSalePrice} additional={row.additionalSalePrice} />;
const cost = (row: DashboardItem) => <BudgetValue total={row.plannedTotalCost} original={row.originalPlannedTotalCost} additional={row.additionalPlannedTotalCost} />;

export function AcompanhamentoDashboardListing({ rows, onOpen }: { rows: DashboardItem[]; onOpen: (row: DashboardRow) => void }) {
  const columns: DataTableColumn<DashboardItem>[] = [
    { key: 'project', header: 'Projeto / proposta', rowHeader: true, render: row => <div className="acp-overview__cell">
      {isGroupRow(row) ? <strong>{row.code}{row.name ? ` — ${row.name}` : ''}</strong> : (
        <Button className="acp-overview__project-action" variant="link" size="sm" onClick={() => onOpen(row)} aria-label={`Abrir cronograma de ${row.code}`}>
          <span className="acp-overview__project-name">{row.code}{row.name ? ` — ${row.name}` : ''}</span>
        </Button>
      )}
      <span>{row.clientName || '—'}</span><small>Proposta: {row.proposalCode || '—'}</small><Members row={row} />
    </div> },
    { key: 'sale', header: <HelpTip help="Preço de venda previsto no comercial (revisão vigente).">Venda prevista</HelpTip>, render: sale },
    { key: 'cost', header: <HelpTip help="Custo total previsto no comercial (inclui mão de obra).">Custo previsto</HelpTip>, render: cost },
    { key: 'paid', header: <HelpTip help="Total pago no Omie (títulos com status PAGO) vinculado à missão.">Realizado pago</HelpTip>, render: row => brl(toNum(row.realizedPaid)) },
    { key: 'margin', header: <HelpTip help="Margem prevista no comercial (revisão vigente).">Margem</HelpTip>, render: row => pct(row.expectedMargin) },
    { key: 'execution', header: <HelpTip help="Avanço físico do escopo (RDOs × previsto, ponderado por serviço), dias corridos / trabalhados previstos no comercial e quantidade de RDOs realizados.">Execução</HelpTip>, render: row => <Execution row={row} /> }
  ];
  return <DataTable rows={rows} columns={columns} getRowId={itemKey} ariaLabel="Projetos e grupos do acompanhamento"
    density="compact" mobileBreakpoint="xl"
    mobile={{ renderItem: row => ({
      title: `${row.code}${row.name ? ` — ${row.name}` : ''}`,
      subtitle: row.clientName || 'Cliente não informado',
      details: isGroupRow(row) ? <Members row={row} /> : undefined,
      onClick: isGroupRow(row) ? undefined : () => onOpen(row),
      accessibleLabel: isGroupRow(row) ? undefined : `Abrir cronograma de ${row.code}`,
      metadata: [
        { label: 'Proposta', value: row.proposalCode || '—' },
        { label: 'Avanço físico', value: pct(row.progressPct) },
        { label: 'Venda prevista', value: sale(row) },
        { label: 'Custo previsto', value: cost(row) },
        { label: 'Realizado pago', value: brl(toNum(row.realizedPaid)) },
        { label: 'Margem prevista', value: pct(row.expectedMargin) },
        { label: 'Dias previstos / trabalhados', value: `${row.plannedDays ?? '—'} / ${row.workedDays ?? '—'}` },
        { label: 'RDOs realizados', value: row.rdoCount }
      ]
    }) }} />;
}
