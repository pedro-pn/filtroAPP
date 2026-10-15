import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { spawnSync } from 'node:child_process';

import { Prisma } from '@prisma/client';
import { aplicarEdicoes, criarPrevia, prepararEdicao, solicitarGeracao } from '../src/lib/databook/service.js';
import { lerPrevia, pdfDaPrevia } from '../src/lib/databook/previas.js';
import env from '../src/config/env.js';

const user = { id: 'gestor-1' };

function fixture() {
  const input = {
    projeto: { doc: 'DB-9001-01', rev: '0', servico: 'Serviço original', emissao: '01/10/2026', periodo: '01/10/2026 a 01/10/2026' },
    textos: { escopo: 'Escopo original', resumo_executivo: 'Resumo original' },
    unidade_escopo: 'm', ocorrencias_sms: 0,
    aprovacoes: { elaborado: { nome: 'Responsável antigo', cargo: 'Coordenador', data: '01/10/2026' } },
    dias: [{ data: '01/10/2026', rdo: 1, resumo: 'Resumo do dia', comentario: 'Comentário original',
      atividades: [{ hora: '07:30', texto: 'Montagem dos equipamnetos' }],
      servicos: [{ tipo: 'RLQ', relatorio: 1, tags: 'TAG-001', quantidade: 25, obs: 'Original' }], fotos: [] }],
    fds: [], certificados: []
  };
  const databook = { id: 'db-1', projectId: 'p1', docNumber: 'DB-9001-01', sequence: 1,
    startDate: new Date('2026-10-01'), endDate: new Date('2026-10-01') };
  const original = { id: 'rev-0', revision: 0, status: 'COMPLETED', description: 'Emissão inicial', input, databook, warnings: [] };
  const revisoes = [original];
  const client = {
    project: { findFirst: async ({ where }) => where.id === 'p1' ? { id: 'p1', code: '9001', name: 'Projeto' } : null },
    user: { findMany: async () => [] }, // autor original já não está entre os responsáveis ativos
    projectDatabook: { findUnique: async () => ({ ...databook, revisions: revisoes }) },
    projectDatabookRevision: {
      findUnique: async ({ where }) => revisoes.find(r => r.id === where.id) || null,
      create: async ({ data }) => {
        const r = { id: `rev-${data.revision}`, ...data, status: 'PENDING', databook };
        revisoes.push(r);
        return r;
      }
    },
    $transaction: async fn => fn(client)
  };
  return { original, revisoes, client };
}

async function pastaTemporaria(t) {
  const raiz = await fs.mkdtemp(path.join(os.tmpdir(), 'databook-previa-test-'));
  t.after(() => fs.rm(raiz, { recursive: true, force: true }));
  return raiz;
}

test('edição abre o snapshot antigo e salvar a prévia cria uma nova revisão sem consultar os relatórios', async t => {
  const { client, original, revisoes } = fixture();
  const antes = structuredClone(original);
  const raiz = await pastaTemporaria(t);
  const aberta = await prepararEdicao('rev-0', { client });
  assert.equal(aberta.documento.rev, 1);
  assert.equal(aberta.dados.textos.escopo, 'Escopo original');
  assert.equal(aberta.dados.aprovacoes.elaborado.nome, 'Responsável antigo');
  aberta.dados.textos.escopo = 'Rascunho local';
  assert.equal(original.input.textos.escopo, 'Escopo original');
  let renderizado;
  const previa = await criarPrevia('p1', { origemRevisaoId: 'rev-0', descricao: 'Correção manual',
    edicoes: { campos_documento: { 'documento.s2.indicadores.dias_execucao': '19' }, textos: { escopo: 'Escopo corrigido' }, dias: [{ data: '01/10/2026', comentario: 'Comentário corrigido' }] }
  }, user, { client, raiz, gerar: async (dados, saida) => {
    renderizado = structuredClone(dados);
    await fs.writeFile(saida, '%PDF-1.4\n%%EOF');
    return { paginas: 3, avisos: ['Aviso da prévia'] };
  } });
  assert.equal(revisoes.length, 1, 'visualizar não gera revisão');
  assert.equal(renderizado.projeto.rev, '1');
  assert.equal(renderizado.dias[0].servicos[0].tags, 'TAG-001');
  assert.deepEqual(renderizado.revisoes.map(r => r.rev), ['0', '1']);
  assert.equal((await fs.readFile(await pdfDaPrevia(previa.id, user, { raiz }), 'utf8')).startsWith('%PDF'), true);
  const nova = await solicitarGeracao('p1', { previaId: previa.id, edicoes: { servico: 'Ignorar esta adulteração' } }, user, { client, opcoesPrevia: { raiz } });
  assert.equal(nova.revision, 1);
  assert.equal(nova.description, 'Correção manual');
  assert.equal(nova.status, 'PENDING');
  assert.equal(nova.input.campos_documento['documento.s2.indicadores.dias_execucao'], '19');
  const { previa_editavel, ...entradaVisualizada } = renderizado;
  assert.equal(previa_editavel, true);
  assert.deepEqual(nova.input, entradaVisualizada, 'salva os dados visualizados sem os marcadores temporários de edição');
  assert.deepEqual(nova.warnings, ['Aviso da prévia']);
  assert.deepEqual(original, antes, 'nenhum campo da revisão anterior foi alterado');
  nova.status = 'COMPLETED';
  const reaberta = await prepararEdicao(nova.id, { client });
  assert.equal(reaberta.documento.rev, 2);
  assert.equal(reaberta.dados.campos_documento['documento.s2.indicadores.dias_execucao'], '19');
  await assert.rejects(() => solicitarGeracao('p1', { previaId: previa.id }, user, { client, opcoesPrevia: { raiz } }), { status: 409 });
});

