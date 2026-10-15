import assert from 'node:assert/strict';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import express from 'express';

import { createDatabookRouter } from '../src/routes/resources/databook.js';
import { pdfDaPrevia } from '../src/lib/databook/previas.js';

function autenticarComo(req, res, next) {
  const role = req.headers['x-test-role'];
  if (!role) return res.status(401).json({ error: 'Sessão ausente.' });
  req.auth = { user: { id: `u-${role}`, accountType: 'INTERNAL', moduleRoles: [role] } };
  next();
}

function dispatch(router, path, { method = 'GET', role, body } = {}) {
  const url = new URL(path, 'http://local.test');
  const request = {
    method, url: `${url.pathname}${url.search}`, originalUrl: `${url.pathname}${url.search}`,
    headers: role ? { 'x-test-role': role } : {}, query: Object.fromEntries(url.searchParams), body
  };
  return new Promise((resolve, reject) => {
    const response = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(payload) { resolve({ status: this.statusCode, body: payload }); return this; },
      setHeader() {},
      getHeader() { return undefined; }
    };
    router.handle(request, response, error => (error ? reject(error) : resolve({ status: 404, body: null })));
  });
}

function fixture() {
  const chamadas = [];
  const servicos = {
    listarDatabooks: async id => { chamadas.push(['listar', id]); return []; },
    resumoDoDialogo: async (id, q) => { chamadas.push(['resumo', id, q]); return { padrao: { inicio: '2026-10-01', fim: '2026-10-09' } }; },
    prepararRevisao: async (id, i) => { chamadas.push(['revisao', id, i]); return { dados: {} }; },
    prepararEdicao: async id => { chamadas.push(['editar', id]); return { dados: { textos: { escopo: 'Original' } }, origem: { id } }; },
    criarPrevia: async (id, input, user) => { chamadas.push(['previa', id, input, user.id]); return { id: 'previa-1', paginas: 3 }; },
    solicitarGeracao: async (id, input, user) => {
      chamadas.push(['gerar', id, input, user.id]);
      return { id: 'rev-1', revision: 0, description: 'Emissão inicial', status: 'PENDING', warnings: [], createdAt: new Date(0) };
    },
    obterRevisao: async () => ({ id: 'rev-1', revision: 0, description: 'x', status: 'RUNNING', warnings: [], createdAt: new Date(0) }),
    agendarFilaDatabook: () => chamadas.push(['agendar'])
  };
  return { chamadas, router: createDatabookRouter({ authenticate: autenticarComo, servicos }) };
}

test('Data Book: só gestor e coordenador do RDO acessam', async () => {
  const { router, chamadas } = fixture();
  assert.equal((await dispatch(router, '/projects/p1')).status, 401);
  for (const role of ['rdo:collaborator', 'rdo:client', 'acompanhamento:manager']) {
    assert.equal((await dispatch(router, '/projects/p1', { role })).status, 403, role);
  }
  assert.equal(chamadas.length, 0);
  for (const role of ['rdo:manager', 'rdo:coordinator']) {
    assert.equal((await dispatch(router, '/projects/p1', { role })).status, 200, role);
  }
});

test('Data Book: abrir revisão e gerar a prévia não agenda geração; salvar envia apenas o snapshot da prévia', async () => {
  const { router, chamadas } = fixture();
  const role = 'rdo:manager';
  assert.equal((await dispatch(router, '/revisoes/rev-0/edicao', { role })).body.dados.textos.escopo, 'Original');
  const body = { inicio: '2026-10-02', fim: '2026-10-05', origemRevisaoId: 'rev-0', edicoes: { servico: 'Editado' }, descricao: 'Correção manual' };
  const previa = await dispatch(router, '/projects/p1/previa', { method: 'POST', role, body });
  assert.equal(previa.body.id, 'previa-1');
  assert.deepEqual(chamadas, [['editar', 'rev-0'], ['previa', 'p1', body, 'u-rdo:manager']]);
  const salvar = await dispatch(router, '/projects/p1/gerar', { method: 'POST', role, body: { previaId: 'previa-1' } });
  assert.equal(salvar.status, 202);
  assert.equal(chamadas.at(-2)[2].previaId, 'previa-1');
  assert.deepEqual(chamadas.at(-1), ['agendar']);
  for (const path of ['/revisoes/rev-0/edicao', '/previas/previa-1/pdf']) {
    assert.equal((await dispatch(router, path, { role: 'rdo:collaborator' })).status, 403);
  }
  assert.equal((await dispatch(router, '/projects/p1/previa', { method: 'POST', role: 'rdo:client', body })).status, 403);
});

test('Data Book: fluxo diálogo → revisão → geração (job agendado, 202) → status', async () => {
  const { router, chamadas } = fixture();
  const role = 'rdo:coordinator';
  const resumo = await dispatch(router, '/projects/p1/intervalo?inicio=2026-10-02&fim=2026-10-05', { role });
  assert.equal(resumo.status, 200);
  await dispatch(router, '/projects/p1/revisao', { method: 'POST', role, body: { inicio: '2026-10-02', fim: '2026-10-05' } });
  const gerar = await dispatch(router, '/projects/p1/gerar', {
    method: 'POST', role, body: { inicio: '2026-10-02', fim: '2026-10-05', edicoes: { servico: 'X' }, descricao: 'Emissão inicial' }
  });
  assert.equal(gerar.status, 202);
  assert.equal(gerar.body.status, 'PENDING');
  const status = await dispatch(router, '/revisoes/rev-1', { role });
  assert.equal(status.body.status, 'RUNNING');
  assert.deepEqual(chamadas, [
    ['resumo', 'p1', { inicio: '2026-10-02', fim: '2026-10-05' }],
    ['revisao', 'p1', { inicio: '2026-10-02', fim: '2026-10-05' }],
    ['gerar', 'p1', { inicio: '2026-10-02', fim: '2026-10-05', edicoes: { servico: 'X' }, descricao: 'Emissão inicial' }, 'u-rdo:coordinator'],
    ['agendar']
  ]);
});

test('Data Book: HTTP entrega o PDF da pasta oculta somente ao autor autenticado', async t => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'databook-http-'));
  t.after(() => fs.rm(tmp, { recursive: true, force: true }));
  const raiz = path.join(tmp, '.databook-previas');
  const id = '00000000-0000-4000-8000-000000000001';
  const pasta = path.join(raiz, id);
  await fs.mkdir(pasta, { recursive: true });
  const pdf = Buffer.from('%PDF-1.4\nPrevia do Data Book\n%%EOF');
  await fs.writeFile(path.join(pasta, 'previa.pdf'), pdf);
  await fs.writeFile(path.join(pasta, 'entrada.json'), JSON.stringify({ userId: 'u-rdo:manager', expiraEm: Date.now() + 60_000 }));
  const app = express();
  app.use('/api/rdo/databook', createDatabookRouter({
    authenticate: autenticarComo,
    servicos: { pdfDaPrevia: (previaId, user) => pdfDaPrevia(previaId, user, { raiz }) }
  }));
  app.use((error, req, res, next) => res.status(error.status || 500).json({ error: error.message }));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/api/rdo/databook/previas/${id}/pdf`;
  assert.equal((await fetch(url)).status, 401);
  assert.equal((await fetch(url, { headers: { 'x-test-role': 'rdo:collaborator' } })).status, 403);
  assert.equal((await fetch(url, { headers: { 'x-test-role': 'rdo:coordinator' } })).status, 410);
  const response = await fetch(url, { headers: { 'x-test-role': 'rdo:manager' } });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /application\/pdf/);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), pdf);
});
