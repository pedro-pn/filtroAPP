import type { SignatureDocumentCard } from '../../../api/assinaturas';
import { Button } from '../../../components/ui/Button';
import { formatSignatureDateTime } from '../utils/datetime';

const statusLabel: Record<SignatureDocumentCard['status'], string> = {
  RASCUNHO: 'Rascunho',
  AGUARDANDO_ASSINATURAS: 'Aguardando assinaturas',
  FINALIZANDO: 'Finalizando',
  CONCLUIDO: 'Concluído',
  CANCELADO: 'Cancelado'
};

export function DocumentCard({ document, onOpen }: { document: SignatureDocumentCard; onOpen: () => void }) {
  return (
    <article className="signature-document-card">
      <div className="signature-card-identity">
        <div className="signature-card-title" title={document.title}>{document.title}</div>
        <div className="signature-card-file" title={document.originalFileName}>{document.originalFileName}</div>
      </div>
      <div className="signature-card-info">
        <div className="signature-card-meta">
          <span>{document.pageCount} página(s)</span>
          <span>{document.progressLabel}</span>
        </div>
        <div className="signature-card-date">
          {document.completedAt ? `Concluído em ${formatSignatureDateTime(document.completedAt)}` : `Criado em ${formatSignatureDateTime(document.createdAt)}`}
        </div>
        {document.hasExpiredInvites ? <p className="field-error">Há links expirados.</p> : null}
      </div>
      <span className={`signature-status signature-status-${document.status.toLowerCase()}`}>{statusLabel[document.status]}</span>
      <Button variant="secondary" onClick={onOpen}>Abrir documento</Button>
    </article>
  );
}
