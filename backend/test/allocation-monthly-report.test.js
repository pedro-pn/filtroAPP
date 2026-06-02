import assert from 'node:assert/strict';
import test from 'node:test';

import { buildMonthlyAllocationSummary } from '../src/lib/allocation-monthly-report.js';

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
  assert.equal(data.entries[0].clientCnpj, '12.345.678/0001-90');

  const ana = data.collaborators.find(item => item.collaboratorName === 'Ana Lima');
  const bruno = data.collaborators.find(item => item.collaboratorName === 'Bruno Souza');

  assert.equal(ana.days.length, 1);
  assert.equal(ana.days[0].shift, 'Diurno');
  assert.equal(bruno.days.length, 2);
  assert.deepEqual(bruno.days.map(day => day.shift).sort(), ['Diurno', 'Noturno']);
});
