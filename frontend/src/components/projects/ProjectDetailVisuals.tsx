import type { BudgetBreakdownSlice, PlannedScope, RequiredWeeklyProgress, RequiredWeeklyProgressStatus } from '../../api/acompanhamentoComercial';
import { HelpTip } from '../ui/HelpTip';
import { Badge, ProgressBar } from '../ui/ds';
import { brl, toNum, hasMoney, proposalContributionLabel, fmtPct, fmtHours, SERVICE_LABELS, SYSTEM_LABELS, UNIT_LABELS } from './projectDetailModel';

export function ProposalContributionDetails({
  original,
  additionals
}: {
  original?: BudgetBreakdownSlice | null;
  additionals?: BudgetBreakdownSlice[];
}) {
  const rows = [
    original ? { ...original, contributionKind: 'ORIGINAL' as const } : null,
    ...(additionals ?? []).map(item => ({ ...item, contributionKind: 'ADDITIONAL' as const }))
  ].filter((item): item is BudgetBreakdownSlice & { contributionKind: 'ORIGINAL' | 'ADDITIONAL' } => Boolean(item));

  if (rows.length <= 1 || !(additionals ?? []).some(item => (
    hasMoney(item.salePrice) || hasMoney(item.plannedTotalCost) || hasMoney(item.expectedProfit) || hasMoney(item.taxes)
  ))) {
    return null;
  }

  return (
    <details className="acp-detail-proposal-details">
      <summary className="acp-detail-summary" data-acp-proposal-contributions>
        Composição das propostas
        <Badge tone="neutral">{rows.length} propostas</Badge>
      </summary>
      <div className="acp-detail-proposal-list">
        {rows.map((proposal, index) => (
          <div className="acp-detail-proposal-item" key={`${proposal.contributionKind}-${proposal.codBd ?? proposal.codProp ?? index}`}>
            <div className="acp-detail-proposal-item-head">
              <strong>{proposalContributionLabel(proposal, proposal.contributionKind === 'ORIGINAL' ? 'Proposta original' : 'Proposta adicional')}</strong>
              <span>{proposal.contributionKind === 'ORIGINAL' ? 'Original' : 'Adicional'}</span>
            </div>
            <div className="acp-detail-proposal-grid">
              <div><span>Venda</span><strong>{brl(toNum(proposal.salePrice))}</strong></div>
              <div><span>Custo</span><strong>{brl(toNum(proposal.plannedTotalCost))}</strong></div>
              <div><span>Lucro</span><strong>{brl(toNum(proposal.expectedProfit))}</strong></div>
              <div><span>Impostos</span><strong>{brl(toNum(proposal.taxes))}</strong></div>
            </div>
          </div>
        ))}
      </div>
    </details>
  );
}

const fmtQuantity = (value?: number | null, unit?: string | null) => (
  value == null
    ? '—'
    : `${value.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}${unit ? ` ${UNIT_LABELS[unit] ?? unit}` : ''}`
);

function weeklyTargetText(
  status: RequiredWeeklyProgressStatus,
  remaining: number | null,
  required: number | null,
  suffix: string
) {
  if (status === 'COMPLETED') return 'Meta concluída';
  if (status === 'OVERDUE') return `Prazo vencido${remaining != null ? ` · faltam ${remaining.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}${suffix}` : ''}`;
  if (status === 'DUE_TODAY') return `Concluir hoje${remaining != null ? ` · faltam ${remaining.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}${suffix}` : ''}`;
  if (status === 'REQUIRED' && required != null) {
    return `${required.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}${suffix}/semana`;
  }
  return 'Ritmo indisponível';
}

