import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertCompleteTubeRows,
  canAccessReport,
  collaboratorCanAccessProject,
  collaboratorReportProjectWhere
} from '../src/routes/resources/reports.js';

const auth = {
  user: {
    id: 'user-carlos',
    role: 'COLLABORATOR',
    collaboratorId: 'collab-carlos'
  },
  rawUser: {
    collaboratorId: 'collab-carlos'
  }
};

test('collaborator access is tied to project operator, not client CNPJ', () => {
  const carlosProject = {
    isActive: true,
    visibleToCollaborators: true,
    managerOnly: false,
    clientCnpj: '07264184000146',
    operatorId: 'collab-carlos'
  };
  const anaProjectSameCnpj = {
    ...carlosProject,
    operatorId: 'collab-ana'
  };

  assert.equal(collaboratorCanAccessProject(auth, carlosProject), true);
  assert.equal(collaboratorCanAccessProject(auth, anaProjectSameCnpj), false);
});

test('collaborator access requires an active visible non-manager project', () => {
  const baseProject = {
    isActive: true,
    visibleToCollaborators: true,
    managerOnly: false,
    operatorId: 'collab-carlos'
  };

  assert.equal(collaboratorCanAccessProject(auth, { ...baseProject, isActive: false }), false);
  assert.equal(collaboratorCanAccessProject(auth, { ...baseProject, deletedAt: new Date() }), false);
  assert.equal(collaboratorCanAccessProject(auth, { ...baseProject, visibleToCollaborators: false }), false);
  assert.equal(collaboratorCanAccessProject(auth, { ...baseProject, managerOnly: true }), false);
});

test('collaborator report list filters by led project only', () => {
  assert.deepEqual(collaboratorReportProjectWhere('collab-carlos'), {
    isActive: true,
    deletedAt: null,
    visibleToCollaborators: true,
    managerOnly: false,
    operatorId: 'collab-carlos'
  });
  assert.deepEqual(collaboratorReportProjectWhere(null), { id: '__NO_MATCH__' });
});

test('report access rejects reports under soft-deleted projects', async () => {
  assert.equal(
    await canAccessReport(
      { user: { id: 'manager-1', role: 'MANAGER' } },
      { id: 'report-1', project: { deletedAt: new Date() } }
    ),
    false
  );
  assert.equal(
    await canAccessReport(
      { user: { id: 'client-1', role: 'CLIENT', username: 'client@example.com' } },
      {
        id: 'report-1',
        project: {
          deletedAt: new Date(),
          managerOnly: false,
          clientEmailPrimary: 'client@example.com',
          clientEmailCc: []
        }
      }
    ),
    false
  );
});

test('tube rows require diameter and length when service uses tubing', () => {
  assert.doesNotThrow(() => assertCompleteTubeRows([{
    serviceType: 'pressao',
    extraData: {
      'Diâmetros e comprimentos': [{ d: '10', unit: 'pol', c: '45', lengthUnit: 'm' }]
    }
  }]));

  assert.throws(
    () => assertCompleteTubeRows([{
      serviceType: 'pressao',
      extraData: {
        'Diâmetros e comprimentos': [{ d: '10', unit: 'pol', c: '', lengthUnit: 'm' }]
      }
    }]),
    /Preencha diâmetro e comprimento/
  );
});
