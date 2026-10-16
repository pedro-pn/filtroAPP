import type { SignatureBatch, SignatureBatchConfiguration, SignatureBatchSigner, SignatureSigner } from '../../../api/assinaturas';

export const MAX_SIGNATURE_PDF_BYTES = 200 * 1024 * 1024;

export function validateSignatureFiles(files: Array<Pick<File, 'name' | 'size' | 'type'>>) {
  if (!files.length) return 'Selecione pelo menos um arquivo PDF.';
  for (const file of files) {
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) return `${file.name}: envie um arquivo PDF válido.`;
    if (!file.size) return `${file.name}: o arquivo está vazio.`;
    if (file.size > MAX_SIGNATURE_PDF_BYTES) return `${file.name}: o PDF deve ter no máximo 200 MB.`;
  }
  return '';
}

export function batchConfiguration(batch: SignatureBatch): SignatureBatchConfiguration {
  return {
    signers: batch.signers,
    documents: batch.documents.map(document => ({
      id: document.id,
      fields: document.fields.map(field => ({
        ...field,
        x: Number(field.x), y: Number(field.y), width: Number(field.width), height: Number(field.height),
        signerId: document.signers.find(signer => signer.id === field.signerId)?.batchSignerId || field.signerId
      }))
    }))
  };
}

export function batchPreviewSigners(signers: SignatureBatchSigner[]): SignatureSigner[] {
  return signers.map(signer => ({ ...signer, status: 'PENDENTE', signedAt: null, viewedAt: null, tokenExpiresAt: null, emailStatus: 'NAO_APLICAVEL' }));
}

export function batchPublicationIssues(batch: SignatureBatch, configuration: SignatureBatchConfiguration) {
  const issues: string[] = [];
  for (const document of batch.documents) {
    if (!configuration.documents.find(item => item.id === document.id)?.fields.length) issues.push(`${document.title}: posicione pelo menos uma assinatura.`);
  }
  for (const signer of configuration.signers) {
    if (!configuration.documents.some(document => document.fields.some(field => field.signerId === signer.id))) issues.push(`${signer.name} não tem campo de assinatura em nenhum documento.`);
  }
  return issues;
}
