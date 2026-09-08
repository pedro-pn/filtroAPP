import type { ApiCredentialPublic } from '../../../../../shared/schemas/api-credentials.js';
import { Button } from '../../ui/Button';

const statusLabels: Record<ApiCredentialPublic['effectiveStatus'], string> = {
  SCHEDULED: 'Agendado', ACTIVE: 'Ativo', NEAR_EXPIRY: 'Vence em breve', EXPIRED: 'Expirado', REVOKED: 'Revogado'
};

export function ApiCredentialCards({ credentials, onSelect }: { credentials: ApiCredentialPublic[]; onSelect?: (credential: ApiCredentialPublic) => void }) {
  return (
    <div className="api-credential-cards">
      {credentials.map(credential => (
        <article className="page-card api-credential-card" key={credential.id}>
          <div className="api-card-heading"><div><h3>{credential.name}</h3><code>{credential.displayToken}</code></div><span className={`api-status status-${credential.effectiveStatus.toLowerCase()}`}>{statusLabels[credential.effectiveStatus]}</span></div>
          <p>{credential.purpose}</p>
          {credential.recentUsage ? <p className="api-recent-volume">Volume recente: {credential.recentUsage.requests} requisições · {credential.recentUsage.rows} linhas · {Math.round(credential.recentUsage.bytes / 1024)} KB</p> : null}
          <dl><div><dt>Destinatário</dt><dd>{credential.recipientName}</dd></div><div><dt>Validade</dt><dd>{credential.expiresAt ? new Date(credential.expiresAt).toLocaleString('pt-BR') : 'Sem expiração'}</dd></div><div><dt>Último uso</dt><dd>{credential.lastUsedAt ? new Date(credential.lastUsedAt).toLocaleString('pt-BR') : 'Ainda não usado'}</dd></div></dl>
          <div className="api-chip-list">{credential.scopeCodes.map(scope => <span key={scope}>{scope}</span>)}</div>
          {credential.rotatedFromId ? <p className="api-lineage">Substitui a credencial {credential.rotatedFromId}.</p> : null}
          {credential.replacementId ? <p className="api-lineage">Rotacionada para {credential.replacementId}.</p> : null}
          {onSelect ? <Button variant="secondary" onClick={() => onSelect(credential)}>Ver detalhes</Button> : null}
        </article>
      ))}
    </div>
  );
}
