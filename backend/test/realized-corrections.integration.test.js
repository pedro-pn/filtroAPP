import assert from 'node:assert/strict';
import { test } from 'node:test';

import prisma from '../src/lib/prisma.js';
import { computeProjectProgress, computeProgressHistoryForProjects } from '../src/lib/acompanhamento/avanco.js';
import { listRealizedCorrections, saveRealizedCorrection } from '../src/lib/acompanhamento/realized-corrections-store.js';
import { setPlannedScope } from '../src/lib/acompanhamento/planned-scope.js';

const testDatabase = (() => {
  try { return new URL(process.env.DATABASE_URL).pathname.endsWith('_test'); } catch { return false; }
})();
test.after(async () => { await prisma.$disconnect(); });

test('correção diária persiste revisões e alimenta avanço atual e histórico', { skip: !testDatabase }, async () => {
  const project = await prisma.project.create({ data: {
    code: `CORR${Date.now()}`, name: 'Teste de conciliação', clientName: 'Cliente teste',
    clientCnpj: '00.000.000/0001-00', contractCode: 'TESTE', location: 'Teste'
  } });
  let report;
  try {
    await prisma.projectPlannedService.create({ data: {
      projectId: project.id, serviceType: 'TESTE_PRESSAO', weight: 1,
      systems: { create: [{ systemType: 'TUBULACAO', quantity: 100, unit: 'M' }] }
    } });
    report = await prisma.report.create({ data: {
      projectId: project.id, reportType: 'RDO', status: 'APPROVED',
      reportDate: new Date('2026-08-01T00:00:00.000Z'),
      arrivalTime: '08:00', departureTime: '17:00', lunchBreak: '01:00', daytimeCount: 1,
      services: { create: [{ serviceType: 'pressao', finalized: true,
        extraData: { tubes: [{ c: '100', lengthUnit: 'm' }] } }] }
    }, include: { services: true } });
    assert.equal((await computeProjectProgress(project.id)).progressPct, 100);
    const input = { date: '2026-08-01', serviceType: 'TESTE_PRESSAO', reason: 'Conferido com o responsável pela obra.',
      expectedSourceMeters: 100, reference: 'Planilha validada' };
    const first = await saveRealizedCorrection(project.id, { ...input, quantityM: 40, expectedRevision: 0 }, null);
    assert.equal(first.revision, 1);
    assert.equal((await computeProjectProgress(project.id)).services[0].systems[0].realizedQty, 40);
    await assert.rejects(() => setPlannedScope(project.id, { services: [] }), /Restaure-as/);
    assert.equal((await computeProgressHistoryForProjects([project.id])).get(project.id).at(-1).progressPct, 40);
    const second = await saveRealizedCorrection(project.id, { ...input, quantityM: 0, expectedRevision: 1 }, null);
    assert.equal(second.revision, 2);
    assert.equal((await computeProjectProgress(project.id)).progressPct, 0);
    await saveRealizedCorrection(project.id, { ...input, quantityM: null, expectedRevision: 2 }, null);
    assert.equal((await computeProjectProgress(project.id)).progressPct, 100);
    await saveRealizedCorrection(project.id, { ...input, quantityM: 40, expectedRevision: 3 }, null);
    const listed = (await listRealizedCorrections(project.id)).rows.find(row => row.date === input.date);
    assert.equal(listed.sourceMeters, 100);
    assert.equal(listed.effectiveMeters, 40);
    assert.equal(listed.history.length, 4);
    await assert.rejects(() => saveRealizedCorrection(project.id, { ...input, quantityM: 50, expectedRevision: 3 }, null), /mudou/);
    await prisma.reportService.update({ where: { id: report.services[0].id }, data: { extraData: { tubes: [{ c: '105', lengthUnit: 'm' }] } } });
    const changed = (await listRealizedCorrections(project.id)).rows.find(row => row.date === input.date);
    assert.equal(changed.sourceChanged, true);
    assert.equal((await computeProjectProgress(project.id)).progressPct, 40);
    await assert.rejects(() => saveRealizedCorrection(project.id, { ...input, quantityM: 50, expectedRevision: 4 }, null), /RDO mudou/);
  } finally {
    if (report) await prisma.report.delete({ where: { id: report.id } });
    await prisma.project.delete({ where: { id: project.id } });
  }
});
