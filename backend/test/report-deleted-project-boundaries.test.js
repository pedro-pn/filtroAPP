import assert from 'node:assert/strict';
import { PassThrough, Readable, Writable } from 'node:stream';
import test from 'node:test';

import { Prisma, ReportStatus, ReportType } from '@prisma/client';

import app from '../src/app.js';
import prisma from '../src/lib/prisma.js';
import {
  approvedRdoHistoryWhere,
  canAccessReport,
  canClientSeeReport,
  derivedReportsForProjectWhere
} from '../src/routes/resources/reports.js';

const bearerToken = 'test-token';

function prismaNotFound() {
  return new Prisma.PrismaClientKnownRequestError('Record not found', {
    code: 'P2025',
    clientVersion: 'test'
  });
}

function managerSession() {
  return {
    id: 'session-1',
    expiresAt: new Date(Date.now() + 60_000),
    user: {
      id: 'manager-1',
      username: 'manager',
      name: 'Manager',
      email: 'manager@example.com',
      role: 'MANAGER',
      accountType: 'ADMIN',
      isActive: true,
      moduleRoles: [{ role: 'RDO_MANAGER' }]
    }
  };
}

function collaboratorSession() {
  return {
    id: 'session-collaborator',
    expiresAt: new Date(Date.now() + 60_000),
    user: {
      id: 'user-collab',
      username: 'collab',
      name: 'Collaborator',
      email: 'collab@example.com',
      role: 'COLLABORATOR',
      accountType: 'INTERNAL',
      isActive: true,
      collaboratorId: 'collab-1',
      moduleRoles: [{ role: 'RDO_COLLABORATOR' }]
    }
  };
}

function clientAuth() {
  return {
    user: {
      id: 'client-1',
      username: '11222333000144',
      email: 'client@example.com',
      role: 'CLIENT',
      accountType: 'CLIENT',
      isActive: true,
      moduleRoles: [{ role: 'RDO_CLIENT' }]
    }
  };
}

function activeReport(overrides = {}) {
  return {
    id: 'report-1',
    projectId: 'project-1',
    createdByUserId: 'creator-1',
    reportType: ReportType.RDO,
    sequenceNumber: 1,
    status: ReportStatus.PENDING,
    deletedAt: null,
    approvedAt: null,
    specialConditions: {},
    project: {
      id: 'project-1',
      deletedAt: null,
      managerOnly: false,
      isActive: true,
      visibleToCollaborators: true,
      operatorId: null
    },
    reportSignatures: [],
    clientReviews: [],
    collaborators: [],
    services: [],
    attachments: [],
    versions: [],
    ...overrides
  };
}

function hiddenCollaboratorReport(overrides = {}) {
  return activeReport({
    id: 'report-hidden',
    createdByUserId: 'user-collab',
    project: {
      id: 'project-hidden',
      deletedAt: null,
      managerOnly: false,
      isActive: true,
      visibleToCollaborators: false,
      operatorId: 'collab-1',
      authorizedUsers: []
    },
    collaborators: [{ collaboratorId: 'collab-1' }],
    ...overrides
  });
}

test('derived report sync filters exclude soft-deleted reports and projects', () => {
  assert.deepEqual(approvedRdoHistoryWhere('project-1'), {
    projectId: 'project-1',
    deletedAt: null,
    project: { deletedAt: null },
    reportType: ReportType.RDO,
    status: ReportStatus.APPROVED
  });
  assert.deepEqual(derivedReportsForProjectWhere('project-1'), {
    projectId: 'project-1',
    deletedAt: null,
    project: { deletedAt: null },
    reportType: { in: [ReportType.RTP, ReportType.RLQ, ReportType.RCPU, ReportType.RLM, ReportType.RLF, ReportType.RLI] }
  });
});

test('client report guards reject reports from soft-deleted projects', async () => {
  const report = activeReport({
    status: ReportStatus.APPROVED,
    project: {
      ...activeReport().project,
      deletedAt: new Date(),
      clientCnpj: '11222333000144',
      clientEmailPrimary: 'client@example.com',
      clientEmailCc: []
    }
  });

  assert.equal(canClientSeeReport(report, new Map([[report.id, report]])), false);
  assert.equal(await canAccessReport(clientAuth(), report), false);
});

