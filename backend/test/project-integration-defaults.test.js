import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { initialIntegrationDefaults, PROJECT_DEFAULT_VALUES, projectDefaultsUpdate, manualIntegrationDefaults,
  applyProjectIntegrationDefaults } from '../src/lib/projects/integration-defaults.js';
import { resolveClientSegment } from '../src/lib/projects/client-segment.js';
import { commercialProjectWorkSchedule } from '../src/lib/projects/commercial-work-schedule.js';
import { projectIntakeSchema, receiveProjectIntake } from '../src/lib/projects/project-intake.js';
import { resolvePlanningProject } from '../src/lib/projects/crm-planning-links.js';

const project = () => ({ id: 'p1', ...PROJECT_DEFAULT_VALUES, registrationPending: true,
  integrationDefaults: initialIntegrationDefaults() });
const phase = (id = 'execution') => ({ id, enabled: true, hoursPerDay: 8.8, saturdayCount: 2,
  sundayCount: 1, saturdayHoursPerDay: 8.8, sundayHoursPerDay: 8.8,
  assignments: [{ workSchedule: { days: [{ dayType: 'weekday', normalHoursPerDay: 4 }] } }] });
const snapshot = payload => ({ costBreakdown: payload });

test('a fase escolhida determina o padrão; jornadas individuais e outras fases não interferem', () => {
  const input = { laborContexts: [{ ...phase('pre'), hoursPerDay: 6 }, phase()], projectWorkScheduleContextId: 'execution' };
  assert.deepEqual(commercialProjectWorkSchedule(snapshot(input)), {
    workdayHours: '08:48', weekendWorkdayHours: '08:48', includesSaturday: true, includesSunday: true
  });
  input.laborContexts[1].saturdayCount = 0;
  input.laborContexts[1].sundayCount = 0;
  assert.equal(commercialProjectWorkSchedule(snapshot(input)).includesSaturday, false);
  assert.equal(commercialProjectWorkSchedule(snapshot(input)).includesSunday, false);
});

test('contratos antigos aceitam fase única; múltiplas fases, seleção inválida e ausência de mão de obra não adivinham um padrão', () => {
  assert.equal(commercialProjectWorkSchedule(snapshot({ laborContexts: [phase()] })).workdayHours, '08:48');
  for (const payload of [{}, { laborContexts: [phase('a'), phase('b')] },
    { laborContexts: [phase()], projectWorkScheduleContextId: 'missing' },
    { laborContexts: [{ ...phase(), enabled: false }], projectWorkScheduleContextId: 'execution' },
    { laborContexts: [phase()], scopeConfirmations: { noLabor: true } },
    { laborContexts: [{ ...phase(), hoursPerDay: 25 }] },
    { laborContexts: [{ ...phase(), sundayHoursPerDay: NaN }] }]) {
    assert.deepEqual(commercialProjectWorkSchedule(snapshot(payload)), {});
  }
});

test('revisões atualizam o que veio da origem e preservam ajustes manuais campo a campo', () => {
  const p = project();
  const incoming = { clientSegment: 'naval', workdayHours: '08:48', weekendWorkdayHours: '08:48', includesSaturday: true, includesSunday: true };
  Object.assign(p, projectDefaultsUpdate(p, incoming));
  assert.equal(p.clientSegment, 'naval');
  assert.equal(p.workdayHours, '08:48');
  assert.deepEqual(projectDefaultsUpdate(p, incoming), {});
  Object.assign(p, manualIntegrationDefaults(p, { workdayHours: '07:00', includesSunday: false }), { workdayHours: '07:00', includesSunday: false });
  Object.assign(p, projectDefaultsUpdate(p, { ...incoming, clientSegment: 'energia', workdayHours: '12:00', includesSaturday: false }));
  assert.equal(p.clientSegment, 'energia');
  assert.equal(p.workdayHours, '07:00');
  assert.equal(p.includesSunday, false);
  assert.equal(p.includesSaturday, false);
  assert.deepEqual(projectDefaultsUpdate(p, {}), {});
  const old = { ...project(), registrationPending: false, integrationDefaults: null, workdayHours: '06:00' };
  const changes = projectDefaultsUpdate(old, incoming);
  assert.equal(changes.clientSegment, 'naval');
  assert.equal(changes.workdayHours, undefined);
});

