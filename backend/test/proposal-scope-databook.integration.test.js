import assert from 'node:assert/strict';
import { createHash, randomInt, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import prisma from '../src/lib/prisma.js';
import { additionalPayload, rawHours } from './helpers/commercial-additional-fixture.js';
import { setProjectBudgetRevision } from '../src/lib/acompanhamento/access-import.js';
import { receiveCommercialAppProposal } from '../src/lib/acompanhamento/comercialapp-bridge.js';
import { assignReportContribution, contributionServiceKey } from '../src/lib/acompanhamento/proposal-scopes.js';
import { getProposalScopeTracking } from '../src/lib/acompanhamento/proposal-scope-tracking.js';
import { montarDadosDatabook } from '../src/lib/databook/montar-dados.js';
import { criarPrevia, listarDatabooks, prepararEdicao, prepararRevisao, solicitarGeracao } from '../src/lib/databook/service.js';
import { gerarPdf } from '../src/lib/databook/python.js';
const databaseUrl = process.env.PROPOSAL_SCOPE_TEST_DATABASE_URL || process.env.TEST_DATABASE_URL;
const python = process.env.DATABOOK_PYTHON || 'python3';
const pythonReady = spawnSync(python, ['-c', 'import reportlab, pypdf, PIL'], { encoding: 'utf8' }).status === 0;
const tube = (tag, quantity) => ({ serviceType: 'pressao', finalized: true, system: 'Mesmo sistema', extraData: {
  equipmentId: 'Mesmo equipamento', drawingsTags: tag, tubes: [{ d: '2', unit: 'pol', c: String(quantity), lengthUnit: 'm' }]
} });

test('escopo independente: PostgreSQL, fontes mistas, RDO misto, histórico e PDF real', { skip: !databaseUrl }, async t => {
  assert.ok(new URL(databaseUrl).pathname === '/filtroapp_bridge_test' || process.env.CI === 'true' && new URL(databaseUrl).pathname === '/filtrovali');
  assert.equal(process.env.DATABASE_URL, databaseUrl);
  const code = randomInt(30_000_000, 40_000_000), externalIds = [], userIds = [];
  let server;
  const project = await prisma.project.create({ data: { code: `scope-${randomUUID()}`, name: 'Escopos QA', clientName: 'Cliente QA',
    clientCnpj: '12345678000190', contractCode: String(code), commercialProposalCode: String(code), location: 'Sede' } });
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'proposal-book-'));
  t.after(async () => {
    if (server) await new Promise(resolve => server.close(resolve));
    await prisma.projectDatabook.deleteMany({ where: { projectId: project.id } });
    await prisma.report.deleteMany({ where: { projectId: project.id } });
    await prisma.commercialAppDelivery.deleteMany({ where: { externalId: { in: externalIds } } });
    await prisma.project.delete({ where: { id: project.id } });
    await prisma.commercialProposal.deleteMany({ where: { codProp: code } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect(); await fs.rm(temp, { recursive: true, force: true });
  });
  await prisma.commercialProposal.create({ data: { codBd: code, codProp: code, salePrice: 100_000, plannedCost: 60_000,
    clientCnpj: project.clientCnpj, rawRow: rawHours(1000), isComplete: true } });
  await setProjectBudgetRevision(project.id, code);
  await prisma.projectPlannedService.create({ data: { projectId: project.id, serviceType: 'TESTE_PRESSAO', weight: 1,
    scopeName: 'Teste de pressão', systems: { create: { systemType: 'TUBULACAO', quantity: 100, unit: 'M' } } } });
  for (const [number, sale] of [[code + 1, 20_000], [code + 2, 5_000]]) {
    const payload = additionalPayload(project.id, code, number, 0, sale);
    externalIds.push(payload.proposalId); await receiveCommercialAppProposal(payload);
  }
  const main = `ACCESS_IMPORT:${code}`, a = `COMERCIAL_APP:${code + 1}`, b = `COMERCIAL_APP:${code + 2}`;
  const previous = await prisma.report.create({ data: { projectId: project.id, arrivalTime: '07:00', departureTime: '17:00', lunchBreak: '01:00', daytimeCount: 1, reportType: 'RDO', status: 'APPROVED', sequenceNumber: 1,
    reportDate: new Date('2026-10-18'), dailyDescription: 'ATIVIDADE ANTERIOR', services: { create: [tube('ANTERIOR-A', 5)] } } });
  const mixed = await prisma.report.create({ data: { projectId: project.id, arrivalTime: '07:00', departureTime: '17:00', lunchBreak: '01:00', daytimeCount: 1, reportType: 'RDO', status: 'APPROVED', sequenceNumber: 2,
    reportDate: new Date('2026-10-19'), dailyDescription: 'SERVICO EXCLUSIVO MAE', specialConditions: { generalUploads: [{ url: '/relatorios/mae.jpg' }] },
    services: { create: [tube('SOMENTE-MAE', 100), tube('SOMENTE-ADICIONAL-A', 15), tube('SOMENTE-ADICIONAL-B', 5)] } }, include: { services: true } });
  for (const [i, service] of mixed.services.entries()) await prisma.report.create({ data: { projectId: project.id, arrivalTime: '07:00', departureTime: '17:00', lunchBreak: '01:00', daytimeCount: 1, reportType: 'RTP', status: 'APPROVED', sequenceNumber: i + 1,
    reportDate: new Date('2026-10-19'), specialConditions: { parentRdoId: mixed.id, serviceId: service.id, serviceData: { 'Desenhos / TAGs': service.extraData.drawingsTags } } } });
  const before = await getProposalScopeTracking(project.id);
  assert.equal(before.pending, 4);
  const stale = before.services.find(s => s.reportId === mixed.id);
  await t.test('HTTP: leitura autorizada, escrita de gestor e conflito entre vínculos concorrentes', async () => {
    const { default: app } = await import('../src/app.js');
    server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const tokens = {};
    for (const role of ['ACOMPANHAMENTO_MANAGER', 'ACOMPANHAMENTO_VIEWER']) {
      const user = await prisma.user.create({ data: { username: `scope-${randomUUID()}`, name: 'Escopo QA', role: 'COLLABORATOR',
        passwordHash: 'synthetic', accountType: 'INTERNAL', moduleRoles: { create: [{ module: 'ACOMPANHAMENTO', role }, ...(role.endsWith('MANAGER') ? [{ module: 'RDO', role: 'RDO_MANAGER' }] : [])] } } });
      userIds.push(user.id); const token = randomUUID(); tokens[role] = token;
      await prisma.userSession.create({ data: { userId: user.id, tokenHash: createHash('sha256').update(token).digest('hex'), expiresAt: new Date(Date.now() + 600_000) } });
    }
    const url = `http://127.0.0.1:${server.address().port}/api/acompanhamento/comercial/projetos/${project.id}/escopos-propostas`;
    assert.equal((await fetch(url)).status, 401);
    const headers = role => ({ Authorization: `Bearer ${tokens[role]}`, 'Content-Type': 'application/json' });
    assert.equal((await fetch(url, { headers: headers('ACOMPANHAMENTO_VIEWER') })).status, 200);
    const body = row => JSON.stringify({ serviceKey: row.serviceKey, version: row.version, contributionKey: a, reason: 'Conferência por HTTP' });
    assert.equal((await fetch(`${url}/${mixed.id}`, { method: 'PUT', headers: headers('ACOMPANHAMENTO_VIEWER'), body: body(stale) })).status, 403);
    const mixedRows = before.services.filter(row => row.reportId === mixed.id).slice(0, 2);
    const responses = await Promise.all(mixedRows.map(row => fetch(`${url}/${mixed.id}`, { method: 'PUT', headers: headers('ACOMPANHAMENTO_MANAGER'), body: body(row) })));
    assert.deepEqual(responses.map(response => response.status).sort(), [200, 409]);
    const dialog = await fetch(`http://127.0.0.1:${server.address().port}/api/rdo/databook/projects/${project.id}/intervalo?contributionKey=${encodeURIComponent(a)}`, { headers: headers('ACOMPANHAMENTO_MANAGER') });
    assert.equal(dialog.status, 200);
    assert.equal((await dialog.json()).propostas.length, 3);
  });

  for (const row of before.services) {
    const fresh = (await getProposalScopeTracking(project.id)).services.find(s => s.reportId === row.reportId && s.serviceKey === row.serviceKey);
    const actual = mixed.services.find(s => contributionServiceKey(s) === row.serviceKey);
    const target = row.reportId === previous.id ? a : actual.extraData.drawingsTags.endsWith('-A') ? a : actual.extraData.drawingsTags.endsWith('-B') ? b : main;
    await assignReportContribution(project.id, row.reportId, { serviceKey: row.serviceKey, version: fresh.version, contributionKey: target, reason: 'Conferência operacional' }, null);
  }
  await assert.rejects(() => assignReportContribution(project.id, mixed.id, { ...stale, contributionKey: b, reason: 'Conflito' }, null), { status: 409 });
  assert.equal((await prisma.report.findUnique({ where: { id: mixed.id } })).updatedAt.toISOString(), mixed.updatedAt.toISOString(), 'vínculo operacional não altera a versão formal do relatório assinado');
  const linked = await getProposalScopeTracking(project.id);
  assert.equal(linked.pending, 0);
  assert.equal(linked.scopes.find(s => s.key === a).progress.services[0].systems[0].realizedQty, 20);
  const mounted = await montarDadosDatabook(project.id, '2026-10-19', '2026-10-19', { contributionKey: a });
  assert.equal(mounted.dados.escopo_total, 20);
  assert.equal(mounted.dados.acumulado_inicial, 5);
  assert.equal(mounted.dados.dias[0].servicos.length, 1);
  assert.equal(mounted.dados.dias[0].servicos[0].tags, 'SOMENTE-ADICIONAL-A');
  assert.equal(mounted.dados.dias[0].servicos[0].concluidas, 15);
  assert.deepEqual(mounted.dados.dias[0].atividades, []);
  assert.deepEqual(mounted.dados.dias[0].fotos, []);
  const prepared = await prepararRevisao(project.id, { inicio: '2026-10-19', fim: '2026-10-19', contributionKey: a }, { gerarAvisos: async () => [], ortografia: async () => ({ disponivel: false, palavras: [] }) });
  const docs = [];
  for (const contributionKey of [a, main, 'ALL']) docs.push(await solicitarGeracao(project.id, { inicio: '2026-10-19', fim: '2026-10-19', contributionKey }, null));
  assert.equal(new Set(docs.map(doc => doc.databook.docNumber)).size, 3);
  assert.deepEqual(docs.map(doc => doc.revision), [0, 0, 0]);
  assert.equal((await listarDatabooks(project.id)).length, 3);
  const payload = additionalPayload(project.id, code, code + 1, 1, 25_000);
  externalIds.push(payload.proposalId); await receiveCommercialAppProposal(payload);
  await assert.rejects(() => criarPrevia(project.id, { inicio: '2026-10-19', fim: '2026-10-19', contributionKey: a, scopeVersion: prepared.proposta.version }, { id: 'qa' }), { status: 409 });
  await prisma.projectDatabookRevision.update({ where: { id: docs[0].id }, data: { status: 'COMPLETED' } });
  const editing = await prepararEdicao(docs[0].id);
  assert.equal(editing.proposta.revision, 0);
  assert.equal(editing.dados.escopo_total, 20);
  assert.equal(editing.documento.rev, 1);
  const next = await solicitarGeracao(project.id, { inicio: '2026-10-19', fim: '2026-10-19', contributionKey: a }, null);
  assert.equal(next.revision, 1); assert.equal(next.input.escopo_total, 25);
  assert.equal(next.scopeSnapshot.revision, 1); assert.equal(next.databook.id, docs[0].databook.id);
  await t.test('PDF real contém apenas a proposta A', { skip: !pythonReady }, async () => {
    const pdf = path.join(temp, 'adicional-a.pdf');
    assert.ok((await gerarPdf(docs[0].input, pdf)).paginas > 0);
    const extracted = spawnSync(python, ['-c', 'from pypdf import PdfReader; import sys; print("\\n".join(p.extract_text() for p in PdfReader(sys.argv[1]).pages))', pdf], { encoding: 'utf8' });
    assert.equal(extracted.status, 0, extracted.stderr);
    assert.match(extracted.stdout, /SOMENTE-ADICIONAL-A/);
    assert.doesNotMatch(extracted.stdout, /SOMENTE-MAE|SOMENTE-ADICIONAL-B|SERVICO EXCLUSIVO MAE/);
    assert.match(extracted.stdout, new RegExp(String(code + 1)));
  });
});
