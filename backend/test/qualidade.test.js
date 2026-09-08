import assert from 'node:assert/strict';
import test from 'node:test';

import AdmZip from 'adm-zip';
import { z } from 'zod';

import {
  requireQualidadeAccess,
  requireQualidadeManager
} from '../src/middleware/auth.js';
import { buildQualityRecordsXlsx, QUALITY_EXPORT_HEADERS } from '../src/lib/qualidade/export-xlsx.js';
import { parseQualityEvidenceUpload } from '../src/lib/qualidade/attachments.js';
import { calculateQualityRecurrence } from '../src/lib/qualidade/recurrence.js';
import {
  createNature,
  createRecord,
  deleteRecord,
  deleteNature,
  listNatures,
  listQualityProjects,
  listProjectDeviations,
  listRecords,
  listRecordsForExport,
  reorderNatures,
  serializeQualityRecord,
  setNatureActive
} from '../src/lib/qualidade/service.js';
import { makeQualidadeSchemas } from '../../shared/schemas/qualidade.js';

function responseRecorder() {
  return {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    }
  };
}

function runGuard(guard, user) {
  const req = { auth: { user } };
  const res = responseRecorder();
  let nextCalled = false;
  guard(req, res, () => {
    nextCalled = true;
  });
  return { nextCalled, statusCode: res.statusCode, body: res.body };
}

function date(value) {
  return new Date(`${value}T00:00:00.000Z`);
}

function includeRecord(state, record) {
  return {
    ...record,
    project: record.projectId ? state.projects.find(project => project.id === record.projectId) || null : null,
    nature: state.natures.find(nature => nature.id === record.natureId) || null,
    evidences: state.evidences
      .filter(evidence => evidence.recordId === record.id)
      .sort((a, b) => a.position - b.position),
    createdBy: null,
    updatedBy: null,
    deletedBy: null
  };
}

function matchesWhere(record, where = {}) {
  if (Object.prototype.hasOwnProperty.call(where, 'deletedAt') && where.deletedAt === null && record.deletedAt) return false;
  if (Object.prototype.hasOwnProperty.call(where, 'id') && record.id !== where.id) return false;
  if (where.type && record.type !== where.type) return false;
  if (Object.prototype.hasOwnProperty.call(where, 'projectId') && record.projectId !== where.projectId) return false;
  if (where.natureId && typeof where.natureId === 'string' && record.natureId !== where.natureId) return false;
  if (where.natureId?.in && !where.natureId.in.includes(record.natureId)) return false;
  if (where.status && record.status !== where.status) return false;
  if (where.impact && record.impact !== where.impact) return false;
  if (where.eventDate?.gte && record.eventDate < where.eventDate.gte) return false;
  if (where.eventDate?.lte && record.eventDate > where.eventDate.lte) return false;
  if (where.OR?.length) {
    const q = where.OR.map(item => Object.values(item)[0]?.contains).find(Boolean)?.toLowerCase() || '';
    if (q) {
      const haystack = [record.number, record.origin, record.description, record.linkedRnc].join(' ').toLowerCase();
      if (!haystack.includes(q)) return false;
    }
  }
  return true;
}

