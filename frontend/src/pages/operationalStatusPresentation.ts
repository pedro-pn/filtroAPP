import type { SemanticTone } from '../components/ui/ds/types';

export function operationalDateTime(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '—';
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short'
  }).format(date);
}

export function operationalDuration(value?: number | null) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0)
    return '—';
  const totalMinutes = Math.round(value / 60000);
  if (totalMinutes <= 0) return '< 1 min';
  if (totalMinutes < 60) return `${totalMinutes} min`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours < 24) return minutes ? `${hours}h ${minutes}min` : `${hours}h`;
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return remainingHours ? `${days}d ${remainingHours}h` : `${days}d`;
}

const STATUS_PRESENTATION: Record<
  string,
  { label: string; tone: SemanticTone }
> = {
  SUCCESS: { label: 'Concluído', tone: 'success' },
  COMPLETED: { label: 'Concluído', tone: 'success' },
  ATIVO: { label: 'Ativo', tone: 'success' },
  SKIPPED: { label: 'Ignorado', tone: 'neutral' },
  FAILED: { label: 'Falhou', tone: 'danger' },
  FAILURE: { label: 'Falhou', tone: 'danger' },
  ERROR: { label: 'Erro', tone: 'danger' },
  INVALID: { label: 'Status inválido', tone: 'danger' },
  STALE: { label: 'Atrasado', tone: 'warning' },
  MISSING: { label: 'Status ausente', tone: 'warning' },
  PARTIAL: { label: 'Parcial', tone: 'warning' },
  PENDING: { label: 'Pendente', tone: 'warning' },
  RUNNING: { label: 'Em andamento', tone: 'info' },
  NOT_CONFIGURED: { label: 'Não configurado', tone: 'neutral' },
  SEM_EXECUCAO: { label: 'Sem execução', tone: 'neutral' },
  SEM_RECEBIMENTO: { label: 'Sem recebimento', tone: 'neutral' },
  DISABLED: { label: 'Desativado', tone: 'neutral' },
  UNKNOWN: { label: 'Desconhecido', tone: 'neutral' }
};

export function operationalStatusLabel(status: string) {
  return STATUS_PRESENTATION[status]?.label || status;
}

export function operationalStatusTone(status: string): SemanticTone {
  return STATUS_PRESENTATION[status]?.tone || 'neutral';
}

const JOB_LABELS: Record<string, string> = {
  'survey-reminders': 'Lembretes de pesquisas',
  'signature-reminders': 'Lembretes de assinaturas',
  'calibration-reminders': 'Lembretes de calibração',
  'monthly-allocation-report': 'Relatório mensal de alocação',
  'legacy-zapsign-reconciliation': 'Conciliação de assinaturas ZapSign',
  'pontomais-sync': 'Sincronização PontoMais',
  'data-retention': 'Retenção de dados',
  'report-approval-post-processing': 'Pós-processamento de aprovação',
  'omie-sync': 'Sincronização Omie',
  'commercial-access-import': 'Recebimento do banco comercial'
};

export function operationalJobLabel(name: string) {
  return JOB_LABELS[name] || name;
}
