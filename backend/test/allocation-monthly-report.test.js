import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildMonthlyAllocationSummary,
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
        if (!current) return { count: 0 };
        rows.set(key, { ...current, ...args.data });
        return { count: 1 };
      }
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
      collaborator: { id: 'collab-1', name: 'Ana Lima', role: 'Operadora' }
    }, {
      collaboratorId: 'collab-2',
      collaborator: { id: 'collab-2', name: 'Bruno Souza', role: 'Técnico' }
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
      collaborator: { id: 'collab-1', name: 'Ana Lima', role: 'Operadora' }
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
      collaborator: { id: 'collab-1', name: 'Ana Lima', role: 'Operadora' }
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

test('processMonthlyAllocationReport records mail failures without retrying the entire recipient list', async t => {
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

  assert.deepEqual(retryResult, { skipped: true, reason: 'already_processed', yearMonth: '2026-06' });
  assert.equal(sent.length, 1);
});
