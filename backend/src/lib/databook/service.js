import path from 'node:path';

import { Prisma } from '@prisma/client';

import env from '../../config/env.js';
import prisma from '../prisma.js';
import { loadProposalScopes, selectProposalScope } from '../acompanhamento/proposal-scopes.js';
import { materializar, salvarVinculosFds } from './anexos.js';
import { dayKey, intervaloPadrao, montarDadosDatabook } from './montar-dados.js';
import { aplicarCorrecoes, verificarOrtografia } from './ortografia.js';
import { avisosDoGerador } from './python.js';
import { revisarTextoLivre } from './textos.js';
import { guardarPrevia, lerPrevia } from './previas.js';

const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/;

function erro(status, message) {
  return Object.assign(new Error(message), { status });
}

/** Valida o intervalo do diálogo: datas ISO, início ≤ fim e ambas dentro do período com RDO. */
export function validarIntervalo({ inicio, fim } = {}, padrao) {
  if (!padrao) throw erro(409, 'O projeto ainda não tem RDO aprovado para gerar o Data Book.');
  if (!DATA_ISO.test(String(inicio || '')) || !DATA_ISO.test(String(fim || ''))) throw erro(400, 'Informe as datas de início e fim.');
  if (Number.isNaN(Date.parse(`${inicio}T00:00:00Z`)) || Number.isNaN(Date.parse(`${fim}T00:00:00Z`))) throw erro(400, 'Data inválida.');
  if (inicio > fim) throw erro(400, 'A data de início deve ser anterior ou igual à data de fim.');
  if (inicio < padrao.inicio || fim > padrao.fim) {
    throw erro(400, `As datas devem estar entre o primeiro e o último RDO do projeto (${padrao.inicio} a ${padrao.fim}).`);
  }
  return { inicio, fim };
}

export async function projetoDoDatabook(projetoId, client = prisma) {
  const projeto = await client.project.findFirst({
    where: { id: projetoId, deletedAt: null },
    select: { id: true, code: true, name: true, isActive: true }
  });
  if (!projeto) throw erro(404, 'Projeto não encontrado.');
  return projeto;
}

/** Dados do diálogo de intervalo: padrão (1º e último RDO) e o que entra no intervalo. */
export async function resumoDoDialogo(projetoId, consulta = {}, client = prisma) {
  await projetoDoDatabook(projetoId, client);
  const scopeContext = await loadProposalScopes(projetoId, client);
  const proposta = selectProposalScope(scopeContext, consulta.contributionKey);
  const propostas = scopeContext.options;
  const padrao = await intervaloPadrao(projetoId, client);
  if (!padrao) return { padrao: null, resumo: null, propostas };
  const intervalo = validarIntervalo({ inicio: consulta.inicio || padrao.inicio, fim: consulta.fim || padrao.fim }, padrao);
  // O mapper só consulta o banco (não lê fotos nem PDFs): dá a contagem real de FDS do intervalo.
  const { resumo } = await montarDadosDatabook(projetoId, intervalo.inicio, intervalo.fim, { client, scopeContext, contributionKey: proposta?.key });
  return { padrao, resumo, propostas };
}

// Elaborado/Verificado por: só gestores e coordenadores do RDO (os mesmos papéis que geram o Data Book).
export const PAPEIS_RESPONSAVEIS = ['RDO_MANAGER', 'RDO_COORDINATOR'];

export async function responsaveisDisponiveis(client = prisma) {
  const users = await client.user.findMany({
    where: { isActive: true, moduleRoles: { some: { role: { in: PAPEIS_RESPONSAVEIS } } } },
    orderBy: { name: 'asc' },
    select: { id: true, name: true, collaborator: { select: { jobRole: { select: { name: true } } } } }
  });
  return users.map(u => ({ id: u.id, nome: u.name, cargo: u.collaborator?.jobRole?.name || '' }));
}

