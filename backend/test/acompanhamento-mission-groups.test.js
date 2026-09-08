import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  createMissionGroup,
  dissolveMissionGroup,
  getActiveMissionGroup,
  listMissionGroups,
  loadActiveMissionGroups,
  MissionGroupError,
  renameMissionGroup,
  updateMissionGroup
} from '../src/lib/acompanhamento/mission-groups.js';
import { parseMissionGroupUpdate } from '../src/routes/resources/acompanhamento-comercial.js';
import { requireAcompanhamentoManager } from '../src/middleware/auth.js';

function createFakeDb({ projects = [], groups = [], members = [], reports = [], purchases = [], receivables = [] } = {}) {
  const state = {
    projects: structuredClone(projects),
    groups: structuredClone(groups),
    members: structuredClone(members),
    reports: structuredClone(reports),
    purchases: structuredClone(purchases),
    receivables: structuredClone(receivables)
  };

  function projectFor(id) {
    return state.projects.find(project => project.id === id) ?? null;
  }

  function hydrateGroup(group, include) {
    return {
      ...group,
      members: state.members
        .filter(member => member.groupId === group.id)
        .sort((a, b) => a.order - b.order)
        .map(member => ({
          ...member,
          project: projectFor(member.projectId)
        }))
        .filter(member => include?.members?.where?.project?.managerOnly !== false || !member.project?.managerOnly)
    };
  }

  const db = {
    state,
    $transaction: async (fn) => fn(db),
    project: {
      findMany: async ({ where }) => {
        const ids = where.id?.in ?? [];
        return state.projects.filter(project => ids.includes(project.id) && project.deletedAt == null);
      }
    },
    acompanhamentoMissionGroupMember: {
      findMany: async ({ where }) => {
        const ids = where.activeProjectId?.in ?? [];
        return state.members.filter(member => ids.includes(member.activeProjectId));
      },
      updateMany: async ({ where, data }) => {
        let count = 0;
        for (const member of state.members) {
          if (member.groupId === where.groupId) {
            Object.assign(member, data);
            count += 1;
          }
        }
        return { count };
      }
    },
    acompanhamentoMissionGroup: {
      findMany: async ({ where = {}, include } = {}) => state.groups
        .filter(group => !where.status || group.status === where.status)
        .filter(group => !where.members?.some || state.members.some(member => member.groupId === group.id && !projectFor(member.projectId)?.managerOnly))
        .map(group => hydrateGroup(group, include)),
      create: async ({ data }) => {
        const now = new Date('2026-07-16T12:00:00.000Z');
        const group = {
          id: `g${state.groups.length + 1}`,
          name: data.name,
          status: data.status,
          laborAllocationMode: data.laborAllocationMode ?? 'VISUAL_ONLY',
          primaryLaborProjectId: data.primaryLaborProjectId ?? null,
          createdByUserId: data.createdByUserId ?? null,
          dissolvedByUserId: null,
          createdAt: now,
          updatedAt: now,
          dissolvedAt: null
        };
        state.groups.push(group);
        data.members.create.forEach(member => {
          state.members.push({
            id: `m${state.members.length + 1}`,
            groupId: group.id,
            projectId: member.projectId,
            activeProjectId: member.activeProjectId,
            order: member.order,
            createdAt: now
          });
        });
        return hydrateGroup(group);
      },
      findUnique: async ({ where, include }) => {
        const group = state.groups.find(item => item.id === where.id);
        return group ? hydrateGroup(group, include) : null;
      },
      update: async ({ where, data }) => {
        const group = state.groups.find(item => item.id === where.id);
        if (!group) throw new Error('not found');
        Object.assign(group, data, { updatedAt: new Date('2026-07-16T13:00:00.000Z') });
        return hydrateGroup(group);
      }
    }
  };

  return db;
}

const projects = [
  { id: 'p1', code: '1001', name: 'A', clientName: 'Cliente A', clientCnpj: '11222333000144', deletedAt: null, isActive: true },
  { id: 'p2', code: '1002', name: 'B', clientName: 'Cliente A', clientCnpj: '11222333000144', deletedAt: null, isActive: true },
  { id: 'p3', code: '1003', name: 'C', clientName: 'Cliente B', clientCnpj: '99888777000166', deletedAt: null, isActive: true }
];

test('createMissionGroup rejects fewer than two distinct projects', async () => {
  const db = createFakeDb({ projects });
  await assert.rejects(
    () => createMissionGroup({ projectIds: ['p1', 'p1'], db }),
    error => error instanceof MissionGroupError && error.code === 'MIN_MEMBERS'
  );
});

