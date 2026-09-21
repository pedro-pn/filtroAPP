import type { ProjectCardItem } from '../../api/acompanhamentoComercial';
import { HelpTip } from '../ui/HelpTip';
import { ProgressBar } from '../ui/ds';
import { brl, fmtHours, pct } from './projectCardFormatting';

export function ProjectOverviewMetrics({ card }: { card: ProjectCardItem }) {
  const hours = card.workedHours;
  const hasOffshore = card.laborCostBase != null && card.laborCost != null && Math.round(card.laborCost) !== Math.round(card.laborCostBase);
  const taxes = card.presumedProfitTaxes;
  const taxHelp = taxes ? `${taxes.basisSource === 'OMIE_INVOICED'
    ? `Base: faturamento real do Omie. ISS Omie: ${brl(taxes.omieIss)}.`
    : `Base: venda prevista. Impostos previstos na NF: ${brl(taxes.invoiceTaxTotal)}.`} Código ${(taxes.omieServiceTaxCodes?.length ? taxes.omieServiceTaxCodes : taxes.serviceTaxCode === 'MIXED' ? taxes.serviceTaxCodes : [taxes.serviceTaxCode])?.join(', ')}${taxes.equivalentServiceTaxCode ? ` (regra ${taxes.equivalentServiceTaxCode})` : ''}. ISS ${taxes.issRatePct}%. INSS ${taxes.inssRatePct}%.` : '';
  return <div className="acp-project__metrics">
    <ProgressBar label={`Avanço de escopo${card.progressMethod === 'MANUAL' ? ' (manual)' : ''}`} value={card.progressPct} valueLabel={pct(card.progressPct)} />
    <div className="acp-project__section">
      <ProgressBar label="Custo consumido" value={card.costConsumedPct} valueLabel={pct(card.costConsumedPct)} />
      <dl className="acp-project__pair">
        <div><dt>Previsto</dt><dd>{brl(card.plannedCost)}</dd></div>
        <div><dt>Realizado</dt><dd>{brl(card.realizedCost)}</dd></div>
      </dl>
      {card.additionalPlannedCost != null && Math.abs(card.additionalPlannedCost) > 0.005 ? (
        <p className="acp-project__secondary">Original: {brl(card.originalPlannedCost)} · Adicional: {brl(card.additionalPlannedCost)}</p>
      ) : null}
      {taxes || card.laborCost != null || card.stockCost > 0 ? <dl className="acp-project__facts">
        {taxes ? <div><dt><HelpTip help={taxHelp}>IRPJ/CSLL fora da NF</HelpTip></dt><dd>{brl(taxes.outOfInvoiceTaxTotal)}</dd></div> : null}
        {card.laborCost != null ? <>
          <div><dt><HelpTip help="Jornada do Ponto Mais apropriada analiticamente a este projeto. Em execução compartilhada, ela pode aparecer integralmente em mais de uma missão.">Horas apropriadas do Ponto</HelpTip></dt><dd>{fmtHours(card.laborHours)}</dd></div>
          <div><dt><HelpTip help="Valor gasto com mão de obra do ponto, rateado para este projeto.">Custo MO{hasOffshore ? ' c/ offshore' : ''}</HelpTip></dt><dd>{brl(card.laborCost)}</dd></div>
          {hasOffshore ? <div><dt>Custo MO sem offshore</dt><dd>{brl(card.laborCostBase)}</dd></div> : null}
        </> : null}
        {card.stockCost > 0 ? <div><dt>Estoque quím./filtros</dt><dd>{brl(card.stockCost)}</dd></div> : null}
      </dl> : null}
    </div>
    <div className="acp-project__section">
      <ProgressBar label="Dias trabalhados" value={card.daysConsumedPct}
        valueLabel={`${card.workedDays} / ${card.totalDays ?? '—'}${card.daysConsumedPct != null ? ` · ${pct(card.daysConsumedPct)}` : ''}`} />
      <ProgressBar label="Horas trabalhadas" value={hours?.totalPct ?? null}
        valueLabel={`${fmtHours(hours?.totalWorkedHours ?? 0)} / ${fmtHours(hours?.plannedTotalHours)}${hours?.totalPct != null ? ` · ${pct(hours.totalPct)}` : ''}`}
        segments={[{ value: hours?.normalPct ?? null }, { value: hours?.overtimePct ?? null, tone: 'warning' }]} />
      <p className="acp-project__secondary">Normais: {fmtHours(hours?.normalWorkedHours ?? 0)}{hours?.normalPct != null ? ` (${pct(hours.normalPct)})` : ''}
        {' · '}HE: {fmtHours(hours?.overtimeWorkedHours ?? 0)}{hours?.overtimePct != null ? ` (${pct(hours.overtimePct)})` : ''}</p>
      <dl className="acp-project__facts"><div><dt>Colaboradores em obra</dt><dd>{card.collaboratorsCount}</dd></div></dl>
    </div>
    {card.equipment.length ? <div className="acp-project__section">
      <h3>Equipamentos em obra ({card.equipment.length})</h3>
      <dl className="acp-project__facts">{card.equipment.slice(0, 6).map((equipment, index) => <div key={index}>
        <dt>{equipment.code ? `${equipment.code} — ${equipment.name}` : equipment.name}</dt><dd>{equipment.days} dia{equipment.days === 1 ? '' : 's'}</dd>
      </div>)}</dl>
      {card.equipment.length > 6 ? <p className="acp-project__secondary">+{card.equipment.length - 6} equipamento(s)</p> : null}
    </div> : null}
  </div>;
}