function createMockQualidadeClient(seed = {}) {
  const state = {
    records: [],
    evidences: [],
    natures: [{ id: 'nature-1', name: 'Stand By', isActive: true, createdAt: date('2026-01-01'), updatedAt: date('2026-01-01') }],
    projects: [{ id: 'project-1', code: '5775', name: 'Projeto X', isActive: true, deletedAt: null }],
    seq: new Map(),
    ...seed
  };
  state.natures = state.natures.map((nature, index) => ({ position: index, ...nature }));
  let recordCounter = 0;
  let natureCounter = state.natures.length;

  function selectedRow(row, select) {
    return Object.fromEntries(Object.keys(select).map(key => [key, row[key]]));
  }

  function sortRows(rows, orderBy = []) {
    const order = Array.isArray(orderBy) ? orderBy : [orderBy];
    return [...rows].sort((a, b) => {
      for (const entry of order) {
        const [field, direction] = Object.entries(entry || {})[0] || [];
        if (!field) continue;
        const dir = direction === 'desc' ? -1 : 1;
        const left = a[field];
        const right = b[field];
        const result = typeof left === 'number' || typeof right === 'number'
          ? Number(left || 0) - Number(right || 0)
          : String(left || '').localeCompare(String(right || ''), 'pt-BR');
        if (result) return result * dir;
      }
      return 0;
    });
  }

  const client = {
    state,
    $transaction: async callback => callback(client),
    project: {
      findFirst: async ({ where }) => state.projects.find(project => project.id === where.id && project.deletedAt === where.deletedAt) || null,
      findMany: async ({ where = {}, select } = {}) => {
        const rows = state.projects
          .filter(project => !Object.prototype.hasOwnProperty.call(where, 'deletedAt') || project.deletedAt === where.deletedAt)
          .filter(project => where.isActive === undefined || project.isActive === where.isActive)
          .sort((a, b) => String(a.code).localeCompare(String(b.code), 'pt-BR') || String(a.name).localeCompare(String(b.name), 'pt-BR'));
        if (select) {
          return rows.map(project => Object.fromEntries(Object.keys(select).map(key => [key, project[key]])));
        }
        return rows;
      }
    },
    qualityRecordSeq: {
      upsert: async ({ where, create }) => {
        const key = `${where.type_year.type}:${where.type_year.year}`;
        const current = state.seq.get(key) || 0;
        const next = current ? current + 1 : create.lastSeq;
        state.seq.set(key, next);
        return { type: where.type_year.type, year: where.type_year.year, lastSeq: next };
      }
    },
    qualityRecord: {
      create: async ({ data }) => {
        const record = {
          id: `record-${++recordCounter}`,
          ...data,
          deletedAt: null,
          deletedById: null,
          createdAt: date('2026-07-22'),
          updatedAt: date('2026-07-22')
        };
        state.records.push(record);
        return includeRecord(state, record);
      },
      findMany: async ({ where = {}, select } = {}) => {
        const rows = state.records.filter(record => matchesWhere(record, where));
        if (select) {
          return rows.map(record => Object.fromEntries(Object.keys(select).map(key => [key, record[key]])));
        }
        return rows.map(record => includeRecord(state, record));
      },
      findFirst: async ({ where = {}, select } = {}) => {
        const record = state.records.find(item => matchesWhere(item, where)) || null;
        if (!record) return null;
        if (select) return Object.fromEntries(Object.keys(select).map(key => [key, record[key]]));
        return includeRecord(state, record);
      },
      findUnique: async ({ where }) => {
        const record = state.records.find(item => item.id === where.id) || null;
        return record ? includeRecord(state, record) : null;
      },
      count: async ({ where = {} } = {}) => state.records.filter(record => matchesWhere(record, where)).length,
      update: async ({ where, data }) => {
        const index = state.records.findIndex(record => record.id === where.id);
        if (index === -1) return null;
        state.records[index] = { ...state.records[index], ...data, updatedAt: date('2026-07-22') };
        return includeRecord(state, state.records[index]);
      },
      delete: async ({ where }) => {
        const index = state.records.findIndex(record => record.id === where.id);
        if (index === -1) throw new Error('not found');
        const [record] = state.records.splice(index, 1);
        return record;
      }
    },
    qualityEvidence: {
      createMany: async ({ data }) => {
        state.evidences.push(...data.map(item => ({
          ...item,
          createdAt: date('2026-07-22')
        })));
        return { count: data.length };
      },
      deleteMany: async ({ where }) => {
        const before = state.evidences.length;
        state.evidences = state.evidences.filter(item => item.recordId !== where.recordId);
        return { count: before - state.evidences.length };
      },
      findFirst: async ({ where }) => {
        const token = where.publicToken;
        const evidence = state.evidences.find(item => item.publicToken === token && item.kind === where.kind);
        if (!evidence) return null;
        const record = state.records.find(item => item.id === evidence.recordId && !item.deletedAt);
        if (!record) return null;
        return { ...evidence, record: { number: record.number } };
      }
    },
    qualityNature: {
      findUnique: async ({ where, include }) => {
        const nature = state.natures.find(item => item.id === where.id) || null;
        if (!nature) return null;
        if (!include?._count) return nature;
        return { ...nature, _count: { records: state.records.filter(record => record.natureId === nature.id).length } };
      },
      findFirst: async ({ where }) => {
        const name = where.name?.equals?.toLowerCase();
        return state.natures.find(nature => nature.name.toLowerCase() === name) || null;
      },
      findMany: async ({ where = {}, include, select, orderBy } = {}) => {
        let rows = state.natures
          .filter(nature => where.isActive === undefined || nature.isActive === where.isActive)
          .filter(nature => !where.id?.in || where.id.in.includes(nature.id));
        rows = sortRows(rows, orderBy);
        if (select) return rows.map(nature => selectedRow(nature, select));
        return rows.map(nature => include?._count
          ? { ...nature, _count: { records: state.records.filter(record => record.natureId === nature.id).length } }
          : nature);
      },
      create: async ({ data }) => {
        const nature = { id: `nature-${++natureCounter}`, ...data, isActive: true, createdAt: date('2026-07-22'), updatedAt: date('2026-07-22') };
        state.natures.push(nature);
        return { ...nature, _count: { records: 0 } };
      },
      update: async ({ where, data }) => {
        const index = state.natures.findIndex(nature => nature.id === where.id);
        if (index === -1) return null;
        state.natures[index] = { ...state.natures[index], ...data, updatedAt: date('2026-07-22') };
        const nature = state.natures[index];
        return { ...nature, _count: { records: state.records.filter(record => record.natureId === nature.id).length } };
      },
      delete: async ({ where }) => {
        const index = state.natures.findIndex(nature => nature.id === where.id);
        if (index === -1) throw new Error('not found');
        const [nature] = state.natures.splice(index, 1);
        return nature;
      }
    }
  };

  return client;
}

