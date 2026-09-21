import type { ReactNode } from 'react';
import type { ProjectDetail } from '../../api/acompanhamentoComercial';
import { Card, BarList } from '../ui/ds';
import { HelpTip } from '../ui/HelpTip';
import { brl, toNum } from './projectDetailModel';
import { MetricBar, ProposalContributionDetails } from './ProjectDetailVisuals';

export function ProjectDetailCosts({ data, children }: { data: ProjectDetail; children: ReactNode }) {
  return (<Card padding="sm" className="acp-detail-block">
            {(() => {
              const mo = data.maoDeObra;
              const moCusto = mo?.custo ?? null;
              const totalRealizado = data.consumo.gasto + (moCusto ?? 0);
              const previsto = data.consumo.previsto;
              const previstoOriginal = data.consumo.previstoOriginal ?? null;
              const previstoAdicional = data.consumo.previstoAdicional ?? null;
              const totalPct = previsto && previsto > 0 ? Math.round((totalRealizado / previsto) * 100) : null;
              const omieCost = data.consumo.omie ?? Math.max(0, data.consumo.gasto - (data.consumo.estoque ?? 0));
              const paidOmieCost = data.consumo.pago ?? 0;
              const pendingOmieCost = data.consumo.previstoPagar ?? 0;
              const stockCost = data.consumo.estoque ?? 0;
              const manualCost = data.consumo.manual ?? 0;

              const hasOffshore = moCusto != null && mo.custoBase != null && Math.round(moCusto) !== Math.round(mo.custoBase);
              return (
                <>
                  <MetricBar
                    label="Consumo de gastos"
                    help="Total realizado (compras do Omie sem salários, consumo de químicos/filtros do estoque, custos manuais e mão de obra do ponto) sobre o custo previsto no comercial."
                    value={totalPct}
                    tone="cost"
                    caption={`${brl(totalRealizado)} / ${brl(previsto)}${totalPct != null ? ` · ${totalPct}%` : ''}`}
                  />
                  <div className="acp-detail-cost-status">
                    <div>
                      <span>Pago no Omie</span>
                      <strong>{brl(paidOmieCost)}</strong>
                    </div>
                    <div>
                      <span>Previsto a pagar</span>
                      <strong>{brl(pendingOmieCost)}</strong>
                    </div>
                  </div>
                  <ProposalContributionDetails
                    original={data.budgetBreakdown?.original}
                    additionals={data.budgetBreakdown?.additionals}
                  />
                  <div className="acp-detail-facts">
                    {previstoAdicional != null && Math.abs(previstoAdicional) > 0.005 ? (
                      <>
                        <div className="acp-detail-fact"><span className="acp-detail-muted">Previsto original</span><span>{brl(previstoOriginal)}</span></div>
                        <div className="acp-detail-fact"><span className="acp-detail-muted">Previsto adicional</span><span>{brl(previstoAdicional)}</span></div>
                      </>
                    ) : null}
                    <div className="acp-detail-fact"><span className="acp-detail-muted">Compras (Omie)</span><span>{brl(omieCost)}</span></div>
                    {stockCost > 0 ? (
                      <div className="acp-detail-fact"><span className="acp-detail-muted">Estoque (químicos/filtros)</span><span>{brl(stockCost)}</span></div>
                    ) : null}
                    {manualCost > 0 ? (
                      <div className="acp-detail-fact"><span className="acp-detail-muted">Custos manuais</span><span>{brl(manualCost)}</span></div>
                    ) : null}
                    {moCusto != null ? (
                      <div className="acp-detail-fact">
                        <HelpTip help="Valor gasto com mão de obra deste projeto, calculado a partir do ponto (custo rateado por colaborador), incluindo o adicional offshore quando houver.">Mão de obra{hasOffshore ? ' c/ offshore' : ''}</HelpTip>
                        <span>{brl(moCusto)}</span>
                      </div>
                    ) : null}
                    {moCusto != null && hasOffshore ? (
                      <div className="acp-detail-fact"><span className="acp-detail-muted">Mão de obra sem offshore</span><span>{brl(mo.custoBase)}</span></div>
                    ) : null}
                    <div className="acp-detail-fact acp-detail-fact--total"><strong>Total realizado</strong><strong>{brl(totalRealizado)}</strong></div>
                  </div>
                  {children}
                  <div className="acp-detail-sub"><HelpTip help="As 5 maiores categorias de despesa do projeto, somando Omie sem salários, consumo líquido de químicos/filtros do estoque e custos manuais.">Maiores gastos (Omie + estoque + manual)</HelpTip></div>
                  {data.maioresGastos.length === 0 ? (
                    <div className="acp-detail-muted">Sem gastos registrados.</div>
                  ) : (
                    <BarList aria-label="Maiores gastos por categoria" items={data.maioresGastos.map((g, i) => ({
                      id: String(i), label: g.categoria, valueLabel: brl(g.total),
                      percentage: 100 * Math.max(0, g.total) / Math.max(1, ...data.maioresGastos.map(item => item.total))
                    }))} />
                  )}
                </>
              );
            })()}
          </Card>);
}

