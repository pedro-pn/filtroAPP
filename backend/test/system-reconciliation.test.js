import assert from 'node:assert/strict';
import test from 'node:test';
import { PassThrough, Readable, Writable } from 'node:stream';
import express from 'express';
import prisma from '../src/lib/prisma.js';
import { createSystemReconciliationRouter } from '../src/routes/resources/system-reconciliation.js';
import commercialRouter from '../src/routes/resources/acompanhamento-comercial.js';
import { getSystemReconciliation, linkReconciledMeasurement, linkReconciledMeasurements, measurementReconciliation } from '../src/lib/acompanhamento/system-reconciliation.js';
import { historicalFingerprint, historicalReportsAsServices } from '../src/lib/reports/historical-services.js';
import { nativeReportMeasurements, withNativeMeasurementLinks } from '../src/lib/acompanhamento/native-measurement-links.js';
import { addRealizedService, buildProgress, buildProgressHistory, isRealizedSourceReport, isServiceFinalized } from '../src/lib/acompanhamento/avanco.js';

function fixture() {
  const systems = ['a', 'b', 'old'].map(id => ({ id, projectId: 'p', equipment: 'UG 01', name: `Sistema ${id}`, aliases: [] }));
  const planned = [{ projectId: 'p', serviceType: 'TESTE_PRESSAO', weight: 100, systems: systems.slice(0, 2).map(system => ({
    projectSystemId: system.id, projectSystem: system, systemType: 'TUBULACAO', unit: 'M', diameter: '6', diameterUnit: 'pol', quantity: 100
  })) }];
  const reports = [1, 2].map((sequenceNumber, index) => {
    const report = { id: `h${sequenceNumber}`, projectId: 'p', reportType: 'RTP', sequenceNumber, reportDate: new Date(`2026-03-0${sequenceNumber}`), revision: 3,
      items: [{ serviceType: 'pressao', equipment: 'UG antiga', system: 'Nome antigo', diameter: '6', unit: index ? 'cm' : 'm', quantity: index ? 3000 : 20, projectSystemId: systems[index].id }] };
    return { ...report, fingerprint: historicalFingerprint(report), sourceFileName: 'historico.csv' };
  });
  const state = { systems, planned, reports, native: [], sources: [], writes: 0 };
  const client = {
    project: { findFirst: async ({ where }) => where.id === 'p' ? { id: 'p', code: '5719', name: 'Missão teste' } : null },
    projectPlannedService: { findMany: async ({ where }) => state.planned.filter(row => row.projectId === where.projectId) },
    projectServiceSystem: {
      findMany: async ({ where }) => systems.filter(system => system.projectId === where.projectId),
      findFirst: async ({ where }) => systems.find(system => system.id === where.id && system.projectId === where.projectId)
    },
    report: {
      findMany: async ({ include }) => include ? state.native : state.sources,
      findFirst: async ({ where }) => state.native.find(report => report.id === where.id && report.projectId === where.projectId)
    },
    reportMeasurementLink: {
      upsert: async ({ where, create, update }) => {
        const key = where.reportId_measurementKey;
        const report = state.native.find(report => report.id === key.reportId);
        const previous = report.measurementLinks.find(link => link.measurementKey === key.measurementKey);
        if (previous) Object.assign(previous, update);
        else report.measurementLinks.push({ ...create, id: `link-${state.writes}` });
        state.writes++;
      },
      deleteMany: async ({ where }) => {
        const report = state.native.find(report => report.id === where.reportId);
        report.measurementLinks = report.measurementLinks.filter(link => link.measurementKey !== where.measurementKey);
        state.writes++;
      }
    },
    historicalServiceReport: {
      findMany: async ({ where }) => state.reports.filter(report => report.projectId === where.projectId),
      findFirst: async ({ where }) => state.reports.find(report => report.id === where.id && report.projectId === where.projectId),
      findUnique: async ({ where }) => state.reports.find(report => report.id === where.id),
      updateMany: async ({ where, data }) => {
        const report = state.reports.find(report => report.id === where.id && report.projectId === where.projectId && report.revision === where.revision);
        if (!report) return { count: 0 };
        state.writes++; Object.assign(report, data, { revision: report.revision + 1 }); return { count: 1 };
      }
    },
    $transaction: async fn => {
      const before = structuredClone({ reports: state.reports, native: state.native, writes: state.writes });
      try { return await fn(client); } catch (error) { Object.assign(state, before); throw error; }
    }
  };
  return { state, client };
}

