import { useState } from 'react';

import type { SignatureAuditItem } from '../../../api/assinaturas';
import { AppIcon } from '../../../components/icons/AppIcon';
import { Badge, Button, Card, EmptyState, Skeleton } from '../../../components/ui/ds';
import { DS_ICONS } from '../../../components/ui/ds/icons';
import { useSignatureAudit } from '../../../hooks/useAssinaturas';
import { formatSignatureDateTime } from '../utils/datetime';
import '../AssinaturasTracking.ds.css';

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

export function AuditTimeline({ items }: { items: SignatureAuditItem[] }) {
  return (
    <ol className="assinaturas-audit__timeline" aria-label="Eventos de auditoria">
      {items.map(item => {
        const tone = ['EMAIL_FALHOU', 'FINALIZACAO_FALHOU'].includes(item.action) ? 'danger'
          : ['CONVITE_EXPIRADO', 'CONVITE_REVOGADO', 'DOCUMENTO_CANCELADO', 'DOCUMENTO_EXCLUIDO'].includes(item.action) ? 'warning'
            : ['PDF_FINAL_GERADO', 'DOCUMENTO_CONCLUIDO'].includes(item.action) ? 'success' : 'info';
        return <li className={`assinaturas-audit__event assinaturas-audit__event--${tone}`} key={item.id}>
          <div className="assinaturas-audit__event-heading"><h3>{actionLabels[item.action] || item.action.replaceAll('_', ' ')}</h3><time dateTime={item.createdAt}>{formatSignatureDateTime(item.createdAt)}</time></div>
          {item.description ? <p>{item.description}</p> : null}
        </li>;
      })}
    </ol>
  );
}

export function AuditTrail({ documentId }: { documentId: string }) {
  const [cursor, setCursor] = useState('');
  const audit = useSignatureAudit(documentId, cursor);

  return (
    <Card className="fv-ds assinaturas-audit" padding="md" title={<h2>Histórico do documento</h2>}
      actions={!audit.isLoading && !audit.isError && audit.data ? <Badge tone="neutral">{audit.data.items.length} nesta página</Badge> : undefined}
    >
      <p className="assinaturas-audit__intro">Criação, convites e assinaturas registrados para este documento.</p>
      <div id="assinaturas-audit-events" aria-busy={audit.isFetching || undefined}>
        {audit.isLoading ? <div className="assinaturas-audit__loading"><Skeleton variant="card" label="Carregando auditoria..." /><Skeleton variant="card" /><Skeleton variant="card" /></div>
          : audit.isError || !audit.data ? <EmptyState variant="error" title="Não foi possível carregar a auditoria." action={{ label: 'Tentar novamente', onClick: () => void audit.refetch() }} />
            : !audit.data.items.length ? <EmptyState title="Nenhum evento de auditoria nesta página." />
              : <AuditTimeline items={audit.data.items} />}
      </div>
      <div className="assinaturas-audit__pagination" role="group" aria-label="Paginação da auditoria">
        <Button variant="secondary" size="sm" iconLeft={<AppIcon icon={DS_ICONS.firstPage} size="sm" />} aria-controls="assinaturas-audit-events" disabled={!cursor} onClick={() => setCursor('')}>Primeira página</Button>
        <Button variant="secondary" size="sm" iconRight={<AppIcon icon={DS_ICONS.next} size="sm" />} aria-controls="assinaturas-audit-events" disabled={audit.isFetching || audit.isError || !audit.data?.nextCursor} onClick={() => setCursor(audit.data?.nextCursor || '')}>Próxima página</Button>
      </div>
    </Card>
  );
}
