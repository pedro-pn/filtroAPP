import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  COLLABORATOR_SKILLS,
  collaboratorSkillEntries,
  collaboratorSkillLevelMeta,
  collaboratorSkillScore,
  meetsCollaboratorSkill,
  normalizeCollaboratorSkillLevels
} from '../../shared/modules/collaborator-skills.js';
import { collaboratorInputSchema } from '../src/lib/efetivo/planning/schemas.js';
import { listPlanningCollaborators } from '../src/lib/efetivo/planning/read-model.js';

const baseInput = { name: 'Ana', jobRoleId: 'r1', admissionDate: '2025-01-01' };

test('catálogo segue a matriz: cinco habilidades e legenda de 0 a 3', () => {
  assert.deepEqual(COLLABORATOR_SKILLS.map(skill => skill.label), ['Flushing', 'Limpeza química', 'Filtragem', 'Hidrojato', 'Teste hidrostático']);
  assert.equal(collaboratorSkillLevelMeta(3).label, 'Apto / executa com autonomia');
  assert.equal(collaboratorSkillLevelMeta(2).label, 'Intermediário / executa com supervisão');
  assert.equal(collaboratorSkillLevelMeta(1).label, 'Em desenvolvimento / conhecimento básico');
  assert.equal(collaboratorSkillLevelMeta(0).label, 'Sem experiência ou não avaliado');
});

test('normalização descarta chaves desconhecidas, níveis inválidos e o nível 0', () => {
  assert.deepEqual(
    normalizeCollaboratorSkillLevels({ FLUSHING: 3, FILTRATION: 0, HYDROJETTING: 4, HYDROSTATIC_TEST: 1.5, CHEMICAL_CLEANING: '2', OTHER: 2 }),
    { FLUSHING: 3 }
  );
  assert.deepEqual(normalizeCollaboratorSkillLevels(null), {});
  assert.deepEqual(normalizeCollaboratorSkillLevels([3]), {});
});

test('entradas, filtro por nível mínimo e pontuação', () => {
  const levels = { FLUSHING: 3, FILTRATION: 2 };
  assert.deepEqual(collaboratorSkillEntries(levels).map(entry => [entry.key, entry.level]), [['FLUSHING', 3], ['FILTRATION', 2]]);
  assert.equal(collaboratorSkillEntries(levels, { includeZero: true }).length, 5);
  assert.equal(meetsCollaboratorSkill(levels, 'FILTRATION', 2), true);
  assert.equal(meetsCollaboratorSkill(levels, 'FILTRATION', 3), false);
  assert.equal(meetsCollaboratorSkill(levels, 'HYDROJETTING', 1), false);
  assert.equal(meetsCollaboratorSkill(levels, '', 3), true);
  assert.equal(collaboratorSkillScore(levels), 5);
});

test('cadastro aceita a matriz opcional e rejeita habilidade ou nível fora do catálogo', () => {
  assert.equal(collaboratorInputSchema.parse(baseInput).skillLevels, undefined);
  assert.deepEqual(collaboratorInputSchema.parse({ ...baseInput, skillLevels: { FLUSHING: 3, HYDROJETTING: 0 } }).skillLevels, { FLUSHING: 3, HYDROJETTING: 0 });
  assert.equal(collaboratorInputSchema.safeParse({ ...baseInput, skillLevels: { SOLDA: 2 } }).success, false);
  assert.equal(collaboratorInputSchema.safeParse({ ...baseInput, skillLevels: { FLUSHING: 4 } }).success, false);
  assert.equal(collaboratorInputSchema.safeParse({ ...baseInput, skillLevels: { FLUSHING: 1.5 } }).success, false);
});

test('lista de planejamento devolve a matriz normalizada de cada colaborador', async () => {
  let select;
  const database = {
    efetivoPlan: { findFirst: async () => ({ id: 'p1' }) },
    collaborator: {
      findMany: async query => {
        select = query.select;
        return [{ id: 'c1', name: 'Ana', jobRoleId: 'r1', jobRole: { id: 'r1', name: 'Operadora' }, admissionDate: new Date('2025-07-04T00:00:00.000Z'), terminationDate: null, isActive: true, skillLevels: { FLUSHING: 3, FILTRATION: 0, OTHER: 1 } }];
      }
    },
    jobRole: { findMany: async () => [{ id: 'r1', name: 'Operadora', isActive: true, isOperational: true }] },
    efetivoMissionPlan: { findMany: async () => [] },
    collaboratorAbsence: { findMany: async () => [] },
    workforceHoliday: { findMany: async () => [] },
    workforceCalendarState: { findUnique: async () => ({ id: 'global', revision: 1 }) },
    efetivoSetting: { findUnique: async () => null },
    efetivoPlannedHire: { findMany: async () => [] }
  };
  const rows = await listPlanningCollaborators({ date: '2026-08-21' }, { database });
  assert.equal(select.skillLevels, true);
  assert.deepEqual(rows[0].skillLevels, { FLUSHING: 3 });
});

