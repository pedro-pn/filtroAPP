import type { SignatureDocumentStatus } from '../../../api/assinaturas';

export const signatureDocumentStatusLabels: Record<SignatureDocumentStatus, string> = {
  RASCUNHO: 'Rascunho',
  AGUARDANDO_ASSINATURAS: 'Aguardando assinaturas',
  FINALIZANDO: 'Finalizando',
  CONCLUIDO: 'Concluído',
  CANCELADO: 'Cancelado'
};
