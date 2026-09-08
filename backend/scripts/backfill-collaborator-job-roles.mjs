import { randomUUID } from 'node:crypto';

import prisma from '../src/lib/prisma.js';
import {
  indexJobRolesByNormalizedKey,
  normalizeJobRoleKey,
  planCanonicalJobRoleBackfill
} from '../src/lib/collaborators/job-role-service.js';

export function planEpiRoleOverrideBackfill(collaborators = [], jobRoles = []) {
  const roleIndex = indexJobRolesByNormalizedKey(jobRoles);
  const matches = [];
  const unresolved = [];
  for (const collaborator of collaborators) {
    const legacyOverride = String(collaborator.epiRoleOverride || '').trim();
    if (!legacyOverride) continue;
    const candidates = roleIndex.get(normalizeJobRoleKey(legacyOverride)) || [];
    if (candidates.length === 1) {
      matches.push({
        collaboratorId: collaborator.id,
        roleOverrideJobRoleId: candidates[0].id,
        roleOverrideName: candidates[0].name
      });
      continue;
    }
    unresolved.push({
      collaboratorId: collaborator.id,
      collaboratorName: collaborator.name || null,
      legacyOverride,
      reason: candidates.length > 1 ? 'AMBIGUOUS' : 'NOT_FOUND',
      candidateIds: candidates.map(candidate => candidate.id)
    });
  }
  return { matches, unresolved };
}

export function planMissingCanonicalJobRoles(collaborators = [], jobRoles = []) {
  const roleIndex = indexJobRolesByNormalizedKey(jobRoles);
  const plannedByKey = new Map();
  const blockingUnresolved = [...roleIndex.entries()]
    .filter(([, candidates]) => candidates.length > 1)
    .map(([normalizedKey, candidates]) => ({
      collaboratorId: null,
      collaboratorName: null,
      source: 'JOB_ROLE_CATALOG',
      legacyRole: normalizedKey,
      reason: 'AMBIGUOUS',
      candidateIds: candidates.map(candidate => candidate.id)
    }));

  const inspectLegacyName = (value, collaborator, source, required) => {
    const name = String(value || '').trim();
    const normalizedKey = normalizeJobRoleKey(name);
    if (!normalizedKey) {
      if (required) {
        blockingUnresolved.push({
          collaboratorId: collaborator.id,
          collaboratorName: collaborator.name || null,
          source,
          legacyRole: null,
          reason: 'EMPTY'
        });
      }
      return;
    }

    const candidates = roleIndex.get(normalizedKey) || [];
    if (candidates.length > 1) return;
    if (candidates.length === 1) return;

    const planned = plannedByKey.get(normalizedKey) || {
      name,
      normalizedKey,
      sources: new Set(),
      collaboratorIds: new Set()
    };
    planned.sources.add(source);
    planned.collaboratorIds.add(collaborator.id);
    plannedByKey.set(normalizedKey, planned);
  };

  for (const collaborator of collaborators) {
    if (!collaborator.jobRoleId) {
      inspectLegacyName(collaborator.role ?? collaborator.legacyRole, collaborator, 'CANONICAL', true);
    }
    if (String(collaborator.epiRoleOverride || '').trim()) {
      inspectLegacyName(collaborator.epiRoleOverride, collaborator, 'EPI_OVERRIDE', false);
    }
  }

  return {
    rolesToCreate: [...plannedByKey.values()]
      .map(role => ({
        ...role,
        sources: [...role.sources].sort(),
        collaboratorIds: [...role.collaboratorIds].sort()
      }))
      .sort((left, right) => left.normalizedKey.localeCompare(right.normalizedKey, 'pt-BR')),
    blockingUnresolved
  };
}

async function columnExists(database, tableName, columnName) {
  const rows = await database.$queryRaw`
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = ${tableName}
      AND column_name = ${columnName}
    LIMIT 1
  `;
  return rows.length > 0;
}

async function loadCollaborators(database) {
  const hasLegacyRole = await columnExists(database, 'Collaborator', 'role');
  const hasLegacyEpiOverride = await columnExists(database, 'Collaborator', 'epiRoleOverride');
  if (!hasLegacyRole && !hasLegacyEpiOverride) {
    return database.collaborator.findMany({
      select: { id: true, name: true, jobRoleId: true }
    });
  }

  const roleExpression = hasLegacyRole ? '"role"' : 'NULL::text';
  const epiExpression = hasLegacyEpiOverride ? '"epiRoleOverride"' : 'NULL::text';
  return database.$queryRawUnsafe(`
    SELECT "id", "name", "jobRoleId", ${roleExpression} AS "role", ${epiExpression} AS "epiRoleOverride"
    FROM "Collaborator"
    ORDER BY "name" ASC
  `);
}

