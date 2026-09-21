import type { SignatureDocumentCard } from '../../../api/assinaturas';
import { AppIcon } from '../../../components/icons/AppIcon';
import { Badge, Card, StatusPill } from '../../../components/ui/ds';
import { DS_ICONS } from '../../../components/ui/ds/icons';
import { formatSignatureDateTime } from '../utils/datetime';
import { signatureDocumentStatusLabels } from '../utils/documentStatus';

export function DocumentCard({ document, onOpen }: { document: SignatureDocumentCard; onOpen: () => void }) {
  return (
    <Card className="assinaturas-document" padding="md" data-signature-document={document.id} onClick={onOpen} aria-label={`Abrir documento ${document.title}`}>
      <div className="assinaturas-document__identity">
        <span className="assinaturas-document__icon" aria-hidden="true"><AppIcon icon={DS_ICONS.fileText} size="md" /></span>
        <div>
          <h2>{document.title}</h2>
          <p className="assinaturas-document__file" title={document.originalFileName}>{document.originalFileName}</p>
        </div>
      </div>
      <div className="assinaturas-document__info">
        <div className="assinaturas-document__meta">
          <span>{document.pageCount} página(s)</span>
          <span>{document.progressLabel}</span>
        </div>
        {document.signerCount > 0 ? <progress className="assinaturas-document__progress" max={document.signerCount} value={document.signedCount} aria-label={`Progresso das assinaturas de ${document.title}`} /> : null}
        <div className="assinaturas-document__date">
          {document.completedAt ? `Concluído em ${formatSignatureDateTime(document.completedAt)}` : `Criado em ${formatSignatureDateTime(document.createdAt)}`}
        </div>
      </div>
      <div className="assinaturas-document__actions">
        <StatusPill status={signatureDocumentStatusLabels[document.status]} dot={false} />
        <span aria-hidden="true"><AppIcon icon={DS_ICONS.next} size="sm" /></span>
      </div>
      {document.hasExpiredInvites ? <div className="assinaturas-document__warning"><Badge tone="danger">Há links expirados</Badge></div> : null}
    </Card>
  );
}
