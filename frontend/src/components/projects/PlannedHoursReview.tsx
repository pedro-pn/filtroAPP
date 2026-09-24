import type { PlannedHoursPlan } from '../../api/acompanhamentoComercial';
import { Alert, Button, DataTable } from '../ui/ds';

const hours = (value: number) => `${value.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} h`;
const labels = { normal: 'Normais', overtime: 'Extras', total: 'Total' } as const;
type HoursKind = keyof typeof labels;

export function PlannedHoursReview({ plan, disabled, canManage, onResolve }: {
  plan?: PlannedHoursPlan;
  disabled: boolean;
  canManage: boolean;
  onResolve: (choice: 'COMMERCIAL' | 'MANUAL') => void;
}) {
  if (!plan) return null;
  return (
    <section id="planned-hours-review" aria-label="Origem das horas previstas" className="acp-schedule-ds__section">
      <h3 className="acp-schedule-ds__section-title">Horas previstas</h3>
      {plan.pending ? (
        <Alert tone="warning">
          Pendência: horas manuais e comerciais diferem mais de {plan.thresholdPct}%.
          As horas manuais continuam em uso até a conferência.
        </Alert>
      ) : (
        <p className="acp-schedule-ds__muted">
          {plan.source === 'COMMERCIAL' ? 'Previsão atualizada automaticamente pelo banco comercial.'
            : plan.decision === 'MANUAL' ? 'Horas manuais confirmadas pelo usuário para esta proposta.'
              : 'Sem previsão comercial completa. Cadastre as horas manualmente abaixo.'}
        </p>
      )}
      {plan.issues.map(issue => <Alert key={issue} tone="warning">{issue} Confira a origem; o cadastro manual permanece disponível.</Alert>)}
      {plan.commercial ? (
        <>
          <p className="acp-schedule-ds__muted">
            {plan.proposals.map(proposal => `Proposta ${proposal.codProp}, rev. ${proposal.nRev}`).join(' + ')}.
            {' '}Horas totais da equipe, com os adicionais selecionados.
          </p>
          <DataTable rows={['normal', 'overtime', 'total'] as HoursKind[]} getRowId={kind => kind}
            ariaLabel="Comparação de horas previstas" density="compact" mobileBreakpoint="md"
            columns={[
              { key: 'kind', header: 'Horas', rowHeader: true, render: kind => labels[kind] },
              { key: 'manual', header: 'Manual', render: kind => plan.manual ? hours(plan.manual[kind]) : 'Não cadastrado' },
              { key: 'commercial', header: 'Comercial', render: kind => hours(plan.commercial![kind]) },
              { key: 'difference', header: 'Diferença', render: kind => {
                const difference = plan.differences.find(item => item.kind === kind);
                return <>{difference ? `${hours(difference.hours)}${difference.percent == null ? '' : ` (${difference.percent.toLocaleString('pt-BR')}%)`}` : '—'}{plan.pending && difference?.significant ? ' ⚠' : ''}</>;
              } }
            ]}
            mobile={{ renderItem: kind => {
              const difference = plan.differences.find(item => item.kind === kind);
              return { title: labels[kind], metadata: [
                { label: 'Manual', value: plan.manual ? hours(plan.manual[kind]) : 'Não cadastrado' },
                { label: 'Comercial', value: hours(plan.commercial![kind]) },
                { label: 'Diferença', value: difference ? `${hours(difference.hours)}${difference.percent == null ? '' : ` (${difference.percent.toLocaleString('pt-BR')}%)`}${plan.pending && difference.significant ? ' ⚠' : ''}` : '—' }
              ] };
            } }} />
          {canManage && (plan.pending || plan.decision === 'MANUAL') ? (
            <div className="acp-schedule-ds__hours-actions">
              <Button variant="secondary" size="sm" disabled={disabled} onClick={() => onResolve('COMMERCIAL')}>Usar horas do comercial</Button>
              {plan.pending ? <Button variant="secondary" size="sm" disabled={disabled} onClick={() => onResolve('MANUAL')}>Confirmar horas manuais</Button> : null}
              <p className="acp-schedule-ds__muted">{disabled ? 'Salve ou descarte as alterações do cronograma antes de resolver.' : 'A escolha é salva ao clicar. Uma nova divergência será avisada se os valores mudarem.'}</p>
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