async function createMissingJobRoles(database, rolesToCreate) {
  if (!rolesToCreate.length) return [];
  const hasNormalizedKey = await columnExists(database, 'JobRole', 'normalizedKey');
  const created = [];
  for (const role of rolesToCreate) {
    const id = randomUUID();
    const affectedRows = hasNormalizedKey
      ? await database.$executeRawUnsafe(`
          INSERT INTO "JobRole" ("id", "name", "normalizedKey", "updatedAt")
          VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
          ON CONFLICT ("normalizedKey") DO NOTHING
        `, id, role.name, role.normalizedKey)
      : await database.$executeRawUnsafe(`
          INSERT INTO "JobRole" ("id", "name", "updatedAt")
          VALUES ($1, $2, CURRENT_TIMESTAMP)
          ON CONFLICT ("name") DO NOTHING
        `, id, role.name);
    if (Number(affectedRows) > 0) created.push({ id, name: role.name, normalizedKey: role.normalizedKey });
  }
  return created;
}

async function inspectBackfill(database) {
  const [collaborators, jobRoles] = await Promise.all([
    loadCollaborators(database),
    database.jobRole.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } })
  ]);
  return {
    collaborators,
    jobRoles,
    canonical: planCanonicalJobRoleBackfill(collaborators, jobRoles),
    epiOverrides: planEpiRoleOverrideBackfill(collaborators, jobRoles),
    creation: planMissingCanonicalJobRoles(collaborators, jobRoles)
  };
}

export async function runCollaboratorJobRoleBackfill({ database = prisma, apply = false } = {}) {
  const initial = await inspectBackfill(database);
  const initiallyReady = initial.creation.blockingUnresolved.length === 0;

  if (!apply) {
    return {
      mode: 'dry-run',
      readyForMigration: initiallyReady,
      collaboratorsInspected: initial.collaborators.length,
      canonical: initial.canonical,
      epiOverrides: initial.epiOverrides,
      rolesToCreate: initial.creation.rolesToCreate,
      blockingUnresolved: initial.creation.blockingUnresolved,
      createdJobRoles: [],
      note: 'Nenhum dado foi alterado. Cargos listados em rolesToCreate serão materializados no apply ou pela migration.'
    };
  }

  if (!initiallyReady) {
    const error = new Error('O backfill não pode ser aplicado enquanto existirem nomes de cargo vazios ou associações ambíguas.');
    error.code = 'JOB_ROLE_BACKFILL_BLOCKED';
    error.unresolved = initial.creation.blockingUnresolved;
    throw error;
  }

  return database.$transaction(async tx => {
    const createdJobRoles = await createMissingJobRoles(tx, initial.creation.rolesToCreate);
    const refreshed = await inspectBackfill(tx);
    const readyForMigration = refreshed.canonical.unresolved.length === 0
      && refreshed.epiOverrides.unresolved.length === 0
      && refreshed.creation.blockingUnresolved.length === 0;
    if (!readyForMigration) {
      const error = new Error('O backfill não conseguiu resolver todos os cargos após a materialização canônica.');
      error.code = 'JOB_ROLE_BACKFILL_BLOCKED';
      error.unresolved = [
        ...refreshed.canonical.unresolved,
        ...refreshed.epiOverrides.unresolved,
        ...refreshed.creation.blockingUnresolved
      ];
      throw error;
    }

    for (const match of refreshed.canonical.matches) {
      await tx.collaborator.update({
        where: { id: match.collaboratorId },
        data: { jobRoleId: match.jobRoleId }
      });
    }

    return {
      mode: 'apply',
      readyForMigration: true,
      collaboratorsInspected: refreshed.collaborators.length,
      canonical: refreshed.canonical,
      epiOverrides: refreshed.epiOverrides,
      rolesToCreate: initial.creation.rolesToCreate,
      blockingUnresolved: [],
      createdJobRoles,
      note: 'Cargos canônicos ausentes foram criados e vinculados. Overrides EPI serão materializados pela migration após este gate.'
    };
  });
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const apply = process.argv.includes('--apply');
  const invalidArguments = process.argv.slice(2).filter(argument => !['--apply', '--dry-run'].includes(argument));
  if (invalidArguments.length) {
    console.error(`Argumentos desconhecidos: ${invalidArguments.join(', ')}`);
    process.exitCode = 2;
  } else {
    runCollaboratorJobRoleBackfill({ apply })
      .then(result => {
        console.log(JSON.stringify(result, null, 2));
        if (!result.readyForMigration) process.exitCode = 1;
      })
      .catch(error => {
        console.error(error.message);
        process.exitCode = 1;
      })
      .finally(() => prisma.$disconnect());
  }
}
