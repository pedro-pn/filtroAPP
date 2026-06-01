import assert from 'node:assert/strict';
import test from 'node:test';

import { buildReportCollaboratorRows } from '../src/lib/report-collaborators.js';
import { enrichNightCollaboratorsInSpecialConditions } from '../src/routes/resources/reports.js';

test('night collaborator snapshot carries role when collaborator link is absent', () => {
  const rows = buildReportCollaboratorRows({
    collaborators: [
      {
        collaboratorId: 'day-1',
        collaborator: { name: 'Colaborador Diurno', role: 'Tecnico' }
      }
    ],
    specialConditions: {
      noturnoDetails: {
        collaboratorIds: ['night-1'],
        colaboradores: [
          { id: 'night-1', name: 'Colaborador Noturno', role: 'Operador' }
        ]
      }
    }
  });

  assert.deepEqual(rows, [
    {
      collaboratorname: 'Colaborador Diurno',
      collaboratorname0: 'Colaborador Diurno',
      collaboratorposition: 'Tecnico',
      collaboratorshift: 'Diurno'
    },
    {
      collaboratorname: 'Colaborador Noturno',
      collaboratorname0: 'Colaborador Noturno',
      collaboratorposition: 'Operador',
      collaboratorshift: 'Noturno'
    }
  ]);
});

test('night collaborator role can be resolved from report collaborator link', () => {
  const rows = buildReportCollaboratorRows({
    collaborators: [
      {
        collaboratorId: 'night-1',
        collaborator: { name: 'Colaborador Noturno', role: 'Operador' }
      }
    ],
    specialConditions: {
      noturnoDetails: {
        collaboratorIds: ['night-1'],
        colaboradores: ['Colaborador Noturno']
      }
    }
  });

  assert.deepEqual(rows, [
    {
      collaboratorname: 'Colaborador Noturno',
      collaboratorname0: 'Colaborador Noturno',
      collaboratorposition: 'Operador',
      collaboratorshift: 'Diurno e Noturno'
    }
  ]);
});

test('night collaborator ids are enriched with name and role before report persistence', async () => {
  const specialConditions = {
    standby: false,
    noturnoDetails: {
      enabled: true,
      inicio: '18:00',
      termino: '20:00',
      collaboratorIds: ['night-1']
    }
  };
  const tx = {
    collaborator: {
      async findMany(query) {
        assert.deepEqual(query.where.id.in, ['night-1']);
        return [{ id: 'night-1', name: 'Colaborador Noturno', role: 'Operador' }];
      }
    }
  };

  const enriched = await enrichNightCollaboratorsInSpecialConditions(tx, specialConditions);

  assert.deepEqual(enriched.noturnoDetails.colaboradores, [
    { id: 'night-1', name: 'Colaborador Noturno', role: 'Operador' }
  ]);
  assert.equal(specialConditions.noturnoDetails.colaboradores, undefined);
});
