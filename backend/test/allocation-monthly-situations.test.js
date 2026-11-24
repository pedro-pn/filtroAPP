import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { buildMonthlyAllocationPdf, buildMonthlyAllocationSummary } from '../src/lib/allocation-monthly-report.js';
import { getReviewMonth } from '../src/lib/efetivo/allocation-review/read-model.js';
import { getAllocationTrailsForRange } from '../src/lib/acompanhamento/allocation-audit.js';
import { apiSimulationDatabase } from './helpers/api-simulation-db.js';

const date = key => new Date(`${key}T00:00:00.000Z`);
const now = new Date('2026-11-03T12:00:00.000Z');

test('resumo mensal inclui situações do Efetivo sem depender da confirmação da semana', async t => {
  const local = await apiSimulationDatabase();
  t.after(() => local.close());
  const client = local.client;
  const role = await client.jobRole.create({ data: {
    name: 'Técnica', normalizedKey: 'tecnica', isOperational: true, workforceClassification: 'OPERATIONAL'
  } });
  const person = name => client.collaborator.create({ data: {
    code: name, name, jobRoleId: role.id, admissionDate: date('2026-10-26')
  } });
  const ana = await person('Ana');
  const bia = await person('Bia');
  const project = await client.project.create({ data: {
    code: '5620', name: 'Usina', clientName: 'Cliente Usina', clientCnpj: '11222333000181',
    contractCode: 'contrato', location: 'Canteiro'
  } });
  for (const key of ['2026-10-27', '2026-10-28', '2026-11-02']) {
    await client.report.create({ data: {
      projectId: project.id, reportDate: date(key), status: 'APPROVED',
      arrivalTime: '08:00', departureTime: '17:00', lunchBreak: '01:00', daytimeCount: 1,
      collaborators: { create: { collaboratorId: ana.id } },
      specialConditions: { noturnoDetails: {
        collaboratorIds: [ana.id], colaboradores: [{ id: ana.id, name: ana.name, role: role.name }]
      } }
    } });
  }
  await client.report.create({ data: {
    projectId: project.id, reportDate: date('2026-10-30'), status: 'PENDING',
    arrivalTime: '08:00', departureTime: '17:00', lunchBreak: '01:00', daytimeCount: 1,
    collaborators: { create: { collaboratorId: ana.id } }
  } });
  await client.collaboratorAbsence.createMany({ data: [
    { collaboratorId: ana.id, type: 'FOLGA', startDate: date('2026-10-28'), endDate: date('2026-10-28') },
    { collaboratorId: bia.id, type: 'FERIAS', startDate: date('2026-10-26'), endDate: date('2026-10-30') }
  ] });
  await client.pontoImport.create({ data: {
    fileName: 'ponto-sintetico', contentHash: 'alocacao-mensal-situacoes',
    periodStart: date('2026-10-26'), periodEnd: date('2026-10-31'),
    periods: { create: {
      collaboratorId: ana.id, rawName: ana.name, normalizedName: 'ana',
      periodStart: date('2026-10-26'), periodEnd: date('2026-10-31'),
      workedMinutes: 960, workedDates: ['2026-10-26', '2026-10-31'],
      monthly: { '2026-10': {
        normalMinutes: 960, extrasMinutes: 0, workedDates: ['2026-10-26', '2026-10-31'],
        days: ['2026-10-26', '2026-10-31'].map(key => ({ date: key, workedMinutes: 480, extrasMinutes: 0, tags: ['Em viagem'] }))
      } }
    } }
  } });

  await t.test('folga, viagem e férias usam as mesmas situações da conferência e preservam os turnos dos RDOs', async () => {
    const data = await buildMonthlyAllocationSummary({ yearMonth: '2026-10', client, now });
    assert.equal(await client.allocationReviewWeek.count(), 0);
    assert.equal(data.summary.reportCount, 2);
    assert.equal(data.summary.reviewedDayCount, 0);
    assert.equal(data.summary.collaboratorCount, 2);
    const days = data.collaborators.find(row => row.collaboratorId === ana.id).days;
    assert.deepEqual(days.map(day => [day.date, day.kind, day.shift]), [
      ['2026-10-26', 'TRAVEL', 'Diurno'],
      ['2026-10-27', 'PROJECT', 'Diurno'],
      ['2026-10-27', undefined, 'Noturno'],
      ['2026-10-28', 'FOLGA', '—'],
      ['2026-10-31', 'TRAVEL', 'Diurno']
    ]);
    for (const day of days.filter(day => day.kind === 'TRAVEL')) {
      assert.equal(day.projectId, project.id);
      assert.equal(day.projectName, 'Viagem · 5620 - Usina');
      assert.equal(day.clientCnpj, '11.222.333/0001-81');
      assert.equal(day.source, 'EFETIVO');
      assert.equal(day.reviewed, false);
      assert.equal(day.reportId, null);
    }
    const vacation = data.collaborators.find(row => row.collaboratorId === bia.id);
    assert.equal(vacation.days.filter(day => day.kind === 'FERIAS').length, 5);
    const offProject = data.entries.filter(day => ['FOLGA', 'FERIAS'].includes(day.kind));
    assert.ok(offProject.length > 0);
    assert.ok(offProject.every(day => day.projectId === null && day.workLocation === '' && day.clientCnpj === '' && !day.reviewed));
    assert.ok(data.entries.every(day => day.date.startsWith('2026-10')));

    const review = await getReviewMonth({ yearMonth: '2026-10', now }, {
      database: client, getTrails: range => getAllocationTrailsForRange(range, { database: client })
    });
    for (const entry of data.entries.filter(entry => entry.source === 'EFETIVO')) {
      const day = review.rows.find(row => row.collaborator.id === entry.collaboratorId).days.find(day => day.date === entry.date);
      assert.equal(entry.kind, day.value.kind);
    }

    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const task = getDocument({
      data: new Uint8Array(await buildMonthlyAllocationPdf(data)), isEvalSupported: false,
      standardFontDataUrl: fileURLToPath(new URL('./standard_fonts/', import.meta.resolve('pdfjs-dist/package.json')))
    });
    try {
      const pdf = await task.promise;
      const texts = [];
      for (let number = 1; number <= pdf.numPages; number++) {
        texts.push(...(await (await pdf.getPage(number)).getTextContent()).items.map(item => item.str || ''));
      }
      assert.ok(texts.includes('Folga'));
      assert.ok(texts.includes('Férias'));
      assert.ok(texts.includes('Viagem · 5620 - Usina'));
      assert.ok(texts.includes('Fora de projeto'));
      assert.ok(texts.every(text => !text.includes('conferido')));
    } finally {
      await task.destroy();
    }
  });

  await t.test('dias futuros e anteriores à admissão não viram situações realizadas', async () => {
    const data = await buildMonthlyAllocationSummary({ yearMonth: '2026-10', client, now: new Date('2026-10-28T15:00:00Z') });
    assert.ok(data.entries.every(day => day.date >= '2026-10-26' && day.date <= '2026-10-28'));
  });

  await t.test('decisão confirmada prevalece sobre as fontes automáticas sem duplicar o dia', async () => {
    await client.allocationReviewWeek.create({ data: {
      weekStart: date('2026-10-26'),
      rows: { create: {
        collaboratorId: ana.id, confirmedAt: now,
        days: { create: { collaboratorId: ana.id, workDate: date('2026-10-26'), kind: 'FALTA' } }
      } }
    } });
    const data = await buildMonthlyAllocationSummary({ yearMonth: '2026-10', client, now });
    const days = data.entries.filter(day => day.collaboratorId === ana.id && day.date === '2026-10-26');
    assert.equal(days.length, 1);
    assert.equal(days[0].kind, 'FALTA');
    assert.equal(days[0].projectName, 'Falta');
    assert.equal(days[0].projectId, null);
    assert.equal(days[0].clientCnpj, '');
    assert.equal(days[0].source, 'REVIEW');
    assert.equal(days[0].reviewed, true);
    assert.equal(data.summary.reviewedDayCount, 1);
    const review = await getReviewMonth({ yearMonth: '2026-10', now }, {
      database: client, getTrails: range => getAllocationTrailsForRange(range, { database: client })
    });
    const day = review.rows.find(row => row.collaborator.id === ana.id).days.find(day => day.date === '2026-10-26');
    assert.equal(day.value.kind, 'FALTA');
    assert.equal(day.attendanceWarning, true);
    assert.equal(day.confirmed, true);
  });
});
