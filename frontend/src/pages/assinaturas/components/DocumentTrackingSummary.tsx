import type { SignatureDocument } from '../../../api/assinaturas';
import { Alert, Button, Card } from '../../../components/ui/ds';
import '../AssinaturasTracking.ds.css';

export function DocumentTrackingSummary({ document, downloading, onDownload }: {
  document: SignatureDocument;
  downloading: 'original' | 'final' | null;
  onDownload: (final: boolean) => void;
}) {
  const { signed, total } = document.progress;
  return (
    <Card className="fv-ds assinaturas-tracking-summary" padding="md">
      <div className="assinaturas-tracking-summary__heading"><h2>Progresso das assinaturas</h2><strong>{signed} de {total}</strong></div>
      {total > 0 ? <progress className="assinaturas-tracking-summary__progress" max={total} value={signed} aria-label={`${signed} de ${total} assinaturas concluídas`} /> : <p>Nenhum assinante cadastrado.</p>}
      {document.status === 'FINALIZANDO' ? <Alert tone="info" title="Gerando o PDF assinado">O documento está sendo finalizado. Esta tela atualiza automaticamente.</Alert>
        : document.status === 'CONCLUIDO' ? <Alert tone="success" title="Documento concluído">O PDF assinado está disponível para download.</Alert>
          : document.status === 'CANCELADO' ? <Alert tone="warning" title="Rodada cancelada">As assinaturas já registradas foram preservadas.</Alert>
            : <p>Acompanhe abaixo o status de cada assinante e de seus convites.</p>}
      <div className="signature-detail-actions">
        <Button variant="secondary" size="sm" disabled={Boolean(downloading)} loading={downloading === 'original'} onClick={() => onDownload(false)}>Baixar original</Button>
        <Button variant="primary" size="sm" disabled={document.status !== 'CONCLUIDO' || Boolean(downloading)} loading={downloading === 'final'} onClick={() => onDownload(true)}>Baixar PDF assinado</Button>
      </div>
    </Card>
  );
}
