import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  buildMonthlyAllocationSummary,
  buildMonthlyAllocationPdf,
  previewMonthlyAllocationDelivery,
  previousYearMonth,
  processMonthlyAllocationReport,
  sendMonthlyAllocationReport
} from '../src/lib/allocation-monthly-report.js';

function createRecipientDeliveryMock(initialRows = []) {
  const rows = new Map();
  for (const row of initialRows) {
    rows.set(`${row.yearMonth}|${row.email}`, { id: `recipient-delivery-${rows.size + 1}`, ...row });
  }

  return {
    rows,
    model: {
      findMany: async args => Array.from(rows.values()).filter(row => (
        row.yearMonth === args.where.yearMonth && args.where.email.in.includes(row.email)
      )),
      findUnique: async args => rows.get(`${args.where.yearMonth_email.yearMonth}|${args.where.yearMonth_email.email}`) || null,
      create: async args => {
        const key = `${args.data.yearMonth}|${args.data.email}`;
        if (rows.has(key)) {
          const error = new Error('Unique constraint failed');
          error.code = 'P2002';
          throw error;
        }
        const row = { id: `recipient-delivery-${rows.size + 1}`, ...args.data };
        rows.set(key, row);
        return row;
      },
      updateMany: async args => {
        const key = `${args.where.yearMonth}|${args.where.email}`;
        const current = rows.get(key);
        if (!current || (args.where.status && current.status !== args.where.status)) return { count: 0 };
        rows.set(key, { ...current, ...args.data });
        return { count: 1 };
      }
    }
  };
}

function createMonthlyDeliveryMock(initialRows = []) {
  const rows = new Map(initialRows.map(row => [row.yearMonth, { ...row }]));
  return {
    rows,
    model: {
      findUnique: async args => rows.get(args.where.yearMonth) || null,
      create: async args => {
        if (rows.has(args.data.yearMonth)) throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
        rows.set(args.data.yearMonth, { sentAt: null, ...args.data });
        return rows.get(args.data.yearMonth);
      },
      updateMany: async args => {
        const row = rows.get(args.where.yearMonth);
        if (!row || row.status !== args.where.status) return { count: 0 };
        rows.set(args.where.yearMonth, { ...row, ...args.data });
        return { count: 1 };
      },
      update: async args => {
        const row = rows.get(args.where.yearMonth);
        assert.ok(row);
        rows.set(args.where.yearMonth, { ...row, ...args.data });
        return rows.get(args.where.yearMonth);
      },
      delete: async args => rows.delete(args.where.yearMonth)
    }
  };
}

function deliveryClient({ recipients = ['gestao@example.com'], recipientRows = [], monthlyRows = [] } = {}) {
  const recipientDeliveries = createRecipientDeliveryMock(recipientRows);
  const monthlyDeliveries = createMonthlyDeliveryMock(monthlyRows);
  return {
    recipientDeliveries,
    monthlyDeliveries,
    client: {
      allocationReportRecipient: { findMany: async () => recipients.map(email => ({ email })) },
      allocationReportRecipientDelivery: recipientDeliveries.model,
      allocationReportDelivery: monthlyDeliveries.model,
      report: { findMany: async () => [] }
    }
  };
}

test('buildMonthlyAllocationSummary groups day and night allocations by collaborator', async () => {
  const reports = [{
    id: 'report-1',
    projectId: 'project-1',
    reportDate: new Date(Date.UTC(2026, 4, 12)),
    sequenceNumber: 18,
    specialConditions: {
      noturnoDetails: {
        collaboratorIds: ['collab-2'],
        colaboradores: [{ id: 'collab-2', name: 'Bruno Souza', role: 'Técnico' }]
      }
    },
    project: {
      id: 'project-1',
      code: 'P-100',
      name: 'Parada Programada',
      location: 'Unidade Industrial',
      clientName: 'Cliente Acme',
      clientCnpj: '12345678000190'
    },
    collaborators: [{
      collaboratorId: 'collab-1',
      roleNameSnapshot: 'Operadora',
      collaborator: { id: 'collab-1', name: 'Ana Lima', jobRole: { name: 'Operadora' } }
    }, {
      collaboratorId: 'collab-2',
      roleNameSnapshot: 'Técnico',
      collaborator: { id: 'collab-2', name: 'Bruno Souza', jobRole: { name: 'Técnico' } }
    }]
  }, {
    id: 'report-2',
    projectId: 'project-1',
    reportDate: new Date(Date.UTC(2026, 4, 12)),
    sequenceNumber: 19,
    specialConditions: {},
    project: {
      id: 'project-1',
      code: 'P-100',
      name: 'Parada Programada',
      location: 'Unidade Industrial',
      clientName: 'Cliente Acme',
      clientCnpj: '12345678000190'
    },
    collaborators: [{
      collaboratorId: 'collab-1',
      roleNameSnapshot: 'Operadora',
      collaborator: { id: 'collab-1', name: 'Ana Lima', jobRole: { name: 'Operadora' } }
    }]
  }];

  const client = {
    report: {
      findMany: async () => reports
    }
  };

  const data = await buildMonthlyAllocationSummary({ yearMonth: '2026-05', client });

  assert.equal(data.summary.reportCount, 2);
  assert.equal(data.summary.collaboratorCount, 2);
  assert.equal(data.summary.allocationCount, 3);
  assert.equal(data.summary.dayCount, 1);
  assert.equal(data.entries[0].clientName, 'Cliente Acme');
  assert.equal(data.entries[0].clientCnpj, '12.345.678/0001-90');
  assert.ok(data.entries.every(entry => entry.workLocation === 'Unidade Industrial'));
  assert.ok(data.collaborators.every(collaborator => collaborator.days.every(day => day.workLocation === 'Unidade Industrial')));

  const ana = data.collaborators.find(item => item.collaboratorName === 'Ana Lima');
  const bruno = data.collaborators.find(item => item.collaboratorName === 'Bruno Souza');

  assert.equal(ana.days.length, 1);
  assert.equal(ana.days[0].shift, 'Diurno');
  assert.equal(bruno.days.length, 2);
  assert.deepEqual(bruno.days.map(day => day.shift).sort(), ['Diurno', 'Noturno']);
});

