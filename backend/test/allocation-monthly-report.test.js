import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildMonthlyAllocationSummary,
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

  const ana = data.collaborators.find(item => item.collaboratorName === 'Ana Lima');
  const bruno = data.collaborators.find(item => item.collaboratorName === 'Bruno Souza');

  assert.equal(ana.days.length, 1);
  assert.equal(ana.days[0].shift, 'Diurno');
  assert.equal(bruno.days.length, 2);
  assert.deepEqual(bruno.days.map(day => day.shift).sort(), ['Diurno', 'Noturno']);
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

test('processMonthlyAllocationReport skips days other than the first day', async () => {
  const result = await processMonthlyAllocationReport({
    now: new Date('2026-07-02T12:00:00.000Z'),
    missingMailerConfig: []
  });

  assert.deepEqual(result, { skipped: true, reason: 'not_first_day' });
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
  assert.deepEqual(result, { skipped: true, reason: 'not_first_day' });
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
