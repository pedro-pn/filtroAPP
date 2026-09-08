import { useState } from 'react';

import { downloadSignaturePdf, type SignatureDocument } from '../../../api/assinaturas';
import { Button } from '../../../components/ui/Button';
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog';
import { useToast } from '../../../components/ui/ToastContext';
import { useAssinaturaMutations } from '../../../hooks/useAssinaturas';
import { DocumentSetupView } from './DocumentSetupView';
import { SignerStatusList } from './SignerStatusList';
import { AuditTrail } from './AuditTrail';
import { formatSignatureDateTime } from '../utils/datetime';

function saveBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function DocumentDetailView({
  document,
  tab,
  pageNumber,
  onTabChange,
  onPageChange,
  onBack
}: {
  document: SignatureDocument;
  tab: 'details' | 'setup' | 'audit';
  pageNumber: number;
  onTabChange: (tab: 'details' | 'setup' | 'audit') => void;
  onPageChange: (page: number) => void;
  onBack: () => void;
}) {
  const showToast = useToast();
  const mutations = useAssinaturaMutations();
  const [pendingAction, setPendingAction] = useState<'archive' | 'cancel' | 'delete' | null>(null);
  const isDraft = document.status === 'RASCUNHO';
  const activeTab = isDraft ? (tab === 'audit' ? 'audit' : 'setup') : (tab === 'setup' ? 'details' : tab);
  async function download(final: boolean) {
    try {
      saveBlob(await downloadSignaturePdf(document.id, final), final ? `${document.title}-assinado.pdf` : document.originalFileName);
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Não foi possível baixar o PDF.', 'error');
    }
  }
  async function runLifecycleAction() {
    if (!pendingAction) return;
    try {
      if (pendingAction === 'archive') await mutations.archive.mutateAsync({ id: document.id });
      if (pendingAction === 'cancel') await mutations.cancel.mutateAsync({ id: document.id });
      if (pendingAction === 'delete') await mutations.deleteDocument.mutateAsync({ id: document.id });
      showToast(pendingAction === 'archive' ? 'Documento arquivado.' : pendingAction === 'cancel' ? 'Documento cancelado.' : 'Documento excluído.', 'success');
      const deleted = pendingAction === 'delete';
      setPendingAction(null);
      if (deleted) onBack();
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Não foi possível concluir a ação.', 'error');
    }
  }
  async function restoreArchive() {
    try {
      await mutations.restoreArchived.mutateAsync({ id: document.id });
      showToast('Documento restaurado para os ativos.', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Não foi possível restaurar o documento.', 'error');
    }
  }
  const actionPending = mutations.archive.isPending || mutations.cancel.isPending || mutations.deleteDocument.isPending;
  return (
    <section className="signature-detail">
      <div className="signature-detail-heading">
        <Button variant="secondary" onClick={onBack}>Voltar</Button>
        <div><h2>{document.title}</h2><p>{document.originalFileName}</p></div>
        <span className={`signature-status signature-status-${document.status.toLowerCase()}`}>{document.status.replaceAll('_', ' ')}</span>
      </div>
      <div className="signature-tabs">
        {document.status !== 'RASCUNHO' ? <button type="button" className={activeTab === 'details' ? 'active' : ''} onClick={() => onTabChange('details')}>Acompanhamento</button> : null}
        {isDraft ? <button type="button" className={activeTab === 'setup' ? 'active' : ''} onClick={() => onTabChange('setup')}>Configuração</button> : null}
        <button type="button" className={activeTab === 'audit' ? 'active' : ''} onClick={() => onTabChange('audit')}>Auditoria</button>
      </div>
      <div className="signature-document-dates">
        <span>Criado em {formatSignatureDateTime(document.createdAt)}</span>
        {document.completedAt ? <span>Concluído em {formatSignatureDateTime(document.completedAt)}</span> : null}
      </div>
      <div className="signature-lifecycle-actions">
        {document.archivedAt ? <Button variant="secondary" onClick={restoreArchive}>Restaurar dos arquivados</Button>
          : <Button variant="secondary" disabled={document.status === 'FINALIZANDO'} onClick={() => setPendingAction('archive')}>Arquivar</Button>}
        {document.status === 'AGUARDANDO_ASSINATURAS' ? <Button variant="secondary" title="Cancela o documento e revoga todos os convites pendentes; assinaturas concluídas são preservadas." onClick={() => setPendingAction('cancel')}>Cancelar rodada</Button> : null}
        <Button variant="secondary" disabled={document.status === 'FINALIZANDO'} title={document.status === 'FINALIZANDO' ? 'Aguarde a geração do PDF final.' : undefined} onClick={() => setPendingAction('delete')}>Excluir</Button>
      </div>
      {activeTab === 'setup' ? <DocumentSetupView document={document} pageNumber={pageNumber} onPageChange={onPageChange} /> : activeTab === 'audit' ? <AuditTrail documentId={document.id} /> : (
        <>
          {document.status === 'FINALIZANDO' ? <p className="signature-inline-warning">O PDF assinado está sendo finalizado. Esta tela atualiza automaticamente.</p> : null}
          <div className="signature-detail-actions">
            <Button variant="secondary" onClick={() => download(false)}>Baixar original</Button>
            <Button disabled={document.status !== 'CONCLUIDO'} onClick={() => download(true)}>Baixar PDF assinado</Button>
          </div>
          <SignerStatusList documentId={document.id} signers={document.signers} />
        </>
      )}
      <ConfirmDialog
        open={Boolean(pendingAction)}
        title={pendingAction === 'archive' ? 'Arquivar documento?' : pendingAction === 'cancel' ? 'Cancelar rodada de assinaturas?' : 'Excluir documento?'}
        description={pendingAction === 'archive'
          ? 'O documento sairá da lista principal, mas status, links e arquivos permanecerão inalterados.'
          : pendingAction === 'cancel'
            ? 'Convites pendentes serão revogados imediatamente; assinaturas já registradas serão preservadas.'
            : 'Links ativos serão invalidados imediatamente. Os arquivos serão preservados durante o prazo de retenção.'}
        highlight={document.title}
        confirmLabel={actionPending ? 'Processando...' : pendingAction === 'archive' ? 'Arquivar' : pendingAction === 'cancel' ? 'Cancelar rodada' : 'Excluir'}
        confirmationText={pendingAction === 'delete' && document.status === 'CONCLUIDO' ? document.title : undefined}
        confirmationLabel={pendingAction === 'delete' && document.status === 'CONCLUIDO' ? 'Digite o nome do documento para confirmar' : undefined}
        onConfirm={runLifecycleAction}
        onCancel={() => setPendingAction(null)}
      />
    </section>
  );
}
