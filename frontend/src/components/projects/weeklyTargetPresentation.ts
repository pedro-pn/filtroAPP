import { weeklyTargetUnit, type WeeklyTargetMetric } from '../../../../shared/modules/mission-weekly-progress.js';

const numberFormat = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });
export const weeklyValueLabel = (value: number | null, metric: WeeklyTargetMetric, signed = false) => value == null ? '—'
  : `${signed && value > 0 ? '+' : ''}${numberFormat.format(value)} ${weeklyTargetUnit(metric)}`;

export const attendanceBalanceLabel = (value: number | null) => value == null ? 'Saldo pendente de RDO'
  : value > 0 ? `Superávit de ${numberFormat.format(value)} presenças`
    : value < 0 ? `Déficit de ${numberFormat.format(-value)} presenças` : 'Saldo zero';