function progress(state) {
  const native = state.native.flatMap(report => report.services.map(service => ({ ...service, report })));
  const services = [...historicalReportsAsServices(state.reports, state.sources), ...withNativeMeasurementLinks(native)]
    .filter(service => isServiceFinalized(service) && isRealizedSourceReport(service.report));
  const realized = new Map(); services.forEach(service => addRealizedService(realized, service));
  return { current: buildProgress(state.planned, realized), history: buildProgressHistory(state.planned, services.map(service => ({ ...service, reportDate: service.report.reportDate }))) };
}

test('abrir a conciliação preserva integralmente dados, vínculos distintos, percentuais e curva histórica', async () => {
  const { state, client } = fixture();
  const original = structuredClone(state), before = progress(state);
  const result = await getSystemReconciliation(client, 'p');
  assert.deepEqual(result.reports.map(report => report.items[0].projectSystemId), ['a', 'b']);
  assert.deepEqual(result.reports.map(report => report.items[0].reconciliation.status), ['MATCHED', 'MATCHED']);
  assert.deepEqual(state, original);
  assert.deepEqual(progress(state), before);
  assert.equal(before.current.progressPct, 25);
  await assert.rejects(getSystemReconciliation(client, 'foreign'), error => error.statusCode === 404);
});

test('diagnóstico e destinos respeitam serviço, tipo, unidade, fração, meta global e prioridade da bitola exata', () => {
  const { state } = fixture();
  const item = state.reports[0].items[0];
  const status = (changes = {}, planned = state.planned, conflict = null) => measurementReconciliation({ ...item, ...changes }, planned, state.systems, conflict);
  assert.equal(status({ diameter: '152.4', diameterUnit: 'mm' }).status, 'DIAMETER_MISMATCH');
  assert.deepEqual(status({ diameter: '152.4', diameterUnit: 'mm' }).compatibleSystemIds, []);
  assert.equal(status({ serviceType: 'filtragem', diameter: '', unit: 'L' }).status, 'NO_SERVICE');
  assert.equal(status({ unit: 'L' }).status, 'MEASUREMENT_MISMATCH');
  assert.equal(status({ projectSystemId: 'old' }).status, 'NO_SYSTEM_SCOPE');
  assert.equal(status({ projectSystemId: 'missing' }).status, 'UNMATCHED');
  assert.equal(status({}, [], null).status, 'NO_SERVICE');
  assert.equal(status({}, state.planned, 'Fonte incompatível').status, 'SOURCE_CONFLICT');
  assert.deepEqual(status({}, state.planned, 'Fonte incompatível').compatibleSystemIds, []);
  const row = state.planned[0].systems[0];
  const scope = rows => [{ ...state.planned[0], systems: rows }];
  assert.equal(status({}, scope([{ ...row, quantity: 0 }])).status, 'NO_QUANTITY');
  assert.equal(status({ diameter: '1.5' }, scope([{ ...row, diameter: '1 1/2' }])).status, 'MATCHED');
  assert.equal(status({}, scope([{ ...row, projectSystemId: null }])).status, 'GLOBAL_SCOPE');
  assert.deepEqual(status({}, scope([{ ...row, projectSystemId: null }])).compatibleSystemIds, []);
  const exactWithoutGoal = scope([{ ...row, quantity: null }, { ...row, diameter: '', quantity: 100 }]);
  assert.equal(status({}, exactWithoutGoal).status, 'NO_QUANTITY');
  assert.deepEqual(status({}, exactWithoutGoal).compatibleSystemIds, []);
});

test('novos vínculos validam metas; vínculos antigos incompatíveis continuam visíveis e podem ser removidos', async () => {
  const { state, client } = fixture();
  state.reports[0].items[0].projectSystemId = 'old';
  const original = structuredClone(state.reports[0]);
  const listed = await getSystemReconciliation(client, 'p');
  assert.equal(listed.reports[0].items[0].projectSystemId, 'old');
  assert.equal(listed.reports[0].items[0].reconciliation.status, 'NO_SYSTEM_SCOPE');
  const input = { projectId: 'p', id: 'h1', itemIndex: 0, revision: 3, userId: 'manager' };
  await assert.rejects(linkReconciledMeasurement(client, { ...input, projectSystemId: 'old' }), /não possui meta/);
  await assert.rejects(linkReconciledMeasurement(client, { ...input, projectSystemId: 'foreign' }), /deste projeto/);
  assert.equal(state.writes, 0);
  await linkReconciledMeasurement(client, { ...input, projectSystemId: 'a' });
  assert.equal(state.reports[0].revision, 4);
  assert.equal(state.reports[0].fingerprint, original.fingerprint);
  assert.equal(state.reports[0].sourceFileName, original.sourceFileName);
  assert.deepEqual(state.reports[0].items[0], { ...original.items[0], projectSystemId: 'a' });
  await assert.rejects(linkReconciledMeasurement(client, { ...input, projectSystemId: 'b' }), error => error.statusCode === 409);
  await linkReconciledMeasurement(client, { ...input, revision: 4, projectSystemId: null });
  assert.equal(state.reports[0].items[0].projectSystemId, undefined);
  assert.equal(state.reports[1].items[0].projectSystemId, 'b');
  assert.equal(state.reports[0].fingerprint, original.fingerprint);
});