test('monthly allocations resolve the RDO location for day and night teams', async () => {
  const cases = [
    { location: 'Oficina', additionalWorkLocations: ['Canteiro'], saved: ' Canteiro ', expected: 'Canteiro' },
    { location: 'Oficina', additionalWorkLocations: ['Canteiro'], saved: 'Local histórico', expected: 'Local histórico' },
    { location: 'Oficina', additionalWorkLocations: ['Canteiro'], expected: 'Oficina' },
    { location: 'Local atualizado', saved: 'Local antigo', expected: 'Local atualizado' },
    { location: '', expected: '' }
  ];
  for (const { saved, expected, ...project } of cases) {
    const client = { report: { findMany: async ({ select }) => {
      assert.equal(select.project.select.location, true);
      assert.equal(select.project.select.additionalWorkLocations, true);
      return [{
        id: 'report-1', projectId: 'project-1', reportDate: new Date('2026-05-12T00:00:00Z'),
        project: { code: 'P-100', name: 'Parada Programada', ...project },
        collaborators: [{ collaboratorId: 'collab-1', collaborator: { name: 'Ana Lima' } }],
        specialConditions: { workLocation: saved, noturnoDetails: {
          collaboratorIds: ['collab-1'],
          colaboradores: [{ id: 'collab-1', name: 'Ana Lima' }, { name: 'Bruno Souza' }]
        } }
      }];
    } } };
    const data = await buildMonthlyAllocationSummary({ yearMonth: '2026-05', client });
    assert.equal(data.summary.allocationCount, 3);
    assert.deepEqual(data.entries.map(entry => entry.workLocation), [expected, expected, expected]);
    assert.deepEqual(data.collaborators.flatMap(collaborator => collaborator.days.map(day => day.workLocation)), [expected, expected, expected]);
  }
});

test('monthly PDF includes work locations within the project column on every page', async () => {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const days = Array.from({ length: 40 }, (_, index) => ({
    date: '2026-05-12', shift: 'Diurno', projectName: 'P-100 - Parada Programada',
    workLocation: index === 0 ? 'Canteiro São Paulo' : index === 1 ? '' : 'W'.repeat(200),
    clientName: 'Cliente Acme', clientCnpj: '12.345.678/0001-90'
  }));
  const bytes = await buildMonthlyAllocationPdf({
    label: 'maio de 2026', generatedAt: new Date('2026-06-01T12:00:00Z'),
    summary: { reportCount: 40, collaboratorCount: 1, allocationCount: 40, dayCount: 1, projectCount: 1 },
    collaborators: [{ collaboratorName: 'Ana Lima', collaboratorRole: 'Operadora', days }]
  });
  const task = getDocument({
    data: new Uint8Array(bytes), isEvalSupported: false,
    standardFontDataUrl: fileURLToPath(new URL('./standard_fonts/', import.meta.resolve('pdfjs-dist/package.json')))
  });
  try {
    const pdf = await task.promise;
    assert.ok(pdf.numPages > 1);
    const locations = [];
    for (let number = 1; number <= pdf.numPages; number++) {
      const content = await (await pdf.getPage(number)).getTextContent();
      assert.ok(content.items.some(item => item.str === 'Projeto / Local da obra'));
      for (const item of content.items.filter(item => item.str?.startsWith('Local da obra:'))) {
        locations.push(item.str);
        assert.ok(item.transform[4] + item.width <= 450.1, 'Location stays inside the project column');
        assert.ok(item.transform[5] >= 34, 'Location stays above the page footer');
      }
    }
    assert.equal(locations.length, days.length);
    assert.equal(locations[0], 'Local da obra: Canteiro São Paulo');
    assert.equal(locations[1], 'Local da obra: -');
    assert.ok(locations.slice(2).every(location => location.endsWith('...')));
  } finally {
    await task.destroy();
  }
});

