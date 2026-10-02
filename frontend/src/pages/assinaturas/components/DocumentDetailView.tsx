import { useState } from 'react';

import { downloadSignaturePdf, type SignatureDocument } from '../../../api/assinaturas';
import { AppIcon } from '../../../components/icons/AppIcon';
import { Button, StatusPill } from '../../../components/ui/ds';
import { DS_ICONS } from '../../../components/ui/ds/icons';
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog';
import { useToast } from '../../../components/ui/ToastContext';
import { useAssinaturaMutations } from '../../../hooks/useAssinaturas';
import { DocumentSetupView } from './DocumentSetupView';
import { SignerStatusList } from './SignerStatusList';
import { AuditTrail } from './AuditTrail';
import { DocumentTrackingSummary } from './DocumentTrackingSummary';
import { formatSignatureDateTime } from '../utils/datetime';
import { signatureDocumentStatusLabels } from '../utils/documentStatus';
import { PageHeader } from '../../../layout/PageHeader';
import '../AssinaturasPreparation.ds.css';

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
  const [downloading, setDownloading] = useState<'original' | 'final' | null>(null);
  const isDraft = document.status === 'RASCUNHO';
  const activeTab = isDraft ? (tab === 'audit' ? 'audit' : 'setup') : (tab === 'setup' ? 'details' : tab);
  async function download(final: boolean) {
    if (downloading) return;
    setDownloading(final ? 'final' : 'original');
    try {
      saveBlob(await downloadSignaturePdf(document.id, final), final ? `${document.title}-assinado.pdf` : document.originalFileName);
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Não foi possível baixar o PDF.', 'error');
    } finally {
      setDownloading(null);
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
    <section className="fv-ds assinaturas-detail">
      <div className="assinaturas-detail__topline">
        <Button variant="secondary" size="sm" iconLeft={<AppIcon icon={DS_ICONS.previous} size="sm" />} onClick={onBack}>Voltar</Button>
        <StatusPill status={signatureDocumentStatusLabels[document.status]} />
      </div>
      <PageHeader title={document.title} description={document.originalFileName} />
      <div className="signature-document-dates">
        <span>Criado em {formatSignatureDateTime(document.createdAt)}</span>
        {document.completedAt ? <span>Concluído em {formatSignatureDateTime(document.completedAt)}</span> : null}
      </div>
      <div className="assinaturas-detail__navigation">
        <div className="signature-tabs" role="group" aria-label="Seções do documento">
          {document.status !== 'RASCUNHO' ? <Button size="sm" variant={activeTab === 'details' ? 'primary' : 'secondary'} aria-pressed={activeTab === 'details'} onClick={() => onTabChange('details')}>Acompanhamento</Button> : null}
          {isDraft ? <Button size="sm" variant={activeTab === 'setup' ? 'primary' : 'secondary'} aria-pressed={activeTab === 'setup'} onClick={() => onTabChange('setup')}>Configuração</Button> : null}
          <Button size="sm" variant={activeTab === 'audit' ? 'primary' : 'secondary'} aria-pressed={activeTab === 'audit'} onClick={() => onTabChange('audit')}>Auditoria</Button>
        </div>
        <div className="signature-lifecycle-actions">
          {document.archivedAt ? <Button variant="secondary" size="sm" title="Restaurar dos arquivados" loading={mutations.restoreArchived.isPending} onClick={restoreArchive}>Restaurar</Button>
            : <Button variant="secondary" size="sm" disabled={document.status === 'FINALIZANDO'} onClick={() => setPendingAction('archive')}>Arquivar</Button>}
          {document.status === 'AGUARDANDO_ASSINATURAS' ? <Button variant="secondary" size="sm" title="Cancela o documento e revoga todos os convites pendentes; assinaturas concluídas são preservadas." onClick={() => setPendingAction('cancel')}>Cancelar rodada</Button> : null}
          <Button variant="secondary" size="sm" disabled={document.status === 'FINALIZANDO'} title={document.status === 'FINALIZANDO' ? 'Aguarde a geração do PDF final.' : undefined} onClick={() => setPendingAction('delete')}>Excluir</Button>
        </div>
      </div>
      {activeTab === 'setup' ? <DocumentSetupView document={document} pageNumber={pageNumber} onPageChange={onPageChange} /> : activeTab === 'audit' ? <AuditTrail key={document.id} documentId={document.id} /> : (
        <>
          <DocumentTrackingSummary document={document} downloading={downloading} onDownload={download} />
          <SignerStatusList documentId={document.id} signers={document.signers} />
        </>
      )}
      <ConfirmDialog
        appearance="design-system"
        confirmDisabled={actionPending}
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
