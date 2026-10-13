// Fixture: botão "Adequar para relatório" com a API simulada (nenhuma chamada à OpenAI).
// ?modo=erro simula falha da OpenAI (504); ?modo=aviso devolve um valor inventado (aviso de aderência).
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AxiosError } from 'axios';
import { apiClient } from '../../src/api/client';
import { AuthContext } from '../../src/auth/AuthContext';
import { AdequarAnotacaoButton } from '../../src/components/anotacoes/AdequarAnotacaoButton';
import '../../src/styles/variables.css';
import '../../src/styles/base.css';

const modo = new URLSearchParams(location.search).get('modo');
let chamadas = 0;
apiClient.defaults.adapter = async config => {
  const responder = (status: number, data: unknown) => ({ data, status, statusText: String(status), headers: {}, config });
  if (config.url?.endsWith('/anotacoes/config')) return responder(200, { disponivel: true, maxCaracteres: 4000 });
  chamadas += 1;
  (window as unknown as { chamadasAdequar: number }).chamadasAdequar = chamadas;
  await new Promise(r => setTimeout(r, 700));
  if (modo === 'erro') {
    throw new AxiosError('Request failed with status code 504', 'ERR_BAD_RESPONSE', config, null,
      responder(504, { error: 'A OpenAI demorou demais para responder. Tente novamente.', codigo: 'TIMEOUT' }) as never);
  }
  const textoFormatado = 'Participação no DDS da Thyssen.\n\nSistema 52300 step 01:\n*Teste com ar comprimido;\n*Fase desengraxante entre as 08h16 e 11h21' + (modo === 'aviso' ? ' a 15 bar' : '') + '.';
  return responder(200, { textoFormatado, avisos: modo === 'aviso' ? ['O texto adequado contém valores que não estão na anotação: 15. Confira antes de aplicar.'] : [] });
};

const auth = { user: { id: 'u1', name: 'Gestor', moduleRoles: ['rdo:manager'] } } as unknown as React.ContextType<typeof AuthContext>;

function Fixture() {
  const [atividades, setAtividades] = useState('Participação dds da Thyssen\nSistema 52300 step 01\nTeste com ar comprimido\nFase desengraxante entre 08:16 as 11:21');
  return <main className="fv-ds" style={{ width: 'min(100% - 32px, 760px)', margin: '24px auto' }}>
    <h1>Atividades do dia</h1>
    <textarea data-testid="campo" rows={8} style={{ width: '100%' }} value={atividades} onChange={e => setAtividades(e.target.value)} />
    <AdequarAnotacaoButton valor={atividades} campo="Atividades do dia" onAplicar={setAtividades} />
  </main>;
}

createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={new QueryClient()}><AuthContext.Provider value={auth}><Fixture /></AuthContext.Provider></QueryClientProvider>
);