test('processMonthlyAllocationReport sends the previous month on the first day', async () => {
  assert.equal(previousYearMonth(new Date('2026-07-01T12:00:00.000Z')), '2026-06');

  const deliveries = new Map();
  const recipientDeliveries = createRecipientDeliveryMock();
  const sent = [];
  const reports = [{
    id: 'report-june-1',
    projectId: 'project-1',
    reportDate: new Date(Date.UTC(2026, 5, 20)),
    sequenceNumber: 10,
    specialConditions: {},
    project: {
      id: 'project-1',
      code: 'P-100',
      name: 'Projeto Junho',
      clientName: 'Cliente Junho',
      clientCnpj: '12345678000190'
    },
    collaborators: [{
      collaboratorId: 'collab-1',
      roleNameSnapshot: 'Operadora',
      collaborator: { id: 'collab-1', name: 'Ana Lima', jobRole: { name: 'Operadora' } }
    }]
  }];
  const client = {
    allocationReportRecipient: {
      findMany: async args => {
        assert.deepEqual(args.where, { isActive: true });
        return [{ email: 'gestao@example.com', name: 'Gestão' }];
      }
    },
    allocationReportDelivery: {
      findUnique: async args => deliveries.get(args.where.yearMonth) || null,
      create: async args => {
        deliveries.set(args.data.yearMonth, { id: 'delivery-1', ...args.data });
        return deliveries.get(args.data.yearMonth);
      },
      update: async args => {
        const current = deliveries.get(args.where.yearMonth);
        deliveries.set(args.where.yearMonth, { ...current, ...args.data });
        return deliveries.get(args.where.yearMonth);
      },
      delete: async args => {
        deliveries.delete(args.where.yearMonth);
      }
    },
    allocationReportRecipientDelivery: recipientDeliveries.model,
    report: {
      findMany: async args => {
        assert.equal(args.where.reportDate.gte.toISOString(), '2026-06-01T00:00:00.000Z');
        assert.equal(args.where.reportDate.lt.toISOString(), '2026-07-01T00:00:00.000Z');
        return reports;
      }
    }
  };

  const result = await processMonthlyAllocationReport({
    now: new Date('2026-07-01T12:00:00.000Z'),
    client,
    mailer: async message => {
      sent.push(message);
    },
    missingMailerConfig: []
  });

  assert.equal(result.yearMonth, '2026-06');
  assert.equal(result.skipped, false);
  assert.equal(result.sent, 1);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'gestao@example.com');
  assert.equal(sent[0].attachments[0].filename, 'alocacao-colaboradores-2026-06.pdf');
  assert.equal(deliveries.get('2026-06').status, 'SENT');
  assert.equal(recipientDeliveries.rows.get('2026-06|gestao@example.com').status, 'SENT');
});

test('processMonthlyAllocationReport skips days after the 3rd business day', async () => {
  // Julho/2026: 1 (qua), 2 (qui), 3 (sex) → limite dia 3; dia 6 já está fora da janela.
  const result = await processMonthlyAllocationReport({
    now: new Date('2026-07-06T12:00:00.000Z'),
    client: {},
    missingMailerConfig: []
  });

  assert.deepEqual(result, { skipped: true, reason: 'outside_send_window' });
});

test('sendMonthlyAllocationReport sends only once per normalized recipient email', async () => {
  const sent = [];
  const recipientDeliveries = createRecipientDeliveryMock();
  const client = {
    allocationReportRecipient: {
      findMany: async () => [
        { email: 'gestao@example.com', name: 'Gestão' },
        { email: ' Gestao@Example.com ', name: 'Gestão duplicada' },
        { email: 'coord@example.com', name: 'Coordenação' }
      ]
    },
    allocationReportRecipientDelivery: recipientDeliveries.model,
    report: {
      findMany: async () => []
    }
  };

  const result = await sendMonthlyAllocationReport({
    yearMonth: '2026-06',
    client,
    mailer: async message => {
      sent.push(message);
    }
  });

  assert.equal(result.skipped, false);
  assert.equal(result.sent, 2);
  assert.equal(result.skippedExisting, 0);
  assert.deepEqual(sent.map(message => message.to).sort(), ['coord@example.com', 'gestao@example.com']);
});

test('sendMonthlyAllocationReport skips recipients already claimed for the same month', async () => {
  const sent = [];
  const recipientDeliveries = createRecipientDeliveryMock([{
    yearMonth: '2026-06',
    email: 'gestao@example.com',
    status: 'SENT'
  }]);
  const client = {
    allocationReportRecipient: {
      findMany: async () => [
        { email: 'gestao@example.com', name: 'Gestão' },
        { email: 'coord@example.com', name: 'Coordenação' }
      ]
    },
    allocationReportRecipientDelivery: recipientDeliveries.model,
    report: {
      findMany: async () => []
    }
  };

  const result = await sendMonthlyAllocationReport({
    yearMonth: '2026-06',
    client,
    mailer: async message => {
      sent.push(message);
    }
  });

  assert.equal(result.skipped, false);
  assert.equal(result.sent, 1);
  assert.equal(result.skippedExisting, 1);
  assert.deepEqual(sent.map(message => message.to), ['coord@example.com']);
  assert.equal(recipientDeliveries.rows.get('2026-06|coord@example.com').status, 'SENT');
});

