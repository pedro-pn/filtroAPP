import type { ApiCredentialPublic } from '../../../../../shared/schemas/api-credentials.js';
import { Badge, Card, StatusPill } from '../../ui/ds';
import { apiCredentialDateLabel, apiCredentialStatusLabels, apiCredentialStatusTones } from './apiCredentialPresentation';

export function ApiCredentialSummary({ credential }: { credential: ApiCredentialPublic }) {
  return <Card className="api-credential-summary">
    <div className="api-card-heading">
      <div className="api-card-identity"><h3>Identificação e acesso</h3><code>{credential.displayToken}</code></div>
      <StatusPill status={credential.effectiveStatus} label={apiCredentialStatusLabels[credential.effectiveStatus]} tone={apiCredentialStatusTones[credential.effectiveStatus]} />
    </div>
    <p>{credential.purpose}</p>
    {credential.description ? <p className="api-summary-description">{credential.description}</p> : null}
    <dl className="api-summary-facts">
      <div><dt>Destinatário</dt><dd>{credential.recipientName}</dd></div>
      <div><dt>Contato</dt><dd>{credential.recipientContact || '—'}</dd></div>
      <div><dt>Início</dt><dd>{apiCredentialDateLabel(credential.startsAt)}</dd></div>
      <div><dt>Validade</dt><dd>{credential.expiresAt ? apiCredentialDateLabel(credential.expiresAt) : 'Sem expiração'}</dd></div>
      <div><dt>Último uso</dt><dd>{credential.lastUsedAt ? apiCredentialDateLabel(credential.lastUsedAt) : 'Ainda não usado'}</dd></div>
      <div><dt>Projetos</dt><dd>{credential.projectAccess.mode === 'ALL' ? 'Todos os permitidos' : `${credential.projectAccess.projectIds.length} selecionados`}</dd></div>
      <div><dt>Redes permitidas</dt><dd>{credential.allowedIpCidrs.length ? `${credential.allowedIpCidrs.length} IPs ou faixas` : 'Sem restrição de IP'}</dd></div>
    </dl>
    <div className="api-summary-scopes"><h4>Permissões do token</h4><div className="api-chip-list">{credential.scopeCodes.map(scope => <Badge key={scope} tone={scope.endsWith('.write') ? 'warning' : 'neutral'} multiline>{scope}</Badge>)}</div></div>
    {credential.rotatedFromId ? <p className="api-lineage">Substitui a credencial {credential.rotatedFromId}.</p> : null}
    {credential.replacementId ? <p className="api-lineage">Rotacionada para {credential.replacementId}.</p> : null}
  </Card>;
}