test('createMissionGroup rejects missing projects', async () => {
  const db = createFakeDb({ projects });
  await assert.rejects(
    () => createMissionGroup({ projectIds: ['p1', 'missing'], db }),
    error => error instanceof MissionGroupError && error.code === 'PROJECT_NOT_FOUND'
  );
});

test('createMissionGroup rejects already grouped projects', async () => {
  const db = createFakeDb({
    projects,
    groups: [{ id: 'g1', name: 'Grupo', status: 'ACTIVE', createdAt: new Date(), updatedAt: new Date(), dissolvedAt: null }],
    members: [{ id: 'm1', groupId: 'g1', projectId: 'p1', activeProjectId: 'p1', order: 0, createdAt: new Date() }]
  });
  await assert.rejects(
    () => createMissionGroup({ projectIds: ['p1', 'p2'], db }),
    error => error instanceof MissionGroupError && error.code === 'PROJECT_ALREADY_GROUPED'
  );
});

test('createMissionGroup generates name and warning for mixed clients', async () => {
  const db = createFakeDb({ projects });
  const group = await createMissionGroup({ projectIds: ['p1', 'p3'], userId: 'u1', db });

  assert.equal(group.name, 'Missões 1001 + 1003');
  assert.equal(group.warning, 'As missões selecionadas têm clientes diferentes.');
  assert.deepEqual(group.members.map(member => member.projectId), ['p1', 'p3']);
});

test('createMissionGroup treats different client names with the same CNPJ as the same client', async () => {
  const db = createFakeDb({
    projects: [
      { id: 'p1', code: '1001', name: 'A', clientName: 'Cliente Matriz', clientCnpj: '11.222.333/0001-44', deletedAt: null, isActive: true },
      { id: 'p2', code: '1002', name: 'B', clientName: 'Cliente Obra', clientCnpj: '11222333000144', deletedAt: null, isActive: true }
    ]
  });
  const group = await createMissionGroup({ projectIds: ['p1', 'p2'], db });

  assert.equal(group.warning, undefined);
  assert.equal(group.name, 'Cliente Matriz — 1001 + 1002');
});

test('listMissionGroups serializes active groups with members', async () => {
  const db = createFakeDb({ projects });
  await createMissionGroup({ name: 'Grupo Cliente A', projectIds: ['p1', 'p2'], db });
  const groups = await listMissionGroups({ db });

  assert.equal(groups.length, 1);
  assert.equal(groups[0].name, 'Grupo Cliente A');
  assert.deepEqual(groups[0].members.map(member => member.code), ['1001', '1002']);
});

test('projeto que passa a Somente gestor desaparece das leituras de agrupamentos', async () => {
  const db = createFakeDb({ projects });
  const created = await createMissionGroup({ name: 'Grupo Cliente A', projectIds: ['p1', 'p2'], db });
  db.state.projects.find(project => project.id === 'p2').managerOnly = true;

  const [listed] = await listMissionGroups({ db });
  const [active] = await loadActiveMissionGroups({ db });
  const detail = await getActiveMissionGroup({ groupId: created.id, db });
  for (const group of [listed, active, detail]) {
    assert.deepEqual(group.members.map(member => member.projectId), ['p1']);
  }
  assert.equal(db.state.members.length, 2, 'o vínculo armazenado deve ser preservado');

  db.state.projects.find(project => project.id === 'p1').managerOnly = true;
  assert.deepEqual(await listMissionGroups({ db }), []);
  assert.deepEqual(await loadActiveMissionGroups({ db }), []);
  await assert.rejects(getActiveMissionGroup({ groupId: created.id, db }), error => error.code === 'GROUP_NOT_FOUND');
});

test('dissolveMissionGroup clears activeProjectId and preserves historical members', async () => {
  const db = createFakeDb({ projects });
  const group = await createMissionGroup({ projectIds: ['p1', 'p2'], db });
  const result = await dissolveMissionGroup({ groupId: group.id, userId: 'u2', db });

  assert.equal(result.ok, true);
  assert.equal(db.state.groups[0].status, 'DISSOLVED');
  assert.equal(db.state.groups[0].dissolvedByUserId, 'u2');
  assert.deepEqual(db.state.members.map(member => member.activeProjectId), [null, null]);
  assert.deepEqual(db.state.members.map(member => member.projectId), ['p1', 'p2']);
});

test('dissolveMissionGroup rejects already dissolved groups', async () => {
  const db = createFakeDb({ projects });
  const group = await createMissionGroup({ projectIds: ['p1', 'p2'], db });
  await dissolveMissionGroup({ groupId: group.id, db });

  await assert.rejects(
    () => dissolveMissionGroup({ groupId: group.id, db }),
    error => error instanceof MissionGroupError && error.code === 'GROUP_NOT_ACTIVE'
  );
});