test('processMonthlyAllocationReport retries failures without resending successful recipients', async t => {
  const originalConsoleError = console.error;
  console.error = () => {};
  t.after(() => {
    console.error = originalConsoleError;
  });

  const deliveries = new Map();
  const recipientDeliveries = createRecipientDeliveryMock();
  const sent = [];
  const reports = [];
  const client = {
    allocationReportRecipient: {
      findMany: async () => [
        { email: 'gestao@example.com', name: 'Gestão' },
        { email: 'coord@example.com', name: 'Coordenação' }
      ]
    },
    allocationReportDelivery: {
      findUnique: async args => deliveries.get(args.where.yearMonth) || null,
      updateMany: async args => {
        const current = deliveries.get(args.where.yearMonth);
        if (!current || current.status !== args.where.status) return { count: 0 };
        deliveries.set(args.where.yearMonth, { ...current, ...args.data });
        return { count: 1 };
      },
      create: async args => {
        deliveries.set(args.data.yearMonth, { id: 'delivery-1', ...args.data });
        return deliveries.get(args.data.yearMonth);
      },
      update: async args => {
        const current = deliveries.get(args.where.yearMonth);
        deliveries.set(args.where.yearMonth, { ...current, ...args.data });
        return deliveries.get(args.where.yearMonth);
      },
      delete: async args => {
        deliveries.delete(args.where.yearMonth);
      }
    },
    allocationReportRecipientDelivery: recipientDeliveries.model,
    report: {
      findMany: async () => reports
    }
  };

  const result = await processMonthlyAllocationReport({
    now: new Date('2026-07-01T12:00:00.000Z'),
    client,
    mailer: async message => {
      if (message.to === 'coord@example.com') throw new Error('smtp timeout');
      sent.push(message);
    },
    missingMailerConfig: []
  });

  assert.equal(result.yearMonth, '2026-06');
  assert.equal(result.sent, 1);
  assert.equal(result.failed, 1);
  assert.equal(deliveries.get('2026-06').status, 'SENT_WITH_ERRORS');
  assert.equal(recipientDeliveries.rows.get('2026-06|gestao@example.com').status, 'SENT');
  assert.equal(recipientDeliveries.rows.get('2026-06|coord@example.com').status, 'ERROR');
  assert.equal(sent.length, 1);

  const retryResult = await processMonthlyAllocationReport({
    now: new Date('2026-07-01T13:00:00.000Z'),
    client,
    mailer: async message => {
      sent.push(message);
    },
    missingMailerConfig: []
  });

  assert.equal(retryResult.sent, 1);
  assert.equal(retryResult.skippedExisting, 1);
  assert.equal(retryResult.failed, 0);
  assert.equal(retryResult.pending, 0);
  assert.equal(deliveries.get('2026-06').status, 'SENT');
  assert.equal(sent.length, 2);
  assert.deepEqual(sent.map(message => message.to), ['gestao@example.com', 'coord@example.com']);
});

test('monthly calendar uses Sao Paulo at UTC month and year boundaries', () => {
  assert.equal(previousYearMonth(new Date('2026-10-01T02:59:59Z')), '2026-08');
  assert.equal(previousYearMonth(new Date('2026-10-01T03:00:00Z')), '2026-09');
  assert.equal(previousYearMonth(new Date('2027-01-01T02:59:59Z')), '2026-11');
  assert.equal(previousYearMonth(new Date('2027-01-01T03:00:00Z')), '2026-12');
});

test('UTC midnight does not claim the monthly delivery before Sao Paulo midnight', async () => {
  const result = await processMonthlyAllocationReport({
    now: new Date('2026-10-01T02:59:59Z'), client: {}, missingMailerConfig: []
  });
  // Ainda é 30/09 em São Paulo: fora da janela de envio de outubro.
  assert.deepEqual(result, { skipped: true, reason: 'outside_send_window' });
});

for (const now of ['2026-10-01T03:00:00Z', '2026-10-02T02:59:59Z']) {
  test(`scheduler sends September throughout the first Sao Paulo day at ${now}`, async () => {
    const { client, monthlyDeliveries } = deliveryClient();
    const result = await processMonthlyAllocationReport({ now: new Date(now), client, mailer: async () => {}, missingMailerConfig: [] });
    assert.equal(result.yearMonth, '2026-09');
    assert.equal(result.sent, 1);
    assert.equal(monthlyDeliveries.rows.get('2026-09').status, 'SENT');
  });
}

