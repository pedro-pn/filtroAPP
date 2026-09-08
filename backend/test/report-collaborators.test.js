import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildReportCollaboratorRows,
  resolveCollaboratorsByShift
} from '../src/lib/report-collaborators.js';
import { enrichNightCollaboratorsInSpecialConditions } from '../src/lib/reports/manual-operational-data.js';

test('night collaborator snapshot carries role when collaborator link is absent', () => {
  const rows = buildReportCollaboratorRows({
    collaborators: [
      {
        collaboratorId: 'day-1',
        roleNameSnapshot: 'Tecnico',
        collaborator: { name: 'Colaborador Diurno', jobRole: { name: 'Tecnico' } }
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
        roleNameSnapshot: 'Operador',
        collaborator: { name: 'Colaborador Noturno', jobRole: { name: 'Operador' } }
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
        return [{ id: 'night-1', name: 'Colaborador Noturno', jobRole: { name: 'Operador' } }];
      }
    }
  };

  const enriched = await enrichNightCollaboratorsInSpecialConditions(tx, specialConditions);

  assert.deepEqual(enriched.noturnoDetails.colaboradores, [
    { id: 'night-1', name: 'Colaborador Noturno', role: 'Operador' }
  ]);
  assert.equal(specialConditions.noturnoDetails.colaboradores, undefined);
});

test('service collaborator resolution prefers the saved role snapshot', () => {
  const rows = resolveCollaboratorsByShift({
    collaborators: [{
      collaboratorId: 'collaborator-1',
      roleNameSnapshot: 'Inspetor N2',
      collaborator: { jobRole: { name: 'Supervisor atual' } }
    }],
    specialConditions: {
      noturnoDetails: { collaboratorIds: ['collaborator-1'] }
    }
  }, [{
    id: 'collaborator-1',
    name: 'Ana',
    jobRole: { name: 'Outro cargo atual' }
  }]);

  assert.deepEqual(rows, [{
    id: 'collaborator-1',
    name: 'Ana',
    role: 'Inspetor N2',
    shift: 'Diurno e Noturno'
  }]);
});

test('service report rows recover a missing resolved role from the saved link snapshot', () => {
  const rows = buildReportCollaboratorRows({
    collaborators: [{
      collaboratorId: 'collaborator-1',
      roleNameSnapshot: 'Inspetor N2',
      collaborator: { name: 'Ana', jobRole: { name: 'Supervisor atual' } }
    }],
    specialConditions: {
      resolvedCollaborators: [{
        id: 'collaborator-1',
        name: 'Ana',
        role: '',
        shift: 'Noturno'
      }]
    }
  });

  assert.deepEqual(rows, [{
    collaboratorname: 'Ana',
    collaboratorname0: 'Ana',
    collaboratorposition: 'Inspetor N2',
    collaboratorshift: 'Noturno'
  }]);
});