function reportPayload(overrides = {}) {
  return {
    projectId: 'deleted-project',
    createdByUserId: 'creator-1',
    reportType: ReportType.RDO,
    status: ReportStatus.APPROVED,
    reportDate: '2026-05-20',
    arrivalTime: '08:00',
    departureTime: '17:00',
    lunchBreak: '01:00',
    daytimeCount: 1,
    dailyDescription: 'Work performed',
    collaboratorIds: [],
    services: [{
      serviceType: 'mecanica',
      finalized: false,
      extraData: {}
    }],
    ...overrides
  };
}

function serviceOnlyPayload(overrides = {}) {
  return {
    projectId: 'deleted-project',
    createdByUserId: 'creator-1',
    reportDate: '2026-05-20',
    collaboratorIds: [],
    services: [{
      serviceType: 'mecanica',
      extraData: {}
    }],
    ...overrides
  };
}

function dispatchApp(method, pathName, body) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const req = new Readable({
      read() {
        if (payload) this.push(payload);
        this.push(null);
      }
    });
    req.method = method;
    req.url = pathName;
    req.headers = {
      authorization: `Bearer ${bearerToken}`,
      host: '127.0.0.1',
      ...(payload ? {
        'content-type': 'application/json',
        'content-length': String(payload.length)
      } : {})
    };
    req.socket = new PassThrough();
    req.socket.remoteAddress = '127.0.0.1';
    req.socket.encrypted = false;
    req.connection = req.socket;

    const chunks = [];
    const responseHeaders = new Map();
    const res = new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(Buffer.from(chunk));
        callback();
      }
    });
    res.statusCode = 200;
    res.setHeader = (name, value) => responseHeaders.set(String(name).toLowerCase(), value);
    res.getHeader = name => responseHeaders.get(String(name).toLowerCase());
    res.getHeaders = () => Object.fromEntries(responseHeaders);
    res.removeHeader = name => responseHeaders.delete(String(name).toLowerCase());
    res.writeHead = (statusCode, headersToSet = {}) => {
      res.statusCode = statusCode;
      Object.entries(headersToSet).forEach(([name, value]) => res.setHeader(name, value));
      return res;
    };
    res.end = (chunk, encoding, callback) => {
      if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding));
      Writable.prototype.end.call(res, callback);
      const rawBody = Buffer.concat(chunks).toString('utf8');
      resolve({ statusCode: res.statusCode, body: rawBody, json: rawBody ? JSON.parse(rawBody) : null });
      return res;
    };

    app.handle(req, res, reject);
  });
}

function stubAuthenticatedManager(t) {
  const originalFindUnique = prisma.userSession.findUnique;
  prisma.userSession.findUnique = async () => managerSession();
  t.after(() => {
    prisma.userSession.findUnique = originalFindUnique;
  });
}

function stubAuthenticatedCollaborator(t) {
  const originalFindUnique = prisma.userSession.findUnique;
  prisma.userSession.findUnique = async () => collaboratorSession();
  t.after(() => {
    prisma.userSession.findUnique = originalFindUnique;
  });
}

function stubReportGroupBy(t, groups = [{
  projectId: 'project-1',
  reportType: ReportType.RDO,
  _count: { _all: 1 }
}], projectGroups = null) {
  const originalGroupBy = prisma.report.groupBy;
  prisma.report.groupBy = async args => {
    assert.equal(args.where.deletedAt, null);
    if (JSON.stringify(args.by) === JSON.stringify(['projectId', 'reportType'])) {
      return groups;
    }
    if (JSON.stringify(args.by) === JSON.stringify(['projectId'])) {
      return projectGroups || Array.from(new Set(groups.map(group => group.projectId)))
        .map(projectId => ({ projectId, _count: { _all: 1 } }));
    }
    throw new Error(`Unexpected report groupBy fields: ${JSON.stringify(args.by)}`);
  };
  t.after(() => {
    prisma.report.groupBy = originalGroupBy;
  });
}

function stubReportListTransaction(t) {
  const originalTransaction = prisma.$transaction;
  prisma.$transaction = async callback => callback(prisma);
  t.after(() => {
    prisma.$transaction = originalTransaction;
  });
}

