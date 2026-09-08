import type { CommercialPendencia } from '../../api/acompanhamentoComercial';

export function pluralSuffix(count: number, plural = 's') {
  return count === 1 ? '' : plural;
}

export function commercialPendenciaPendingCount(pendencia: CommercialPendencia | null | undefined) {
  if (!pendencia) return 0;
  if (Number.isFinite(pendencia.pendingCount)) return Math.max(0, Number(pendencia.pendingCount));
  return pendencia.resolved ? 0 : 1;
}

export function pendingCommercialProposalCountForProjects(pendencias: CommercialPendencia[], activeProjectIds: Set<string>) {
  return pendencias.reduce((sum, pendencia) => (
    activeProjectIds.has(pendencia.projectId)
      ? sum + commercialPendenciaPendingCount(pendencia)
      : sum
  ), 0);
}

export function commercialPendenciaMapByProject(pendencias: CommercialPendencia[]) {
  const map = new Map<string, CommercialPendencia>();
  pendencias.forEach(pendencia => map.set(pendencia.projectId, pendencia));
  return map;
}

export function commercialPendenciaAlertText(pendencia: CommercialPendencia) {
  const pendingCount = commercialPendenciaPendingCount(pendencia);
  if (pendingCount <= 0) return null;

  const details: string[] = [];
  if (pendencia.originalPending) details.push('principal');
  const pendingAdditional = Math.max(0, Number(pendencia.pendingAdditionalProposalCount ?? 0));
  if (pendingAdditional > 0) details.push(`${pendingAdditional} adicional${pluralSuffix(pendingAdditional, 'is')}`);
  const detailText = details.length ? ` (${details.join(' + ')})` : '';
  return `Há ${pendingCount} proposta${pluralSuffix(pendingCount)} comercial${pluralSuffix(pendingCount, 'is')} pendente${pluralSuffix(pendingCount)} para a proposta ${pendencia.proposalCode}${detailText}. Abra os detalhes e escolha as revisões que valem para esta missão.`;
}