function recordPayload(overrides = {}) {
  return {
    type: 'DESVIO',
    registeredAt: '2026-07-22',
    origin: 'Reunião semanal',
    projectId: 'project-1',
    eventDate: '2026-07-20',
    natureId: 'nature-1',
    description: 'Stand by de equipe',
    impact: 'BAIXO',
    linkedRnc: null,
    disposition: 'MONITORAR',
    definedAction: null,
    actionOwner: null,
    actionDeadline: null,
    evidence: null,
    evidences: [],
    resultVerification: null,
    status: 'ABERTO',
    ...overrides
  };
}

test('qualidade schemas enforce required fields and defined action for Tratar', () => {
  const schemas = makeQualidadeSchemas(z);

  assert.equal(schemas.recordCreate.safeParse(recordPayload()).success, true);
  assert.equal(schemas.recordCreate.safeParse(recordPayload({ description: '' })).success, false);
  assert.equal(schemas.recordCreate.safeParse(recordPayload({ evidence: 'texto solto' })).success, false);
  assert.equal(schemas.recordCreate.safeParse(recordPayload({ evidence: 'https://example.com/evidencia' })).success, true);
  assert.equal(schemas.recordCreate.safeParse(recordPayload({
    evidences: [
      { kind: 'LINK', url: 'https://example.com/evidencia-1' },
      { kind: 'LINK', url: 'https://example.com/evidencia-2' },
      { kind: 'ATTACHMENT', fileName: 'foto.png', mimeType: 'image/png', dataUrl: 'data:image/png;base64,AA==' }
    ]
  })).success, true);
  assert.equal(schemas.recordCreate.safeParse(recordPayload({ evidences: [{ kind: 'LINK', url: 'texto solto' }] })).success, false);
  assert.equal(schemas.recordCreate.safeParse(recordPayload({ disposition: 'TRATAR', definedAction: '' })).success, false);
  assert.equal(schemas.recordCreate.safeParse(recordPayload({ disposition: 'TRATAR', definedAction: 'Abrir plano de ação' })).success, true);
});

