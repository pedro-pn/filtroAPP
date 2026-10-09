import assert from 'node:assert/strict';
import test from 'node:test';

import { createDatabookRouter } from '../src/routes/resources/databook.js';

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
