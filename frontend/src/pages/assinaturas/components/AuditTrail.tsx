import { useState } from 'react';

import { Button } from '../../../components/ui/Button';
import { useSignatureAudit } from '../../../hooks/useAssinaturas';
import { formatSignatureDateTime } from '../utils/datetime';

const actionLabels: Record<string, string> = {
  DOCUMENTO_CRIADO: 'Documento criado',
  CONFIGURACAO_ATUALIZADA: 'Configuração atualizada',
  DOCUMENTO_PUBLICADO: 'Documento publicado',
  DOCUMENTO_DESPUBLICADO: 'Publicação desfeita',
  CONVITE_CRIADO: 'Convite criado',
  EMAIL_SOLICITADO: 'Envio de e-mail solicitado',
  EMAIL_ENVIADO: 'E-mail enviado',
  EMAIL_FALHOU: 'Falha no envio do e-mail',
  LINK_RECUPERADO: 'Link copiado',
  LINK_ACESSADO: 'Link acessado',
  DOCUMENTO_VISUALIZADO: 'Documento visualizado',
  ASSINATURA_REALIZADA: 'Assinatura realizada',
  CONVITE_EXPIRADO: 'Convite expirado',
  CONVITE_RENOVADO: 'Convite renovado',
  CONVITE_REVOGADO: 'Convite revogado',
  FINALIZACAO_INICIADA: 'Finalização iniciada',
  FINALIZACAO_FALHOU: 'Falha na finalização',
  PDF_FINAL_GERADO: 'PDF final gerado',
  DOCUMENTO_CONCLUIDO: 'Documento concluído',
  DOCUMENTO_CANCELADO: 'Documento cancelado',
  DOCUMENTO_ARQUIVADO: 'Documento arquivado',
  DOCUMENTO_RESTAURADO: 'Documento restaurado',
  DOCUMENTO_EXCLUIDO: 'Documento excluído',
  DOCUMENTO_EXCLUSAO_DESFEITA: 'Exclusão desfeita',
  ARQUIVOS_PURGADOS: 'Arquivos removidos pela retenção',
  PROPRIETARIO_REMOVIDO: 'Proprietário removido',
  DADOS_ACESSO_ANONIMIZADOS: 'Dados de acesso anonimizados'
};

export function AuditTrail({ documentId }: { documentId: string }) {
  const [cursor, setCursor] = useState('');
  const audit = useSignatureAudit(documentId, cursor);

  if (audit.isLoading) return <div className="signature-page-state">Carregando auditoria...</div>;
  if (audit.isError || !audit.data) return <div className="signature-page-state">Não foi possível carregar a auditoria. <Button onClick={() => audit.refetch()}>Tentar novamente</Button></div>;
  if (!audit.data.items.length) return <div className="signature-page-state">Nenhum evento de auditoria nesta página.</div>;

  return (
    <div className="signature-audit-list">
      {audit.data.items.map(item => (
        <article className="signature-audit-card" key={item.id}>
          <div><strong>{actionLabels[item.action] || item.action.replaceAll('_', ' ')}</strong><time>{formatSignatureDateTime(item.createdAt)}</time></div>
          {item.description ? <p>{item.description}</p> : null}
        </article>
      ))}
      <div className="signature-audit-pagination">
        <Button variant="secondary" disabled={!cursor} onClick={() => setCursor('')}>Primeira página</Button>
        <Button variant="secondary" disabled={!audit.data.nextCursor} onClick={() => setCursor(audit.data.nextCursor || '')}>Próxima página</Button>
      </div>
    </div>
  );
}