test('alocações de missão e equipe do fluxo carregam a matriz do colaborador', () => {
  const read = file => fs.readFileSync(new URL(file, import.meta.url), 'utf8');
  assert.match(read('../src/lib/efetivo/planning/mission-planning.js'), /collaborator: \{ select: \{[^}]*skillLevels: true/);
  assert.match(read('../src/lib/efetivo/planning/read-model.js'), /collaborator: \{ select: \{[^}]*skillLevels: true/);
  const workflow = read('../src/lib/efetivo/project-workflow/service.js');
  assert.match(workflow, /skillLevels: normalizeCollaboratorSkillLevels\(allocation\.collaborator\.skillLevels\)/);
  assert.match(workflow, /skillLevels: normalizeCollaboratorSkillLevels\(allocation\.collaborator\?\.skillLevels\)/);
});

test('contrato do Efetivo documenta a matriz de habilidades', () => {
  const contract = fs.readFileSync(new URL('../../specs/012-planejamento-efetivo/contracts/efetivo-planning.openapi.yaml', import.meta.url), 'utf8');
  const schema = contract.slice(contract.indexOf('    CollaboratorSkillLevels:'), contract.indexOf('    CollaboratorPlanning:'));
  for (const skill of COLLABORATOR_SKILLS) assert.ok(schema.includes(`${skill.key}:`), skill.key);
});

test('edição direta da matriz grava só skillLevels, normalizada e auditada', async () => {
  const { updatePlanningCollaboratorSkills } = await import('../src/lib/efetivo/planning/collaborators.js');
  const { collaboratorSkillsInputSchema } = await import('../src/lib/efetivo/planning/schemas.js');
  assert.deepEqual(collaboratorSkillsInputSchema.parse({ skillLevels: { FLUSHING: 2, FILTRATION: 0 } }), { skillLevels: { FLUSHING: 2, FILTRATION: 0 } });
  assert.equal(collaboratorSkillsInputSchema.safeParse({ skillLevels: { FLUSHING: 2 }, name: 'X' }).success, false);
  assert.equal(collaboratorSkillsInputSchema.safeParse({ skillLevels: { SOLDA: 1 } }).success, false);

  const updates = [];
  const audits = [];
  const plan = { id: 'p1', kind: 'OFFICIAL', status: 'ACTIVE' };
  const database = {
    efetivoPlan: { findFirst: async () => plan, findUnique: async () => plan },
    collaborator: {
      findUnique: async () => ({ id: 'c1', name: 'Ana', skillLevels: { FLUSHING: 1 } }),
      findMany: async () => [{ id: 'c1' }],
      update: async query => { updates.push(query); return {}; }
    },
    efetivoAuditEvent: { create: async query => { audits.push(query); return {}; } }
  };
  const result = await updatePlanningCollaboratorSkills('c1', { FLUSHING: 3, FILTRATION: 0, HYDROJETTING: 2 }, { actorUserId: 'u1' }, { database });
  assert.deepEqual(result, { id: 'c1', skillLevels: { FLUSHING: 3, HYDROJETTING: 2 } });
  assert.deepEqual(updates, [{ where: { id: 'c1' }, data: { skillLevels: { FLUSHING: 3, HYDROJETTING: 2 } } }]);
  assert.equal(audits.length, 1);
  assert.deepEqual(audits[0].data.beforeData, { skillLevels: { FLUSHING: 1 } });
  assert.deepEqual(audits[0].data.afterData, { skillLevels: { FLUSHING: 3, HYDROJETTING: 2 } });

  database.collaborator.findUnique = async () => null;
  await assert.rejects(updatePlanningCollaboratorSkills('x', {}, {}, { database }), /Colaborador não encontrado/);
});

test('rota PATCH /collaborators/:id/skills exige gestor do Efetivo', () => {
  const routes = fs.readFileSync(new URL('../src/routes/efetivo-planning.js', import.meta.url), 'utf8');
  assert.match(routes, /PATCH \/collaborators\/:collaboratorId\/skills[^\n]*requireEfetivoManager/);
});

test('withCollaboratorSkillLevel troca um nível sem alterar a matriz original', async () => {
  const { withCollaboratorSkillLevel } = await import('../../shared/modules/collaborator-skills.js');
  const original = { FLUSHING: 3, FILTRATION: 1 };
  assert.deepEqual(withCollaboratorSkillLevel(original, 'FILTRATION', 2), { FLUSHING: 3, FILTRATION: 2 });
  assert.deepEqual(withCollaboratorSkillLevel(original, 'FLUSHING', 0), { FILTRATION: 1 });
  assert.deepEqual(withCollaboratorSkillLevel(null, 'HYDROJETTING', 1), { HYDROJETTING: 1 });
  assert.deepEqual(original, { FLUSHING: 3, FILTRATION: 1 });
});
