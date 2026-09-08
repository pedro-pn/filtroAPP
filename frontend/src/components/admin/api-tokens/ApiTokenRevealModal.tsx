import { useEffect, useRef, useState } from 'react';

import type { IssuedApiCredential } from '../../../api/apiCredentials';
import { Button } from '../../ui/Button';
import { Modal } from '../../ui/Modal';
import { exampleOperationForCredential, type ApiOperationOption } from './apiOperations';

interface ApiTokenRevealModalProps {
  issued: IssuedApiCredential | null;
  operations: ApiOperationOption[];
  onClose: () => void;
}

export function ApiTokenRevealModal({ issued, operations, onClose }: ApiTokenRevealModalProps) {
  const [copied, setCopied] = useState({ token: false, curl: false });
  const [copyError, setCopyError] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const tokenRef = useRef<HTMLDivElement | null>(null);
  const curlRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    setCopied({ token: false, curl: false });
    setCopyError('');
    setConfirmed(false);
  }, [issued]);

  const apiBase = `${(import.meta.env.VITE_API_BASE_URL || '/api').replace(/\/$/, '')}/integracoes/v1`;
  const apiBaseUrl = new URL(apiBase, window.location.origin).href;
  const exampleOperation = issued ? exampleOperationForCredential(operations, issued.credential.scopeCodes) : undefined;
  const exampleQuery = exampleOperation?.queryParams.includes('limit') ? '?limit=1' : '';
  const curlExample = exampleOperation ? [
    'curl --fail-with-body \\',
    '  -H "Authorization: Bearer $FILTRO_API_TOKEN" \\',
    '  -H "Accept: application/json" \\',
    `  "${apiBaseUrl}${exampleOperation.path}${exampleQuery}"`
  ].join('\n') : '';

  async function copyValue(kind: 'token' | 'curl') {
    if (!issued) return;
    try {
      await navigator.clipboard.writeText(kind === 'token' ? issued.token : curlExample);
      setCopied(previous => ({ ...previous, [kind]: true }));
      setCopyError('');
    } catch {
      const element = kind === 'token' ? tokenRef.current : curlRef.current;
      if (element) {
        element.focus();
        const range = document.createRange();
        range.selectNodeContents(element);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
      }
      setCopyError(`Não foi possível copiar automaticamente. O ${kind === 'token' ? 'token' : 'comando'} foi selecionado para você copiar manualmente.`);
    }
  }

  return (
    <Modal open={Boolean(issued)} onClose={() => confirmed && onClose()} ariaLabelledBy="api-token-reveal-title" ariaDescribedBy="api-token-reveal-description" panelClassName="modal-card api-token-reveal-modal">
      {issued ? <>
        <div className="api-modal-body">
          <header className="api-token-reveal-header">
            <span className="api-risk-badge">EXIBIÇÃO ÚNICA</span>
            <h2 id="api-token-reveal-title">Guarde o token agora</h2>
            <p id="api-token-reveal-description">Depois que esta janela for fechada, o valor não poderá ser recuperado. Armazene-o em um cofre de segredos.</p>
          </header>
          <section className="api-token-reveal-section" aria-labelledby="api-token-secret-label">
            <h3 id="api-token-secret-label">Token de integração</h3>
            <div className="api-token-secret-row">
              <div ref={tokenRef} className="api-token-secret" role="textbox" aria-readonly="true" aria-labelledby="api-token-secret-label" tabIndex={0}><code>{issued.token}</code></div>
              <Button variant="secondary" onClick={() => void copyValue('token')}>{copied.token ? 'Token copiado' : 'Copiar token'}</Button>
            </div>
          </section>
          <section className="api-token-reveal-section" aria-labelledby="api-token-base-label">
            <h3 id="api-token-base-label">Endereço base da API</h3>
            <code className="api-token-base-url">{apiBaseUrl}</code>
            <p>O caminho de cada consulta depende da área e das permissões concedidas ao token.</p>
          </section>
          {exampleOperation ? <section className="api-token-reveal-section" aria-labelledby="api-token-curl-label">
            <div className="api-token-example-heading">
              <h3 id="api-token-curl-label">Exemplo em cURL</h3>
              <Button variant="secondary" onClick={() => void copyValue('curl')}>{copied.curl ? 'cURL copiado' : 'Copiar cURL'}</Button>
            </div>
            <p>Defina <code>FILTRO_API_TOKEN</code> com o token salvo antes de executar esta consulta.</p>
            <pre><code ref={curlRef} tabIndex={0} aria-label="Exemplo em cURL">{curlExample}</code></pre>
          </section> : <p className="api-safe-note">Consulte os caminhos disponíveis em Testar API para montar uma requisição com as permissões deste token.</p>}
          {copyError ? <p className="inline-warning" role="alert">{copyError}</p> : null}
          <span className="sr-only" role="status">{[copied.token && 'Token copiado.', copied.curl && 'cURL copiado.'].filter(Boolean).join(' ')}</span>
          <label className="api-confirm-copy"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} /> Confirmo que guardei o token em local seguro.</label>
        </div>
        <div className="api-modal-footer"><Button disabled={!confirmed} onClick={onClose}>Concluir</Button></div>
      </> : null}
    </Modal>
  );
}
