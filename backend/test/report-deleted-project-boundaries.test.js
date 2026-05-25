import assert from 'node:assert/strict';
import { PassThrough, Readable, Writable } from 'node:stream';
import test from 'node:test';

import { Prisma, ReportStatus, ReportType } from '@prisma/client';

import app from '../src/app.js';
import prisma from '../src/lib/prisma.js';
import {
  approvedRdoHistoryWhere,
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
    reportType: { in: [ReportType.RTP, ReportType.RLQ, ReportType.RCPU, ReportType.RLM] }
  });
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
