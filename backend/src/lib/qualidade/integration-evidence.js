import env from '../../config/env.js';
import { IntegrationApiError } from '../../middleware/api-request-context.js';
import { resolveManagedDocumentPath, safeDocumentPathPart } from '../documents/storage.js';

const requiredPrefix = `${safeDocumentPathPart('Qualidade')}/${safeDocumentPathPart('Evidencias')}/`;

export async function resolveIntegrationQualityEvidence(client, id, context, { rootDir = env.uploadDir } = {}) {
  const evidence = await client.qualityEvidence.findUnique({
    where: { id },
    select: {
      id: true, kind: true, fileName: true, mimeType: true, storagePath: true,
      record: { select: { deletedAt: true, projectId: true } }
    }
  });
  if (!evidence || evidence.kind !== 'ATTACHMENT' || !evidence.storagePath) {
    throw new IntegrationApiError(404, 'NOT_FOUND', 'Evidência não encontrada.');
  }
  if (evidence.record.deletedAt && !context.scopes.has('qualidade.excluidos.read')) {
    throw new IntegrationApiError(404, 'NOT_FOUND', 'Evidência não encontrada.');
  }
  if (context.projectAccessMode === 'SELECTED' && !context.projectIds.has(evidence.record.projectId)) {
    throw new IntegrationApiError(404, 'NOT_FOUND', 'Evidência não encontrada.');
  }
  const targetPath = resolveManagedDocumentPath(evidence.storagePath, { rootDir, requiredPrefix });
  if (!targetPath) throw new IntegrationApiError(404, 'NOT_FOUND', 'Evidência não encontrada.');
  return { targetPath, fileName: evidence.fileName || 'evidencia', mimeType: evidence.mimeType || 'application/octet-stream' };
}
