import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import express from 'express';
import { apiSimulationDatabase } from './helpers/api-simulation-db.js';
import { API_SCOPES } from '../src/lib/api-credentials/catalog.js';
import { createApiToken } from '../src/lib/api-credentials/token.js';
import { createApiTokenAuthenticator, createApiSimulationPreferenceResolver } from '../src/middleware/api-token-auth.js';
import { apiRequestContext, integrationApiBoundary, integrationApiErrorHandler } from '../src/middleware/api-request-context.js';
import { createOperationalRouter } from '../src/routes/integrations/v1/operational.js';
import { syncOmieInvoices } from '../src/lib/omie/invoices.js';
import { parseCte, importCte } from '../src/lib/logistica/cte.js';
import { executePlaygroundOperation } from '../src/lib/api-credentials/playground.js';

const key = 'synthetic-omni-delivery-b-key-with-at-least-32-characters';
const envConfig = { apiTokenGlobalMaxPageSize: 500, apiTokenHashKeys: { 1: key }, apiTokenActiveKeyVersion: 1 };
const cteXml = `<cteProc xmlns="http://www.portalfiscal.inf.br/cte"><CTe><infCte><ide><mod>57</mod><nCT>0010</nCT><dhEmi>2026-10-01T11:00:00-03:00</dhEmi></ide><emit><xNome>Transportadora fictícia</xNome></emit><infCTeNorm><infDoc><infNFe><chave>${'1'.repeat(44)}</chave></infNFe></infDoc></infCTeNorm></infCte></CTe></cteProc>`;

