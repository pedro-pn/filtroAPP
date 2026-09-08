import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { planCanonicalJobRoleBackfill } from '../src/lib/collaborators/job-role-service.js';
import {
  planEpiRoleOverrideBackfill,
  planMissingCanonicalJobRoles,
  runCollaboratorJobRoleBackfill
} from '../scripts/backfill-collaborator-job-roles.mjs';

const roles = [
  { id: 'r1', name: 'Eletricista' },
  { id: 'r2', name: 'Auxiliar de Eletricista' }
];

test('dry-run canônico é determinístico e não cria associação inexistente', () => {
  const collaborators = [
    { id: 'c1', name: 'Ana', role: 'ELETRICISTA', jobRoleId: null },
    { id: 'c2', name: 'Bia', role: 'Cargo não cadastrado', jobRoleId: null }
  ];
  const first = planCanonicalJobRoleBackfill(collaborators, roles);
  const second = planCanonicalJobRoleBackfill(collaborators, roles);
  assert.deepEqual(first, second);
  assert.equal(first.matches[0].jobRoleId, 'r1');
  assert.equal(first.unresolved[0].reason, 'NOT_FOUND');
});

test('override EPI existente é preservado por vínculo com cargo inativo ou ativo', () => {
  const result = planEpiRoleOverrideBackfill([
    { id: 'c1', name: 'Ana', epiRoleOverride: ' auxiliar de eletricista ' }
  ], roles);
  assert.deepEqual(result.unresolved, []);
  assert.equal(result.matches[0].roleOverrideJobRoleId, 'r2');
});

test('cargos legados ausentes são planejados uma única vez por nome normalizado', () => {
  const result = planMissingCanonicalJobRoles([
    { id: 'c1', name: 'Ana', role: ' Auxiliar ', epiRoleOverride: null, jobRoleId: null },
    { id: 'c2', name: 'Bia', role: 'AUXILIAR', epiRoleOverride: 'Químico', jobRoleId: null },
    { id: 'c3', name: 'Caio', role: 'Eletricista', epiRoleOverride: null, jobRoleId: null }
  ], roles);

  assert.deepEqual(result.rolesToCreate.map(role => ({ name: role.name, normalizedKey: role.normalizedKey })), [
    { name: 'Auxiliar', normalizedKey: 'auxiliar' },
    { name: 'Químico', normalizedKey: 'quimico' }
  ]);
  assert.deepEqual(result.blockingUnresolved, []);
});

test('nome legado vazio continua bloqueando a centralização automática', () => {
  const result = planMissingCanonicalJobRoles([
    { id: 'c-empty', name: 'Sem cargo', role: '   ', epiRoleOverride: null, jobRoleId: null }
  ], roles);

  assert.deepEqual(result.rolesToCreate, []);
  assert.equal(result.blockingUnresolved[0].reason, 'EMPTY');
});

test('duplicidade normalizada no catálogo continua bloqueando mesmo sem colaborador afetado', () => {
  const result = planMissingCanonicalJobRoles([], [
    { id: 'r-a', name: 'Operador' },
    { id: 'r-b', name: 'OPERADOR' }
  ]);

  assert.equal(result.blockingUnresolved[0].source, 'JOB_ROLE_CATALOG');
  assert.deepEqual(result.blockingUnresolved[0].candidateIds, ['r-a', 'r-b']);
});

test('apply cria cargo ausente, vincula todos os colaboradores equivalentes e é idempotente', async () => {
  const collaborators = [
    { id: 'c1', name: 'Ana', role: 'Auxiliar', epiRoleOverride: null, jobRoleId: null },
    { id: 'c2', name: 'Bia', role: ' auxiliar ', epiRoleOverride: null, jobRoleId: null }
  ];
  const storedRoles = [...roles];
  const createdNames = [];
  const database = {
    $queryRaw: async (_parts, _tableName, columnName) => (
      ['role', 'epiRoleOverride'].includes(columnName) ? [{ exists: 1 }] : []
    ),
    $queryRawUnsafe: async (sql, ...parameters) => {
      if (sql.includes('SELECT "id", "name", "jobRoleId"')) return collaborators;
      throw new Error(`SQL inesperado no teste: ${sql}`);
    },
    $executeRawUnsafe: async (sql, ...parameters) => {
      if (sql.includes('INSERT INTO "JobRole"')) {
        const [id, name] = parameters;
        if (!storedRoles.some(role => role.name === name)) {
          storedRoles.push({ id, name });
          createdNames.push(name);
        }
        return 1;
      }
      throw new Error(`SQL inesperado no teste: ${sql}`);
    },
    $transaction: async callback => callback(database),
    jobRole: { findMany: async () => storedRoles },
    collaborator: {
      update: async ({ where, data }) => {
        const collaborator = collaborators.find(item => item.id === where.id);
        collaborator.jobRoleId = data.jobRoleId;
        return collaborator;
      }
    }
  };

  const first = await runCollaboratorJobRoleBackfill({ database, apply: true });
  const second = await runCollaboratorJobRoleBackfill({ database, apply: true });

  assert.deepEqual(createdNames, ['Auxiliar']);
  assert.equal(new Set(collaborators.map(item => item.jobRoleId)).size, 1);
  assert.equal(first.createdJobRoles.length, 1);
  assert.equal(second.createdJobRoles.length, 0);
  assert.equal(second.readyForMigration, true);
});

test('migration materializa cargos ausentes antes do vínculo e do gate obrigatório', () => {
  const sql = readFileSync(new URL('../prisma/migrations/20260826160000_centralize_workforce_planning/migration.sql', import.meta.url), 'utf8');
  const createMissingAt = sql.indexOf('INSERT INTO "JobRole"');
  const linkCollaboratorsAt = sql.indexOf('WITH matched_roles AS');
  const notNullGateAt = sql.indexOf('ALTER TABLE "Collaborator" ALTER COLUMN "jobRoleId" SET NOT NULL');

  assert.ok(createMissingAt >= 0);
  assert.ok(createMissingAt < linkCollaboratorsAt);
  assert.ok(linkCollaboratorsAt < notNullGateAt);
});