test('non-deviation quality records allow project or internal/SGQ origin', () => {
  const schemas = makeQualidadeSchemas(z);
  const minimalPayload = {
    registeredAt: '2026-07-22',
    projectId: 'project-1',
    eventDate: '2026-07-20'
  };

  for (const type of schemas.RECORD_TYPES.filter(item => item !== 'DESVIO')) {
    const result = schemas.recordCreate.safeParse({ type, ...minimalPayload });
    assert.equal(result.success, true, type);
    assert.equal(result.data.origin, null);
    assert.equal(result.data.natureId, null);
    assert.equal(result.data.description, null);
    assert.equal(result.data.impact, null);
    assert.equal(result.data.disposition, null);
    assert.equal(result.data.status, null);

    const internalResult = schemas.recordCreate.safeParse({
      type,
      registeredAt: minimalPayload.registeredAt,
      eventDate: minimalPayload.eventDate
    });
    assert.equal(internalResult.success, true, `${type} interno/SGQ`);
    assert.equal(internalResult.data.projectId, null);
  }

  assert.equal(schemas.recordCreate.safeParse({
    type: 'MELHORIA',
    registeredAt: minimalPayload.registeredAt,
    eventDate: minimalPayload.eventDate
  }).success, true);
  assert.equal(schemas.recordCreate.safeParse({
    type: 'MELHORIA',
    projectId: minimalPayload.projectId,
    eventDate: minimalPayload.eventDate
  }).success, false);
  assert.equal(schemas.recordCreate.safeParse({
    type: 'MELHORIA',
    registeredAt: minimalPayload.registeredAt,
    projectId: minimalPayload.projectId
  }).success, false);
  assert.equal(schemas.recordCreate.safeParse({
    type: 'MELHORIA',
    ...minimalPayload,
    disposition: 'TRATAR'
  }).success, true);
  assert.equal(schemas.recordCreate.safeParse({
    type: 'DESVIO',
    ...minimalPayload
  }).success, false);
  assert.equal(schemas.recordUpdateForType('MELHORIA').safeParse(minimalPayload).success, true);
  assert.equal(schemas.recordUpdateForType('MELHORIA').safeParse({
    registeredAt: minimalPayload.registeredAt,
    eventDate: minimalPayload.eventDate
  }).success, true);
  assert.equal(schemas.recordUpdateForType('DESVIO').safeParse(minimalPayload).success, false);
});

test('quality record serialization ignores invalid legacy evidence text', () => {
  const serialized = serializeQualityRecord({
    id: 'record-legacy',
    number: 'D-001/26',
    type: 'DESVIO',
    seq: 1,
    year: 2026,
    registeredAt: date('2026-07-22'),
    origin: 'abc',
    project: null,
    projectId: null,
    eventDate: date('2026-07-22'),
    nature: { id: 'nature-1', name: 'Stand By', isActive: true },
    natureId: 'nature-1',
    description: 'Desvio com evidencia legada',
    impact: 'MEDIO',
    linkedRnc: null,
    disposition: 'MONITORAR',
    definedAction: null,
    actionOwner: null,
    actionDeadline: null,
    evidence: 'texto solto',
    evidences: [{
      id: 'legacy-evidence-record-legacy',
      kind: 'LINK',
      label: 'Evidência',
      url: 'texto solto',
      createdAt: date('2026-07-22')
    }],
    resultVerification: null,
    status: 'ABERTO',
    createdBy: null,
    updatedBy: null,
    createdAt: date('2026-07-22'),
    updatedAt: date('2026-07-22')
  });

  assert.equal(serialized.evidence, null);
  assert.deepEqual(serialized.evidences, []);
});

test('quality evidence attachment accepts images and pdf only', () => {
  const pdf = parseQualityEvidenceUpload({
    fileName: 'evidencia.pdf',
    dataUrl: `data:application/pdf;base64,${Buffer.from('%PDF-1.4\n').toString('base64')}`
  });
  assert.equal(pdf.mimeType, 'application/pdf');
  assert.equal(pdf.extension, 'pdf');

  const image = parseQualityEvidenceUpload({
    fileName: 'foto.png',
    dataUrl: 'data:image/png;base64,AA=='
  });
  assert.equal(image.mimeType, 'image/png');
  assert.equal(image.extension, 'png');

  assert.throws(() => parseQualityEvidenceUpload({
    fileName: 'evidencia.txt',
    dataUrl: 'data:text/plain;base64,AA=='
  }), /imagem ou PDF/);
});