async function proximoDocumento(client, projeto, inicio, fim, scopeKey = 'ALL') {
  const existente = await client.projectDatabook.findUnique({
    where: { projectId_startDate_endDate_scopeKey: { projectId: projeto.id, startDate: new Date(`${inicio}T00:00:00Z`), endDate: new Date(`${fim}T00:00:00Z`), scopeKey } },
    include: { revisions: { orderBy: { revision: 'asc' }, select: { revision: true, status: true, description: true, createdAt: true, input: true } } }
  });
  if (existente) {
    const ultima = existente.revisions.reduce((m, r) => Math.max(m, r.revision), -1);
    return { databook: existente, doc: existente.docNumber, rev: ultima + 1 };
  }
  const agg = await client.projectDatabook.aggregate({ where: { projectId: projeto.id }, _max: { sequence: true } });
  const sequence = (agg._max.sequence || 0) + 1;
  return { databook: null, sequence, doc: `DB-${projeto.code}-${String(sequence).padStart(2, '0')}`, rev: 0 };
}

/** Tela de revisão: dados montados, sugestões de FDS/certificados, avisos e responsáveis. */
export async function prepararRevisao(projetoId, intervaloPedido, { client = prisma, gerarAvisos = avisosDoGerador, ortografia = verificarOrtografia } = {}) {
  const projeto = await projetoDoDatabook(projetoId, client);
  const { inicio, fim } = validarIntervalo(intervaloPedido, await intervaloPadrao(projetoId, client));
  const documento = await proximoDocumento(client, projeto, inicio, fim, intervaloPedido.contributionKey || 'ALL');
  const montado = await montarDadosDatabook(projetoId, inicio, fim, { client, documento, contributionKey: intervaloPedido.contributionKey, scopeVersion: intervaloPedido.scopeVersion });
  let avisosGerador = [];
  try {
    avisosGerador = await gerarAvisos(await materializar(client, montado.dados, { modo: 'verificar' }));
  } catch (error) {
    if (error.status !== 422) throw error;
    avisosGerador = [error.message];
  }
  return {
    ...montado,
    avisos: [...montado.avisos, ...avisosGerador],
    documento: { doc: documento.doc, rev: documento.rev },
    responsaveis: await responsaveisDisponiveis(client),
    ortografia: await ortografia(montado.dados)
  };
}

function texto(v, max = 4000) {
  return typeof v === 'string' ? v.slice(0, max) : undefined;
}

function pessoa(escolha, responsaveis, data) {
  if (!escolha) return undefined;
  if (escolha.userId) {
    const r = responsaveis.find(x => x.id === escolha.userId);
    if (!r) throw erro(400, 'Responsável selecionado não encontrado.');
    return { nome: r.nome, cargo: escolha.cargo ? texto(escolha.cargo, 120) : r.cargo, data };
  }
  const nome = texto(escolha.nome, 160)?.trim();
  return nome ? { nome, cargo: texto(escolha.cargo, 120)?.trim() || '' } : undefined;
}

/**
 * Aplica textos e ajustes de apresentação sobre uma cópia. Os campos do PDF podem
 * ser substituídos livremente; os relatórios e referências de arquivos são preservados.
 */
