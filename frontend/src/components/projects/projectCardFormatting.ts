import type { MissionGroupCard, ProjectCardItem } from '../../api/acompanhamentoComercial';

export function formatDate(iso?: string | null) {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('pt-BR');
}
export function pct(value?: number | null) {
  return value === null || value === undefined ? '—' : `${value.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
}
export function brl(value?: number | null) {
  return value === null || value === undefined ? '—'
    : value.toLocaleString('pt-BR', {
      style: 'currency',
      currency: 'BRL',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
}
export function fmtHours(value?: number | null) {
  return value === null || value === undefined ? '—'
    : `${value.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}h`;
}
export function isGroupCard(card: ProjectCardItem): card is MissionGroupCard {
  return card.kind === 'GROUP';
}

export function cardKey(card: ProjectCardItem) {
  return isGroupCard(card) ? `group-${card.groupId}` : card.projectId;
}
