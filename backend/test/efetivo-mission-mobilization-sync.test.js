import assert from 'node:assert/strict';
import test from 'node:test';

import { syncMissionDemobilization } from '../src/lib/efetivo/planning/mission-planning.js';

test('data inicial da missão oficial atualiza projeto e previsão da gestão', async () => {
  const projectUpdates = [];
  const workflowUpdates = [];
  const tx = {
    project: { update: async input => projectUpdates.push(input) },
    projectWorkflow: { updateMany: async input => workflowUpdates.push(input) }
  };
  await syncMissionDemobilization(tx, { id: 'project-1', mobilizationDate: null }, undefined, '2026-10-05');

  assert.equal(projectUpdates[0].data.mobilizationDate.toISOString().slice(0, 10), '2026-10-05');
  assert.equal(workflowUpdates[0].where.projectId, 'project-1');
  assert.equal(workflowUpdates[0].data.plannedMobilizationDate.toISOString().slice(0, 10), '2026-10-05');
  assert.deepEqual(workflowUpdates[0].data.version, { increment: 1 });

  await syncMissionDemobilization(tx, { id: 'project-1', mobilizationDate: new Date('2026-10-05T00:00:00.000Z') }, undefined, '2026-10-05');
  assert.equal(workflowUpdates.length, 1, 'salvar a mesma data não cria nova versão da gestão');
});
