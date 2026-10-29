import { useState } from 'react';
import type { ApiCredentialPublic } from '../../../../../shared/schemas/api-credentials.js';
import { reduceApiCredential } from '../../../api/apiCredentials';
import { Alert, Button, Select, Textarea } from '../../ui/ds';

export function ApiCredentialWriteMode({ credential, onChanged }: {
  credential: ApiCredentialPublic; onChanged: () => Promise<unknown>;
}) {
  const [writeMode, setWriteMode] = useState(credential.writeMode);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [invalid, setInvalid] = useState(false);
  const [busy, setBusy] = useState(false);
  const terminal = ['REVOKED', 'EXPIRED'].includes(credential.effectiveStatus);
  return <form className="page-card api-form-section" data-api-credential-write-mode noValidate onSubmit={async event => {
    event.preventDefault(); setInvalid(reason.trim().length < 10); setError('');
    if (reason.trim().length < 10) return;
    setBusy(true);
    try {
      await reduceApiCredential(credential.id, { expectedVersion: credential.version, writeMode, reason });
      setReason(''); await onChanged();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível alterar o modo.'); }
    finally { setBusy(false); }
  }}>
    <h3>Modo das escritas</h3>
    <div className="api-form-grid">
      <div className="field-group"><label htmlFor="credential-write-mode">Modo desta credencial</label>
        <Select id="credential-write-mode" value={writeMode} disabled={busy || terminal} onChange={event => setWriteMode(event.target.value as 'LIVE' | 'SIMULATE')}>
          <option value="LIVE">LIVE — permite salvar</option><option value="SIMULATE">SIMULATE — sempre simular</option>
        </Select>
        <small>SIMULATE vale para todas as escritas, mesmo sem Prefer: validate-only.</small>
      </div>
      <div className={`field-group${invalid ? ' field-invalid' : ''}`}><label htmlFor="write-mode-reason">Justificativa *</label>
        <Textarea id="write-mode-reason" value={reason} maxLength={500} disabled={busy || terminal} onChange={event => setReason(event.target.value)} invalid={invalid} aria-describedby="write-mode-error" />
        <span id="write-mode-error" className="field-error">{invalid ? 'Informe ao menos 10 caracteres.' : ''}</span>
      </div>
    </div>
    {writeMode === 'LIVE' && credential.writeMode === 'SIMULATE' ? <Alert tone="warning">As próximas escritas poderão salvar dados reais.</Alert> : null}
    <Button type="submit" variant="secondary" disabled={busy || terminal || writeMode === credential.writeMode} loading={busy}>Salvar modo de escrita</Button>
    {error ? <Alert tone="danger">{error}</Alert> : null}
  </form>;
}