test('equivalências nunca substituem o vínculo individual; conflitos de fonte bloqueiam novos vínculos', async () => {
  const { state, client } = fixture();
  state.systems[1].aliases = [{ equipment: 'UG antiga', system: 'Nome antigo', serviceType: 'TESTE_PRESSAO' }];
  assert.equal((await getSystemReconciliation(client, 'p')).reports[0].items[0].reconciliation.matchedSystem.id, 'a');
  state.sources = [{ ...state.reports[0], services: [{ id: 'native' }], specialConditions: {} }];
  await assert.rejects(linkReconciledMeasurement(client, { projectId: 'p', id: 'h1', itemIndex: 0, projectSystemId: 'a', revision: 3 }), /já possui serviços/);
  assert.equal(state.writes, 0);
});

function dispatch(app, method, url, body, authenticated = true) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const req = new Readable({ read() { if (payload) this.push(payload); this.push(null); } });
    Object.assign(req, { method, url, headers: { ...(authenticated ? { authorization: 'Bearer reconciliation-test' } : {}), ...(payload ? { 'content-type': 'application/json', 'content-length': String(payload.length) } : {}) } });
    req.socket = new PassThrough(); req.socket.remoteAddress = '127.0.0.1';
    const chunks = [], headers = new Map();
    const res = new Writable({ write(chunk, _encoding, done) { chunks.push(Buffer.from(chunk)); done(); } });
    res.setHeader = (key, value) => headers.set(key.toLowerCase(), value);
    res.getHeader = key => headers.get(key.toLowerCase());
    res.removeHeader = key => headers.delete(key.toLowerCase());
    res.end = chunk => { if (chunk) chunks.push(Buffer.from(chunk)); resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString()) }); return res; };
    app.handle(req, res, reject);
  });
}
test('HTTP: gestor de Acompanhamento sem RDO pode conciliar; visualizador só lê e outros módulos não acessam', async t => {
  const { state, client } = fixture();
  const app = express(); app.use(express.json());
  app.use('/projetos/:projectId/conciliacao', createSystemReconciliationRouter(client));
  app.use('/comercial', commercialRouter);
  app.use((error, _req, res, _next) => res.status(error.statusCode || (error.name === 'ZodError' ? 400 : 500)).json({ error: error.message }));
  let role = 'ACOMPANHAMENTO_MANAGER';
  const original = prisma.userSession.findUnique;
  prisma.userSession.findUnique = async () => ({ id: 'session', expiresAt: new Date(Date.now() + 60000), user: {
    id: 'manager', username: 'test', name: 'Test', isActive: true, accountType: 'INTERNAL', role: 'COLLABORATOR', moduleRoles: [{ role }]
  } });
  t.after(() => { prisma.userSession.findUnique = original; });
  const root = '/projetos/p/conciliacao', route = `${root}/h1/items/0/system`;
  assert.equal((await dispatch(app, 'GET', root, undefined, false)).status, 401);
  assert.equal((await dispatch(app, 'GET', root)).status, 200);
  role = 'ACOMPANHAMENTO_VIEWER';
  assert.equal((await dispatch(app, 'GET', root)).status, 200);
  assert.equal((await dispatch(app, 'PUT', route, { projectSystemId: 'b', revision: 3 })).status, 403);
  assert.equal((await dispatch(app, 'PUT', `${root}/measurements`, { measurements: [{ source: 'HISTORICAL', reportId: 'h1', measurementKey: '0', revision: 3 }], projectSystemId: 'b' })).status, 403);
  role = 'RDO_MANAGER';
  assert.equal((await dispatch(app, 'GET', root)).status, 403);
  assert.equal((await dispatch(app, 'PUT', route, { projectSystemId: 'b', revision: 3 })).status, 403);
  assert.equal((await dispatch(app, 'PUT', `${root}/measurements`, { measurements: [{ source: 'HISTORICAL', reportId: 'h1', measurementKey: '0', revision: 3 }], projectSystemId: 'b' })).status, 403);
  for (const endpoint of ['revisoes', 'avanco', 'sistemas', 'conciliacao']) {
    assert.equal((await dispatch(app, 'GET', `/comercial/projetos/p/${endpoint}`)).status, 403, endpoint);
  }
  assert.equal((await dispatch(app, 'PATCH', '/comercial/projetos/p/cronograma', { startDate: '2026-03-01' })).status, 403);
  assert.equal(state.writes, 0);
  role = 'ACOMPANHAMENTO_MANAGER';
  assert.equal((await dispatch(app, 'PUT', route, { projectSystemId: 'old', revision: 3 })).status, 400);
  assert.equal((await dispatch(app, 'PUT', route, { projectSystemId: 'b', revision: 3 })).status, 200);
  assert.equal((await dispatch(app, 'PUT', route, { projectSystemId: 'a', revision: 3 })).status, 409);
  assert.equal((await dispatch(app, 'PUT', `${root}/h1/items/99/system`, { projectSystemId: 'a', revision: 4 })).status, 404);
  assert.equal((await dispatch(app, 'GET', '/projetos/foreign/conciliacao')).status, 404);
  assert.equal((await dispatch(app, 'PUT', `${root}/measurements`, { measurements: [], projectSystemId: 'a' })).status, 400);
  const batch = await dispatch(app, 'PUT', `${root}/measurements`, { measurements: [{ source: 'HISTORICAL', reportId: 'h1', measurementKey: '0', revision: 4 }], projectSystemId: 'a' });
  assert.equal(batch.status, 200);
  assert.deepEqual(batch.body, { saved: 1 });
  assert.equal(state.writes, 2);
});