test('GET /reports keeps legacy array response when pagination is not requested', async t => {
  stubAuthenticatedManager(t);
  const originals = {
    reportFindMany: prisma.report.findMany,
    reportCount: prisma.report.count
  };
  prisma.report.findMany = async args => {
    assert.equal(args.skip, undefined);
    assert.equal(args.take, undefined);
    return [activeReport({ id: 'report-1' })];
  };
  prisma.report.count = async () => {
    throw new Error('legacy report list must not count rows');
  };
  t.after(() => {
    prisma.report.findMany = originals.reportFindMany;
    prisma.report.count = originals.reportCount;
  });

  const response = await dispatchApp('GET', '/api/reports', undefined);

  assert.equal(response.statusCode, 200);
  assert.equal(Array.isArray(response.json), true);
  assert.equal(response.json.length, 1);
  assert.equal(response.json[0].id, 'report-1');
});

test('GET /reports returns paginated payload when page parameters are provided', async t => {
  stubAuthenticatedManager(t);
  stubReportListTransaction(t);
  stubReportGroupBy(t, [{ projectId: 'project-1', reportType: ReportType.RDO, _count: { _all: 5 } }]);
  const originals = {
    reportFindMany: prisma.report.findMany,
    reportCount: prisma.report.count
  };
  prisma.report.findMany = async args => {
    assert.equal(args.skip, 2);
    assert.equal(args.take, 2);
    return [
      activeReport({ id: 'report-3' }),
      activeReport({ id: 'report-4' })
    ];
  };
  prisma.report.count = async args => {
    assert.equal(args.where.deletedAt, null);
    return 5;
  };
  t.after(() => {
    prisma.report.findMany = originals.reportFindMany;
    prisma.report.count = originals.reportCount;
  });

  const response = await dispatchApp('GET', '/api/reports?page=2&pageSize=2', undefined);

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json.pagination, {
    page: 2,
    pageSize: 2,
    total: 5,
    totalPages: 3
  });
  assert.deepEqual(response.json.items.map(item => item.id), ['report-3', 'report-4']);
  assert.deepEqual(response.json.groups, [{ projectId: 'project-1', reportType: ReportType.RDO, total: 5 }]);
  assert.deepEqual(response.json.meta, { projectTotal: 1 });
});

test('GET /reports can use summary select for paginated lists', async t => {
  stubAuthenticatedManager(t);
  stubReportListTransaction(t);
  stubReportGroupBy(t);
  const originals = {
    reportFindMany: prisma.report.findMany,
    reportCount: prisma.report.count
  };
  prisma.report.findMany = async args => {
    assert.equal(args.include, undefined);
    assert.equal(args.select.id, true);
    assert.equal(args.select.project.select.name, true);
    assert.equal(args.select.services.select.attachments, undefined);
    assert.equal(args.select.versions, undefined);
    return [activeReport({ id: 'report-summary' })];
  };
  prisma.report.count = async () => 1;
  t.after(() => {
    prisma.report.findMany = originals.reportFindMany;
    prisma.report.count = originals.reportCount;
  });

  const response = await dispatchApp('GET', '/api/reports?page=1&pageSize=10&summary=true', undefined);

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json.items.map(item => item.id), ['report-summary']);
  assert.deepEqual(response.json.pagination, {
    page: 1,
    pageSize: 10,
    total: 1,
    totalPages: 1
  });
});

test('GET /reports applies status and project activity filters before pagination', async t => {
  stubAuthenticatedManager(t);
  stubReportListTransaction(t);
  stubReportGroupBy(t);
  const originals = {
    reportFindMany: prisma.report.findMany,
    reportCount: prisma.report.count
  };
  prisma.report.findMany = async args => {
    assert.deepEqual(args.where.status, { in: ['PENDING', 'RETURNED'] });
    assert.equal(args.where.project.isActive, true);
    assert.equal(args.where.project.deletedAt, null);
    assert.equal(args.skip, 0);
    assert.equal(args.take, 25);
    return [activeReport({ id: 'report-filtered' })];
  };
  prisma.report.count = async args => {
    assert.deepEqual(args.where.status, { in: ['PENDING', 'RETURNED'] });
    assert.equal(args.where.project.isActive, true);
    return 1;
  };
  t.after(() => {
    prisma.report.findMany = originals.reportFindMany;
    prisma.report.count = originals.reportCount;
  });

  const response = await dispatchApp(
    'GET',
    '/api/reports?page=1&pageSize=25&summary=true&statuses=PENDING,RETURNED&projectActive=true',
    undefined
  );

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json.items.map(item => item.id), ['report-filtered']);
});