test('manual attempts for current, future and invalid months are rejected before any database access', async () => {
  const now = new Date('2026-10-01T02:59:59Z');
  for (const yearMonth of ['2026-09', '2026-10', '2026-13']) {
    for (const send of [sendMonthlyAllocationReport, processMonthlyAllocationReport]) {
      await assert.rejects(() => send({ yearMonth, now, client: {}, missingMailerConfig: [] }), error => (
        error.statusCode === (yearMonth === '2026-13' ? 400 : 409)
      ));
    }
  }
});

test('early manual attempt does not block the final report after the month closes', async () => {
  const { client, monthlyDeliveries, recipientDeliveries } = deliveryClient();
  await assert.rejects(() => sendMonthlyAllocationReport({
    yearMonth: '2026-09', now: new Date('2026-10-01T02:59:59Z'), client, mailer: async () => assert.fail('early send')
  }));
  assert.equal(monthlyDeliveries.rows.size, 0);
  assert.equal(recipientDeliveries.rows.size, 0);
  const result = await processMonthlyAllocationReport({
    now: new Date('2026-10-01T03:00:00Z'), client, mailer: async () => {}, missingMailerConfig: []
  });
  assert.equal(result.sent, 1);
});

test('all failed recipients produce ERROR without sentAt and can be retried', async t => {
  t.mock.method(console, 'error', () => {});
  const { client, monthlyDeliveries } = deliveryClient({ recipients: ['a@example.com', 'b@example.com'] });
  const options = { yearMonth: '2026-08', now: new Date('2026-10-05T12:00:00Z'), client, missingMailerConfig: [] };
  const failed = await processMonthlyAllocationReport({ ...options, mailer: async () => { throw new Error('535 5.7.139'); } });
  assert.equal(failed.sent, 0);
  assert.equal(failed.failed, 2);
  assert.equal(failed.pending, 2);
  assert.equal(monthlyDeliveries.rows.get('2026-08').status, 'ERROR');
  assert.equal(monthlyDeliveries.rows.get('2026-08').sentAt, null);
  const retry = await processMonthlyAllocationReport({ ...options, mailer: async () => {} });
  assert.equal(retry.sent, 2);
  assert.equal(monthlyDeliveries.rows.get('2026-08').status, 'SENT');
  assert.ok(monthlyDeliveries.rows.get('2026-08').sentAt instanceof Date);
});

test('recovery repairs legacy SENT months whose recipient deliveries are ERROR', async () => {
  const { client, monthlyDeliveries } = deliveryClient({
    recipientRows: [{ yearMonth: '2026-09', email: 'gestao@example.com', status: 'ERROR', error: '535', sentAt: null }],
    monthlyRows: [{ yearMonth: '2026-09', status: 'SENT', recipientCount: 1 }]
  });
  const options = { yearMonth: '2026-09', now: new Date('2026-10-05T12:00:00Z'), client, missingMailerConfig: [] };
  const result = await processMonthlyAllocationReport({ ...options, mailer: async () => {} });
  assert.equal(result.sent, 1);
  assert.equal(result.pending, 0);
  assert.equal(monthlyDeliveries.rows.get('2026-09').status, 'SENT');
  const repeat = await processMonthlyAllocationReport({ ...options, mailer: async () => assert.fail('duplicate') });
  assert.deepEqual(repeat, { skipped: true, reason: 'already_processed', yearMonth: '2026-09' });
});

test('claimed recipients are pending rather than completed and are not sent again', async () => {
  const { client, monthlyDeliveries } = deliveryClient({
    recipientRows: [{ yearMonth: '2026-09', email: 'gestao@example.com', status: 'CLAIMED' }]
  });
  const result = await processMonthlyAllocationReport({
    yearMonth: '2026-09', client, mailer: async () => assert.fail('duplicate'), missingMailerConfig: []
  });
  assert.equal(result.sent, 0);
  assert.equal(result.skippedExisting, 0);
  assert.equal(result.pending, 1);
  assert.equal(monthlyDeliveries.rows.get('2026-09').status, 'ERROR');
  assert.equal(monthlyDeliveries.rows.get('2026-09').sentAt, null);
});

test('concurrent retries atomically claim each ERROR recipient only once', async () => {
  const { client } = deliveryClient({ recipientRows: [{ yearMonth: '2026-09', email: 'gestao@example.com', status: 'ERROR' }] });
  let release, started;
  const sending = new Promise(resolve => { started = resolve; });
  const finish = new Promise(resolve => { release = resolve; });
  let calls = 0;
  const options = { yearMonth: '2026-09', client, mailer: async () => { calls += 1; started(); await finish; } };
  const first = sendMonthlyAllocationReport(options);
  await sending;
  const second = await sendMonthlyAllocationReport(options);
  assert.equal(second.sent, 0);
  assert.equal(second.pending, 1);
  assert.equal(second.status, 'ERROR');
  release();
  assert.equal((await first).sent, 1);
  assert.equal(calls, 1);
});