test('primeira geração: prévia do intervalo só cria documento e revisão ao confirmar', async t => {
  const { client, revisoes } = fixture();
  revisoes.length = 0;
  const raiz = await pastaTemporaria(t);
  const projeto = { id: 'p1', code: '9001', name: 'Projeto', clientName: 'Cliente', plannedServices: [] };
  client.project.findUnique = async () => projeto;
  let documentoSalvo = null;
  client.projectDatabook.findUnique = async () => documentoSalvo && { ...documentoSalvo, revisions: revisoes };
  client.projectDatabook.aggregate = async () => ({ _max: { sequence: null } });
  client.projectDatabook.create = async ({ data }) => { documentoSalvo = { id: 'db1', ...data }; return documentoSalvo; };
  const rdo = { id: 'rdo1', reportDate: new Date('2026-10-01T12:00:00Z'), sequenceNumber: 1, dailyDescription: 'Atividade original',
    services: [], collaborators: [], specialConditions: {} };
  client.report = {
    findFirst: async () => rdo,
    findMany: async ({ where }) => where.reportType === 'RDO' ? [rdo] : []
  };
  const previa = await criarPrevia('p1', { inicio: '2026-10-01', fim: '2026-10-01', edicoes: { textos: { escopo: 'Escopo manual da primeira emissão' } } }, user, {
    client, raiz, gerar: async (_, saida) => { await fs.writeFile(saida, '%PDF'); return { paginas: 7 }; }
  });
  assert.equal(previa.documento.rev, 0);
  assert.equal(documentoSalvo, null);
  assert.equal(revisoes.length, 0);
  client.report.findMany = async () => assert.fail('Salvar não pode remontar relatórios após a prévia');
  const nova = await solicitarGeracao('p1', { previaId: previa.id }, user, { client, opcoesPrevia: { raiz } });
  assert.equal(nova.revision, 0);
  assert.equal(nova.input.textos.escopo, 'Escopo manual da primeira emissão');
  assert.equal(documentoSalvo.docNumber, previa.documento.doc);
});

test('prévia é privada, expira, valida o projeto e não aceita caminho como identificador', async t => {
  const { client } = fixture();
  const raiz = await pastaTemporaria(t);
  const previa = await criarPrevia('p1', { origemRevisaoId: 'rev-0' }, user, { client, raiz, agora: 100,
    gerar: async (_, saida) => { await fs.writeFile(saida, '%PDF'); return { paginas: 1 }; }
  });
  await assert.rejects(() => lerPrevia(previa.id, { id: 'outra-pessoa' }, { raiz, agora: 101 }), { status: 410 });
  await assert.rejects(() => lerPrevia(previa.id, user, { raiz, agora: 100 + 24 * 60 * 60 * 1000 }), { status: 410 });
  await assert.rejects(() => lerPrevia('../entrada.json', user, { raiz }), { status: 410 });
  await assert.rejects(() => solicitarGeracao('outro-projeto', { previaId: previa.id }, user, { client, opcoesPrevia: { raiz, agora: 101 } }), { status: 400 });
});

test('editar uma revisão antiga usa a próxima numeração, incluindo revisões que falharam', async () => {
  const { client, original, revisoes } = fixture();
  revisoes.push({ ...original, id: 'rev-1', revision: 1, status: 'COMPLETED' }, { ...original, id: 'rev-2', revision: 2, status: 'FAILED' });
  const aberta = await prepararEdicao('rev-0', { client });
  assert.equal(aberta.documento.rev, 3);
  assert.deepEqual(aberta.origem, { id: 'rev-0', revisao: 0 });
  await assert.rejects(() => prepararEdicao('rev-2', { client }), { status: 409 });
  await assert.rejects(() => prepararEdicao('inexistente', { client }), { status: 404 });
});

