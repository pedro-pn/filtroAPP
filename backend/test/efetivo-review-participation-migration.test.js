import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { apiSimulationDatabase } from './helpers/api-simulation-db.js';
import { listReviewParticipants, updateReviewParticipation } from '../src/lib/efetivo/allocation-review/participation.js';
import { getReviewWeek } from '../src/lib/efetivo/allocation-review/read-model.js';
import { withWorkforceVisibility } from '../src/lib/collaborators/workforce-visibility-context.js';
import { defaultWorkforceVisibilityRules } from '../../shared/modules/workforce-visibility.js';

test('migração da participação preserva escolhas, corrige Sim indevido e usa somente operacionais no Efetivo', { timeout: 180000 }, async t => {
  const database = await apiSimulationDatabase();
  t.after(() => database.close());
  const db = database.client;
  const migration = await readFile(new URL('../prisma/migrations/20261124190000_efetivo_review_participation/migration.sql', import.meta.url), 'utf8');
  const roles = {};
  for (const classification of ['OPERATIONAL', 'NON_OPERATIONAL', 'PENDING']) {
    roles[classification] = await db.jobRole.create({ data: { name: classification, normalizedKey: classification, workforceClassification: classification } });
  }
  const people = {};
  for (const [code, role, override, enabled] of [
    ['included', 'OPERATIONAL', null, true], ['excluded', 'OPERATIONAL', null, false],
    ['office', 'NON_OPERATIONAL', null, true], ['pending', 'PENDING', null, true],
    ['override-op', 'NON_OPERATIONAL', 'OPERATIONAL', true], ['override-office', 'OPERATIONAL', 'NON_OPERATIONAL', true]
  ]) {
    people[code] = await db.collaborator.create({ data: { code, name: code, jobRoleId: roles[role].id,
      workforceClassificationOverride: override, allocationReviewEnabled: enabled, admissionDate: new Date('2026-01-01T00:00:00Z') } });
  }
  const current = code => db.collaborator.findUniqueOrThrow({ where: { id: people[code].id } });
  await database.db.exec('ALTER TABLE "Collaborator" ALTER COLUMN "allocationReviewEnabled" SET DEFAULT true;');
  await database.db.exec(migration);
  for (const code of ['included', 'override-op']) {
    assert.equal((await current(code)).allocationReviewEnabled, true);
    assert.equal((await current(code)).classificationVersion, 1);
  }
  for (const code of ['office', 'pending', 'override-office']) {
    assert.equal((await current(code)).allocationReviewEnabled, false);
    assert.equal((await current(code)).classificationVersion, 2);
    assert.equal((await current(code)).workforceClassificationOverride, people[code].workforceClassificationOverride);
  }
  assert.equal((await current('excluded')).allocationReviewEnabled, false);
  assert.equal((await current('excluded')).classificationVersion, 1);
  // Inserts outside Prisma must receive the same default as RH and application writes.
  await database.db.query('INSERT INTO "Collaborator" (id, code, name, "jobRoleId", "updatedAt") VALUES ($1, $1, $1, $2, CURRENT_TIMESTAMP)', ['raw-new', roles.OPERATIONAL.id]);
  assert.equal((await db.collaborator.findUniqueOrThrow({ where: { id: 'raw-new' } })).allocationReviewEnabled, false);
  const before = await db.collaborator.findMany({ orderBy: { id: 'asc' } });
  await database.db.exec(migration);
  assert.deepEqual(await db.collaborator.findMany({ orderBy: { id: 'asc' } }), before);

  const rules = { ...defaultWorkforceVisibilityRules(), ALLOCATION_REVIEW: [], EFETIVO: [] };
  await db.efetivoSetting.create({ data: { key: 'workforce.visibility.v1', numberValue: 1, textValue: JSON.stringify(rules) } });
  // An operational person hidden by the old global matrix stays disabled on migration.
  await database.db.exec(migration);
  assert.equal((await current('included')).allocationReviewEnabled, false);
  assert.equal((await current('included')).classificationVersion, 2);
  const configuration = { version: 1, rules };
  const list = await withWorkforceVisibility('EFETIVO', () => listReviewParticipants(db), configuration);
  assert.deepEqual(list.map(person => person.code).sort(), ['excluded', 'included', 'override-op', 'raw-new']);
  assert.ok(list.every(person => person.allocationReviewEnabled === false));
  for (const code of ['office', 'pending', 'override-office']) {
    await assert.rejects(() => updateReviewParticipation(db, people[code].id, { allocationReviewEnabled: true, version: 2 }), error => error.code === 'COLLABORATOR_NOT_OPERATIONAL');
  }
  await assert.rejects(() => updateReviewParticipation(db, 'missing', { allocationReviewEnabled: true, version: 1 }), error => error.status === 404);

  // After migration, only the Efetivo toggle determines inclusion alongside classification.
  await updateReviewParticipation(db, people.included.id, { allocationReviewEnabled: true, version: 2 });
  const week = await withWorkforceVisibility('ALLOCATION_REVIEW', () => getReviewWeek({ weekStart: '2026-11-02', now: new Date('2026-11-24T15:00:00Z') }, {
    database: db, getTrails: async () => new Map(), loadEffectiveIndex: async () => new Map(),
    loadCalendar: async () => ({ holidays: [], holidayDates: new Set() })
  }), configuration);
  assert.deepEqual(week.rows.map(row => row.collaborator.id), [people.included.id]);
});