test('quality record numbering is sequential by type and year', async () => {
  const client = createMockQualidadeClient();

  const first = await createRecord(client, { data: recordPayload() });
  const second = await createRecord(client, { data: recordPayload() });
  const nextYear = await createRecord(client, { data: recordPayload({ registeredAt: '2027-01-03' }) });
  const improvement = await createRecord(client, { data: recordPayload({ type: 'MELHORIA' }) });

  assert.equal(first.number, 'D-001/26');
  assert.equal(second.number, 'D-002/26');
  assert.equal(nextYear.number, 'D-001/27');
  assert.equal(improvement.number, 'M-001/26');
});

test('non-deviation quality records persist optional fields as null', async () => {
  const client = createMockQualidadeClient();
  const schemas = makeQualidadeSchemas(z);
  const data = schemas.recordCreate.parse({
    type: 'MELHORIA',
    registeredAt: '2026-07-22',
    eventDate: '2026-07-20'
  });

  const record = await createRecord(client, { data });

  assert.equal(record.number, 'M-001/26');
  assert.equal(record.projectId, null);
  assert.equal(record.project, null);
  assert.equal(record.origin, null);
  assert.equal(record.natureId, null);
  assert.equal(record.nature, null);
  assert.equal(record.description, null);
  assert.equal(record.impact, null);
  assert.equal(record.disposition, null);
  assert.equal(record.status, null);

  const workbook = new AdmZip(buildQualityRecordsXlsx([record]));
  const worksheet = workbook.readAsText('xl/worksheets/sheet1.xml');
  assert.match(worksheet, /M-001\/26/);
  assert.match(worksheet, /Interno\/SGQ/);
});

test('quality record stores multiple evidence links', async () => {
  const client = createMockQualidadeClient();
  const record = await createRecord(client, {
    data: recordPayload({
      evidences: [
        { kind: 'LINK', url: 'https://example.com/evidencia-1' },
        { kind: 'LINK', url: 'https://example.com/evidencia-2' }
      ]
    })
  });

  assert.equal(record.evidences.length, 2);
  assert.deepEqual(record.evidences.map(item => item.url), [
    'https://example.com/evidencia-1',
    'https://example.com/evidencia-2'
  ]);
  assert.equal(record.evidence, 'https://example.com/evidencia-1');
  assert.equal(client.state.evidences.length, 2);
});

test('concurrent quality record creation produces unique numbers', async () => {
  const client = createMockQualidadeClient();
  const records = await Promise.all(Array.from({ length: 8 }).map((_, index) => (
    createRecord(client, { data: recordPayload({ description: `Desvio ${index}` }) })
  )));

  assert.equal(new Set(records.map(record => record.number)).size, 8);
  assert.deepEqual(records.map(record => record.number).sort(), [
    'D-001/26',
    'D-002/26',
    'D-003/26',
    'D-004/26',
    'D-005/26',
    'D-006/26',
    'D-007/26',
    'D-008/26'
  ]);
});

test('qualidade guards enforce viewer, manager and no-role matrix', () => {
  const viewer = { accountType: 'INTERNAL', moduleRoles: ['qualidade:viewer'] };
  const manager = { accountType: 'INTERNAL', moduleRoles: ['qualidade:manager'] };
  const adminManager = { accountType: 'ADMIN', moduleRoles: ['qualidade:manager'] };
  const noRole = { accountType: 'ADMIN', moduleRoles: [] };

  assert.equal(runGuard(requireQualidadeAccess, viewer).nextCalled, true);
  assert.equal(runGuard(requireQualidadeManager, viewer).statusCode, 403);
  assert.equal(runGuard(requireQualidadeAccess, noRole).statusCode, 403);
  assert.equal(runGuard(requireQualidadeManager, noRole).statusCode, 403);
  assert.equal(runGuard(requireQualidadeAccess, manager).nextCalled, true);
  assert.equal(runGuard(requireQualidadeManager, adminManager).nextCalled, true);
});

