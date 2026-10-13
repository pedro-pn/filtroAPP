// Fixture: editor dos textos do Data Book (mostra negrito em vez de <b>) e a marcação gravada.
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthContext } from '../../src/auth/AuthContext';
import { DatabookRevisaoForm } from '../../src/components/databook/DatabookRevisaoForm';
import { TextoFormatadoEditor } from '../../src/components/databook/TextoFormatadoEditor';
import { formularioInicialDatabook } from '../../src/utils/databook';
import { Field } from '../../src/components/ui/ds';
import '../../src/styles/variables.css';
import '../../src/styles/base.css';

function Fixture() {
  const [valor, setValor] = useState('Execução de limpeza química em <b>APVs Verticais</b> da unidade <b>VENTURA</b>.');
  return <main className="fv-ds" style={{ width: 'min(100% - 32px, 760px)', margin: '24px auto' }}>
    <Field label="Escopo" optionalText="">
      <TextoFormatadoEditor ariaLabel="Escopo" value={valor} onChange={setValor} />
    </Field>
    <pre data-testid="marcacao" style={{ whiteSpace: 'pre-wrap' }}>{valor}</pre>
    <button type="button" onClick={() => setValor('Novo <i>texto</i><br/>aplicado')}>Simular aplicar</button>
  </main>;
}

// ?tela=revisao: formulário de revisão do Data Book com rascunho real (<b>) e o botão de IA visível.
const preparada = {
  dados: {
    projeto: { servico: 'Limpeza Química de APVs Verticais', doc: 'DB-5815-01', rev: '0', periodo: '16/09/2026 a 08/10/2026' },
    unidade_escopo: 'APVs', ocorrencias_sms: 0, fds: [], certificados: [],
    textos: {
      escopo: 'Execução de limpeza química por <b>circulação pressurizada</b> em <b>APVs Verticais</b> da unidade <b>VENTURA SS VICTÓRIA</b>.',
      resumo_executivo: 'Entre 16/09 e 08/10 foram concluídos <b>38 de 38 APVs</b> (100% do escopo).',
      destaques_sms: ['DDS realizados em 23 de 23 dia(s) com RDO.', 'Sem registro de acidentes ou incidentes com pessoas no período.'],
      consideracoes_finais: 'Os serviços foram executados conforme o escopo do Contrato/Proposta 4096 REV 4.'
    }
  },
  avisos: [], resumo: { inicio: '2026-09-16', fim: '2026-10-08', dias: 23, rdos: 23, rlq: 19, rcpu: 0, rtp: 0, rlm: 0 },
  sugestoes: { fds: [], certificados: [] }, documento: { doc: 'DB-5815-01', rev: 0 }, responsaveis: [],
  ortografia: { disponivel: true, palavras: [] }
};
function Revisao() {
  const [form, setForm] = useState(formularioInicialDatabook(preparada as never));
  return <main className="fv-ds" style={{ width: 'min(100% - 32px, 760px)', margin: '24px auto' }}>
    <DatabookRevisaoForm preparada={preparada as never} form={form} erros={{}} onChange={patch => setForm(f => ({ ...f, ...patch }))} />
    <pre data-testid="escopo" style={{ whiteSpace: 'pre-wrap' }}>{form.escopo}</pre>
  </main>;
}
const client = new QueryClient();
client.setQueryData(['anotacoes', 'config'], { disponivel: true, maxCaracteres: 4000 });
const auth = { user: { id: 'u1', name: 'Gestor', moduleRoles: ['rdo:manager'] } } as unknown as React.ContextType<typeof AuthContext>;
const tela = new URLSearchParams(location.search).get('tela');
createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={client}><AuthContext.Provider value={auth}>{tela === 'revisao' ? <Revisao /> : <Fixture />}</AuthContext.Provider></QueryClientProvider>
);
