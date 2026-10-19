import { ProjectProposalScopes } from '../../src/components/projects/ProjectProposalScopes';
// Diálogo de produção com API simulada. Nenhum dado real é alterado.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { apiClient } from '../../src/api/client';
import { AuthContext } from '../../src/auth/AuthContext';
import { ToastProvider } from '../../src/components/ui/Toast';
import { ThemeProvider } from '../../src/theme/ThemeProvider';
import { ProjectDatabookButton } from '../../src/components/databook/ProjectDatabookButton';
import type { DatabookEdicoes, DatabookRevisaoPreparada } from '../../src/api/databook';
import { camposDoDocumento, pdfInterativo } from './databook-pdf-fixture';
import pdfUrl from '../../../backend/databook/referencia/DataBook_exemplo_projeto_completo.pdf?url';
import '../../src/styles/variables.css';
import '../../src/styles/foundation.css';
import '../../src/styles/utilities.css';
import '../../src/styles/legacy.css';

const periodo = { inicio: '2026-10-01', fim: '2026-10-01' };
const porProposta = new URLSearchParams(location.search).has('propostas');
const propostas = [
  { key: 'ACCESS_IMPORT:500', proposalCode: '500', source: 'ACCESS_IMPORT', kind: 'MAIN', revision: 0, parentProposalCode: null, label: 'Principal 500 · Rev. 0 · Access', version: 'a'.repeat(64) },
  { key: 'COMERCIAL_APP:502', proposalCode: '502', source: 'COMERCIAL_APP', kind: 'ADDITIONAL', revision: 1, parentProposalCode: '500', label: 'Adicional 502 · Rev. 1 · ComercialAPP', version: 'b'.repeat(64) }
];
let assigned = false;
const interativo = new URLSearchParams(location.search).has('interativo');
const todosCampos = !new URLSearchParams(location.search).has('longo');
const preparada: DatabookRevisaoPreparada = {
  dados: {
    projeto: { servico: 'Serviço original', doc: 'DB-9001-01', rev: '0', periodo: '01/10/2026' },
    unidade_escopo: 'm', ocorrencias_sms: 0,
    textos: { escopo: 'Escopo original', resumo_executivo: 'Resumo original', consideracoes_finais: 'Conclusão original' },
    dias: [{ data: '01/10/2026', resumo: 'Dia original', atividades: [{ texto: 'Atividade original' }], fotos: [{ legenda: 'Legenda original' }] }],
    aprovacoes: { elaborado: { nome: 'Autor antigo', cargo: 'Coordenador' } },
    fds: [{ produto: 'Ácido', nome_comercial: 'FDS original', arquivo: 'stockdoc:original' }], certificados: []
  },
  documento: { doc: 'DB-9001-01', rev: 1 }, resumo: { ...periodo, dias: 1, rdos: 1, rlq: 1, rcpu: 0, rtp: 0, rlm: 0 },
  avisos: [], sugestoes: { fds: [], certificados: [] }, responsaveis: []
};
if (interativo) preparada.dados.dias!.push({ data: '02/10/2026', resumo: 'Outro dia', atividades: [{ texto: 'Atividade original' }], fotos: [] });
const original = { id: 'rev-0', revisao: 0, descricao: 'Emissão inicial', status: 'COMPLETED', paginas: 9, avisos: [], criadoEm: '2026-10-01' };
const revisoes = [original];
const chamadas: Array<{ url: string; body: Record<string, unknown> }> = [];
const previas = new Map<string, Record<string, unknown>>();
const concluidas: string[] = [];
let falharPrevia = new URLSearchParams(location.search).has('erro-previa');
let falharAtualizacao = new URLSearchParams(location.search).has('falha-auto');
const lenta = new URLSearchParams(location.search).has('lento');
Object.assign(window, { databookChamadas: chamadas, databookRevisoes: revisoes, databookPreviasConcluidas: concluidas });
apiClient.defaults.adapter = async config => {
  const url = config.url || '';
  const body = typeof config.data === 'string' ? JSON.parse(config.data) : config.data;
  chamadas.push({ url, body });
  let data: unknown;
  if (url.includes('/escopos-propostas')) {
    if (config.method === 'put') assigned = true;
    data = config.method === 'put' ? { saved: true } : { pending: assigned ? 0 : 1, scopes: propostas.map(p => ({ ...p, progress: { progressPct: 50, services: [] }, serviceCount: 1 })),
      services: [{ reportId: 'r1', reportType: 'RDO', number: 1, serviceKey: 'c'.repeat(64), version: 'd'.repeat(64), serviceType: 'pressao', system: 'Linha A', contributionKey: assigned ? 'COMERCIAL_APP:502' : null, method: assigned ? 'MANUAL' : 'INFERRED', count: 1 }] };
  }
  else if (url.endsWith('/intervalo')) data = { padrao: periodo, resumo: preparada.resumo, ...(porProposta ? { propostas } : {}) };
  else if (url.endsWith('/projects/p1')) data = [{ id: 'db1', doc: 'DB-9001-01', ...periodo, revisoes }];
  else if (url.endsWith('/revisao')) data = { ...preparada, ...(body.contributionKey && body.contributionKey !== 'ALL' ? { proposta: propostas.find(p => p.key === body.contributionKey) } : {}), documento: { ...preparada.documento, rev: 1 } };
  else if (url.endsWith('/edicao')) data = { ...preparada, origem: { id: 'rev-0', revisao: 0 } };
  else if (url.endsWith('/previa')) {
    await new Promise(resolve => setTimeout(resolve, lenta && previas.size ? 900 : 100));
    if (falharPrevia) { falharPrevia = false; throw new Error('Falha simulada da prévia. Tente novamente.'); }
    if (falharAtualizacao && previas.size) { falharAtualizacao = false; throw new Error('Falha simulada da atualização.'); }
    const id = `previa-${previas.size + 1}`;
    previas.set(id, body);
    concluidas.push(id);
    data = { id, documento: preparada.documento, paginas: 9, avisos: [], campos: todosCampos ? camposDoDocumento(body.edicoes) : [] };
  } else if (url.endsWith('/pdf')) data = interativo || todosCampos ? pdfInterativo(previas.get(url.split('/').at(-2)!)?.edicoes as DatabookEdicoes, todosCampos) : await (await fetch(pdfUrl)).blob();
  else if (url.endsWith('/gerar')) {
    if (!previas.has(body.previaId)) throw new Error('Prévia obrigatória.');
    const nova = { ...original, id: 'rev-1', revisao: 1, descricao: String(previas.get(body.previaId)?.descricao) };
    revisoes.unshift(nova);
    data = nova;
  } else if (url.endsWith('/revisoes/rev-1')) data = { ...revisoes[0], doc: 'DB-9001-01' };
  else if (url.endsWith('/anotacoes/config')) data = { disponivel: false, maxCaracteres: 4000 };
  else throw new Error(`Rota não simulada: ${url}`);
  return { config, status: 200, statusText: 'OK', headers: {}, data: structuredClone(data) };
};

function Fixture() {
  return <div className="fv-ds" style={{ maxWidth: 1000, margin: 'auto', padding: 16 }}>
    {porProposta ? <ProjectProposalScopes projectId="p1" canManage /> : null}
    <ProjectDatabookButton project={{ id: 'p1', code: '9001', name: 'Projeto de prévia' }} />
  </div>;
}
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const auth = { user: { id: 'u1', name: 'Gestor', moduleRoles: ['rdo:manager'] } } as unknown as React.ContextType<typeof AuthContext>;
createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={client}><ThemeProvider><AuthContext.Provider value={auth}><ToastProvider><Fixture /></ToastProvider></AuthContext.Provider></ThemeProvider></QueryClientProvider>
);