test('GET /reports applies search filter in database before pagination for internal roles', async t => {
  stubAuthenticatedManager(t);
  stubReportListTransaction(t);
  stubReportGroupBy(t);
  const originals = {
    reportFindMany: prisma.report.findMany,
    reportCount: prisma.report.count
  };
  prisma.report.findMany = async args => {
    assert.equal(args.skip, 0);
    assert.equal(args.take, 10);
    assert.equal(Array.isArray(args.where.AND), true);
    const searchOr = args.where.AND[0].OR;
    assert.equal(searchOr.some(item => item.project?.code?.contains === '5797'), true);
    assert.equal(searchOr.some(item => item.sequenceNumber === 5797), true);
    assert.equal(searchOr.some(item => item.createdBy?.is?.name?.contains === '5797'), true);
    assert.equal(searchOr.some(item => item.services?.some?.equipment?.is?.code?.contains === '5797'), true);
    return [activeReport({ id: 'report-search' })];
  };
  prisma.report.count = async args => {
    assert.equal(Array.isArray(args.where.AND), true);
    return 1;
  };
  t.after(() => {
    prisma.report.findMany = originals.reportFindMany;
    prisma.report.count = originals.reportCount;
  });

  const response = await dispatchApp('GET', '/api/reports?page=1&pageSize=10&summary=true&search=5797', undefined);

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json.items.map(item => item.id), ['report-search']);
});

test('GET /reports orders project report type pages by requested sequence direction', async t => {
  stubAuthenticatedManager(t);
  stubReportListTransaction(t);
  stubReportGroupBy(t, [{ projectId: 'project-1', reportType: ReportType.RDO, _count: { _all: 50 } }]);
  const originals = {
    reportFindMany: prisma.report.findMany,
    reportCount: prisma.report.count
  };
  prisma.report.findMany = async args => {
    assert.equal(args.where.projectId, 'project-1');
    assert.equal(args.where.reportType, ReportType.RDO);
    assert.deepEqual(args.orderBy, [
      { sequenceNumber: 'asc' },
      { reportDate: 'asc' },
      { createdAt: 'asc' }
    ]);
    assert.equal(args.skip, 10);
    assert.equal(args.take, 10);
    return [activeReport({ id: 'report-11', sequenceNumber: 11 })];
  };
  prisma.report.count = async args => {
    assert.equal(args.where.projectId, 'project-1');
    assert.equal(args.where.reportType, ReportType.RDO);
    return 50;
  };
  t.after(() => {
    prisma.report.findMany = originals.reportFindMany;
    prisma.report.count = originals.reportCount;
  });

  const response = await dispatchApp(
    'GET',
    '/api/reports?page=2&pageSize=10&summary=true&projectId=project-1&reportType=RDO&reportSort=asc',
    undefined
  );

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json.items.map(item => item.sequenceNumber), [11]);
});

test('GET /reports orders global project pages by requested project direction', async t => {
  stubAuthenticatedManager(t);
  stubReportListTransaction(t);
  stubReportGroupBy(t, [{ projectId: 'project-1', reportType: ReportType.RDO, _count: { _all: 1 } }]);
  const originals = {
    reportFindMany: prisma.report.findMany,
    reportCount: prisma.report.count
  };
  prisma.report.findMany = async args => {
    assert.deepEqual(args.orderBy, [
      { project: { code: 'asc' } },
      { project: { name: 'asc' } },
      { reportDate: 'desc' },
      { createdAt: 'desc' }
    ]);
    assert.equal(args.skip, 0);
    assert.equal(args.take, 10);
    return [activeReport({ id: 'report-project-sort', sequenceNumber: 1 })];
  };
  prisma.report.count = async () => 1;
  t.after(() => {
    prisma.report.findMany = originals.reportFindMany;
    prisma.report.count = originals.reportCount;
  });

  const response = await dispatchApp(
    'GET',
    '/api/reports?page=1&pageSize=10&summary=true&projectSort=asc',
    undefined
  );

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json.items.map(item => item.id), ['report-project-sort']);
});