function addNative(state) {
  state.systems[0].aliases = [{ equipment: 'UG antiga', system: 'Nome antigo', serviceType: 'TESTE_PRESSAO' }];
  state.native.push({ id: 'n1', projectId: 'p', reportType: 'RDO', sequenceNumber: 10, reportDate: new Date('2026-03-08'), updatedAt: new Date('2026-03-09'), specialConditions: {}, measurementLinks: [], services: [
    { id: 's1', serviceType: 'pressao', system: 'Nome antigo', finalized: true, extraData: { equipmentId: 'UG antiga', tubes: [
      { d: '6', c: 25 }, { d: '6', c: 75, lengthUnit: 'cm' }, { d: '16', unit: 'mm', c: 10 }
    ] } },
    { id: 'ongoing', serviceType: 'pressao', system: 'Nome antigo', finalized: false, extraData: { equipmentId: 'UG antiga', tubes: [{ d: '6', c: 50 }] } }
  ] });
  const derived = structuredClone(state.native[0]);
  Object.assign(derived, { id: 'derived', reportType: 'RTP', specialConditions: { parentRdoId: 'n1' } });
  derived.services.forEach(service => { service.id = `derived-${service.id}`; });
  state.native.push(derived);
}
const selected = (report, index = 0) => ({ source: report.source, reportId: report.id, revision: report.revision, measurementKey: report.items[index].measurementKey });

test('lista única inclui RDO finalizado, exclui derivados/em andamento e mantém exatamente o avanço anterior', async () => {
  const { state, client } = fixture(); addNative(state);
  const before = structuredClone(state), beforeProgress = progress(state);
  const result = await getSystemReconciliation(client, 'p');
  const native = result.reports.filter(report => report.source === 'REPORT');
  assert.equal(native.length, 1);
  assert.equal(native[0].items.length, 3);
  assert.deepEqual(native[0].items.map(item => item.quantity), [25, 0.75, 10]);
  assert.equal(native[0].items[0].reconciliation.matchedSystem.id, 'a');
  assert.equal(native[0].items[2].reconciliation.status, 'DIAMETER_MISMATCH');
  assert.deepEqual(state, before);
  assert.deepEqual(progress(state), beforeProgress);
  assert.equal(beforeProgress.current.progressPct, 37.9);
});

