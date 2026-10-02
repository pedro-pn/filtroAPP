import { weeklyTargetUnit, type WeeklyTargetMetric } from '../../../../shared/modules/mission-weekly-progress.js';

const numberFormat = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });
export const weeklyValueLabel = (value: number | null, metric: WeeklyTargetMetric, signed = false) => value == null ? '—'
  : `${signed && value > 0 ? '+' : ''}${numberFormat.format(value)} ${weeklyTargetUnit(metric)}`;