test('quality natures are unique case-insensitively and protected when in use', async () => {
  const client = createMockQualidadeClient();

  await assert.rejects(() => createNature(client, { name: 'stand by' }), /Natureza já cadastrada/);
  const created = await createNature(client, { name: 'Atraso de mobilização' });
  assert.equal(created.isActive, true);

  await createRecord(client, { data: recordPayload({ natureId: created.id }) });
  await assert.rejects(() => deleteNature(client, created.id), /Natureza em uso/);

  const inactive = await setNatureActive(client, created.id, false);
  assert.equal(inactive.isActive, false);
  const activeList = await client.qualityNature.findMany({ where: { isActive: true } });
  assert.equal(activeList.some(nature => nature.id === created.id), false);
});

test('quality natures preserve manual order for forms', async () => {
  const client = createMockQualidadeClient({
    natures: [
      { id: 'nature-1', name: 'Primeira', isActive: true, position: 0, createdAt: date('2026-01-01'), updatedAt: date('2026-01-01') },
      { id: 'nature-2', name: 'Segunda', isActive: true, position: 1, createdAt: date('2026-01-01'), updatedAt: date('2026-01-01') },
      { id: 'nature-3', name: 'Terceira', isActive: true, position: 2, createdAt: date('2026-01-01'), updatedAt: date('2026-01-01') }
    ]
  });

  await reorderNatures(client, ['nature-3', 'nature-1', 'nature-2']);
  assert.deepEqual((await listNatures(client, { includeInactive: true })).map(nature => nature.id), [
    'nature-3',
    'nature-1',
    'nature-2'
  ]);

  const created = await createNature(client, { name: 'Quarta' });
  assert.equal(created.position, 3);
  assert.deepEqual((await listNatures(client, { includeInactive: true })).map(nature => nature.id), [
    'nature-3',
    'nature-1',
    'nature-2',
    created.id
  ]);
});

test('quality projects list uses module access endpoint shape and only active non-deleted projects', async () => {
  const client = createMockQualidadeClient({
    projects: [
      { id: 'project-2', code: '5888', name: 'Projeto B', isActive: true, deletedAt: null },
      { id: 'project-1', code: '5775', name: 'Projeto A', isActive: true, deletedAt: null },
      { id: 'inactive', code: '5999', name: 'Inativo', isActive: false, deletedAt: null },
      { id: 'deleted', code: '6000', name: 'Excluído', isActive: true, deletedAt: date('2026-07-01') }
    ]
  });

  const projects = await listQualityProjects(client);
  assert.deepEqual(projects.map(project => project.id), ['project-1', 'project-2']);
});

test('quality record delete is soft and hidden from list, export and project deviations', async () => {
  const client = createMockQualidadeClient();
  const record = await createRecord(client, { data: recordPayload({ description: 'Excluir sem apagar' }) });

  await deleteRecord(client, record.id, { userId: 'user-1' });

  assert.equal(client.state.records.length, 1);
  assert.ok(client.state.records[0].deletedAt instanceof Date);
  assert.equal(client.state.records[0].deletedById, 'user-1');
  assert.equal(client.state.records[0].updatedById, 'user-1');

  assert.equal((await listRecords(client, {})).total, 0);
  assert.equal((await listRecordsForExport(client, {})).length, 0);
  assert.equal((await listProjectDeviations(client, 'project-1')).length, 0);
  await assert.rejects(() => deleteRecord(client, record.id), /Registro de qualidade não encontrado/);
});

