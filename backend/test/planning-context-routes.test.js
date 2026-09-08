import assert from 'node:assert/strict';
import test from 'node:test';

import { getLastReportCollaboratorPrefill } from '../src/lib/reports/collaborator-prefill.js';
import { officialMissionContextQuerySchema } from '../src/lib/workforce/schemas.js';

test('contrato de contexto exige projeto e data civil estrita', () => {
  assert.equal(officialMissionContextQuerySchema.safeParse({ projectId: 'p1', date: '2026-08-01' }).success, true);
  assert.equal(officialMissionContextQuerySchema.safeParse({ projectId: 'p1', date: '01/08/2026' }).success, false);
});

test('contexto sanitizado não contém cenário, capacidade nem auditoria', () => {
  const publicKeys = ['missionId', 'missionVersion', 'planRevision', 'calendarRevision', 'projectId', 'dates', 'collaborators'];
  assert.equal(publicKeys.includes('auditEvents'), false);
  assert.equal(publicKeys.includes('plannedUtilization90d'), false);
  assert.equal(publicKeys.includes('scenarioId'), false);
});

test('prefill consulta somente a equipe do último RDO até a data selecionada', async () => {
  let query;
  const result = await getLastReportCollaboratorPrefill({
    projectId: 'p1',
    date: '2026-08-20'
  }, {
    report: {
      findFirst: async input => {
        query = input;
        return {
          collaborators: [{ collaboratorId: 'c1' }, { collaboratorId: 'c2' }]
        };
      }
    }
  });

  assert.equal(query.where.projectId, 'p1');
  assert.equal(query.where.reportType, 'RDO');
  assert.equal(query.where.deletedAt, null);
  assert.equal(query.where.reportDate.lte.toISOString(), '2026-08-20T23:59:59.999Z');
  assert.deepEqual(query.select, {
    collaborators: { select: { collaboratorId: true } }
  });
  assert.deepEqual(result.collaboratorIds, ['c1', 'c2']);
});

test('prefill retorna nulo quando não existe RDO anterior', async () => {
  const result = await getLastReportCollaboratorPrefill({ projectId: 'p1', date: '2026-08-20' }, {
    report: { findFirst: async () => null }
  });
  assert.equal(result, null);
});