export function aplicarEdicoes(dados, edicoes = {}, responsaveis = []) {
  // Correções ortográficas escolhidas na revisão: palavra inteira, só nos textos livres dos relatórios.
  const out = structuredClone(dados);
  const e = edicoes || {};
  if (e.campos_documento !== undefined) {
    const campos = e.campos_documento;
    if (!campos || typeof campos !== 'object' || Array.isArray(campos) || Object.keys(campos).length > 20000) {
      throw erro(400, 'Campos do documento inválidos.');
    }
    let tamanho = 0;
    for (const [id, valor] of Object.entries(campos)) {
      if (!/^documento\.[a-zA-Z0-9_.-]{1,190}$/.test(id) || typeof valor !== 'string' || valor.length > 12000) {
        throw erro(400, 'Campo do documento inválido.');
      }
      tamanho += Buffer.byteLength(valor, 'utf8');
    }
    if (tamanho > 2 * 1024 * 1024) throw erro(400, 'Os ajustes do documento excedem o tamanho permitido.');
    out.campos_documento = structuredClone(campos);
  }
  if (texto(e.servico, 200)?.trim()) out.projeto.servico = e.servico.trim();
  if (texto(e.unidade_escopo, 40)?.trim()) out.unidade_escopo = e.unidade_escopo.trim();
  if (Number.isInteger(e.ocorrencias_sms) && e.ocorrencias_sms >= 0) out.ocorrencias_sms = e.ocorrencias_sms;
  const t = e.textos || {};
  for (const campo of ['escopo', 'resumo_executivo', 'consideracoes_finais', 'kpi_rotulo_concluidos', 'base_calculo', 'intro_procedimento', 'intro_rcpu', 'intro_rtp', 'nota_controle']) {
    if (texto(t[campo]) !== undefined) out.textos[campo] = revisarTextoLivre(t[campo]);
  }
  if (Array.isArray(t.destaques_sms)) out.textos.destaques_sms = t.destaques_sms.map(x => revisarTextoLivre(texto(x, 600) || '')).filter(Boolean).slice(0, 30);
  if (e.limites_rcpu && typeof e.limites_rcpu === 'object') {
    const l = {};
    if (texto(e.limites_rcpu.iso, 20)?.trim()) {
      if (!/^\d{1,2}\/\d{1,2}(\/\d{1,2})?$/.test(e.limites_rcpu.iso.trim())) throw erro(400, 'Limite ISO 4406 inválido (ex.: 16/14/11).');
      l.iso = e.limites_rcpu.iso.trim();
    }
    for (const k of ['nas', 'umidade_ppm']) {
      const v = e.limites_rcpu[k];
      if (v === '' || v == null) continue;
      if (!Number.isFinite(Number(String(v).replace(',', '.'))) || Number(String(v).replace(',', '.')) < 0) throw erro(400, 'Limite de RCPU inválido.');
      l[k] = Number(String(v).replace(',', '.'));
    }
    out.limites_rcpu = l;
  }
  if (Array.isArray(e.fds)) out.fds = out.fds.filter(f => e.fds.includes(f.arquivo));
  if (Array.isArray(e.certificados)) out.certificados = out.certificados.filter(c => e.certificados.includes(c.arquivo));
  if (e.aprovacoes) {
    const a = e.aprovacoes;
    const data = out.projeto.emissao;
    out.aprovacoes = Object.fromEntries(Object.entries({
      elaborado: pessoa(a.elaborado, responsaveis, data),
      verificado: pessoa(a.verificado, responsaveis, data),
      aprovado: pessoa(a.aprovado, responsaveis)
    }).filter(([, v]) => v));
  }
  if (Array.isArray(e.dias)) {
    for (const [i, edicao] of e.dias.entries()) {
      const dia = out.dias?.[i];
      if (!dia || edicao?.data !== dia.data) throw erro(400, 'Os dias editados não correspondem ao documento.');
      const copiarTextos = (alvo, fonte, campos) => {
        for (const campo of campos) {
          if (texto(fonte?.[campo]) !== undefined) alvo[campo] = revisarTextoLivre(texto(fonte[campo]));
        }
      };
      copiarTextos(dia, edicao, ['resumo', 'comentario']);
      for (const [lista, campos] of [['atividades', ['texto']], ['servicos', ['titulo', 'obs', 'laudo_observacao']], ['fotos', ['legenda']]]) {
        if (!Array.isArray(edicao[lista])) continue;
        if (edicao[lista].length !== (dia[lista] || []).length) throw erro(400, 'A estrutura dos registros do documento não pode ser alterada.');
        edicao[lista].forEach((item, j) => copiarTextos(dia[lista][j], item, campos));
      }
    }
  }
  return aplicarCorrecoes(out, e.correcoes);
}