export function RequiredWeeklyProgressCard({ target }: { target?: RequiredWeeklyProgress }) {
  if (!target) return null;
  const measurableServices = target.services.filter(service => service.systems.some(system => system.plannedQty != null));
  return (
    <div className="acp-detail-weekly" data-acp-weekly-progress-target>
      <div className="acp-detail-weekly-head">
        <div>
          <strong>Ritmo necessário</strong>
          <span>para entregar na data prevista</span>
        </div>
        <Badge multiline tone={target.status === 'OVERDUE' ? 'danger' : target.status === 'DUE_TODAY' ? 'warning' : target.status === 'COMPLETED' ? 'success' : 'brand'}>
          {weeklyTargetText(target.status, target.remainingPctPoints, target.requiredPctPointsPerWeek, ' p.p.')}
        </Badge>
      </div>
      {measurableServices.length > 0 ? (
        <div className="acp-detail-weekly-services">
          {measurableServices.map(service => (
            <div className="acp-detail-weekly-service" key={service.serviceType}>
              <div className="acp-detail-weekly-service-head">
                <strong>{SERVICE_LABELS[service.serviceType] ?? service.serviceType}</strong>
                <span>{fmtPct(service.executionPct)}</span>
              </div>
              {service.systems.filter(system => system.plannedQty != null).map(system => {
                const unit = system.unit ? ` ${UNIT_LABELS[system.unit] ?? system.unit}` : '';
                return (
                  <div className="acp-detail-weekly-system" key={`${system.systemType}:${system.unit ?? ''}`}>
                    <div>
                      <span>{SYSTEM_LABELS[system.systemType] ?? system.systemType}</span>
                      <small>{fmtQuantity(system.realizedQty, system.unit)} / {fmtQuantity(system.plannedQty, system.unit)}</small>
                    </div>
                    <strong>{weeklyTargetText(system.status, system.remainingQty, system.requiredQtyPerWeek, unit)}</strong>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function MetricBar({ label, value, caption, tone, help }: { label: string; value: number | null; caption: string; tone?: 'cost'; help: string }) {
  return (
    <ProgressBar
      label={<HelpTip help={help}>{label}</HelpTip>}
      value={value}
      valueLabel={caption}
      tone={tone === 'cost' && value != null && value > 100 ? 'danger' : 'brand'}
    />
  );
}

export function WorkedHoursMetric({ data }: {
  data: {
    normalWorkedHours: number;
    overtimeWorkedHours: number;
    totalWorkedHours: number;
    plannedTotalHours: number | null;
    normalPct: number | null;
    overtimePct: number | null;
    totalPct: number | null;
    roleCounts?: Array<{ roleName: string; collaboratorCount: number; usedHours: number; pctOfPlannedTotal: number | null }>;
  };
}) {
  const roleCounts = data.roleCounts ?? [];
  return (
    <div className="acp-detail-metric">
      <ProgressBar
        label={<HelpTip help="Soma das horas-homem dos relatórios de execução, separando horas normais e horas extras. Cada turno é multiplicado pela quantidade de colaboradores daquele turno; as horas previstas já incluem todos os colaboradores.">Horas trabalhadas</HelpTip>}
        value={data.totalPct}
        valueLabel={`${fmtHours(data.totalWorkedHours)} / ${fmtHours(data.plannedTotalHours)}${data.totalPct != null ? ` · ${data.totalPct}%` : ''}`}
        segments={[{ value: data.normalPct, tone: 'brand' }, { value: data.overtimePct, tone: 'warning' }]}
      />
      <div className="acp-detail-hours-split">
        <span>
          <i className="acp-detail-hours-dot normal" />Normais {fmtHours(data.normalWorkedHours)}
          {data.normalPct != null ? ` · ${data.normalPct}%` : ''}
        </span>
        <span>
          <i className="acp-detail-hours-dot overtime" />HE {fmtHours(data.overtimeWorkedHours)}
          {data.overtimePct != null ? ` · ${data.overtimePct}%` : ''}
        </span>
      </div>
      {roleCounts.length > 0 ? (
        <div className="acp-detail-hours-roles" aria-label="Colaboradores por cargo previsto">
          {roleCounts.map(item => (
            <span key={item.roleName}>
              {item.roleName}: {item.collaboratorCount} colab. · {fmtHours(item.usedHours)}
              {item.pctOfPlannedTotal != null ? ` · ${fmtPct(item.pctOfPlannedTotal)}` : ''}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function PlannedScopeView({ scope }: { scope?: PlannedScope }) {
  if (!scope || scope.services.length === 0) {
    return <div className="acp-detail-muted">Nenhum escopo cadastrado.</div>;
  }
  return (
    <div className="acp-detail-scope">
      {scope.services.map((svc, i) => (
        <div className="acp-detail-scope-svc" key={i}>
          <div className="acp-detail-scope-head">
            <span>{SERVICE_LABELS[svc.serviceType] ?? svc.serviceType}</span>
            {svc.weight !== null && svc.weight !== undefined ? (
              <span className="acp-detail-scope-weight">peso {Number(svc.weight ?? 0).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%</span>
            ) : null}
          </div>
          <ul>
            {svc.systems.map((sys, j) => (
              <li key={j}>
                {SYSTEM_LABELS[sys.systemType] ?? sys.systemType}: {sys.quantity ?? '—'} {sys.unit ? UNIT_LABELS[sys.unit] ?? '' : ''}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