test('lote misto salva só linhas escolhidas, sem alterar RDO/PDF/aliases; também reflete na curva histórica', async () => {
  const { state, client } = fixture(); addNative(state);
  state.planned[0].systems[0].quantity = 40;
  const original = structuredClone(state.native[0]), aliases = structuredClone(state.systems), before = progress(state);
  const listed = await getSystemReconciliation(client, 'p');
  const native = listed.reports.find(report => report.id === 'n1');
  const historical = listed.reports.find(report => report.id === 'h1');
  const input = { projectId: 'p', projectSystemId: 'b', userId: 'manager', measurements: [selected(native), selected(historical)] };
  assert.deepEqual(await linkReconciledMeasurements(client, input), { saved: 2 });
  assert.equal(state.reports[0].items[0].projectSystemId, 'b');
  assert.deepEqual(state.native[0].services, original.services);
  assert.deepEqual(state.native[0].specialConditions, original.specialConditions);
  assert.equal(state.native[0].updatedAt.toISOString(), original.updatedAt.toISOString());
  assert.deepEqual(state.systems, aliases);
  const afterRows = nativeReportMeasurements(state.native[0]).filter(row => row.service.finalized);
  assert.equal(afterRows[0].measurement.projectSystemId, 'b');
  assert.equal(afterRows[1].measurement.projectSystemId, null);
  assert.notDeepEqual(progress(state).current, before.current);
  assert.notDeepEqual(progress(state).history, before.history);
  await assert.rejects(linkReconciledMeasurements(client, input), error => error.statusCode === 409);
  const fresh = (await getSystemReconciliation(client, 'p')).reports.find(report => report.id === 'n1');
  await linkReconciledMeasurements(client, { ...input, projectSystemId: null, measurements: [selected(fresh)] });
  assert.equal(state.native[0].measurementLinks.length, 0);
  assert.deepEqual(state.native[0].services, original.services);
});

test('lote inválido, duplicado, com outra missão ou revisão desatualizada não salva nenhuma linha', async () => {
  const { state, client } = fixture(); addNative(state);
  const listed = await getSystemReconciliation(client, 'p');
  const n = listed.reports.find(report => report.id === 'n1'), h = listed.reports.find(report => report.id === 'h1');
  const before = structuredClone(state);
  const input = measurements => ({ projectId: 'p', measurements, projectSystemId: 'b' });
  for (const measurements of [
    [selected(h), selected(n, 2)],
    [selected(h), { ...selected(n), reportId: 'foreign' }],
    [selected(h), { ...selected(n), revision: 'stale' }],
    [selected(h), selected(h)]
  ]) {
    await assert.rejects(linkReconciledMeasurements(client, input(measurements)));
    assert.deepEqual(state, before);
  }
});

test('identidade sobrevive à reordenação e à recriação de serviços; quantidades editadas não recebem vínculo antigo', async () => {
  const { state, client } = fixture(); addNative(state);
  const native = (await getSystemReconciliation(client, 'p')).reports.find(report => report.id === 'n1');
  await linkReconciledMeasurements(client, { projectId: 'p', projectSystemId: 'b', measurements: [selected(native)] });
  const report = state.native[0];
  report.services[0].id = 'new-service-id';
  report.services[0].extraData.tubes.reverse();
  assert.equal(nativeReportMeasurements(report).find(row => row.measurement.quantity === 25).measurement.projectSystemId, 'b');
  report.services[0].extraData.tubes.find(tube => tube.c === 25).c = 26;
  assert.equal(nativeReportMeasurements(report).find(row => row.measurement.quantity === 26).measurement.projectSystemId, null);
  const changed = (await getSystemReconciliation(client, 'p')).reports.find(item => item.id === 'n1');
  assert.equal(changed.unappliedLinks, 1);
  assert.equal(report.measurementLinks.length, 1);
});

test('adicionar ou remover repetições idênticas não transfere vínculos entre ocorrências ambíguas', () => {
  const { state } = fixture(); addNative(state);
  const report = state.native[0];
  const tube = report.services[0].extraData.tubes[0];
  report.services[0].extraData.tubes.push({ ...tube });
  const duplicates = nativeReportMeasurements(report).filter(row => row.measurement.quantity === 25);
  assert.equal(new Set(duplicates.map(row => row.measurementKey)).size, 2);
  report.measurementLinks.push({ id: 'linked-duplicate', measurementKey: duplicates[0].measurementKey, projectSystemId: 'b' });
  assert.equal(nativeReportMeasurements(report).filter(row => row.link).length, 1);
  report.services[0].extraData.tubes.pop();
  assert.equal(nativeReportMeasurements(report).filter(row => row.link).length, 0);
  assert.equal(report.measurementLinks.length, 1);
});