function revisaoParaTabela(r) {
  const ap = r.input?.aprovacoes || {};
  return {
    rev: String(r.revision), data: r.input?.projeto?.emissao || '', descricao: r.description,
    elaborado: ap.elaborado?.nome || '', verificado: ap.verificado?.nome || '', aprovado: ap.aprovado?.nome || ''
  };
}

function isUnico(error) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

/** Vínculos produto do RLQ → item do Estoque escolhidos no diálogo ({ produto: stockItemId | '' }). */
export function vinculosFdsDasEdicoes(edicoes) {
  const v = edicoes?.vinculos_fds;
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
  return Object.fromEntries(Object.entries(v)
    .filter(([produto, id]) => String(produto).trim() && typeof id === 'string')
    .slice(0, 100)
    .map(([produto, id]) => [produto, id.trim()]));
}

/** Cria a revisão (PENDING) com a entrada final do gerador; o worker gera o PDF. */
export async function solicitarGeracao(projetoId, { inicio, fim, edicoes, descricao, previaId, contributionKey, scopeVersion } = {}, user, { client = prisma, opcoesPrevia } = {}) {
  if (previaId) return salvarPrevia(projetoId, previaId, user, { client, opcoesPrevia });
  const projeto = await projetoDoDatabook(projetoId, client);
  const intervalo = validarIntervalo({ inicio, fim }, await intervaloPadrao(projetoId, client));
  const vinculosFds = vinculosFdsDasEdicoes(edicoes);
  for (let tentativa = 0; tentativa < 3; tentativa += 1) {
    const documento = await proximoDocumento(client, projeto, intervalo.inicio, intervalo.fim, contributionKey || 'ALL');
    const montado = await montarDadosDatabook(projetoId, intervalo.inicio, intervalo.fim, { client, documento, vinculosFds, contributionKey, scopeVersion });
    const dados = aplicarEdicoes(montado.dados, edicoes, await responsaveisDisponiveis(client));
    const desc = texto(descricao, 200)?.trim() || (documento.rev === 0 ? 'Emissão inicial' : `Revisão ${documento.rev}`);
    const anteriores = (documento.databook?.revisions || []).filter(r => r.status === 'COMPLETED').map(revisaoParaTabela);
    dados.revisoes = [...anteriores, revisaoParaTabela({ revision: documento.rev, description: desc, input: dados })];
    try {
      return await client.$transaction(async tx => {
        // O vínculo escolhido vira sinônimo no Estoque: o próximo Data Book já vincula sozinho.
        await salvarVinculosFds(tx, vinculosFds);
        const databook = documento.databook || await tx.projectDatabook.create({
          data: {
            projectId: projeto.id, sequence: documento.sequence, docNumber: documento.doc,
            scopeKey: contributionKey || 'ALL', scopeSnapshot: dados.proposta || Prisma.JsonNull,
            startDate: new Date(`${intervalo.inicio}T00:00:00Z`), endDate: new Date(`${intervalo.fim}T00:00:00Z`),
            createdByUserId: user?.id || null
          }
        });
        return tx.projectDatabookRevision.create({
          data: {
            databookId: databook.id, revision: documento.rev, description: desc, input: dados, scopeSnapshot: dados.proposta || Prisma.JsonNull,
            warnings: montado.avisos, createdByUserId: user?.id || null
          },
          include: { databook: true }
        });
      });
    } catch (error) {
      if (!isUnico(error)) throw error; // outra geração simultânea pegou o mesmo nº: recalcula
    }
  }
  throw erro(409, 'Outra geração deste Data Book está em andamento. Tente novamente.');
}

async function revisaoEditavel(id, client) {
  const revisao = await client.projectDatabookRevision.findUnique({ where: { id }, include: { databook: true } });
  if (!revisao) throw erro(404, 'Revisão do Data Book não encontrada.');
  await projetoDoDatabook(revisao.databook.projectId, client);
  if (revisao.status !== 'COMPLETED') throw erro(409, 'Aguarde a conclusão da revisão para editá-la.');
  return revisao;
}

