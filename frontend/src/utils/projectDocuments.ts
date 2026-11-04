import type { ProjectCommercialProposalSync } from '../api/projectDocuments';

export function commercialProposalDocumentsRefetchInterval(sync: ProjectCommercialProposalSync | null | undefined) {
  return sync?.retryScheduled && ['PENDING', 'APPLYING', 'ERROR'].includes(sync.status) ? 15_000 : false;
}

export function commercialProposalSyncMessage(sync: ProjectCommercialProposalSync | null | undefined) {
  if (!sync || sync.status === 'SYNCED') return null;
  const proposal = `proposta ${sync.proposalCode}, revisão ${sync.revisionNumber}`;
  if (sync.status === 'EXCLUDED') return sync.stopReason?.startsWith('LEGACY_')
    ? `A ${proposal} pertence ao acervo legado e não está disponível para importação pelo ComercialAPP.`
    : `A importação automática não está disponível para a ${proposal}.`;
  if (!sync.configured) return 'A integração com o ComercialAPP ainda não está configurada neste ambiente.';
  const retry = sync.retryScheduled ? ' A busca será repetida automaticamente.' : '';
  if (sync.status === 'ERROR') {
    if (sync.errorCode === 'COMERCIALAPP_HTTP_404') return `Os documentos da ${proposal} não foram encontrados no ComercialAPP. Confira o número e a revisão vinculados ao projeto.${retry}`;
    if (sync.errorCode === 'COMERCIALAPP_HTTP_409') return `Os PDFs da ${proposal} ainda não estão disponíveis para importação no ComercialAPP.${retry}`;
    return `Não foi possível importar os documentos da ${proposal} do ComercialAPP.${retry}`;
  }
  if (!sync.retryScheduled) return `A importação dos documentos da ${proposal} está pendente.`;
  return `Buscando os documentos da ${proposal} no ComercialAPP. Os anexos aparecerão aqui automaticamente após a importação.`;
}
