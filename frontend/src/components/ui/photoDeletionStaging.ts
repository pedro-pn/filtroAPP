import { deleteUploadFile } from '../../api/uploads';

// Conjunto de imagens cuja exclusão foi ENCENADA no editor. A exclusão (global +
// disco) só acontece quando o editor chama `flushStagedUploadDeletions()` após
// salvar o relatório com sucesso. Se o usuário não salvar, nada é apagado.
//
// O escopo é por sessão de edição: cada editor deve chamar
// `clearStagedUploadDeletions()` ao montar / ao trocar de relatório, garantindo
// que exclusões encenadas e não salvas sejam descartadas.
const stagedDeletions = new Set<string>();

export function stageUploadDeletion(storagePath: string) {
  if (storagePath) stagedDeletions.add(storagePath);
}

export function clearStagedUploadDeletions() {
  stagedDeletions.clear();
}

export async function flushStagedUploadDeletions() {
  const refs = [...stagedDeletions];
  stagedDeletions.clear();
  for (const ref of refs) {
    try {
      await deleteUploadFile(ref);
    } catch {
      /* best effort — não bloqueia o fluxo de salvar */
    }
  }
  return refs.length;
}