test('GET /reports applies manager review queue filter before pagination', async t => {
  stubAuthenticatedManager(t);
  stubReportListTransaction(t);
  stubReportGroupBy(t, [{ projectId: 'project-1', reportType: ReportType.RDO, _count: { _all: 3 } }]);
  const originals = {
    reportFindMany: prisma.report.findMany,
    reportCount: prisma.report.count
  };
  prisma.report.findMany = async args => {
    assert.equal(args.where.status, undefined);
    assert.equal(args.where.project.isActive, true);
    assert.equal(args.skip, 0);
    assert.equal(args.take, 25);
    const queueFilter = args.where.AND.find(item => Array.isArray(item.OR));
    assert.deepEqual(queueFilter.OR[0], { status: { in: [ReportStatus.PENDING, ReportStatus.RETURNED] } });
    assert.equal(queueFilter.OR[1].status.not, ReportStatus.SIGNED);
    assert.deepEqual(queueFilter.OR[1].AND[0].specialConditions.path, ['__clientRejectedAt']);
    assert.deepEqual(queueFilter.OR[1].AND[1].specialConditions.path, ['__clientRejectionResolvedAt']);
    return [activeReport({ id: 'report-review-queue' })];
  };
  prisma.report.count = async args => {
    assert.equal(args.where.status, undefined);
    assert.equal(Array.isArray(args.where.AND), true);
    return 3;
  };
  t.after(() => {
    prisma.report.findMany = originals.reportFindMany;
    prisma.report.count = originals.reportCount;
  });

  const response = await dispatchApp(
    'GET',
    '/api/reports?page=1&pageSize=25&summary=true&reviewQueue=true&projectActive=true&statuses=SIGNED',
    undefined
  );

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json.items.map(item => item.id), ['report-review-queue']);
  assert.deepEqual(response.json.pagination, {
    page: 1,
    pageSize: 25,
    total: 3,
    totalPages: 1
  });
});

test('collaborator direct report routes reject hidden projects for operator participants', async t => {
  stubAuthenticatedCollaborator(t);
  const originals = {
    reportFindUniqueOrThrow: prisma.report.findUniqueOrThrow,
    transaction: prisma.$transaction
  };
  const calls = [];
  prisma.report.findUniqueOrThrow = async args => {
    calls.push(['report.findUniqueOrThrow', args]);
    return hiddenCollaboratorReport();
  };
  prisma.$transaction = async () => {
    calls.push(['transaction']);
    throw new Error('hidden project report mutation should not run');
  };
  t.after(() => {
    prisma.report.findUniqueOrThrow = originals.reportFindUniqueOrThrow;
    prisma.$transaction = originals.transaction;
  });

  const getResponse = await dispatchApp('GET', '/api/reports/report-hidden', undefined);
  const pdfResponse = await dispatchApp('GET', '/api/reports/report-hidden/pdf', undefined);
  const putResponse = await dispatchApp('PUT', '/api/reports/report-hidden', reportPayload({
    projectId: 'project-hidden',
    status: undefined
  }));

  assert.equal(getResponse.statusCode, 403);
  assert.equal(pdfResponse.statusCode, 403);
  assert.equal(putResponse.statusCode, 403);
  assert.equal(calls.some(([name]) => name === 'transaction'), false);
});

test('collaborator direct report route allows explicit authorized user on hidden active project', async t => {
  stubAuthenticatedCollaborator(t);
  const originalFindUniqueOrThrow = prisma.report.findUniqueOrThrow;
  prisma.report.findUniqueOrThrow = async () => hiddenCollaboratorReport({
    createdByUserId: 'other-user',
    project: {
      ...hiddenCollaboratorReport().project,
      operatorId: 'other-collab',
      authorizedUsers: [{ userId: 'user-collab' }]
    },
    collaborators: []
  });
  t.after(() => {
    prisma.report.findUniqueOrThrow = originalFindUniqueOrThrow;
  });

  const response = await dispatchApp('GET', '/api/reports/report-hidden', undefined);

  assert.equal(response.statusCode, 200);
  assert.equal(response.json.id, 'report-hidden');
});