test('successful SMTP delivery followed by a database failure stays claimed to prevent duplicates', async () => {
  const { client, recipientDeliveries } = deliveryClient();
  const updateMany = client.allocationReportRecipientDelivery.updateMany;
  client.allocationReportRecipientDelivery.updateMany = async args => {
    if (args.data.status === 'SENT') throw new Error('database offline');
    return updateMany(args);
  };
  await assert.rejects(() => sendMonthlyAllocationReport({ yearMonth: '2026-09', client, mailer: async () => {} }), /database offline/);
  assert.equal(recipientDeliveries.rows.get('2026-09|gestao@example.com').status, 'CLAIMED');
  const retry = await sendMonthlyAllocationReport({ yearMonth: '2026-09', client, mailer: async () => assert.fail('duplicate') });
  assert.equal(retry.sent, 0);
  assert.equal(retry.pending, 1);
});

for (const response of [{ skipped: true, reason: 'outbound_emails_disabled' }, { accepted: [], rejected: ['gestao@example.com'] }]) {
  test(`mailer result ${JSON.stringify(response)} is not counted as a completed send`, async t => {
    t.mock.method(console, 'error', () => {});
    const { client, monthlyDeliveries } = deliveryClient();
    const result = await processMonthlyAllocationReport({
      yearMonth: '2026-09', client, mailer: async () => response, missingMailerConfig: []
    });
    assert.equal(result.sent, 0);
    assert.equal(result.failed, 1);
    assert.equal(monthlyDeliveries.rows.get('2026-09').status, 'ERROR');
    assert.equal(monthlyDeliveries.rows.get('2026-09').sentAt, null);
  });
}

test('no recipients leaves the month available for a later attempt', async () => {
  const { client, monthlyDeliveries } = deliveryClient({ recipients: [] });
  const result = await processMonthlyAllocationReport({ yearMonth: '2026-09', client, mailer: async () => assert.fail('empty'), missingMailerConfig: [] });
  assert.equal(result.reason, 'no_recipients');
  assert.equal(monthlyDeliveries.rows.size, 0);
});

test('preview counts only SENT active recipients without claiming or sending', async () => {
  const { client, recipientDeliveries, monthlyDeliveries } = deliveryClient({
    recipients: ['sent@example.com', 'error@example.com', 'claimed@example.com', 'new@example.com', ' SENT@example.com '],
    recipientRows: [
      { yearMonth: '2026-09', email: 'sent@example.com', status: 'SENT' },
      { yearMonth: '2026-09', email: 'error@example.com', status: 'ERROR' },
      { yearMonth: '2026-09', email: 'claimed@example.com', status: 'CLAIMED' },
      { yearMonth: '2026-09', email: 'inactive@example.com', status: 'SENT' }
    ]
  });
  const before = Array.from(recipientDeliveries.rows.values());
  assert.deepEqual(await previewMonthlyAllocationDelivery({ yearMonth: '2026-09', client }), {
    recipientCount: 4, delivered: 1, pending: 3, status: 'SENT_WITH_ERRORS'
  });
  assert.deepEqual(Array.from(recipientDeliveries.rows.values()), before);
  assert.equal(monthlyDeliveries.rows.size, 0);
});

test('historical SENT month is preserved when there are no active recipients', async () => {
  const old = { yearMonth: '2026-06', status: 'SENT', recipientCount: 6, sentAt: new Date('2026-07-01T12:00:00Z') };
  const { client, monthlyDeliveries } = deliveryClient({ recipients: [], monthlyRows: [old] });
  const result = await processMonthlyAllocationReport({ yearMonth: '2026-06', client, missingMailerConfig: [] });
  assert.equal(result.reason, 'already_processed');
  assert.deepEqual(monthlyDeliveries.rows.get('2026-06'), old);
});

test('unexpected persistence failure still records actual partial completion for the month', async () => {
  const { client, monthlyDeliveries } = deliveryClient({ recipients: ['a@example.com', 'b@example.com'] });
  const updateMany = client.allocationReportRecipientDelivery.updateMany;
  client.allocationReportRecipientDelivery.updateMany = async args => {
    if (args.where.email === 'b@example.com' && args.data.status === 'SENT') throw new Error('database failure');
    return updateMany(args);
  };
  await assert.rejects(() => processMonthlyAllocationReport({
    yearMonth: '2026-09', client, mailer: async () => {}, missingMailerConfig: []
  }), /database failure/);
  assert.equal(monthlyDeliveries.rows.get('2026-09').status, 'SENT_WITH_ERRORS');
  assert.equal(monthlyDeliveries.rows.get('2026-09').recipientCount, 2);
  assert.ok(monthlyDeliveries.rows.get('2026-09').sentAt instanceof Date);
});

// === Conferência semanal de alocação (feature 037) ===

function reviewClient({ reports = [], reviewDays = [], projects = [], collaborators = [] } = {}) {
  const days = reviewDays.map(({ projects: _projects, ...day }, index) => ({ ...day, id: `review-${index}` }));
  const links = reviewDays.flatMap((day, index) => (day.projects || []).map(project => ({ dayId: `review-${index}`, ...project })));
  return {
    report: { findMany: async () => reports },
    allocationReviewDay: {
      findMany: async args => {
        assert.deepEqual(args.where.row, { confirmedAt: { not: null } });
        return days;
      }
    },
    allocationReviewDayProject: { findMany: async args => links.filter(link => args.where.dayId.in.includes(link.dayId)) },
    project: { findMany: async () => projects },
    collaborator: { findMany: async () => collaborators }
  };
}