test('conflito simultâneo ao inserir exige atualizar a prévia e nunca sobrescreve a revisão', async t => {
  const { client, revisoes } = fixture();
  const raiz = await pastaTemporaria(t);
  const previa = await criarPrevia('p1', { origemRevisaoId: 'rev-0' }, user, { client, raiz,
    gerar: async (_, saida) => { await fs.writeFile(saida, '%PDF'); return { paginas: 1 }; }
  });
  client.projectDatabookRevision.create = async () => { throw new Prisma.PrismaClientKnownRequestError('unique', { code: 'P2002', clientVersion: '7' }); };
  await assert.rejects(() => solicitarGeracao('p1', { previaId: previa.id }, user, { client, opcoesPrevia: { raiz } }), { status: 409 });
  assert.equal(revisoes.length, 1);
});

test('edição diária limita campos, preserva dados técnicos/arquivos e aplica a ortografia depois das edições', () => {
  const { original } = fixture();
  const dados = aplicarEdicoes(original.input, { dias: [{ data: '01/10/2026', resumo: 'Resumo manual',
    atividades: [{ texto: 'Instalação dos equipamnetos', hora: '22:00' }],
    servicos: [{ obs: 'Observação manual', tags: 'ADULTERADO', quantidade: 999 }], fotos: []
  }], correcoes: [{ palavra: 'equipamnetos', por: 'equipamentos' }] });
  assert.equal(dados.dias[0].atividades[0].texto, 'Instalação dos equipamentos');
  assert.equal(dados.dias[0].atividades[0].hora, '07:30');
  assert.equal(dados.dias[0].servicos[0].tags, 'TAG-001');
  assert.equal(dados.dias[0].servicos[0].quantidade, 25);
  assert.equal(dados.dias[0].servicos[0].obs, 'Observação manual');
  assert.throws(() => aplicarEdicoes(original.input, { dias: [{ data: '02/10/2026' }] }), { status: 400 });
  assert.throws(() => aplicarEdicoes(original.input, { dias: [{ data: '01/10/2026', atividades: [] }] }), { status: 400 });
});

test('ajustes de qualquer campo do documento são texto literal e podem ser restaurados, preservando RDOs/arquivos', () => {
  const { original } = fixture();
  const antes = structuredClone(original.input);
  const ajustes = { 'documento.s2.indicadores.dias_execucao': '19', 'documento.d1.campo.pressao.valor': '350 bar',
    'documento.capa.servico': '<b>Texto literal</b>', 'documento.s2.grafico.dia.0.percentual': '82%',
    'documento.d1.campo.efetivo.valor': '' };
  const dados = aplicarEdicoes(original.input, { campos_documento: ajustes });
  assert.deepEqual(dados.campos_documento, ajustes);
  assert.deepEqual(dados.dias, antes.dias);
  assert.deepEqual(original.input, antes);
  assert.deepEqual(aplicarEdicoes(dados, {}).campos_documento, ajustes);
  assert.deepEqual(aplicarEdicoes(dados, { campos_documento: {} }).campos_documento, {});
  for (const campos_documento of [[], null, { arquivo: '/etc/passwd' }, { 'documento.x': 19 }, { 'documento.x': 'x'.repeat(12001) }]) {
    assert.throws(() => aplicarEdicoes(antes, { campos_documento }), { status: 400 });
  }
});

const pythonPronto = spawnSync(env.databookPython, ['-c', 'import reportlab, pypdf, PIL']).status === 0;
test('prévia real: o PDF contém o texto manual e a revisão salva conserva a mesma entrada', {
  skip: !pythonPronto && 'Python do Data Book não instalado (DATABOOK_PYTHON)'
}, async t => {
  const { client, original } = fixture();
  const raiz = await pastaTemporaria(t);
  const dados = JSON.parse(await fs.readFile(new URL('../databook/exemplo/projeto_completo.json', import.meta.url), 'utf8'));
  dados.fds = [];
  dados.certificados = [];
  dados.dias.forEach(d => { d.fotos = []; });
  original.input = dados;
  const previa = await criarPrevia('p1', { origemRevisaoId: 'rev-0', descricao: 'Correção manual',
    edicoes: { campos_documento: { 'documento.s2.indicadores.dias_execucao': '19' }, textos: { escopo: 'Texto manual conferido na previa do documento.' } }
  }, user, { client, raiz });
  assert.ok(previa.paginas > 5);
  assert.equal(previa.campos.find(c => c.id === 'documento.s2.indicadores.dias_execucao').valor, '19');
  const pdf = await pdfDaPrevia(previa.id, user, { raiz });
  const leitura = spawnSync(env.databookPython, ['-c', 'import sys; from pypdf import PdfReader; print("\\n".join(p.extract_text() for p in PdfReader(sys.argv[1]).pages))', pdf], { encoding: 'utf8' });
  assert.equal(leitura.status, 0, leitura.stderr);
  assert.match(leitura.stdout, /Texto manual conferido na previa do documento\./);
  const entrada = await lerPrevia(previa.id, user, { raiz });
  assert.equal(entrada.dados.previa_editavel, undefined);
  const nova = await solicitarGeracao('p1', { previaId: previa.id }, user, { client, opcoesPrevia: { raiz } });
  assert.deepEqual(nova.input, entrada.dados);
});