/** Abre exatamente o conteúdo salvo, mesmo que relatórios/cadastros tenham mudado depois. */
export async function prepararEdicao(revisaoId, { client = prisma } = {}) {
  const r = await revisaoEditavel(revisaoId, client);
  const projeto = await projetoDoDatabook(r.databook.projectId, client);
  const inicio = dayKey(r.databook.startDate);
  const fim = dayKey(r.databook.endDate);
  const documento = await proximoDocumento(client, projeto, inicio, fim, r.databook.scopeKey || 'ALL');
  const dados = structuredClone(r.input);
  const dias = dados.dias || [];
  const contar = tipo => dias.flatMap(d => d.servicos || []).filter(s => s.tipo === tipo && (s.relatorio != null || s.rlq != null)).length;
  return {
    dados, proposta: dados.proposta || null, origem: { id: r.id, revisao: r.revision },
    documento: { doc: documento.doc, rev: documento.rev },
    resumo: { inicio, fim, dias: dias.length, rdos: dias.reduce((n, d) => n + (d.rdo != null ? 1 : 0) + (d.rdos_extras?.length || 0), 0),
      rlq: contar('RLQ'), rcpu: contar('RCPU'), rtp: contar('RTP'), rlm: contar('RLM'), fds: dados.fds?.length || 0, certificados: dados.certificados?.length || 0 },
    avisos: Array.isArray(r.warnings) ? r.warnings : [],
    sugestoes: { fds: [], certificados: dados.certificados || [] },
    responsaveis: await responsaveisDisponiveis(client)
  };
}

/** Monta a entrada final uma só vez: a prévia e a revisão usam o mesmo snapshot. */
export async function criarPrevia(projetoId, { inicio, fim, edicoes, descricao, origemRevisaoId, contributionKey, scopeVersion } = {}, user, { client = prisma, ...opcoesPrevia } = {}) {
  const projeto = await projetoDoDatabook(projetoId, client);
  let base;
  if (origemRevisaoId) {
    const origem = await revisaoEditavel(origemRevisaoId, client);
    if (origem.databook.projectId !== projetoId) throw erro(400, 'A revisão não pertence a este projeto.');
    contributionKey = origem.databook.scopeKey || 'ALL';
    inicio = dayKey(origem.databook.startDate);
    fim = dayKey(origem.databook.endDate);
    base = { dados: origem.input, avisos: Array.isArray(origem.warnings) ? origem.warnings : [] };
  } else {
    validarIntervalo({ inicio, fim }, await intervaloPadrao(projetoId, client));
  }
  const documento = await proximoDocumento(client, projeto, inicio, fim, contributionKey || 'ALL');
  const vinculosFds = origemRevisaoId ? {} : vinculosFdsDasEdicoes(edicoes);
  base ||= await montarDadosDatabook(projetoId, inicio, fim, { client, documento, vinculosFds, contributionKey, scopeVersion });
  const dados = aplicarEdicoes(base.dados, edicoes, await responsaveisDisponiveis(client));
  dados.projeto.doc = documento.doc;
  dados.projeto.rev = String(documento.rev);
  dados.projeto.emissao = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  for (const campo of ['elaborado', 'verificado']) {
    if (dados.aprovacoes?.[campo]) dados.aprovacoes[campo].data = dados.projeto.emissao;
  }
  const desc = texto(descricao, 200)?.trim() || (documento.rev === 0 ? 'Emissão inicial' : `Revisão ${documento.rev}`);
  dados.revisoes = [
    ...(documento.databook?.revisions || []).filter(r => r.status === 'COMPLETED').map(revisaoParaTabela),
    revisaoParaTabela({ revision: documento.rev, description: desc, input: dados })
  ];
  return guardarPrevia({
    projetoId, inicio, fim, scopeKey: contributionKey || 'ALL', dados, descricao: desc, avisos: base.avisos, vinculosFds,
    documento: { doc: documento.doc, rev: documento.rev }
  }, user, { client, ...opcoesPrevia });
}

