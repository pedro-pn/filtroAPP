import { useEffect, useState } from 'react';

import type { ApiPlaygroundResult } from '../../../api/apiCredentials';
import { Alert, Badge, Button, Card } from '../../ui/ds';
import { isDownloadCheckResult, redactedRequestPreview } from './apiRequestFormatting';

export function ApiRequestConsole({ result, loading }: { result: ApiPlaygroundResult | null; loading: boolean }) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  useEffect(() => { setCopied(false); setCopyError(false); }, [result]);
  const request = redactedRequestPreview(result);
  const statusTone = result?.response.status === null || (result?.response.status && result.response.status >= 400)
    ? 'danger' : 'success';

  async function copyCurl() {
    if (!request) return;
    try { await navigator.clipboard.writeText(request.curl); setCopied(true); setCopyError(false); }
    catch { setCopyError(true); }
  }

  return (
    <section className="api-playground-console" aria-live="polite" aria-busy={loading} aria-label="Resultado do teste">
      <Card className="api-console-pane" header={<h3>Requisição redigida</h3>} actions={request ? <Button variant="secondary" size="sm" onClick={copyCurl}>{copied ? 'Copiado' : 'Copiar cURL'}</Button> : undefined}>
        {request ? <p>Para usar o cURL, defina <code>FILTRO_API_BASE_URL</code> com o endereço do app, sem barra final, e <code>FILTRO_API_TOKEN</code> com seu token no terminal.</p> : null}
        <pre tabIndex={0} aria-label="Requisição sem segredo"><code>{request ? `${request.method} ${request.path}\nAuthorization: ${request.authorization}\n\n${request.curl}` : 'Execute uma operação para visualizar a requisição.'}</code></pre>
        {copyError ? <Alert tone="warning">Não foi possível copiar. Selecione o comando acima e copie manualmente.</Alert> : null}
      </Card>
      <Card className="api-console-pane" header={<h3>Resposta</h3>} actions={result ? <Badge tone={statusTone}>{result.response.status ?? 'Falha de conexão'} · {result.response.durationMs} ms</Badge> : undefined}>
        {result ? <>
          {isDownloadCheckResult(result) ? <Alert tone="info">Verificação de download concluída. Nenhum arquivo foi transferido pelo painel; use o cURL em um ambiente autorizado para baixar o conteúdo.</Alert> : null}
          {result.response.requestId ? <p className="api-console-request-id">requestId: <code>{result.response.requestId}</code></p> : null}
          {result.response.truncated ? <Alert tone="warning">Resultado truncado para visualização segura.</Alert> : null}
          <pre tabIndex={0} aria-label="Corpo da resposta"><code>{JSON.stringify(result.response.body, null, 2)}</code></pre>
        </> : <pre tabIndex={0} aria-label="Estado da resposta"><code>{loading ? 'Executando…' : 'Nenhuma resposta.'}</code></pre>}
      </Card>
    </section>
  );
}
