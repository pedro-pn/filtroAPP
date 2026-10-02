import type { ApiCredentialPublic } from '../../../../../shared/schemas/api-credentials.js';
import { Badge, Button, Card, StatusPill } from '../../ui/ds';
import { apiCredentialDateLabel, apiCredentialStatusLabels, apiCredentialStatusTones } from './apiCredentialPresentation';

export function ApiCredentialCards({ credentials, selectedId, onSelect }: {
  credentials: ApiCredentialPublic[];
  selectedId?: string;
  onSelect?: (credential: ApiCredentialPublic) => void;
}) {
  return <div className="api-credential-cards">
    {credentials.map(credential => {
      const selected = selectedId === credential.id;
      return <Card className="api-credential-card" selected={selected} key={credential.id}>
        <div className="api-card-heading">
          <div className="api-card-identity"><h3>{credential.name}</h3><code>{credential.displayToken}</code></div>
          <StatusPill status={credential.effectiveStatus} label={apiCredentialStatusLabels[credential.effectiveStatus]} tone={apiCredentialStatusTones[credential.effectiveStatus]} />
        </div>
        <p className="api-card-purpose">{credential.purpose}</p>
        <dl className="api-card-facts">
          <div><dt>Destinatário</dt><dd>{credential.recipientName}</dd></div>
          <div><dt>Validade</dt><dd>{credential.expiresAt ? apiCredentialDateLabel(credential.expiresAt) : 'Sem expiração'}</dd></div>
          <div><dt>Último uso</dt><dd>{credential.lastUsedAt ? apiCredentialDateLabel(credential.lastUsedAt) : 'Ainda não usado'}</dd></div>
        </dl>
        <div className="api-card-footer">
          <Badge tone="neutral">{credential.scopeCodes.length} {credential.scopeCodes.length === 1 ? 'permissão' : 'permissões'}</Badge>
          {credential.recentUsage ? <span className="api-recent-volume">{credential.recentUsage.requests} requisições recentes</span> : null}
          {onSelect ? <Button variant="secondary" size="sm" aria-expanded={selected} aria-controls={selected ? 'api-credential-detail' : undefined} onClick={() => onSelect(credential)}>{selected ? 'Fechar detalhes' : 'Ver detalhes'}</Button> : null}
        </div>
        {credential.rotatedFromId ? <p className="api-lineage">Substitui a credencial {credential.rotatedFromId}.</p> : null}
        {credential.replacementId ? <p className="api-lineage">Rotacionada para {credential.replacementId}.</p> : null}
      </Card>;
    })}
  </div>;
}