test('PATCH report status rejects reports under soft-deleted projects before mutation', async t => {
  stubAuthenticatedManager(t);
  const originals = {
    reportFindUnique: prisma.report.findUnique,
    transaction: prisma.$transaction
  };
  const calls = [];
  prisma.report.findUnique = async args => {
    calls.push(['report.findUnique', args]);
    return {
      id: 'report-1',
      status: ReportStatus.PENDING,
      specialConditions: {},
      deletedAt: null,
      project: { deletedAt: new Date() }
    };
  };
  prisma.$transaction = async () => {
    calls.push(['transaction']);
    throw new Error('status mutation should not run for a deleted project');
  };
  t.after(() => {
    prisma.report.findUnique = originals.reportFindUnique;
    prisma.$transaction = originals.transaction;
  });

  const response = await dispatchApp('PATCH', '/api/reports/report-1/status', {
    status: ReportStatus.APPROVED
  });

  assert.equal(response.statusCode, 404);
  assert.deepEqual(calls.map(([name]) => name), ['report.findUnique']);
});

test('POST report creation requires an active target project before reserving sequence', async t => {
  stubAuthenticatedManager(t);
  const originals = {
    transaction: prisma.$transaction
  };
  const calls = [];
  prisma.$transaction = async callback => callback({
    project: {
      findFirstOrThrow: async args => {
        calls.push(['project.findFirstOrThrow', args]);
        throw prismaNotFound();
      }
    },
    projectReportSeq: {
      upsert: async args => {
        calls.push(['projectReportSeq.upsert', args]);
        throw new Error('sequence reservation should not run for a deleted project');
      }
    },
    report: {
      create: async args => {
        calls.push(['report.create', args]);
        throw new Error('report creation should not run for a deleted project');
      }
    }
  });
  t.after(() => {
    prisma.$transaction = originals.transaction;
  });

  const response = await dispatchApp('POST', '/api/reports', reportPayload());

  assert.equal(response.statusCode, 404);
  assert.deepEqual(calls.map(([name]) => name), ['project.findFirstOrThrow']);
  assert.deepEqual(calls[0][1].where, { id: 'deleted-project', deletedAt: null });
});

test('POST service-only report creation requires an active target project', async t => {
  stubAuthenticatedManager(t);
  const originals = {
    transaction: prisma.$transaction
  };
  const calls = [];
  prisma.$transaction = async callback => callback({
    project: {
      findFirstOrThrow: async args => {
        calls.push(['project.findFirstOrThrow', args]);
        throw prismaNotFound();
      }
    },
    report: {
      create: async args => {
        calls.push(['report.create', args]);
        throw new Error('service-only report creation should not run for a deleted project');
      }
    }
  });
  t.after(() => {
    prisma.$transaction = originals.transaction;
  });

  const response = await dispatchApp('POST', '/api/reports/service-only', serviceOnlyPayload());

  assert.equal(response.statusCode, 404);
  assert.deepEqual(calls.map(([name]) => name), ['project.findFirstOrThrow']);
  assert.deepEqual(calls[0][1].where, { id: 'deleted-project', deletedAt: null });
});

test('PUT report rejects moves to soft-deleted target projects before rewriting report data', async t => {
  stubAuthenticatedManager(t);
  const originals = {
    reportFindUniqueOrThrow: prisma.report.findUniqueOrThrow,
    transaction: prisma.$transaction
  };
  const calls = [];
  prisma.report.findUniqueOrThrow = async args => {
    calls.push(['report.findUniqueOrThrow', args]);
    return activeReport();
  };
  prisma.$transaction = async callback => callback({
    project: {
      findFirstOrThrow: async args => {
        calls.push(['project.findFirstOrThrow', args]);
        throw prismaNotFound();
      }
    },
    reportCollaborator: {
      deleteMany: async args => {
        calls.push(['reportCollaborator.deleteMany', args]);
        throw new Error('collaborators should not be rewritten for a deleted target project');
      }
    },
    reportService: {
      deleteMany: async args => {
        calls.push(['reportService.deleteMany', args]);
        throw new Error('services should not be rewritten for a deleted target project');
      }
    },
    report: {
      update: async args => {
        calls.push(['report.update', args]);
        throw new Error('report update should not run for a deleted target project');
      }
    }
  });
  t.after(() => {
    prisma.report.findUniqueOrThrow = originals.reportFindUniqueOrThrow;
    prisma.$transaction = originals.transaction;
  });

  const response = await dispatchApp('PUT', '/api/reports/report-1', reportPayload({
    status: undefined
  }));

  assert.equal(response.statusCode, 404);
  assert.deepEqual(calls.map(([name]) => name), ['report.findUniqueOrThrow', 'project.findFirstOrThrow']);
  assert.deepEqual(calls[1][1].where, { id: 'deleted-project', deletedAt: null });
});

