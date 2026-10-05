import { useQuery } from '@tanstack/react-query';
import { TrendingUp } from 'lucide-react';

import { buildWeeklyProgressComparison, corporateToday, weekStartKey } from '../../../../shared/modules/mission-weekly-progress.js';
import { listWeeklyProgressTargets, weeklyTargetPath, type WeeklyTargetOwner } from '../../api/weeklyProgressTargets';
import type { ProgressHistoryPoint } from '../../api/acompanhamentoComercial';
import { formatDateOnly } from '../../utils/dateOnly';
import { AppIcon } from '../icons/AppIcon';
import { Card } from '../ui/ds';
import { attendanceBalanceLabel, weeklyValueLabel } from './weeklyTargetPresentation';

const numberFormat = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });

export function MissionWeeklyProgressSummaryCard({ owner, progressHistory }: {
  owner: WeeklyTargetOwner;
  progressHistory?: ProgressHistoryPoint[];
}) {
  const targetsQuery = useQuery({
    queryKey: ['mission-weekly-targets', weeklyTargetPath(owner), progressHistory === undefined],
    queryFn: () => listWeeklyProgressTargets(owner, progressHistory === undefined),
    staleTime: 30_000
  });
  const currentWeek = weekStartKey(corporateToday())!;
  const current = targetsQuery.data ? buildWeeklyProgressComparison({
    targets: targetsQuery.data.targets,
    progressHistory: progressHistory ?? targetsQuery.data.progressHistory ?? [], serviceHistory: targetsQuery.data.serviceHistory ?? [], attendanceHistory: targetsQuery.data.attendanceHistory ?? []
  }).find(row => row.weekStartDate === currentWeek) : null;
  const planned = current?.plannedValue ?? null;
  const actual = current?.actualValue ?? null;
  const metric = current?.metric ?? 'PCT_POINTS';
  const achievedPct = Math.min(100, current?.achievementPct ?? 0);
  const weekLabel = formatDateOnly(currentWeek);
  let valueLabel = 'Sem meta';
  let detailLabel = `${actual == null ? 'Sem avanço registrado' : `${weeklyValueLabel(actual, metric)} executados`} · ${weekLabel}`;
  if (targetsQuery.isPending) {
    valueLabel = 'Carregando…';
    detailLabel = 'Consultando a semana atual';
  } else if (targetsQuery.isError) {
    valueLabel = 'Indisponível';
    detailLabel = 'Não foi possível carregar a meta semanal';
  } else if (current?.metric === 'COLLABORATORS') {
    valueLabel = current.status === 'BELOW' ? 'Fora da meta' : current.status === 'ON_TARGET' ? 'Dentro da meta'
      : current.status === 'PLANNED' ? 'Aguardando dias de trabalho' : 'Presença pendente';
    detailLabel = `${weeklyValueLabel(planned, metric)} · ${attendanceBalanceLabel(current.cumulativeAttendance?.differenceValue ?? null)} · ${weekLabel}`;
  } else if (current?.mixedUnits && current.achievementPct != null) {
    valueLabel = `${numberFormat.format(current.achievementPct)}% da meta`;
    detailLabel = `Por serviço · ${weekLabel}`;
  } else if (planned != null) {
    valueLabel = `${actual == null ? '—' : numberFormat.format(actual)} / ${weeklyValueLabel(planned, metric)}`;
    detailLabel = actual == null ? 'Sem histórico de avanço nesta semana'
      : planned === 0 ? `Meta de ${weeklyValueLabel(0, metric)} · ${weekLabel}`
        : `${numberFormat.format(current?.achievementPct ?? 0)}% da meta${current && current.goals.length > 1 ? ' por serviço' : ''} · ${weekLabel}`;
  } else if (current?.target) {
    valueLabel = current.status === 'NO_DATA' ? 'Sem dados' : 'Sem cenário';
    detailLabel = current.status === 'NO_DATA' ? current.basis === 'PER_PRODUCTIVE_DAY' ? 'Confira a equipe e os horários nos RDOs' : 'Aguardando serviços finalizados' : 'Confira os tipos de serviço e as regras cadastradas';
  }

  return <Card padding="sm" className="acp-overview-kpi acp-overview-weekly" data-acp-weekly-current>
    <div className="acp-overview-kpi-icon"><AppIcon icon={TrendingUp} /></div>
    <span>Meta desta semana</span>
    <strong>{valueLabel}</strong>
    {(planned != null && actual != null && planned > 0) || (current?.mixedUnits && current.achievementPct != null) ? <div className="acp-overview-weekly-track" role="progressbar"
      aria-label="Avanço da meta semanal" aria-valuemin={0} aria-valuemax={current?.goals.length === 1 ? planned! : 100} aria-valuenow={current?.goals.length === 1 ? Math.max(0, Math.min(planned!, actual!)) : achievedPct}
      aria-valuetext={`${numberFormat.format(current?.achievementPct ?? 0)}% da meta${current && current.goals.length > 1 ? ' por serviço' : ''}`}>
      <i style={{ width: `${achievedPct}%` }} />
    </div> : null}
    <small>{detailLabel}</small>
  </Card>;
}