test('alteração manual anterior à chegada da proposta também é preservada, inclusive retornar ao valor original', () => {
  const p = project();
  Object.assign(p, manualIntegrationDefaults(p, { workdayHours: '07:00' }), { workdayHours: '07:00' });
  Object.assign(p, manualIntegrationDefaults(p, { workdayHours: '09:00' }), { workdayHours: '09:00' });
  assert.equal(projectDefaultsUpdate(p, { workdayHours: '12:00' }).workdayHours, undefined);
});

function segments() {
  const rows = [{ slug: 'celulose_papel', label: 'Celulose e Papel', isActive: true },
    { slug: 'antigo', label: 'Antigo', isActive: false }];
  return { rows, findMany: async () => rows, upsert: async ({ create }) => {
    const item = rows.find(row => row.slug === create.slug) || create;
    if (!rows.includes(item)) rows.push(item);
    return item;
  } };
}

test('segmento reutiliza catálogo sem diferenciar acentos ou ordem; novo segmento é cadastrado e inativo é respeitado', async () => {
  const clientSegment = segments();
  const tx = { clientSegment };
  assert.equal(await resolveClientSegment(tx, 'Papel e celulose'), 'celulose_papel');
  assert.equal(await resolveClientSegment(tx, 'Mineração'), 'mineracao');
  assert.equal(await resolveClientSegment(tx, 'MINERACAO'), 'mineracao');
  assert.equal(clientSegment.rows.length, 3);
  assert.equal(await resolveClientSegment(tx, 'Antigo'), null);
  assert.equal(await resolveClientSegment(tx, ''), null);
});

test('mudança concorrente não deixa a integração sobrescrever uma edição', async () => {
  const p = project();
  await assert.rejects(applyProjectIntegrationDefaults({ project: {
    findUnique: async () => p, updateMany: async ({ where }) => {
      assert.equal(where.workdayHours, '09:00');
      return { count: 0 };
    }
  } }, p.id, { workdayHours: '08:48' }), { code: 'P2034' });
});

test('cadastro legado recebe o segmento opcional já relacionado ao catálogo', async () => {
  const raw = { code: '005719', name: 'Projeto', clientName: 'Cliente', clientCnpj: '12345678000190', proposalCode: '3088', revision: 0, location: 'Sede', clientSegment: 'Papel e celulose' };
  assert.equal(projectIntakeSchema.parse(raw).clientSegment, raw.clientSegment);
  let saved;
  const tx = { clientSegment: segments(), project: {
    findUnique: async () => null, create: async ({ data }) => { saved = data; return { id: 'p1', ...data }; }
  } };
  await receiveProjectIntake(raw, tx, { selectAccessRevision: false });
  assert.equal(saved.clientSegment, 'celulose_papel');
  assert.equal(saved.integrationDefaults.values.clientSegment, 'celulose_papel');
});

test('planejamento passa o segmento para a criação e o vínculo confirmado', async () => {
  const p = project();
  Object.assign(p, { code: '005719', clientCnpj: '12345678000190', contractCode: '3088 Rev. 0', isActive: true });
  const tx = { clientSegment: segments(), project: {
    findUnique: async () => p,
    updateMany: async ({ data }) => { Object.assign(p, data); return { count: 1 }; }
  } };
  const input = { sourceSystem: 'prismaCRM', tenantId: 'filtrovali', environment: 'sandbox', opportunity: {
    commercialStatus: 'WON', scope: { kind: 'PRIMARY' }, client: { taxId: p.clientCnpj, segment: 'Papel e celulose' },
    proposal: { code: '3088' }, project: { filtroappProjectId: p.id, number: p.code }
  } };
  const result = await resolvePlanningProject(tx, input, null);
  assert.equal(result.projectId, p.id);
  assert.equal(p.clientSegment, 'celulose_papel');
});

test('migração adiciona somente metadados, preservando os campos dos projetos existentes', async () => {
  const db = new PGlite();
  try {
    await db.exec('CREATE TABLE "Project" (id text PRIMARY KEY, "workdayHours" text); INSERT INTO "Project" VALUES (\'p\',\'07:00\');');
    await db.exec(await readFile(new URL('../prisma/migrations/20261026150000_project_integration_defaults/migration.sql', import.meta.url), 'utf8'));
    assert.deepEqual((await db.query('SELECT "workdayHours", "integrationDefaults" FROM "Project"')).rows, [{ workdayHours: '07:00', integrationDefaults: null }]);
  } finally { await db.close(); }
});