test('DELETE report clears deleted sequence numbers and renumbers remaining project reports', async t => {
  stubAuthenticatedManager(t);
  const originals = {
    reportFindUniqueOrThrow: prisma.report.findUniqueOrThrow,
    transaction: prisma.$transaction
  };
  const calls = [];
  prisma.report.findUniqueOrThrow = async args => {
    calls.push(['report.findUniqueOrThrow', args]);
    return activeReport({
      id: 'rdo-29',
      projectId: 'project-1',
      reportType: ReportType.RDO,
      sequenceNumber: 29,
      status: ReportStatus.APPROVED
    });
  };
  prisma.$transaction = async callback => callback({
    report: {
      findMany: async args => {
        calls.push(['tx.report.findMany', args]);
        if (typeof args.where.reportType === 'object') {
          return [{
            id: 'rcpu-12',
            reportType: ReportType.RCPU,
            specialConditions: { parentRdoId: 'rdo-29' }
          }, {
            id: 'rcpu-other',
            reportType: ReportType.RCPU,
            specialConditions: { parentRdoId: 'other-rdo' }
          }];
        }
        if (args.where.reportType === ReportType.RDO) {
          return [
            { id: 'rdo-30', sequenceNumber: 30, status: ReportStatus.APPROVED },
            { id: 'rdo-31', sequenceNumber: 31, status: ReportStatus.PENDING }
          ];
        }
        if (args.where.reportType === ReportType.RCPU) {
          return [{ id: 'rcpu-13', sequenceNumber: 13, status: ReportStatus.PENDING }];
        }
        return [];
      },
      updateMany: async args => {
        calls.push(['tx.report.updateMany', args]);
        return { count: args.where.id.in.length };
      },
      update: async args => {
        calls.push(['tx.report.update', args]);
        return { id: args.where.id, ...args.data };
      }
    },
    projectReportSeq: {
      upsert: async args => {
        calls.push(['tx.projectReportSeq.upsert', args]);
        return args.create;
      }
    }
  });
  t.after(() => {
    prisma.report.findUniqueOrThrow = originals.reportFindUniqueOrThrow;
    prisma.$transaction = originals.transaction;
  });

  const response = await dispatchApp('DELETE', '/api/reports/rdo-29');

  assert.equal(response.statusCode, 204);
  const deleteCall = calls.find(([name, args]) => (
    name === 'tx.report.updateMany'
    && Array.isArray(args.where?.id?.in)
    && args.where.id.in.includes('rdo-29')
  ));
  assert.ok(deleteCall);
  assert.deepEqual(deleteCall[1].where.id.in.sort(), ['rcpu-12', 'rdo-29']);
  assert.equal(deleteCall[1].data.sequenceNumber, null);
  assert.ok(deleteCall[1].data.deletedAt instanceof Date);

  const sequenceUpdates = calls
    .filter(([name]) => name === 'tx.report.update')
    .map(([, args]) => [args.where.id, args.data.sequenceNumber]);
  assert.deepEqual(sequenceUpdates, [
    ['rdo-30', 1],
    ['rdo-31', 2],
    ['rcpu-13', 1]
  ]);

  const sequenceReservations = calls
    .filter(([name]) => name === 'tx.projectReportSeq.upsert')
    .map(([, args]) => [args.where.projectId_reportType.reportType, args.update.nextNumber]);
  assert.deepEqual(sequenceReservations, [
    [ReportType.RDO, 2],
    [ReportType.RCPU, 1]
  ]);
});