const rdoReport = (date, projectId, code, extra = {}) => ({
  id: `rdo-${date}-${projectId}`, projectId, reportDate: new Date(`${date}T00:00:00.000Z`), sequenceNumber: 7,
  specialConditions: {},
  project: { id: projectId, code, name: `Obra ${code}`, location: 'Canteiro', additionalWorkLocations: [], clientName: `Cliente ${code}`, clientCnpj: '11222333000181' },
  collaborators: [{ collaboratorId: 'c1', roleNameSnapshot: 'Técnica', collaborator: { id: 'c1', name: 'Ana Lima', jobRole: { name: 'Técnica' } } }],
  ...extra
});

test('dia conferido em outro projeto substitui a entrada do RDO e leva o CNPJ do projeto conferido', async () => {
  const client = reviewClient({
    reports: [rdoReport('2026-10-27', 'pA', '5620'), rdoReport('2026-10-28', 'pA', '5620')],
    reviewDays: [{ collaboratorId: 'c1', workDate: new Date('2026-10-27T00:00:00.000Z'), kind: 'PROJECT', projects: [{ projectId: 'pB' }] }],
    projects: [{ id: 'pB', code: '5484', name: 'Missão', location: 'Usina', additionalWorkLocations: [], clientName: 'Thyssenkrupp', clientCnpj: '37981316000111', managerOnly: false, deletedAt: null }],
    collaborators: [{ id: 'c1', name: 'Ana Lima', jobRole: { name: 'Técnica' } }]
  });
  const summary = await buildMonthlyAllocationSummary({ yearMonth: '2026-10', client });
  const days = summary.collaborators[0].days;
  assert.equal(days.length, 2);
  const reviewed = days.find(day => day.date === '2026-10-27');
  assert.equal(reviewed.projectId, 'pB');
  assert.equal(reviewed.clientCnpj, '37.981.316/0001-11');
  assert.equal(reviewed.source, 'REVIEW');
  assert.equal(reviewed.reviewed, true);
  assert.equal(reviewed.shift, 'Diurno');
  assert.equal(reviewed.reportId, null);
  const untouched = days.find(day => day.date === '2026-10-28');
  assert.equal(untouched.source, 'RDO');
  assert.equal(untouched.projectId, 'pA');
  assert.equal(summary.summary.reviewedDayCount, 1);
  assert.equal(summary.summary.projectCount, 2);
});

test('Sede, Folga e Férias conferidas aparecem sem CNPJ; viagem leva o CNPJ do destino', async () => {
  const client = reviewClient({
    reviewDays: [
      { collaboratorId: 'c1', workDate: new Date('2026-10-26T00:00:00.000Z'), kind: 'SEDE', projects: [] },
      { collaboratorId: 'c1', workDate: new Date('2026-10-27T00:00:00.000Z'), kind: 'FERIAS', projects: [] },
      { collaboratorId: 'c1', workDate: new Date('2026-10-28T00:00:00.000Z'), kind: 'TRAVEL', projects: [{ projectId: 'pG' }] }
    ],
    projects: [{ id: 'pG', code: '5830', name: 'Gerdau', location: 'Ouro Branco', additionalWorkLocations: [], clientName: 'Gerdau', clientCnpj: '07522191003116', managerOnly: false, deletedAt: null }],
    collaborators: [{ id: 'c1', name: 'Ana Lima', jobRole: { name: 'Técnica' } }]
  });
  const summary = await buildMonthlyAllocationSummary({ yearMonth: '2026-10', client });
  const [sede, ferias, travel] = summary.collaborators[0].days;
  assert.deepEqual([sede.kind, sede.projectName, sede.clientCnpj, sede.projectId], ['SEDE', 'Sede', '', null]);
  assert.deepEqual([ferias.kind, ferias.projectName, ferias.clientCnpj], ['FERIAS', 'Férias', '']);
  assert.equal(travel.kind, 'TRAVEL');
  assert.equal(travel.projectName, 'Viagem · 5830 - Gerdau');
  assert.equal(travel.clientCnpj, '07.522.191/0031-16');
  assert.equal(summary.summary.projectCount, 1);
  assert.equal(summary.summary.reviewedDayCount, 3);

  const bytes = await buildMonthlyAllocationPdf(summary);
  assert.ok(bytes.length > 1000, 'PDF gera com dias sem projeto');
});

