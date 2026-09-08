import path from 'node:path';
import env from '../../config/env.js';
import { resolveIntegrationQualityEvidence } from '../qualidade/integration-evidence.js';
import { openManagedFile, openOperationalDownload } from './operational-downloads.js';

// Verifica autorização e abertura, mas nunca lê/transmite o conteúdo do arquivo.
export async function checkPlaygroundDownload(client, operation, params, context, roots = env) {
  let file;
  try {
    let mimeType;
    if (operation.operationId === 'quality.evidence.download') {
      const evidence = await resolveIntegrationQualityEvidence(client, params.id, context, { rootDir: roots.uploadDir });
      file = await openManagedFile(roots.uploadDir, path.relative(roots.uploadDir, evidence.targetPath).split(path.sep).join('/'), 'Qualidade/Evidencias/');
      mimeType = evidence.mimeType;
    } else {
      file = await openOperationalDownload(client, operation.operationId, params, {}, context, roots);
      mimeType = file.contentType;
    }
    return { kind: 'DOWNLOAD_CHECK', available: true,
      file: { id: params.id, mimeType, sizeBytes: file.bytes },
      message: 'Acesso ao arquivo verificado. O conteúdo não foi transferido. Use o cURL no ambiente do consumidor para validar o download real.' };
  } finally {
    if (file) await file.handle.close();
  }
}
