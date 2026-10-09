import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

// Smoke ponta a ponta (sem o clique no navegador): diálogo → revisão → geração → job no worker
// com o gerador Python real → PDF salvo no projeto e baixado. Precisa de PostgreSQL e do Python
// do gerador (DATABOOK_PYTHON); no CI os dois existem.
const banco = process.env.DATABOOK_TEST_DATABASE_URL;
const python = process.env.DATABOOK_PYTHON || 'python3';
const pythonPronto = spawnSync(python, ['-c', 'import reportlab, pypdf, PIL'], { encoding: 'utf8' }).status === 0;

test('Data Book: HTTP + PostgreSQL + gerador Python, do diálogo ao PDF salvo no projeto', {
  skip: !banco ? 'DATABOOK_TEST_DATABASE_URL ausente' : !pythonPronto ? 'Python do Data Book não instalado' : false
}, async t => {
  const url = new URL(banco);
  assert.match(url.hostname, /^(localhost|127\.0\.0\.1)$/);
  assert.ok(url.pathname.endsWith('_test') || (process.env.CI === 'true' && url.pathname === '/filtrovali'));
  process.env.DATABASE_URL = url.toString();
  const uploadDir = await fs.mkdtemp(path.join(os.tmpdir(), 'databook-int-'));
  process.env.REPORTS_DIR = uploadDir;

  const { default: prisma } = await import('../src/lib/prisma.js');
  const { default: app } = await import('../src/app.js');
  const { processarFilaDatabook } = await import('../src/lib/databook/jobs.js');
  const { createStockItemDocument } = await import('../src/lib/estoque/stock-attachments.js');
  const { createCalibrationCertificate } = await import('../src/lib/calibration-certificates.js');

  const sufixo = randomUUID().slice(0, 8);
  const pdf = await fs.readFile(new URL('../databook/exemplo/certificados/CERT_MAN-012.pdf', import.meta.url));
  const upload = nome => ({ fileName: `${nome}.pdf`, dataUrl: `data:application/pdf;base64,${pdf.toString('base64')}` });
  const criados = { users: [], projectId: null, stockItemId: null, manometerId: null };
  let server;
  t.after(async () => {
    if (server) await new Promise(resolve => server.close(resolve));
    if (criados.projectId) {
      await prisma.projectDatabook.deleteMany({ where: { projectId: criados.projectId } });
      await prisma.report.deleteMany({ where: { projectId: criados.projectId } });
      await prisma.project.delete({ where: { id: criados.projectId } });
    }
    if (criados.stockItemId) await prisma.stockItem.delete({ where: { id: criados.stockItemId } });
    if (criados.manometerId) await prisma.manometer.delete({ where: { id: criados.manometerId } });
    await prisma.user.deleteMany({ where: { id: { in: criados.users } } });
    await prisma.$disconnect();
    await fs.rm(uploadDir, { recursive: true, force: true });
  });

  const tokens = {};
  for (const role of ['RDO_MANAGER', 'RDO_COLLABORATOR']) {
    const user = await prisma.user.create({ data: {
      username: `databook-${role}-${sufixo}`, name: `Usuário ${role}`, passwordHash: 'test-only', role: 'COLLABORATOR',
      accountType: 'INTERNAL', moduleRoles: { create: { module: 'RDO', role } }
    } });
    criados.users.push(user.id);
    tokens[role] = randomUUID();
    await prisma.userSession.create({ data: { userId: user.id, tokenHash: createHash('sha256').update(tokens[role]).digest('hex'), expiresAt: new Date(Date.now() + 600_000) } });
  }

  const projeto = await prisma.project.create({ data: {
    code: `DB${sufixo}`, name: 'Projeto Data Book', clientName: 'Cliente teste', clientCnpj: '00000000000100',
    contractCode: '9999 REV 0', location: 'Macaé, RJ',
    plannedServices: { create: { serviceType: 'LIMPEZA_QUIMICA', weight: 1, systems: { create: { systemType: 'TUBULACAO', quantity: 100, unit: 'M' } } } }
  } });
  criados.projectId = projeto.id;

  const item = await prisma.stockItem.create({ data: {
    type: 'PRODUTO_QUIMICO', code: `ACID-${sufixo}`, name: 'Ácido Cítrico Fino Granulado', unitLabel: 'kg',
    manufacturer: 'BSC Química Ltda.', fdsSynonyms: ['Ácido cítrico'], fdsCode: 'DT-LAB-100', fdsRevision: '05'
  } });
  criados.stockItemId = item.id;
  await createStockItemDocument(prisma, { itemId: item.id, upload: upload('FDS acido') });
  const manometro = await prisma.manometer.create({ data: {
    code: `MAN-${sufixo}`, scale: '0 a 400 bar', calibrationCertCode: 'CAL-1', calibratedAt: new Date('2026-03-12'), expiresAt: new Date('2027-03-12')
  } });
  criados.manometerId = manometro.id;
  const certificado = await createCalibrationCertificate(prisma, { equipmentType: 'MANOMETER', manometerId: manometro.id, upload: upload('CAL-1') });

  const fotoRel = `Missão ${projeto.code} - ${projeto.name}/RDO/foto-1.jpg`;
  await fs.mkdir(path.dirname(path.join(uploadDir, fotoRel)), { recursive: true });
  const { default: sharp } = await import('sharp');
  await sharp({ create: { width: 640, height: 480, channels: 3, background: { r: 40, g: 80, b: 60 } } }).jpeg().toFile(path.join(uploadDir, fotoRel));

  const rdoBase = { projectId: projeto.id, reportType: 'RDO', status: 'APPROVED', arrivalTime: '07:00', departureTime: '17:00', lunchBreak: '01:00', daytimeCount: 4 };
  const rdo1 = await prisma.report.create({ data: { ...rdoBase, sequenceNumber: 1, reportDate: new Date('2026-10-01T12:00:00Z'),
    dailyDescription: '07:30 - Limpeza química da linha L-101.',
    specialConditions: { generalUploads: [{ url: `/relatorios/${fotoRel}` }], dds: { diurno: { enabled: true, inicio: '07:00', termino: '07:15', temas: ['EPI'] } } },
    services: { create: { serviceType: 'limpeza', finalized: true, extraData: { tubes: [{ d: '1', unit: 'pol', c: '40', lengthUnit: 'm' }], drawingsTags: 'L-101', etapas: ['Fase ácida'], aprovadoCliente: 'Sim' } } } },
  include: { services: true } });
  const rdo2 = await prisma.report.create({ data: { ...rdoBase, sequenceNumber: 2, reportDate: new Date('2026-10-02T12:00:00Z'),
    dailyDescription: 'Teste de pressão da linha L-101.',
    services: { create: { serviceType: 'pressao', finalized: true, extraData: { tubes: [{ d: '1', unit: 'pol', c: '40', lengthUnit: 'm' }], drawingsTags: 'L-101', aprovadoCliente: 'Sim' } } } },
  include: { services: true } });
  await prisma.report.create({ data: { ...rdoBase, reportType: 'RLQ', sequenceNumber: 1, reportDate: rdo1.reportDate,
    specialConditions: { parentRdoId: rdo1.id, serviceId: rdo1.services[0].id, serviceData: { 'Desenhos / TAGs': 'L-101', 'Aprovado pelo cliente?': 'Sim' } } } });
  await prisma.report.create({ data: { ...rdoBase, reportType: 'RTP', sequenceNumber: 1, reportDate: rdo2.reportDate,
    specialConditions: { parentRdoId: rdo2.id, serviceId: rdo2.services[0].id,
      serviceData: { 'Desenhos / TAGs': 'L-101', 'Aprovado pelo cliente?': 'Sim', 'Pressão de trabalho': '210 bar', 'Pressão de teste': '315 bar' },
      resolvedManometers: [{ code: manometro.code, scale: '0 a 400 bar', certCode: 'CAL-1', calibratedAt: '2026-03-12', expiresAt: '2027-03-12', certificate: { id: certificado.id } }] } } });

  server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  const pedir = async (caminho, { body, role = 'RDO_MANAGER', method = body ? 'POST' : 'GET' } = {}) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/rdo/databook${caminho}`, {
      method, headers: { authorization: `Bearer ${tokens[role]}`, 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined
    });
    const tipo = response.headers.get('content-type') || '';
    return { status: response.status, tipo, body: tipo.includes('json') ? await response.json() : Buffer.from(await response.arrayBuffer()) };
  };

  assert.equal((await pedir(`/projects/${projeto.id}/intervalo`, { role: 'RDO_COLLABORATOR' })).status, 403);

  const dialogo = await pedir(`/projects/${projeto.id}/intervalo`);
  assert.equal(dialogo.status, 200);
  assert.deepEqual(dialogo.body.padrao, { inicio: '2026-10-01', fim: '2026-10-02' });
  assert.equal(dialogo.body.resumo.rlq, 1);
  assert.equal(dialogo.body.resumo.rtp, 1);
  assert.equal(dialogo.body.resumo.fds, 1);
  assert.equal((await pedir(`/projects/${projeto.id}/revisao`, { body: { inicio: '2026-09-30', fim: '2026-10-02' } })).status, 400);

  const revisao = await pedir(`/projects/${projeto.id}/revisao`, { body: dialogo.body.padrao });
  assert.equal(revisao.status, 200);
  assert.equal(revisao.body.documento.doc, `DB-${projeto.code}-01`);
  assert.equal(revisao.body.dados.fds.length, 1);
  assert.equal(revisao.body.dados.certificados.length, 1);
  assert.ok(Array.isArray(revisao.body.avisos));

  const gerar = await pedir(`/projects/${projeto.id}/gerar`, { body: { ...dialogo.body.padrao, edicoes: {
    servico: 'Limpeza Química e Teste de Pressão', aprovacoes: { elaborado: { userId: criados.users[0] } }
  } } });
  assert.equal(gerar.status, 202);
  assert.equal(gerar.body.status, 'PENDING');

  await processarFilaDatabook({ client: prisma });
  const status = await pedir(`/revisoes/${gerar.body.id}`);
  assert.equal(status.body.status, 'COMPLETED', status.body.erro || '');
  assert.ok(status.body.paginas > 6);
  const baixado = await pedir(`/revisoes/${gerar.body.id}/pdf`);
  assert.equal(baixado.status, 200);
  assert.equal(baixado.body.subarray(0, 4).toString(), '%PDF');
  const salvo = await prisma.projectDatabookRevision.findUnique({ where: { id: gerar.body.id } });
  await fs.access(path.join(uploadDir, ...salvo.storagePath.split('/')));

  // nova geração do mesmo intervalo = mesma numeração, revisão seguinte
  const rev1 = await pedir(`/projects/${projeto.id}/gerar`, { body: { ...dialogo.body.padrao, edicoes: {} } });
  assert.equal(rev1.body.revisao, 1);
  assert.equal(rev1.body.doc, `DB-${projeto.code}-01`);
  const lista = await pedir(`/projects/${projeto.id}`);
  assert.deepEqual(lista.body[0].revisoes.map(r => r.revisao), [1, 0]);
});
