import { useEffect, useState } from 'react';

import type { ApiPlaygroundResult } from '../../../api/apiCredentials';
import { Button } from '../../ui/Button';
import { isDownloadCheckResult, redactedRequestPreview } from './apiRequestFormatting';

export function ApiRequestConsole({ result, loading }: { result: ApiPlaygroundResult | null; loading: boolean }) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  useEffect(() => { setCopied(false); setCopyError(false); }, [result]);
  const request = redactedRequestPreview(result);
  async function copyCurl() {
    if (!request) return;
    try { await navigator.clipboard.writeText(request.curl); setCopied(true); setCopyError(false); }
    catch { setCopyError(true); }
  }
  return (
    <section className="api-playground-console" aria-live="polite" aria-busy={loading}>
      <div className="api-console-pane"><div className="api-console-heading"><h3>Requisição redigida</h3>{request ? <Button variant="mini" onClick={copyCurl}>{copied ? 'Copiado' : 'Copiar curl'}</Button> : null}</div>{request ? <p>Para usar o cURL, defina <code>FILTRO_API_BASE_URL</code> com o endereço do app, sem barra final (ex.: https://app.exemplo.com), e <code>FILTRO_API_TOKEN</code> com seu token no terminal.</p> : null}<pre><code>{request ? `${request.method} ${request.path}\nAuthorization: ${request.authorization}\n\n${request.curl}` : 'Execute uma operação para visualizar a requisição.'}</code></pre></div>
      {copyError ? <p className="inline-warning" role="alert">Não foi possível copiar. Selecione o comando acima e copie manualmente.</p> : null}
      <div className="api-console-pane"><div className="api-console-heading"><h3>Resposta</h3>{result ? <span>{result.response.status ?? 'Falha de conexão'} · {result.response.durationMs} ms</span> : null}</div>{result ? <>{isDownloadCheckResult(result) ? <p className="api-safe-note">Verificação de download concluída. Nenhum arquivo foi transferido pelo painel; use o cURL em um ambiente autorizado para baixar o conteúdo.</p> : null}{result.response.requestId ? <p>requestId: <code>{result.response.requestId}</code></p> : null}{result.response.truncated ? <p className="inline-warning">Resultado truncado para visualização segura.</p> : null}<pre><code>{JSON.stringify(result.response.body, null, 2)}</code></pre></> : <pre><code>{loading ? 'Executando…' : 'Nenhuma resposta.'}</code></pre>}</div>
    </section>
  );
}