async function salvarPrevia(projetoId, previaId, user, { client, opcoesPrevia }) {
  const entrada = await lerPrevia(previaId, user, opcoesPrevia);
  if (entrada.projetoId !== projetoId) throw erro(400, 'A prévia não pertence a este projeto.');
  const projeto = await projetoDoDatabook(projetoId, client);
  const documento = await proximoDocumento(client, projeto, entrada.inicio, entrada.fim, entrada.scopeKey || 'ALL');
  const conflito = () => erro(409, 'Uma nova revisão foi gerada durante a edição. Atualize a prévia para salvar com o próximo número.');
  if (documento.doc !== entrada.documento.doc || documento.rev !== entrada.documento.rev) throw conflito();
  try {
    return await client.$transaction(async tx => {
      await salvarVinculosFds(tx, entrada.vinculosFds);
      const databook = documento.databook || await tx.projectDatabook.create({ data: {
        projectId: projetoId, sequence: documento.sequence, docNumber: documento.doc,
        scopeKey: entrada.scopeKey || 'ALL', scopeSnapshot: entrada.dados.proposta || Prisma.JsonNull,
        startDate: new Date(`${entrada.inicio}T00:00:00Z`), endDate: new Date(`${entrada.fim}T00:00:00Z`),
        createdByUserId: user.id
      } });
      return tx.projectDatabookRevision.create({ data: {
        databookId: databook.id, revision: documento.rev, description: entrada.descricao,
        input: entrada.dados, scopeSnapshot: entrada.dados.proposta || Prisma.JsonNull, warnings: entrada.avisos, createdByUserId: user.id
      }, include: { databook: true } });
    });
  } catch (error) {
    if (isUnico(error)) throw conflito();
    throw error;
  }
}

export function serializarRevisao(r) {
  return {
    id: r.id,
    proposta: r.scopeSnapshot || r.input?.proposta || r.databook?.scopeSnapshot || null,
    revisao: r.revision,
    descricao: r.description,
    status: r.status,
    paginas: r.pageCount,
    tamanho: r.fileSize,
    avisos: Array.isArray(r.warnings) ? r.warnings : [],
    erro: r.status === 'FAILED' ? (r.error || '').split('\n')[0].slice(0, 500) : null,
    criadoEm: r.createdAt,
    concluidoEm: r.completedAt,
    ...(r.databook ? { doc: r.databook.docNumber, inicio: dayKey(r.databook.startDate), fim: dayKey(r.databook.endDate) } : {})
  };
}

export async function listarDatabooks(projetoId, client = prisma) {
  await projetoDoDatabook(projetoId, client);
  const databooks = await client.projectDatabook.findMany({
    where: { projectId: projetoId },
    orderBy: { sequence: 'desc' },
    include: { revisions: { orderBy: { revision: 'desc' }, omit: { input: true } } }
  });
  return databooks.map(d => ({
    id: d.id, doc: d.docNumber, proposta: d.scopeSnapshot || null, inicio: dayKey(d.startDate), fim: dayKey(d.endDate),
    revisoes: d.revisions.map(serializarRevisao)
  }));
}

export async function obterRevisao(revisaoId, client = prisma) {
  const r = await client.projectDatabookRevision.findUnique({ where: { id: revisaoId }, omit: { input: true }, include: { databook: true } });
  if (!r) throw erro(404, 'Revisão do Data Book não encontrada.');
  return r;
}

/** Caminho absoluto do PDF de uma revisão concluída (dentro do armazenamento do app). */
export function caminhoDoPdf(revisao) {
  if (revisao.status !== 'COMPLETED' || !revisao.storagePath) throw erro(409, 'O PDF desta revisão ainda não está pronto.');
  const raiz = path.resolve(env.uploadDir);
  const alvo = path.resolve(raiz, ...revisao.storagePath.split('/'));
  const rel = path.relative(raiz, alvo);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) throw erro(404, 'Arquivo do Data Book não encontrado.');
  return alvo;
}

export function nomeDoArquivo(revisao) {
  return `${revisao.databook.docNumber}_Rev${revisao.revision}.pdf`;
}

