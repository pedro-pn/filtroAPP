import assert from 'node:assert/strict';
import test from 'node:test';

import {
  listCollaboratorsWithCurrentJobRole,
  normalizeJobRoleKey,
  planCanonicalJobRoleBackfill,
  requireCanonicalJobRole,
  setCollaboratorCanonicalJobRole
} from '../src/lib/collaborators/job-role-service.js';

test('lista compartilhada entrega cargo canônico e alias visual ao bootstrap do RDO', async () => {
  let query;
  const database = {
    collaborator: {
      findMany: async input => {
        query = input;
        return [{
          id: 'c1',
          name: 'Ana',
          jobRoleId: 'r1',
          signatureImage: '/assinaturas/ana.png',
          jobRole: { id: 'r1', name: 'Química', isActive: true, isOperational: true }
        }];
      }
    }
  };

  const result = await listCollaboratorsWithCurrentJobRole(database, async item => ({
    ...item,
    signatureImage: 'data:image/png;base64,AA=='
  }));

  assert.deepEqual(query, {
    include: {
      jobRole: true,
      jobRoleHistory: {
        include: { jobRole: { select: { id: true, name: true, isActive: true, isOperational: true } } },
        orderBy: { effectiveDate: 'desc' }
      }
    },
    orderBy: { name: 'asc' }
  });
  assert.equal(result[0].jobRole.name, 'Química');
  assert.equal(result[0].role, 'Química');
  assert.equal(result[0].currentRoleName, 'Química');
  assert.equal(result[0].signatureImage, 'data:image/png;base64,AA==');
});

test('normalização canônica ignora acento, caixa e espaços sem casar ambiguidades', () => {
  assert.equal(normalizeJobRoleKey('  TÉCNICO   Mecânico  '), 'tecnico mecanico');
  const plan = planCanonicalJobRoleBackfill(
    [
      { id: 'c1', name: 'Ana', role: 'Técnico Mecânico', jobRoleId: null },
      { id: 'c2', name: 'Bia', role: 'Operador', jobRoleId: null }
    ],
    [
      { id: 'r1', name: 'Tecnico Mecanico' },
      { id: 'r2', name: 'Operador' },
      { id: 'r3', name: 'OPERADOR' }
    ]
  );
  assert.deepEqual(plan.matches, [{ collaboratorId: 'c1', jobRoleId: 'r1', jobRoleName: 'Tecnico Mecanico' }]);
  assert.equal(plan.unresolved[0].reason, 'AMBIGUOUS');
});

test('cargo inativo não pode ser atribuído como cargo canônico', async () => {
  const database = { jobRole: { findUnique: async () => ({ id: 'r1', isActive: false, isOperational: true }) } };
  await assert.rejects(() => requireCanonicalJobRole(database, 'r1'), error => error.code === 'JOB_ROLE_INACTIVE');
});

test('cargo inativo continua disponível para correção de histórico', async () => {
  const role = { id: 'r1', name: 'Cargo histórico', isActive: false, isOperational: true };
  const database = { jobRole: { findUnique: async () => role } };
  assert.equal(await requireCanonicalJobRole(database, 'r1', { requireActive: false }), role);
});

test('troca canônica marca alocações futuras incompatíveis e incrementa revisões', async () => {
  const calls = [];
  const database = {
    jobRole: { findUnique: async () => ({ id: 'r2', name: 'Novo cargo', isActive: true, isOperational: true }) },
    collaborator: {
      findUnique: async query => query.select ? { id: 'c1', jobRoleId: 'r1' } : { id: 'c1', jobRoleId: 'r2', jobRole: { id: 'r2', name: 'Novo cargo' } },
      update: async () => ({ id: 'c1', jobRoleId: 'r2', jobRole: { id: 'r2', name: 'Novo cargo' } })
    },
    efetivoMissionAllocation: {
      findMany: async () => [{
        missionId: 'm1',
        mobilizationDate: null,
        demobilizationDate: null,
        mission: {
          planId: 'p1',
          mobilizationDate: '2099-01-01',
          executionEndDate: '2099-01-30',
          returnDate: '2099-01-31'
        }
      }]
    },
    efetivoMissionPlan: { updateMany: async input => calls.push(['mission', input]) },
    efetivoPlan: { updateMany: async input => calls.push(['plan', input]) }
  };
  const result = await setCollaboratorCanonicalJobRole(database, 'c1', 'r2');
  assert.deepEqual(result.affectedMissionIds, ['m1']);
  assert.equal(calls[0][1].data.needsReplanning, true);
  assert.deepEqual(calls[1][1].data.revision, { increment: 1 });
});