test('dissolved projects can be grouped again', async () => {
  const db = createFakeDb({ projects });
  const group = await createMissionGroup({ projectIds: ['p1', 'p2'], db });
  await dissolveMissionGroup({ groupId: group.id, db });
  const next = await createMissionGroup({ projectIds: ['p1', 'p2'], db });

  assert.equal(next.status, 'ACTIVE');
});

test('renameMissionGroup updates only active groups', async () => {
  const db = createFakeDb({ projects });
  const group = await createMissionGroup({ projectIds: ['p1', 'p2'], db });
  const renamed = await renameMissionGroup({ groupId: group.id, name: 'Novo grupo', db });

  assert.equal(renamed.name, 'Novo grupo');
});

test('grupos novos são apenas visuais e serializam a política de mão de obra', async () => {
  const db = createFakeDb({ projects });
  const group = await createMissionGroup({ projectIds: ['p1', 'p2'], db });

  assert.equal(group.laborAllocationMode, 'VISUAL_ONLY');
  assert.equal(group.primaryLaborProjectId, null);
});

test('updateMissionGroup configura execução compartilhada e limpa projeto principal', async () => {
  const db = createFakeDb({ projects });
  const group = await createMissionGroup({ projectIds: ['p1', 'p2'], db });
  const updated = await updateMissionGroup({
    groupId: group.id,
    laborAllocationMode: 'SHARED_EXECUTION',
    primaryLaborProjectId: 'p1',
    db
  });

  assert.equal(updated.laborAllocationMode, 'SHARED_EXECUTION');
  assert.equal(updated.primaryLaborProjectId, null);
});

test('updateMissionGroup exige que o projeto principal de consolidação seja membro', async () => {
  const db = createFakeDb({ projects });
  const group = await createMissionGroup({ projectIds: ['p1', 'p2'], db });

  await assert.rejects(
    () => updateMissionGroup({
      groupId: group.id,
      laborAllocationMode: 'CONSOLIDATE_PRIMARY',
      primaryLaborProjectId: 'p3',
      db
    }),
    error => error instanceof MissionGroupError && error.code === 'PRIMARY_NOT_MEMBER'
  );

  const updated = await updateMissionGroup({
    groupId: group.id,
    laborAllocationMode: 'CONSOLIDATE_PRIMARY',
    primaryLaborProjectId: 'p1',
    db
  });
  assert.equal(updated.primaryLaborProjectId, 'p1');
});

test('rota valida a política e exige projeto principal na consolidação', () => {
  assert.deepEqual(parseMissionGroupUpdate({
    laborAllocationMode: 'CONSOLIDATE_PRIMARY',
    primaryLaborProjectId: 'p1'
  }), {
    laborAllocationMode: 'CONSOLIDATE_PRIMARY',
    primaryLaborProjectId: 'p1'
  });
  assert.throws(() => parseMissionGroupUpdate({ laborAllocationMode: 'CONSOLIDATE_PRIMARY' }));
  assert.throws(() => parseMissionGroupUpdate({ laborAllocationMode: 'INVALID' }));
});

test('middleware da rota de política continua restrito ao gestor de Acompanhamento', () => {
  let response = null;
  let proceeded = false;
  requireAcompanhamentoManager({
    auth: {
      user: {
        id: 'viewer-1',
        accountType: 'INTERNAL',
        moduleRoles: ['acompanhamento:viewer']
      }
    }
  }, {
    status(status) {
      return { json(body) { response = { status, body }; } };
    }
  }, () => { proceeded = true; });

  assert.equal(proceeded, false);
  assert.equal(response.status, 403);
  assert.match(response.body.error, /gestor de Acompanhamento/i);
});

test('create and dissolve do not mutate operational project/report/omie collections', async () => {
  const db = createFakeDb({
    projects,
    reports: [{ id: 'r1', projectId: 'p1' }],
    purchases: [{ id: 'o1', projectId: 'p1' }],
    receivables: [{ id: 'f1', projectId: 'p1' }]
  });
  const before = {
    projects: structuredClone(db.state.projects),
    reports: structuredClone(db.state.reports),
    purchases: structuredClone(db.state.purchases),
    receivables: structuredClone(db.state.receivables)
  };

  const group = await createMissionGroup({ projectIds: ['p1', 'p2'], db });
  await dissolveMissionGroup({ groupId: group.id, db });

  assert.deepEqual(db.state.projects, before.projects);
  assert.deepEqual(db.state.reports, before.reports);
  assert.deepEqual(db.state.purchases, before.purchases);
  assert.deepEqual(db.state.receivables, before.receivables);
});
