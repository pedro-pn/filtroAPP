import type { PlannedHoursPlan } from '../../api/acompanhamentoComercial';

const hours = (value: number) => `${value.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} h`;
const labels = { normal: 'Normais', overtime: 'Extras', total: 'Total' } as const;

export function PlannedHoursReview({ plan, disabled, canManage, onResolve }: {
  plan?: PlannedHoursPlan;
  disabled: boolean;
  canManage: boolean;
  onResolve: (choice: 'COMMERCIAL' | 'MANUAL') => void;
}) {
  if (!plan) return null;
  return (
    <section id="planned-hours-review" aria-label="Origem das horas previstas" style={{ marginTop: 18 }}>
      <div className="sec">Horas previstas</div>
      {plan.pending ? (
        <div role="alert" className="acp-alert warn">
          ⚠ Pendência: horas manuais e comerciais diferem mais de {plan.thresholdPct}%.
          As horas manuais continuam em uso até a conferência.
        </div>
      ) : (
        <p className="placeholder-copy">
          {plan.source === 'COMMERCIAL' ? 'Previsão atualizada automaticamente pelo banco comercial.'
            : plan.decision === 'MANUAL' ? 'Horas manuais confirmadas pelo usuário para esta proposta.'
              : 'Sem previsão comercial completa. Cadastre as horas manualmente abaixo.'}
        </p>
      )}
      {plan.issues.map(issue => <p key={issue} className="acp-alert warn">⚠ {issue} Confira a origem; o cadastro manual permanece disponível.</p>)}
      {plan.commercial ? (
        <>
          <p className="placeholder-copy">
            {plan.proposals.map(proposal => `Proposta ${proposal.codProp}, rev. ${proposal.nRev}`).join(' + ')}.
            {' '}Horas totais da equipe, com os adicionais selecionados.
          </p>
          <table className="data-table" aria-label="Comparação de horas previstas" style={{ width: '100%' }}>
            <thead><tr><th>Horas</th><th>Manual</th><th>Comercial</th><th>Diferença</th></tr></thead>
            <tbody>{(['normal', 'overtime', 'total'] as const).map(kind => {
              const difference = plan.differences.find(item => item.kind === kind);
              return (
                <tr key={kind}>
                  <th scope="row">{labels[kind]}</th>
                  <td>{plan.manual ? hours(plan.manual[kind]) : 'Não cadastrado'}</td>
                  <td>{hours(plan.commercial![kind])}</td>
                  <td>{difference ? `${hours(difference.hours)}${difference.percent == null ? '' : ` (${difference.percent.toLocaleString('pt-BR')}%)`}` : '—'}{plan.pending && difference?.significant ? ' ⚠' : ''}</td>
                </tr>
              );
            })}</tbody>
          </table>
          {canManage && (plan.pending || plan.decision === 'MANUAL') ? (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
              <button type="button" className="mini-btn" disabled={disabled} onClick={() => onResolve('COMMERCIAL')}>Usar horas do comercial</button>
              {plan.pending ? <button type="button" className="mini-btn alt" disabled={disabled} onClick={() => onResolve('MANUAL')}>Confirmar horas manuais</button> : null}
              <p className="placeholder-copy">{disabled ? 'Salve ou descarte as alterações do cronograma antes de resolver.' : 'A escolha é salva ao clicar. Uma nova divergência será avisada se os valores mudarem.'}</p>
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
