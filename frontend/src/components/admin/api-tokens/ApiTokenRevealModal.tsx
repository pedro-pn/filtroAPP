import { useEffect, useRef, useState } from 'react';

import type { IssuedApiCredential } from '../../../api/apiCredentials';
import { Button } from '../../ui/Button';
import { Modal } from '../../ui/Modal';

export function ApiTokenRevealModal({ issued, onClose }: { issued: IssuedApiCredential | null; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const tokenRef = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => { setCopied(false); setConfirmed(false); }, [issued]);

  async function copyToken() {
    if (!issued) return;
    try {
      await navigator.clipboard.writeText(issued.token);
      setCopied(true);
    } catch {
      tokenRef.current?.focus();
      tokenRef.current?.select();
    }
  }

  return (
    <Modal open={Boolean(issued)} onClose={() => confirmed && onClose()} ariaLabelledBy="api-token-reveal-title" panelClassName="modal-card api-token-reveal-modal">
      {issued ? <>
        <div className="api-modal-body">
          <span className="api-risk-badge">EXIBIÇÃO ÚNICA</span>
          <h2 id="api-token-reveal-title">Guarde o token agora</h2>
          <p>Depois que esta janela for fechada, o valor não poderá ser recuperado. Armazene-o em um cofre de segredos.</p>
          <textarea ref={tokenRef} className="api-token-secret" readOnly value={issued.token} aria-label="Token de integração" />
          <Button onClick={copyToken}>{copied ? 'Token copiado' : 'Copiar token'}</Button>
          <pre><code>{'export FILTRO_API_TOKEN="cole-no-seu-cofre"\ncurl -H "Authorization: Bearer $FILTRO_API_TOKEN" \\\n  https://seu-dominio/api/integracoes/v1/qualidade/registros'}</code></pre>
          <label className="api-confirm-copy"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} /> Confirmo que guardei o token em local seguro.</label>
        </div>
        <div className="api-modal-footer"><Button variant="secondary" disabled={!confirmed} onClick={onClose}>Concluir</Button></div>
      </> : null}
    </Modal>
  );
}