test('Entrega B: contratos HTTP, joins e gatilhos com Prisma/PostgreSQL descartável', { timeout: 120_000 }, async t => {
  const database = await apiSimulationDatabase(), prisma = database.client;
  let server;
  t.after(async () => { if (server) await new Promise(resolve => server.close(resolve)); await database.close(); });
  const user = await prisma.user.create({ data: { username: 'leader', name: 'Líder fictício', email: 'leader@example.test', passwordHash: 'synthetic', role: 'COORDINATOR' } });
  const other = await prisma.user.create({ data: { username: 'other', name: 'Outro', email: 'other@example.test', passwordHash: 'synthetic', role: 'COORDINATOR' } });
  const makeProject = code => prisma.project.create({ data: { code, name: 'Projeto fictício', clientName: 'Cliente', clientCnpj: '12345678000195', contractCode: 'ficticio', location: 'Itajaí' } });
  const p1 = await makeProject('00501'), p2 = await makeProject('00502');
  await prisma.projectWorkflow.create({ data: { projectId: p1.id, leaderUserId: user.id } });
  const romaneio = await prisma.romaneio.create({ data: { projectId: p1.id, type: 'OUTBOUND', romaneioDate: new Date('2026-10-01'), driverName: 'NÃO EXPOR', vehiclePlate: 'ABC1D23', cargoWeight: '1.125', cargoWeightUnit: 'ton', pdfUrl: '/private/a.pdf' } });
  const inbound = await prisma.romaneio.create({ data: { projectId: p1.id, type: 'INBOUND', romaneioDate: new Date('2026-10-02'), driverName: 'NÃO EXPOR', vehiclePlate: 'ABC1D23', pdfUrl: '/private/b.pdf' } });
  async function issue(scopes, { selected = true, writeMode = 'LIVE' } = {}) {
    const token = createApiToken({ key });
    const credential = await prisma.apiCredential.create({ data: { selector: token.selector, secretVerifier: token.verifier, secretLastFour: token.secretLastFour,
      hashKeyVersion: 1, name: 'Fictícia', purpose: 'Teste', recipientName: 'Omni', startsAt: new Date(0), createdByUserId: user.id, issuanceRequestId: randomUUID(),
      requestsPerMinute: 600, projectAccessMode: selected ? 'SELECTED' : 'ALL', writeMode,
      scopes: { create: scopes.map(scopeCode => ({ scopeCode, grantedByUserId: user.id })) }, ...(selected ? { projects: { create: { projectId: p1.id, grantedByUserId: user.id } } } : {}) } });
    return { token: token.token, credential };
  }
  const full = await issue(API_SCOPES.map(scope => scope.code));
  const base = await issue(['efetivo.projetos.medicao.read', 'eventos.read']);
  const noScope = await issue(['eventos.read']);
  const app = express();
  app.use(apiRequestContext(), createApiSimulationPreferenceResolver({ prismaClient: prisma, envConfig }), integrationApiBoundary(), express.json());
  app.use(createApiTokenAuthenticator({ prismaClient: prisma, envConfig }));
  app.use('/api/integracoes/v1', createOperationalRouter({ prismaClient: prisma, envConfig }));
  const errors = [];
  app.use((error, req, res, next) => { errors.push(error); next(error); });
  app.use(integrationApiErrorHandler);
  server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  const root = `http://127.0.0.1:${server.address().port}/api/integracoes/v1`;
  async function request(path, auth = full, body, headers = {}) {
    const res = await fetch(root + path, { method: body ? 'POST' : 'GET', headers: { authorization: `Bearer ${auth.token}`, ...(body ? { 'content-type': 'application/json' } : {}), ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const data = await res.json();
    assert.notEqual(res.status, 500, JSON.stringify({ data, errors: errors.map(error => error.stack) }));
    return { status: res.status, body: data, headers: res.headers };
  }
  await t.test('B1 sem medição, estados, decimais e finanças omitidas sem escopo', async () => {
    const path = `/efetivo/projetos/${p1.id}/medicao`;
    assert.equal((await request(path, base)).body.situacao, 'SEM_MEDICAO');
    assert.equal((await request(path, base)).body.saldoPendente, null);
    await prisma.projectWorkflowMeasurement.create({ data: { projectId: p1.id, preparedAt: new Date('2026-10-01'), executedAmount: '100.01', approvedAmount: '100.00' } });
    let result = await request(path, base);
    assert.equal(result.body.situacao, 'PREPARADA'); assert.equal(result.body.saldoPendente, true);
    assert.equal('executedAmount' in result.body, false); assert.equal('currency' in result.body, false);
    result = await request(path); assert.equal(result.body.executedAmount, '100.01'); assert.equal(result.body.currency, 'BRL');
    await prisma.projectWorkflowMeasurement.update({ where: { projectId: p1.id }, data: { sentAt: new Date('2026-10-02') } });
    assert.equal((await request(path)).body.situacao, 'ENVIADA');
    await prisma.projectWorkflowMeasurement.update({ where: { projectId: p1.id }, data: { approvedAt: new Date('2026-10-03'), approvedAmount: '100.01' } });
    assert.equal((await request(path)).body.situacao, 'APROVADA'); assert.equal((await request(path)).body.saldoPendente, false);
    const count = await prisma.integrationEvent.count({ where: { type: 'medicao.alterada' } });
    await prisma.projectWorkflowMeasurement.update({ where: { projectId: p1.id }, data: { evidenceNote: 'não publicada' } });
    assert.equal(await prisma.integrationEvent.count({ where: { type: 'medicao.alterada' } }), count);
    const rows = (await request('/efetivo/projetos/medicoes?projectCode=00501', base)).body;
    assert.equal(rows.items.length, 1); assert.equal(rows.items[0].projectId, p1.id);
    assert.equal((await request(`/efetivo/projetos/${p2.id}/medicao`)).status, 403);
  });
  await t.test('medição e eventos fazem rollback juntos', async () => {
    const previous = await prisma.projectWorkflowMeasurement.findUnique({ where: { projectId: p1.id } });
    const events = await prisma.integrationEvent.count();
    await assert.rejects(prisma.$transaction(async tx => {
      await tx.projectWorkflowMeasurement.update({ where: { projectId: p1.id }, data: { approvedAmount: '0.01' } });
      throw new Error('rollback fictício');
    }), /rollback fictício/);
    assert.equal(await prisma.integrationEvent.count(), events);
    assert.equal(String((await prisma.projectWorkflowMeasurement.findUnique({ where: { projectId: p1.id } })).approvedAmount), String(previous.approvedAmount));
  });
  await t.test('B2 ligação exata, paginação após recorte, remapeamento e primeira publicação', async () => {
    await prisma.omieProject.create({ data: { codigo: 'o1', projectId: p1.id } });
    await prisma.omieProject.create({ data: { codigo: 'o2', projectId: p2.id } });
    for (const [id, codigoProjeto] of [['NFSE:1','o1'], ['NFE:2','o1'], ['ND:3','o2'], ['NFSE:4','unknown']]) {
      await prisma.omieInvoice.create({ data: { id, codigoProjeto, source: id.split(':')[0], numero: id, dataEmissao: new Date('2026-10-01'), valor: '100.01', receiptStatus: 'OPEN', clienteCnpj: 'NÃO EXPOR' } });
    }
    const first = (await request('/omie/notas?limit=1')).body;
    assert.equal(first.items.length, 1); assert.equal(first.page.hasMore, true);
    const second = (await request('/omie/notas?limit=1&cursor=' + encodeURIComponent(first.page.nextCursor))).body;
    assert.equal(second.items.length, 1); assert.notEqual(first.items[0].id, second.items[0].id); assert.equal(second.page.hasMore, false);
    assert.ok([...first.items,...second.items].every(row => row.projectId === p1.id && !('clienteCnpj' in row)));
    const before = await prisma.omieInvoice.findUnique({ where: { id: 'NFSE:1' } });
    const emitted = await prisma.integrationEvent.count({ where: { type: 'nota.emitida' } });
    await prisma.omieInvoice.update({ where: { id: before.id }, data: { syncedAt: new Date() } });
    const after = await prisma.omieInvoice.findUnique({ where: { id: before.id } });
    assert.equal(+after.updatedAt, +before.updatedAt); assert.equal(await prisma.integrationEvent.count({ where: { type: 'nota.emitida' } }), emitted);
    await prisma.omieInvoice.update({ where: { id: before.id }, data: { receiptStatus: 'RECEIVED' } });
    assert.equal((await request('/omie/notas')).body.items.find(row => row.id === before.id).situacaoRecebimento, 'RECEBIDA');
    assert.equal(await prisma.integrationEvent.count({ where: { type: 'nota.recebimento_alterado' } }), 1);
    const since = new Date().toISOString();
    await prisma.omieProject.update({ where: { codigo: 'o2' }, data: { projectId: p1.id } });
    assert.ok((await request('/omie/notas?updatedSince='+encodeURIComponent(since))).body.items.some(row => row.id === 'ND:3'));
    await prisma.omieInvoice.delete({ where: { id: before.id } });
    const { updatedAt, ...data } = before;
    await prisma.omieInvoice.create({ data });
    assert.equal(await prisma.integrationEvent.count({ where: { type: 'nota.emitida', resourceId: before.id, projectId: p1.id } }), 1);
  });
  await t.test('snapshot fiscal repetido usa upsert em lote sem republicar nem avançar watermark', async () => {
    const call = async (_path, method) => method === 'ListarNFSEs'
      ? { nTotPaginas: 1, nTotRegistros: 1, nfseEncontradas: [{ Cabecalho: { nCodNF: 1, nNumeroNFSe: '1', nValorNFSe: 100, cStatusNFSe: 'F', cAmbienteNFSe: 'P' }, Adicionais: { nCodigoProjeto: 'o1' }, Emissao: { cDataEmissao: '01/10/2026' } }] }
      : method === 'ListarNF' ? { total_de_paginas: 1, total_de_registros: 0, nfCadastro: [] }
      : { total_de_paginas: 1, total_de_registros: 0, conta_receber_cadastro: [] };
    await syncOmieInvoices({ db: prisma, call });
    const first = await prisma.omieInvoice.findUnique({ where: { id: 'NFSE:1' } });
    const count = await prisma.integrationEvent.count({ where: { type: { in: ['nota.emitida','nota.recebimento_alterado'] } } });
    await syncOmieInvoices({ db: prisma, call });
    const second = await prisma.omieInvoice.findUnique({ where: { id: 'NFSE:1' } });
    assert.equal(+first.updatedAt,+second.updatedAt);
    assert.equal(await prisma.integrationEvent.count({ where: { type: { in: ['nota.emitida','nota.recebimento_alterado'] } } }),count);
  });
  await t.test('B3 retorno emitido, contagem sincronizável e projeção mínima', async () => {
    await prisma.romaneioItem.create({ data: { romaneioId: inbound.id, itemName: 'Equipamento fictício', categoryName: 'Equipamento', quantity: '2', unitLabel: 'un' } });
    const items = (await request('/romaneios')).body.items;
    assert.equal(items.length, 2); assert.equal(items.find(row => row.id === inbound.id).quantidadeItens, 1);
    assert.equal(items.find(row => row.id === inbound.id).tipo, 'RETORNO'); assert.ok(items.every(row => row.emitidoEm));
    assert.equal(JSON.stringify(items).includes('NÃO EXPOR'), false); assert.equal(JSON.stringify(items).includes('/private'), false);
  });
  await t.test('B4 agregados exatos, parcial desconhecido e zero após quitação/exclusão', async () => {
    const data = { projectId: p1.id, valor: '0.10', statusTitulo: 'ABERTO', rawPayload: {}, dataVencimento: new Date('2026-11-01') };
    await prisma.omiePurchase.create({ data: { ...data, omieId: 'purchase1' } });
    await prisma.omiePurchase.create({ data: { ...data, valor: '0.20', omieId: 'purchase2' } });
    await prisma.omiePurchase.create({ data: { ...data, projectId: p2.id, valor: '999', omieId: 'hidden' } });
    let row = (await request('/omie/projetos/pendencias')).body.items[0];
    assert.equal(row.aPagar.quantidade, 2); assert.equal(row.aPagar.valorEmAberto, '0.30'); assert.equal(row.aReceber.valorEmAberto, '0.00');
    await prisma.omieReceivable.create({ data: { ...data, omieId: 'partial', statusTitulo: 'RECEBIDO PARCIAL' } });
    row = (await request('/omie/projetos/pendencias')).body.items[0]; assert.equal(row.aReceber.valorEmAberto, null);
    await prisma.omieReceivable.update({ where: { omieId: 'partial' }, data: { rawPayload: { valor_em_aberto: '0.03' } } });
    row = (await request('/omie/projetos/pendencias')).body.items[0]; assert.equal(row.aReceber.valorEmAberto, '0.03');
    await prisma.omiePurchase.deleteMany({ where: { projectId: p1.id } });
    await prisma.omieReceivable.update({ where: { omieId: 'partial' }, data: { statusTitulo: 'RECEBIDO' } });
    row = (await request('/omie/projetos/pendencias')).body.items[0]; assert.equal(row.aPagar.valorEmAberto, '0.00'); assert.equal(row.aReceber.quantidade, 0);
  });
  await t.test('B5 CT-e separado, histórico, acesso, chave natural e idempotência', async () => {
    const calls = [];
    const cte = await importCte(prisma, romaneio.id, { omieId: '123', invoiceId: 'NFSE:1' }, user, async (...args) => { calls.push(args); return { cXmlCTe: cteXml, cNumCTe: '0010' }; });
    assert.equal(cte.transportadora, 'Transportadora fictícia'); assert.deepEqual(calls[0], ['/produtos/dfedocs/', 'ObterCTe', { nIdCTe: 123 }]);
    const body = { romaneioId: romaneio.id, tipo: 'PARCIAL', confirmadaEm: '2026-10-02T12:00:00Z', confirmadaPorEmail: user.email.toUpperCase() };
    const key = randomUUID(), headers = { 'Idempotency-Key': key };
    const wrong = await request('/logistica/descargas', full, { ...body, confirmadaPorEmail: other.email }, headers); assert.equal(wrong.status, 422);
    const hidden = await prisma.romaneio.create({ data: { projectId: p2.id, romaneioDate: new Date(), driverName: 'Fictício', vehiclePlate: 'ABC1D23' } });
    assert.equal((await request('/logistica/descargas', full, { ...body, romaneioId: hidden.id }, headers)).status, 403);
    assert.equal((await request('/logistica/descargas', noScope, body, headers)).status, 403);
    assert.equal((await request('/logistica/descargas', full, body)).status, 400);
    const before = await prisma.logisticsUnloading.count();
    const simulated = await request('/logistica/descargas', full, body, { ...headers, Prefer: 'validate-only' });
    assert.equal(simulated.status, 200); assert.equal(simulated.body.simulated, true); assert.equal('id' in simulated.body.would, false);
    assert.equal(await prisma.logisticsUnloading.count(), before);
    const partial = await request('/logistica/descargas', full, body, headers); assert.equal(partial.status, 201);
    assert.equal((await request('/logistica/descargas', full, body, headers)).body.id, partial.body.id);
    assert.equal((await request('/logistica/descargas', full, { ...body, tipo: 'TOTAL' }, headers)).status, 409);
    assert.equal((await request('/logistica/descargas', full, body, { 'Idempotency-Key': randomUUID() })).body.id, partial.body.id);
    const total = await request('/logistica/descargas', full, { ...body, tipo: 'TOTAL', confirmadaEm: '2026-10-03T12:00:00Z' }, { 'Idempotency-Key': randomUUID() });
    assert.equal(total.status, 201);
    assert.equal((await request('/logistica/descargas', full, { ...body, tipo: 'TOTAL', confirmadaEm: '2026-10-04T12:00:00Z' }, { 'Idempotency-Key': randomUUID() })).body.id, total.body.id);
    const history = (await request('/logistica/descargas')).body.items; assert.equal(history.length, 2); assert.equal(history[0].cte.numero, '0010');
    assert.equal(await prisma.integrationEvent.count({ where: { type: 'descarga.confirmada' } }), 2);
    assert.equal((await request('/logistica/descargas', full, { ...body, romaneioId: inbound.id }, { 'Idempotency-Key': randomUUID() })).status, 422);
    await prisma.user.update({ where: { id: user.id }, data: { isActive: false } });
    assert.equal((await request('/logistica/descargas', full, body, headers)).status, 422);
    await prisma.user.update({ where: { id: user.id }, data: { isActive: true } });
  });
  await t.test('todas as operações exigem escopo, recorte e feed autoriza cada família', async () => {
    for (const path of ['/efetivo/projetos/medicoes','/omie/notas','/romaneios','/omie/projetos/pendencias','/logistica/descargas']) {
      assert.equal((await request(path, noScope)).status, 403, path);
      assert.equal((await request(path+'?projectCode=00502')).status, 403, path);
    }
    assert.deepEqual((await request('/eventos', noScope)).body.items, []);
    assert.ok((await request('/eventos', base)).body.items.every(row => row.type === 'medicao.alterada'));
    const families = { 'omie.notas.read': ['nota.emitida','nota.recebimento_alterado'], 'romaneios.read': ['romaneio.emitido'],
      'omie.pendencias.read': ['pendencia.alterada'], 'logistica.descargas.read': ['descarga.confirmada'] };
    for (const [scope, types] of Object.entries(families)) {
      const auth = await issue([scope,'eventos.read']);
      const items = (await request('/eventos',auth)).body.items;
      assert.ok(items.length > 0,scope); assert.ok(items.every(row => row.projectId === p1.id && types.includes(row.type)),scope);
    }
    const playground = await executePlaygroundOperation(prisma, full.credential.id, { operationId: 'efetivo.projects.measurement.get', pathParams: { id: p1.id } }, { cursorKey: key });
    assert.equal(playground.response.status,200); assert.equal(playground.response.body.projectCode,p1.code);
  });
});

test('CT-e rejeita NF-e, entidades XML, campos ausentes e datas inválidas', () => {
  for (const cXmlCTe of ['<NFe/>','<!DOCTYPE cte><CTe/>',cteXml.replace('<mod>57</mod>','<mod>55</mod>'),cteXml.replace('2026-10-01T11:00:00-03:00','2026-02-31T11:00:00-03:00')]) {
    assert.throws(() => parseCte({ cXmlCTe }), error => error.code === 'INVALID_CTE');
  }
});