test('project deviations return labeled details for only Desvio records for the selected project', async () => {
  const client = createMockQualidadeClient({
    projects: [
      { id: 'project-1', code: '5775', name: 'Projeto X', isActive: true, deletedAt: null },
      { id: 'project-2', code: '5888', name: 'Projeto Y', isActive: true, deletedAt: null }
    ]
  });

  await createRecord(client, {
    data: recordPayload({
      projectId: 'project-1',
      description: 'Desvio 1',
      linkedRnc: 'RNC-9',
      disposition: 'TRATAR',
      definedAction: 'Corrigir procedimento',
      actionOwner: 'Pedro',
      actionDeadline: '2026-07-30',
      impact: 'ALTO',
      status: 'EM_ACAO'
    })
  });
  await createRecord(client, { data: recordPayload({ projectId: 'project-1', description: 'Desvio 2' }) });
  await createRecord(client, { data: recordPayload({ projectId: 'project-1', type: 'MELHORIA', description: 'Melhoria' }) });
  await createRecord(client, { data: recordPayload({ projectId: null, description: 'Interno' }) });
  await createRecord(client, { data: recordPayload({ projectId: 'project-2', description: 'Outro projeto' }) });

  const deviations = await listProjectDeviations(client, 'project-1');
  assert.equal(deviations.length, 2);
  assert.ok(deviations.every(deviation => deviation.number.startsWith('D-')));
  assert.equal(deviations[0].description, 'Desvio 1');
  assert.equal(deviations[0].eventDate, '2026-07-20');
  assert.equal(deviations[0].origin, 'Reunião semanal');
  assert.equal(deviations[0].linkedRnc, 'RNC-9');
  assert.equal(deviations[0].definedAction, 'Corrigir procedimento');
  assert.equal(deviations[0].actionOwner, 'Pedro');
  assert.equal(deviations[0].actionDeadline, '2026-07-30');
  assert.equal(deviations[0].impact, 'ALTO');
  assert.equal(deviations[0].status, 'EM_ACAO');
  assert.equal(typeof deviations[0].occurrences12m, 'number');
  assert.equal(typeof deviations[0].recurrent, 'boolean');
});

test('quality recurrence counts records in the 12 month nature window', () => {
  const recurrence = calculateQualityRecurrence([
    { id: 'old', natureId: 'nature-1', eventDate: date('2025-01-01') },
    { id: 'a', natureId: 'nature-1', eventDate: date('2026-07-20') },
    { id: 'b', natureId: 'nature-1', eventDate: date('2026-07-20') },
    { id: 'c', natureId: 'nature-1', eventDate: date('2026-07-20') },
    { id: 'other', natureId: 'nature-2', eventDate: date('2026-07-20') }
  ]);

  assert.equal(recurrence.get('a').occurrences12m, 3);
  assert.equal(recurrence.get('a').recurrent, true);
  assert.equal(recurrence.get('other').occurrences12m, 1);
  assert.equal(recurrence.get('other').recurrent, false);
});

test('quality list enriches records with recurrence without N+1 visible contract changes', async () => {
  const client = createMockQualidadeClient();
  await createRecord(client, { data: recordPayload({ eventDate: '2026-07-20', description: 'A' }) });
  await createRecord(client, { data: recordPayload({ eventDate: '2026-07-20', description: 'B' }) });
  await createRecord(client, { data: recordPayload({ eventDate: '2026-07-20', description: 'C' }) });

  const result = await listRecords(client, {});
  assert.equal(result.items.length, 3);
  assert.ok(result.items.every(record => record.occurrences12m === 3));
  assert.ok(result.items.every(record => record.recurrent));
});

test('quality xlsx export uses FR-3-4-11-01 template formatting with filtered rows and escaped XML', async () => {
  const client = createMockQualidadeClient();
  await createRecord(client, { data: recordPayload({ description: 'A & <B>', linkedRnc: 'RNC-1' }) });
  await createRecord(client, { data: recordPayload({ type: 'MELHORIA', description: 'Nao exportar no filtro' }) });

  const list = await listRecords(client, { type: 'DESVIO' });
  const buffer = buildQualityRecordsXlsx(list.items);
  const zip = new AdmZip(buffer);
  const sheet = zip.readAsText('xl/worksheets/sheet1.xml');
  const sharedStrings = zip.readAsText('xl/sharedStrings.xml').replace(/\r\n/g, '\n');
  const workbook = zip.readAsText('xl/workbook.xml');
  const styles = zip.readAsText('xl/styles.xml');

  for (const header of QUALITY_EXPORT_HEADERS) {
    assert.match(sharedStrings, new RegExp(header.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(workbook, /name="Registro"/);
  assert.match(workbook, /name="Legenda"/);
  assert.match(styles, /FF1F3350/);
  assert.equal(zip.getEntry('xl/worksheets/sheet2.xml') !== null, true);
  assert.equal(zip.getEntry('xl/calcChain.xml'), null);
  assert.match(sheet, /<dimension ref="A1:S4"\/>/);
  assert.equal((sheet.match(/<row /g) || []).length, 4);
  assert.match(sheet, /A &amp; &lt;B&gt;/);
  assert.doesNotMatch(sheet, /Nao exportar/);
});
