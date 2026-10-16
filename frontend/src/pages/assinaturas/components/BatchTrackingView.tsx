import { useState } from 'react';
import { downloadSignaturePdf, type SignatureBatch } from '../../../api/assinaturas';
import { useToast } from '../../../components/ui/ToastContext';
import { Badge, Button, Card, StatusPill } from '../../../components/ui/ds';
import { PageHeader } from '../../../layout/PageHeader';
import { signatureDocumentStatusLabels } from '../utils/documentStatus';
import { SignerStatusList } from './SignerStatusList';

export function BatchTrackingView({ batch, onBack, onOpenDocument }: {
  batch: SignatureBatch; onBack: () => void; onOpenDocument: (id: string) => void;
}) {
  const showToast = useToast();
  const [downloading, setDownloading] = useState<string | null>(null);
  async function download(id: string, title: string) {
    if (downloading) return;
    setDownloading(id);
    try {
      const url = URL.createObjectURL(await downloadSignaturePdf(id, true));
      const anchor = document.createElement('a');
      anchor.href = url; anchor.download = `${title}-assinado.pdf`; anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Não foi possível baixar o PDF.', 'error');
    } finally { setDownloading(null); }
  }
  return <section className="fv-ds assinaturas-detail">
    <div className="assinaturas-detail__topline"><Button variant="secondary" size="sm" onClick={onBack}>Voltar</Button><Badge tone="neutral">{batch.documents.length} documentos</Badge></div>
    <PageHeader title="Acompanhamento do lote" description="Um link por assinante reúne apenas os documentos em que ele participa. Cada PDF final fica separado." />
    <Card padding="md" title={<h2 className="assinaturas-batch-title">Documentos do lote</h2>}>
      <div className="assinaturas-batch-documents">
        {batch.documents.map(document => <div className="assinaturas-batch-document" key={document.id}>
          <span><strong>{document.title}</strong><small>{document.originalFileName} · {document.progress.signed} de {document.progress.total} assinaturas</small></span>
          <StatusPill status={signatureDocumentStatusLabels[document.status]} dot={false} />
          <div className="signature-row-actions">
            <Button variant="secondary" size="sm" onClick={() => onOpenDocument(document.id)} aria-label={`Abrir documento ${document.title}`}>Ver documento</Button>
            {document.status === 'CONCLUIDO' ? <Button variant="secondary" size="sm" disabled={Boolean(downloading)} loading={downloading === document.id} onClick={() => void download(document.id, document.title)} aria-label={`Baixar PDF de ${document.title}`}>Baixar PDF assinado</Button> : null}
          </div>
        </div>)}
      </div>
    </Card>
    <SignerStatusList batchId={batch.id} signers={batch.invitations} />
  </section>;
}
