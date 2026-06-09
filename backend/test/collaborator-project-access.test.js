import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertCompleteTubeRows,
  canAccessReport,
  collaboratorCanAccessProject,
  collaboratorCanMutateReport,
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

test('collaborator access allows explicit authorized project users', () => {
  const project = {
    isActive: true,
    visibleToCollaborators: false,
    managerOnly: false,
    operatorId: 'collab-ana',
    authorizedUsers: [{ userId: 'user-carlos' }]
  };

  assert.equal(collaboratorCanAccessProject(auth, project), true);
});

test('project authorization grants report viewing without edit ownership', async () => {
  const report = {
    id: 'report-1',
    createdByUserId: 'user-ana',
    project: {
      isActive: true,
      visibleToCollaborators: false,
      managerOnly: false,
      operatorId: 'collab-ana',
      authorizedUsers: [{ userId: 'user-carlos' }]
    },
    collaborators: []
  };

  assert.equal(await canAccessReport(auth, report), true);
  assert.equal(collaboratorCanMutateReport(auth, report), false);
});

test('collaborator report access rejects hidden or inactive projects even for operator and participant', async () => {
  const baseReport = {
    id: 'report-1',
    createdByUserId: 'user-ana',
    project: {
      isActive: true,
      visibleToCollaborators: true,
      managerOnly: false,
      operatorId: 'collab-carlos',
      authorizedUsers: []
    },
    collaborators: [{ collaboratorId: 'collab-carlos' }]
  };

  assert.equal(
    await canAccessReport(auth, {
      ...baseReport,
      project: { ...baseReport.project, visibleToCollaborators: false }
    }),
    false
  );
  assert.equal(
    await canAccessReport(auth, {
      ...baseReport,
      project: { ...baseReport.project, isActive: false }
    }),
    false
  );
  assert.equal(collaboratorCanMutateReport(auth, {
    ...baseReport,
    project: { ...baseReport.project, visibleToCollaborators: false }
  }), false);
});

test('collaborator report access still allows explicit authorized users on hidden active projects', async () => {
  const report = {
    id: 'report-1',
    createdByUserId: 'user-ana',
    project: {
      isActive: true,
      visibleToCollaborators: false,
      managerOnly: false,
      operatorId: 'collab-ana',
      authorizedUsers: [{ userId: 'user-carlos' }]
    },
    collaborators: []
  };

  assert.equal(await canAccessReport(auth, report), true);
  assert.equal(collaboratorCanMutateReport(auth, report), false);
});

test('collaborator report list filters by led or explicitly authorized project', () => {
  assert.deepEqual(collaboratorReportProjectWhere('collab-carlos', 'user-carlos'), {
    isActive: true,
    deletedAt: null,
    managerOnly: false,
    OR: [
      {
        visibleToCollaborators: true,
        operatorId: 'collab-carlos'
      },
      {
        authorizedUsers: {
          some: { userId: 'user-carlos' }
        }
      }
    ]
  });
  assert.deepEqual(collaboratorReportProjectWhere(null, null), { id: '__NO_MATCH__' });
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

test('client report access can reuse preloaded project visibility context', async () => {
  const project = {
    id: 'project-1',
    deletedAt: null,
    managerOnly: false,
    clientCnpj: '12345678000190',
    clientEmailPrimary: 'client@example.com',
    clientEmailCc: []
  };
  const parentRdo = {
    id: 'rdo-1',
    projectId: 'project-1',
    reportType: 'RDO',
    status: 'SIGNED',
    reportDate: new Date('2026-05-20T00:00:00.000Z'),
    project
  };
  const serviceReport = {
    id: 'rtp-1',
    projectId: 'project-1',
    reportType: 'RTP',
    status: 'APPROVED',
    reportDate: new Date('2026-05-21T00:00:00.000Z'),
    specialConditions: { parentRdoId: 'rdo-1' },
    project
  };
  const clientAuth = {
    user: {
      id: 'client-1',
      role: 'CLIENT',
      username: 'client@example.com'
    }
  };
  const clientVisibilityById = new Map([
    [parentRdo.id, parentRdo],
    [serviceReport.id, serviceReport]
  ]);

  assert.equal(await canAccessReport(clientAuth, serviceReport, { clientVisibilityById }), true);
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