export function ProjectDetailTaxes({ data }: { data: ProjectDetail }) {
  return <>{data.presumedProfitTaxes ? (() => {
            const taxes = data.presumedProfitTaxes;
            const expectedRevenue = toNum(data.faturamento.previsto);
            const expectedOriginalRevenue = toNum(data.faturamento.previstoOriginal);
            const expectedAdditionalRevenue = toNum(data.faturamento.previstoAdicional);
            const invoicedRevenue = toNum(data.faturamento.realizado);
            const hasOmieInvoice = taxes.basisSource === 'OMIE_INVOICED';

            return (
              <Card padding="sm" className="acp-detail-block">
                <details className="acp-detail-tax-details">
                  <summary className="acp-detail-summary">
                    Impostos do projeto
                    <span className="acp-detail-tax-summary-value">{brl(taxes.totalTax)}</span>
                  </summary>
                  <div className="acp-detail-tax-body">
                    <div className="acp-detail-fact">
                      <HelpTip help={hasOmieInvoice ? 'Projeto com faturamento sincronizado no Omie. O cálculo de IRPJ/CSLL usa o valor real faturado, não a venda prevista.' : 'Projeto ainda sem faturamento sincronizado no Omie. O cálculo usa a venda prevista do comercial.'}>Base dos impostos</HelpTip>
                      <span>{brl(taxes.basisAmount)}</span>
                    </div>
                    <div className="acp-detail-fact"><span className="acp-detail-muted">Venda prevista</span><span>{brl(expectedRevenue)}</span></div>
                    {expectedAdditionalRevenue != null && Math.abs(expectedAdditionalRevenue) > 0.005 ? (
                      <>
                        <div className="acp-detail-fact"><span className="acp-detail-muted">Venda original</span><span>{brl(expectedOriginalRevenue)}</span></div>
                        <div className="acp-detail-fact"><span className="acp-detail-muted">Venda adicional</span><span>{brl(expectedAdditionalRevenue)}</span></div>
                      </>
                    ) : null}
                    {hasOmieInvoice ? (
                      <>
                        <div className="acp-detail-fact"><span className="acp-detail-muted">Faturado Omie ({data.faturamento.notas} NF)</span><span>{brl(invoicedRevenue)}</span></div>
                      </>
                    ) : null}
                    <div className="acp-detail-fact">
                      <HelpTip help={hasOmieInvoice ? 'ISS vem da alíquota/código da NFSe do Omie quando disponível. PIS, COFINS e o INSS de 5,5% para serviços 14.01/7.02 são calculados sobre o faturamento real.' : 'Previsão da planilha para ISS, PIS, COFINS e INSS de 5,5% para serviços 14.01/7.02 enquanto não houver NF sincronizada no Omie.'}>Impostos na NF</HelpTip>
                      <span>{brl(taxes.invoiceTaxTotal)}</span>
                    </div>
                    <div className="acp-detail-fact"><span className="acp-detail-muted">{hasOmieInvoice ? 'ISS Omie' : 'ISS previsto'}</span><span>{brl(taxes.iss)}</span></div>
                    <div className="acp-detail-fact"><span className="acp-detail-muted">PIS</span><span>{brl(taxes.pis)}</span></div>
                    <div className="acp-detail-fact"><span className="acp-detail-muted">COFINS</span><span>{brl(taxes.cofins)}</span></div>
                    {taxes.inss > 0 ? (
                      <div className="acp-detail-fact"><span className="acp-detail-muted">INSS NF (5,5%)</span><span>{brl(taxes.inss)}</span></div>
                    ) : null}
                    <div className="acp-detail-fact acp-detail-fact--total">
                      <HelpTip help={hasOmieInvoice ? 'Cálculo gerencial feito sobre o faturamento real do Omie. O cliente paga o valor faturado; este valor é o imposto estimado a pagar pela empresa.' : 'Previsão gerencial feita sobre a venda prevista. O cliente paga a venda prevista; este valor é o imposto estimado a pagar pela empresa.'}>IRPJ/CSLL fora da NF</HelpTip>
                      <strong>{brl(taxes.outOfInvoiceTaxTotal)}</strong>
                    </div>
                    <div className="acp-detail-fact"><span className="acp-detail-muted">IRPJ básico</span><span>{brl(taxes.irpjBasic)}</span></div>
                    <div className="acp-detail-fact"><span className="acp-detail-muted">CSLL</span><span>{brl(taxes.csll)}</span></div>
                    <div className="acp-detail-fact"><span className="acp-detail-muted">Adic. IRPJ</span><span>{brl(taxes.additionalIrpjEstimated)}</span></div>
                    <div className="acp-detail-fact acp-detail-fact--total">
                      <HelpTip help="Soma de ISS, PIS, COFINS, INSS quando aplicável, IRPJ, CSLL e adicional de IRPJ calculados para o projeto.">Total de impostos</HelpTip>
                      <strong>{brl(taxes.totalTax)}</strong>
                    </div>
                  </div>
                </details>
              </Card>
            );
          })() : null}</>;
}