test('turno noturno do RDO é preservado quando o dia é conferido no mesmo projeto', async () => {
  const night = rdoReport('2026-10-27', 'pA', '5620', {
    collaborators: [],
    specialConditions: { noturnoDetails: { collaboratorIds: ['c1'], colaboradores: [{ id: 'c1', name: 'Ana Lima', role: 'Técnica' }] } }
  });
  const client = reviewClient({
    reports: [night],
    reviewDays: [{ collaboratorId: 'c1', workDate: new Date('2026-10-27T00:00:00.000Z'), kind: 'PROJECT', projects: [{ projectId: 'pA' }] }],
    projects: [{ id: 'pA', code: '5620', name: 'Obra 5620', location: 'Canteiro', additionalWorkLocations: [], clientName: 'Cliente', clientCnpj: '11222333000181', managerOnly: false, deletedAt: null }],
    collaborators: [{ id: 'c1', name: 'Ana Lima', jobRole: { name: 'Técnica' } }]
  });
  const summary = await buildMonthlyAllocationSummary({ yearMonth: '2026-10', client });
  const [day] = summary.collaborators[0].days;
  assert.equal(day.shift, 'Noturno');
  assert.equal(day.reportId, 'rdo-2026-10-27-pA');
  assert.equal(day.source, 'REVIEW');
});

function waitingClient(closedWeeks = []) {
  const base = deliveryClient();
  const writes = [];
  const model = base.client.allocationReportDelivery;
  base.client.allocationReportDelivery = new Proxy(model, {
    get(target, prop) {
      const value = target[prop];
      if (typeof value !== 'function') return value;
      return async (...args) => { writes.push(prop); return value.apply(target, args); };
    }
  });
  base.client.allocationReviewWeek = {
    findMany: async ({ where }) => where.weekStart.in
      .map(date => date.toISOString().slice(0, 10))
      .filter(key => closedWeeks.includes(key))
      .map(key => ({ weekStart: new Date(`${key}T00:00:00.000Z`) }))
  };
  return { ...base, writes };
}

const OCTOBER_WEEKS = ['2026-09-28', '2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26'];
const noHolidays = async () => ({ holidayDates: new Set() });

test('com semana aberta, o envio espera até o 3º dia útil sem tocar na entrega', async () => {
  // Nov/2026: 1 é domingo; 2 (seg) é Finados mas o calendário injetado não tem feriados → limite dia 4.
  const { client, writes } = waitingClient(OCTOBER_WEEKS.slice(0, 4));
  const result = await processMonthlyAllocationReport({
    now: new Date('2026-11-03T12:00:00.000Z'), client, mailer: async () => assert.fail('não deve enviar'),
    missingMailerConfig: [], loadCalendar: noHolidays
  });
  assert.deepEqual(result, { skipped: true, reason: 'awaiting_review', yearMonth: '2026-10', deadline: '2026-11-04', openWeeks: ['2026-10-26'] });
  assert.deepEqual(writes, []);
});

test('com todas as semanas fechadas, envia antes do limite', async () => {
  const { client, monthlyDeliveries } = waitingClient(OCTOBER_WEEKS);
  const result = await processMonthlyAllocationReport({
    now: new Date('2026-11-02T12:00:00.000Z'), client, mailer: async () => {}, missingMailerConfig: [], loadCalendar: noHolidays
  });
  assert.equal(result.yearMonth, '2026-10');
  assert.equal(result.sent, 1);
  assert.equal(monthlyDeliveries.rows.get('2026-10').status, 'SENT');
});

test('no 3º dia útil envia mesmo com semana aberta; depois dele, fora da janela', async () => {
  const { client } = waitingClient([]);
  const sent = await processMonthlyAllocationReport({
    now: new Date('2026-11-04T12:00:00.000Z'), client, mailer: async () => {}, missingMailerConfig: [], loadCalendar: noHolidays
  });
  assert.equal(sent.sent, 1);
  const late = await processMonthlyAllocationReport({
    now: new Date('2026-11-05T12:00:00.000Z'), client, mailer: async () => {}, missingMailerConfig: [], loadCalendar: noHolidays
  });
  assert.deepEqual(late, { skipped: true, reason: 'outside_send_window' });
});

test('feriado corporativo empurra o limite e o calendário real inclui feriados nacionais', async () => {
  const { client } = waitingClient([]);
  const holiday = await processMonthlyAllocationReport({
    now: new Date('2026-11-04T12:00:00.000Z'), client, mailer: async () => assert.fail('não deve enviar'), missingMailerConfig: [],
    loadCalendar: async () => ({ holidayDates: new Set(['2026-11-03']) })
  });
  assert.equal(holiday.reason, 'awaiting_review');
  assert.equal(holiday.deadline, '2026-11-05');
  // Sem calendário injetado: Finados (02/11) é feriado nacional → limite dia 5.
  const national = await processMonthlyAllocationReport({
    now: new Date('2026-11-04T12:00:00.000Z'), client, mailer: async () => assert.fail('não deve enviar'), missingMailerConfig: []
  });
  assert.equal(national.deadline, '2026-11-05');
});

test('envio manual não espera a conferência', async () => {
  const { client } = waitingClient([]);
  const result = await processMonthlyAllocationReport({
    yearMonth: '2026-10', now: new Date('2026-11-02T12:00:00.000Z'), client, mailer: async () => {}, missingMailerConfig: []
  });
  assert.equal(result.sent, 1);
});
