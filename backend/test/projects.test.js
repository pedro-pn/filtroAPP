import assert from 'node:assert/strict';
import { PassThrough, Readable, Writable } from 'node:stream';
import test from 'node:test';

import app from '../src/app.js';
import prisma from '../src/lib/prisma.js';
import { removeProjectById } from '../src/routes/resources/projects.js';

const bearerToken = 'project-test-token';

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

test('removeProjectById preserves projects with reports before hiding the project', async () => {
  const calls = [];
  const tx = {
    report: {
      findMany: async args => {
        calls.push(['report.findMany', args]);
        return [{ id: 'report-1' }, { id: 'report-2' }];
      },
      update: async args => {
        calls.push(['report.update', args]);
      },
      deleteMany: async args => {
        calls.push(['report.deleteMany', args]);
      }
    },
    reportDraft: {
      updateMany: async args => {
        calls.push(['reportDraft.updateMany', args]);
      }
    },
    satisfactionSurvey: {
      deleteMany: async args => {
        calls.push(['satisfactionSurvey.deleteMany', args]);
      }
    },
    projectReportSeq: {
      deleteMany: async args => {
        calls.push(['projectReportSeq.deleteMany', args]);
      }
    },
    reportAttachment: {
      deleteMany: async args => {
        calls.push(['reportAttachment.deleteMany', args]);
      }
    },
    clientReportReview: {
      deleteMany: async args => {
        calls.push(['clientReportReview.deleteMany', args]);
      }
    },
    reportCollaborator: {
      deleteMany: async args => {
        calls.push(['reportCollaborator.deleteMany', args]);
      }
    },
    reportService: {
      deleteMany: async args => {
        calls.push(['reportService.deleteMany', args]);
      }
    },
    romaneio: {
      count: async args => {
        calls.push(['romaneio.count', args]);
        return 0;
      }
    },
    project: {
      update: async args => {
        calls.push(['project.update', args]);
      },
      delete: async args => {
        calls.push(['project.delete', args]);
      }
    }
  };
  const prismaClient = {
    $transaction: async callback => callback(tx)
  };

  await removeProjectById('project-1', prismaClient);

  assert.equal(calls[0][0], 'report.findMany');
  assert.deepEqual(calls[0][1], { where: { projectId: 'project-1' }, select: { id: true } });
  assert.equal(calls[1][0], 'project.update');
  assert.equal(calls[1][1].where.id, 'project-1');
  assert.equal(calls[1][1].data.isActive, false);
  assert.ok(calls[1][1].data.deletedAt instanceof Date);
  assert.equal(calls[2][0], 'report.findMany');
  assert.deepEqual(calls.slice(3), [
    ['report.update', {
      where: { id: 'report-1' },
      data: {
        zapsignDocToken: null,
        zapsignSignerToken: null,
        zapsignRequestedAt: null,
        zapsignSignedAt: null,
        zapsignDocUrl: null,
        specialConditions: {}
      }
    }],
    ['report.update', {
      where: { id: 'report-2' },
      data: {
        zapsignDocToken: null,
        zapsignSignerToken: null,
        zapsignRequestedAt: null,
        zapsignSignedAt: null,
        zapsignDocUrl: null,
        specialConditions: {}
      }
    }]
  ]);
});

test('removeProjectById clears dependent records before deleting projects without reports', async () => {
  const calls = [];
  const tx = {
    report: {
      findMany: async args => {
        calls.push(['report.findMany', args]);
        return [];
      },
      deleteMany: async args => {
        calls.push(['report.deleteMany', args]);
      }
    },
    reportDraft: {
      updateMany: async args => {
        calls.push(['reportDraft.updateMany', args]);
      }
    },
    satisfactionSurvey: {
      deleteMany: async args => {
        calls.push(['satisfactionSurvey.deleteMany', args]);
      }
    },
    projectReportSeq: {
      deleteMany: async args => {
        calls.push(['projectReportSeq.deleteMany', args]);
      }
    },
    reportAttachment: {
      deleteMany: async args => {
        calls.push(['reportAttachment.deleteMany', args]);
      }
    },
    clientReportReview: {
      deleteMany: async args => {
        calls.push(['clientReportReview.deleteMany', args]);
      }
    },
    reportCollaborator: {
      deleteMany: async args => {
        calls.push(['reportCollaborator.deleteMany', args]);
      }
    },
    reportService: {
      deleteMany: async args => {
        calls.push(['reportService.deleteMany', args]);
      }
    },
    romaneio: {
      count: async args => {
        calls.push(['romaneio.count', args]);
        return 0;
      }
    },
    project: {
      delete: async args => {
        calls.push(['project.delete', args]);
      }
    }
  };
  const prismaClient = {
    $transaction: async callback => callback(tx)
  };

  await removeProjectById('project-1', prismaClient);

  assert.deepEqual(calls, [
    ['report.findMany', { where: { projectId: 'project-1' }, select: { id: true } }],
    ['romaneio.count', { where: { projectId: 'project-1' } }],
    ['reportDraft.updateMany', { where: { projectId: 'project-1' }, data: { projectId: null } }],
    ['satisfactionSurvey.deleteMany', { where: { projectId: 'project-1' } }],
    ['projectReportSeq.deleteMany', { where: { projectId: 'project-1' } }],
    ['project.delete', { where: { id: 'project-1' } }]
  ]);
});

test('DELETE /projects/:id uses removeProjectById cleanup for projects with romaneios and no reports', async t => {
  stubAuthenticatedManager(t);
  const calls = [];
  const originalTransaction = prisma.$transaction;
  const tx = {
    report: {
      findMany: async args => {
        calls.push(['report.findMany', args]);
        return [];
      },
      update: async args => {
        calls.push(['report.update', args]);
      }
    },
    romaneio: {
      count: async args => {
        calls.push(['romaneio.count', args]);
        return 1;
      }
    },
    project: {
      update: async args => {
        calls.push(['project.update', args]);
      },
      delete: async args => {
        calls.push(['project.delete', args]);
        throw new Error('project should be soft-deleted when romaneios still reference it');
      }
    }
  };
  prisma.$transaction = async callback => callback(tx);
  t.after(() => {
    prisma.$transaction = originalTransaction;
  });

  const response = await dispatchApp('DELETE', '/api/projects/project-1');

  assert.equal(response.statusCode, 204);
  assert.deepEqual(calls.slice(0, 3), [
    ['report.findMany', { where: { projectId: 'project-1' }, select: { id: true } }],
    ['romaneio.count', { where: { projectId: 'project-1' } }],
    ['project.update', {
      where: { id: 'project-1' },
      data: {
        isActive: false,
        deletedAt: calls[2][1].data.deletedAt
      }
    }]
  ]);
  assert.ok(calls[2][1].data.deletedAt instanceof Date);
  assert.equal(calls.some(([name]) => name === 'project.delete'), false);
  assert.deepEqual(calls[3], ['report.findMany', {
    where: {
      projectId: 'project-1',
      zapsignSignedAt: null,
      OR: [
        { zapsignDocToken: { not: null } },
        { zapsignSignerToken: { not: null } },
        { zapsignRequestedAt: { not: null } },
        { zapsignDocUrl: { not: null } }
      ]
    },
    select: {
      id: true,
      specialConditions: true
    }
  }]);
});
