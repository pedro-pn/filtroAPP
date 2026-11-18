import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

// Banco descartável com as migrations aplicadas e pasta de arquivos temporária;
// nunca executa contra o banco nem o volume do app.
test('retenção LGPD remove fotos e anexos de projeto encerrado há mais de 10 anos e respeita exceção', {
  skip: !process.env.LGPD_RETENTION_TEST_DATABASE_URL
}, async t => {
  const url = new URL(process.env.LGPD_RETENTION_TEST_DATABASE_URL);
  assert.match(url.pathname, /_test$/);
  process.env.DATABASE_URL = url.toString();
  const { default: prisma } = await import('../src/lib/prisma.js');
  const { runProjectFileRetention } = await import('../src/lib/privacy/project-file-retention.js');
  const { setRetentionHold, listRetentionHolds } = await import('../src/lib/privacy/retention-holds.js');

  const suffix = randomUUID().slice(0, 8);
  const reportsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lgpd-files-'));
  const projectIds = [];
  t.after(async () => {
    await prisma.dataRetentionHold.deleteMany({ where: { targetId: { in: projectIds } } });
    await prisma.report.deleteMany({ where: { projectId: { in: projectIds } } });
    await prisma.project.deleteMany({ where: { id: { in: projectIds } } });
    await prisma.$disconnect();
    await fs.rm(reportsDir, { recursive: true, force: true });
  });

  const now = new Date('2026-11-18T12:00:00Z');
  const makeProject = async (label, data) => {
    const project = await prisma.project.create({ data: {
      code: `LGPD${label}${suffix}`, name: `Projeto ${label}`, clientName: 'Cliente', clientCnpj: '',
      contractCode: '', location: '', isActive: false, acompanhamentoReportArchivedAt: new Date('2015-02-01'), ...data
    } });
    projectIds.push(project.id);
    return project;
  };
  const closed = await makeProject('A', {});
  const held = await makeProject('B', {});
  const recent = await makeProject('C', { acompanhamentoReportArchivedAt: new Date('2022-01-01') });

  const writeFile = async relative => {
    const target = path.join(reportsDir, ...relative.split('/'));
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, 'x');
    return target;
  };
  const makeReport = async project => {
    const folder = `Missão ${project.code} - ${project.name}`;
    const photo = `${folder}/RDO/foto-${suffix}.jpg`;
    const servicePhoto = `${folder}/RDO/servico-${suffix}.png`;
    const pdfStorage = `report-pdf-attachments/${project.id}/anexo.pdf`;
    const report = await prisma.report.create({ data: {
      projectId: project.id, reportDate: new Date('2015-01-20'), arrivalTime: '07:00', departureTime: '17:00',
      lunchBreak: '01:00', daytimeCount: 1,
      specialConditions: { generalUploads: [`/relatorios/${encodeURI(photo)}`], observacao: 'mantida' },
      services: { create: [{ serviceType: 'FILTRAGEM', extraData: { __uploads__: [{ label: 'Fotos', files: [servicePhoto] }] } }] },
      pdfAttachments: { create: [{ fileName: 'anexo.pdf', storagePath: pdfStorage, sizeBytes: 1, pageCount: 1 }] }
    }, include: { services: true } });
    await prisma.reportAttachment.create({ data: {
      reportId: report.id, label: 'Fotos de registro', fileName: 'foto.jpg', mimeType: 'image/jpeg', storagePath: photo
    } });
    return {
      report,
      files: [await writeFile(photo), await writeFile(servicePhoto), await writeFile(pdfStorage)]
    };
  };
  const closedData = await makeReport(closed);
  const heldData = await makeReport(held);
  const recentData = await makeReport(recent);

  const hold = await setRetentionHold(prisma, { kind: 'project', code: held.code, hold: true, reason: 'Contrato exige 15 anos' });
  assert.equal(hold.hold, true);
  assert.equal((await listRetentionHolds(prisma)).projects.some(item => item.code === held.code), true);
  // O motivo não aparece numa leitura genérica do projeto.
  assert.equal('reason' in await prisma.project.findUnique({ where: { id: held.id } }), false);

  const totals = await runProjectFileRetention({ prismaClient: prisma, now, reportsDir, onlyIds: projectIds, logger: { warn() {} } });
  assert.equal(totals.projectsFilesPurged, 1);
  assert.equal(totals.filesDeleted, 3);

  const after = await prisma.report.findUnique({ where: { id: closedData.report.id }, include: { services: true, pdfAttachments: true } });
  assert.deepEqual(after.specialConditions, { generalUploads: [], observacao: 'mantida' });
  assert.deepEqual(after.services[0].extraData, { __uploads__: [{ label: 'Fotos', files: [] }] });
  assert.equal(after.pdfAttachments.length, 0);
  assert.equal(await prisma.reportAttachment.count({ where: { reportId: closedData.report.id } }), 0);
  for (const file of closedData.files) await assert.rejects(fs.access(file));
  assert.ok((await prisma.project.findUnique({ where: { id: closed.id } })).filesRetentionPurgedAt);

  for (const data of [heldData, recentData]) {
    for (const file of data.files) await fs.access(file);
    assert.equal(await prisma.reportPdfAttachment.count({ where: { reportId: data.report.id } }), 1);
  }

  const again = await runProjectFileRetention({ prismaClient: prisma, now, reportsDir, onlyIds: projectIds });
  assert.equal(again.projectsFilesPurged, 0);
});
