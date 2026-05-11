import assert from 'node:assert/strict';
import test from 'node:test';

import { collaboratorCanAccessProject } from '../src/routes/resources/reports.js';

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
  assert.equal(collaboratorCanAccessProject(auth, { ...baseProject, visibleToCollaborators: false }), false);
  assert.equal(collaboratorCanAccessProject(auth, { ...baseProject, managerOnly: true }), false);
});
