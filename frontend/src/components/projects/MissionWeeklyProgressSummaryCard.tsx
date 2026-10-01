import { useQuery } from '@tanstack/react-query';
import { TrendingUp } from 'lucide-react';

import { buildWeeklyProgressComparison, corporateToday, weekStartKey } from '../../../../shared/modules/mission-weekly-progress.js';
import { listWeeklyProgressTargets, weeklyTargetPath, type WeeklyTargetOwner } from '../../api/weeklyProgressTargets';
import type { ProgressHistoryPoint } from '../../api/acompanhamentoComercial';
import { formatDateOnly } from '../../utils/dateOnly';
import { AppIcon } from '../icons/AppIcon';
import { Card } from '../ui/ds';

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
    progressHistory: progressHistory ?? targetsQuery.data.progressHistory ?? []
  }).find(row => row.weekStartDate === currentWeek) : null;
  const planned = current?.plannedPctPoints ?? null;
  const actual = current?.actualPctPoints ?? null;
  const achievedPct = planned != null && planned > 0 && actual != null
    ? Math.max(0, Math.min(100, actual / planned * 100)) : 0;
  const weekLabel = formatDateOnly(currentWeek);
  let valueLabel = 'Sem meta';
  let detailLabel = `${actual == null ? 'Sem avanço registrado' : `${numberFormat.format(actual)} p.p. executados`} · ${weekLabel}`;
  if (targetsQuery.isPending) {
    valueLabel = 'Carregando…';
    detailLabel = 'Consultando a semana atual';
  } else if (targetsQuery.isError) {
    valueLabel = 'Indisponível';
    detailLabel = 'Não foi possível carregar a meta semanal';
  } else if (planned != null) {
    valueLabel = `${actual == null ? '—' : numberFormat.format(actual)} / ${numberFormat.format(planned)} p.p.`;
    detailLabel = actual == null ? 'Sem histórico de avanço nesta semana'
      : planned === 0 ? `Meta de 0 p.p. · ${weekLabel}`
        : `${numberFormat.format(Math.max(0, actual / planned * 100))}% da meta · ${weekLabel}`;
  }

  return <Card padding="sm" className="acp-overview-kpi acp-overview-weekly" data-acp-weekly-current>
    <div className="acp-overview-kpi-icon"><AppIcon icon={TrendingUp} /></div>
    <span>Meta desta semana</span>
    <strong>{valueLabel}</strong>
    {planned != null && actual != null && planned > 0 ? <div className="acp-overview-weekly-track" role="progressbar"
      aria-label="Avanço da meta semanal" aria-valuemin={0} aria-valuemax={planned} aria-valuenow={Math.max(0, Math.min(planned, actual))}
      aria-valuetext={`${numberFormat.format(actual)} de ${numberFormat.format(planned)} pontos percentuais`}>
      <i style={{ width: `${achievedPct}%` }} />
    </div> : null}
    <small>{detailLabel}</small>
  </Card>;
}
