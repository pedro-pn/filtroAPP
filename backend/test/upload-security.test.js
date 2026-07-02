import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PassThrough, Readable, Writable } from 'node:stream';
import test from 'node:test';

import app from '../src/app.js';
import env from '../src/config/env.js';
import { trustedClientAccessScopeForUser } from '../src/lib/client-project-access.js';
import prisma from '../src/lib/prisma.js';
import { grantReportUploadAccess } from '../src/lib/transient-upload-access.js';
import { authorizeStoredFile, canAccessReport } from '../src/routes/resources/uploads.js';

const validPngDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=';
const bearerToken = 'upload-security-token';
const managerAuth = {
  user: {
    id: 'manager-1',
    role: 'MANAGER',
    moduleRoles: ['rdo:manager']
  },
  rawUser: {}
};

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

function stubUploadManagerSession(t) {
  const originalFindUnique = prisma.userSession.findUnique;
  prisma.userSession.findUnique = async () => ({
    id: 'session-manager',
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
  });
  t.after(() => {
    prisma.userSession.findUnique = originalFindUnique;
  });
}

// Stub do projeto "dono" da pasta usada nos testes de escopo de projeto.
function stubProjectScope(t, project) {
  const originalProjectFindUnique = prisma.project.findUnique;
  const originalDraftFindMany = prisma.reportDraft.findMany;
  prisma.project.findUnique = async args => {
    if (project && args?.where?.code === project.code) return project;
    return null;
  };
  prisma.reportDraft.findMany = async () => [];
  t.after(() => {
    prisma.project.findUnique = originalProjectFindUnique;
    prisma.reportDraft.findMany = originalDraftFindMany;
  });
}

test('stored upload access rejects soft-deleted reports and projects', () => {
  assert.equal(
    canAccessReport(managerAuth, {
      id: 'report-1',
      deletedAt: new Date(),
      project: { deletedAt: null }
    }),
    false
  );
  assert.equal(
    canAccessReport(managerAuth, {
      id: 'report-1',
      deletedAt: null,
      project: { deletedAt: new Date() }
    }),
    false
  );
});

test('stored upload access rejects client reports under soft-deleted linked projects', () => {
  assert.equal(
    canAccessReport({
      user: {
        id: 'client-1',
        username: 'client@example.com',
        role: 'CLIENT',
        accountType: 'CLIENT',
        moduleRoles: ['rdo:client']
      },
      rawUser: {}
    }, {
      id: 'report-1',
      deletedAt: null,
      project: {
        deletedAt: new Date(),
        managerOnly: false,
        clientCnpj: '11222333000144',
        clientEmailPrimary: 'client@example.com',
        clientEmailCc: []
      }
    }),
    false
  );
});

test('escopo de projeto: colaborador acessa arquivo de projeto visível e ativo', async t => {
  const project = {
    id: 'project-1',
    code: 'P-100',
    name: 'Projeto Seguro',
    isActive: true,
    deletedAt: null,
    managerOnly: false,
    visibleToCollaborators: true,
    authorizedUsers: []
  };
  stubProjectScope(t, project);
  const auth = {
    user: {
      id: 'user-collab',
      role: 'COLLABORATOR',
      collaboratorId: 'collab-1',
      moduleRoles: ['rdo:collaborator']
    },
    rawUser: { collaboratorId: 'collab-1' }
  };
  const filePath = 'Missão P-100 - Projeto Seguro/rdo/photo.jpg';

  assert.equal(await authorizeStoredFile({ auth }, filePath), true);

  // Projeto oculto e sem vínculo → negado.
  project.visibleToCollaborators = false;
  assert.equal(await authorizeStoredFile({ auth }, filePath), false);

  // Vínculo autorizado dá acesso mesmo oculto.
  project.authorizedUsers = [{ userId: 'user-collab' }];
  assert.equal(await authorizeStoredFile({ auth }, filePath), true);

  // Projeto inativo → negado.
  project.visibleToCollaborators = true;
  project.authorizedUsers = [];
  project.isActive = false;
  assert.equal(await authorizeStoredFile({ auth }, filePath), false);

  // Projeto managerOnly → negado para colaborador.
  project.isActive = true;
  project.managerOnly = true;
  assert.equal(await authorizeStoredFile({ auth }, filePath), false);
});

test('escopo de projeto: gestor acessa qualquer arquivo de projeto que enxerga', async t => {
  const project = {
    id: 'project-1',
    code: 'P-100',
    name: 'Projeto Seguro',
    isActive: true,
    deletedAt: null,
    managerOnly: true,
    visibleToCollaborators: false,
    authorizedUsers: []
  };
  stubProjectScope(t, project);

  assert.equal(
    await authorizeStoredFile({ auth: managerAuth }, 'Missão P-100 - Projeto Seguro/rdo/foto.jpg'),
    true
  );
});

test('escopo de projeto: colaborador negado para arquivo de outro projeto', async t => {
  const project = {
    id: 'project-1',
    code: 'P-100',
    name: 'Projeto Seguro',
    isActive: true,
    deletedAt: null,
    managerOnly: false,
    visibleToCollaborators: true,
    authorizedUsers: []
  };
  stubProjectScope(t, project);
  const auth = {
    user: {
      id: 'user-collab',
      role: 'COLLABORATOR',
      collaboratorId: 'collab-1',
      moduleRoles: ['rdo:collaborator']
    },
    rawUser: { collaboratorId: 'collab-1' }
  };

  // Pasta de outro projeto (não encontrado) → negado.
  assert.equal(await authorizeStoredFile({ auth }, 'Missão P-999 - Outro Projeto/foto.jpg'), false);
  // Caminho fora de qualquer pasta de projeto → negado (cai no fallback de rascunho vazio).
  assert.equal(await authorizeStoredFile({ auth }, 'private/report.pdf'), false);
});

test('stored upload access denies internal users for files outside any project folder', async t => {
  const originals = {
    attachmentFindMany: prisma.reportAttachment.findMany,
    draftFindMany: prisma.reportDraft.findMany,
    reportFindMany: prisma.report.findMany
  };
  prisma.reportAttachment.findMany = async () => [];
  prisma.reportDraft.findMany = async () => [];
  prisma.report.findMany = async () => {
    throw new Error('arbitrary report JSON references must not authorize stored-file access');
  };
  t.after(() => {
    prisma.reportAttachment.findMany = originals.attachmentFindMany;
    prisma.reportDraft.findMany = originals.draftFindMany;
    prisma.report.findMany = originals.reportFindMany;
  });
  const auth = {
    user: {
      id: 'manager-preview',
      role: 'MANAGER',
      moduleRoles: ['rdo:manager']
    },
    rawUser: {}
  };

  grantReportUploadAccess(auth, {
    id: 'report-preview',
    specialConditions: {
      generalUploads: [{ url: '/relatorios/private-other-project/foto.jpg' }]
    },
    attachments: [],
    services: []
  });

  assert.equal(await authorizeStoredFile({ auth }, 'private-other-project/foto.jpg'), false);
  assert.equal(await authorizeStoredFile({ auth }, 'private-other-project/service.jpg'), false);
});

test('protected upload route uses shared auth middleware', () => {
  const source = fs.readFileSync(new URL('../src/routes/resources/uploads.js', import.meta.url), 'utf8');

  assert.match(source, /router\.get\('\/file\/\*filePath', requireAuth,/);
  assert.doesNotMatch(source, /function authenticateFileRequest/);
});

test('upload endpoint rejects active content and invalid images before writing files', async t => {
  stubUploadManagerSession(t);
  const originalReportsDir = env.reportsDir;
  const dir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'rdo-upload-validation-'));
  env.reportsDir = dir;
  t.after(async () => {
    env.reportsDir = originalReportsDir;
    await fsPromises.rm(dir, { recursive: true, force: true });
  });

  const htmlResponse = await dispatchApp('POST', '/api/uploads', {
    fileName: 'payload.html',
    mimeType: 'text/html',
    dataUrl: `data:text/html;base64,${Buffer.from('<script>localStorage.token</script>').toString('base64')}`,
    label: 'HTML'
  });
  const invalidPngResponse = await dispatchApp('POST', '/api/uploads', {
    fileName: 'broken.png',
    mimeType: 'image/png',
    dataUrl: `data:image/png;base64,${Buffer.from('not-a-png').toString('base64')}`,
    label: 'PNG quebrado'
  });

  assert.equal(htmlResponse.statusCode, 400);
  assert.equal(invalidPngResponse.statusCode, 400);
  assert.deepEqual(await fsPromises.readdir(dir), []);
});

test('upload endpoint stores valid images as sanitized jpeg files', async t => {
  stubUploadManagerSession(t);
  const originalReportsDir = env.reportsDir;
  const dir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'rdo-upload-valid-'));
  env.reportsDir = dir;
  t.after(async () => {
    env.reportsDir = originalReportsDir;
    await fsPromises.rm(dir, { recursive: true, force: true });
  });

  const response = await dispatchApp('POST', '/api/uploads', {
    fileName: 'foto.png',
    mimeType: 'image/png',
    dataUrl: validPngDataUrl,
    label: 'Foto'
  });
  const files = await fsPromises.readdir(dir);

  assert.equal(response.statusCode, 201);
  assert.equal(response.json.mimeType, 'image/jpeg');
  assert.match(response.json.fileName, /\.jpg$/);
  assert.equal(files.length, 1);
  assert.match(files[0], /\.jpg$/);
});

test('stored upload access allows trusted legacy client email scope', async t => {
  const originals = {
    projectFindMany: prisma.project.findMany,
    userFindMany: prisma.user.findMany,
    queryRaw: prisma.$queryRaw,
    attachmentFindMany: prisma.reportAttachment.findMany,
    reportFindMany: prisma.report.findMany
  };
  const rawUser = {
    id: 'client-1',
    username: '11222333000144',
    name: 'Cliente',
    email: 'cliente@example.com',
    role: 'CLIENT',
    accountType: 'CLIENT',
    isActive: true,
    moduleRoles: [{ role: 'RDO_CLIENT' }]
  };
  prisma.project.findMany = async args => {
    if (args?.select?.clientEmailPrimary) {
      return [{
        clientEmailPrimary: 'cliente@example.com',
        clientEmailCc: [],
        clientSigners: []
      }];
    }
    return [];
  };
  prisma.user.findMany = async () => [];
  prisma.$queryRaw = async () => {
    throw new Error('stored-file access must not use raw JSON/text scans');
  };
  prisma.reportAttachment.findMany = async args => {
    assert.equal(args.where.storagePath.in.includes('protected/photo.jpg'), true);
    return [{
      reportId: 'report-1',
      reportService: null
    }];
  };
  prisma.report.findMany = async () => [{
    id: 'report-1',
    projectId: 'project-1',
    reportType: 'RDO',
    status: 'APPROVED',
    deletedAt: null,
    createdByUserId: 'other-user',
    specialConditions: {
      photo: '/api/rdo/uploads/file/protected/photo.jpg'
    },
    project: {
      deletedAt: null,
      managerOnly: false,
      clientCnpj: '00999000199',
      clientEmailPrimary: 'cliente@example.com',
      clientEmailCc: [],
      clientSigners: [],
      authorizedUsers: []
    },
    collaborators: [],
    attachments: [],
    services: []
  }];
  t.after(() => {
    prisma.project.findMany = originals.projectFindMany;
    prisma.user.findMany = originals.userFindMany;
    prisma.$queryRaw = originals.queryRaw;
    prisma.reportAttachment.findMany = originals.attachmentFindMany;
    prisma.report.findMany = originals.reportFindMany;
  });

  const trustedScope = await trustedClientAccessScopeForUser(prisma, rawUser);
  const allowedWithoutTrustedScope = await authorizeStoredFile({
    auth: {
      user: {
        id: rawUser.id,
        username: rawUser.username,
        email: rawUser.email,
        role: rawUser.role,
        accountType: rawUser.accountType,
        moduleRoles: ['rdo:client']
      },
      rawUser
    }
  }, 'protected/photo.jpg');
  const allowedWithTrustedScope = await authorizeStoredFile({
    auth: {
      user: {
        id: rawUser.id,
        username: rawUser.username,
        email: rawUser.email,
        role: rawUser.role,
        accountType: rawUser.accountType,
        moduleRoles: ['rdo:client'],
        trustedClientEmails: trustedScope.emails,
        trustedClientCnpjs: trustedScope.cnpjs
      },
      rawUser
    }
  }, 'protected/photo.jpg');

  assert.deepEqual(trustedScope.emails, ['cliente@example.com']);
  assert.equal(allowedWithoutTrustedScope, false);
  assert.equal(allowedWithTrustedScope, true);
});

test('stored upload access applies client report visibility before serving attachments', async t => {
  const originals = {
    queryRaw: prisma.$queryRaw,
    attachmentFindMany: prisma.reportAttachment.findMany,
    reportFindMany: prisma.report.findMany
  };
  prisma.$queryRaw = async () => {
    throw new Error('stored-file access must not use raw JSON/text scans');
  };
  prisma.reportAttachment.findMany = async () => [{
    reportId: 'report-1',
    reportService: null
  }];
  const reportsByStatus = {
    PENDING: [{
      id: 'report-1',
      projectId: 'project-1',
      reportType: 'RDO',
      status: 'PENDING',
      deletedAt: null,
      createdByUserId: 'other-user',
      specialConditions: {
        photo: '/api/rdo/uploads/file/protected/photo.jpg'
      },
      project: {
        deletedAt: null,
        managerOnly: false,
        clientCnpj: '11222333000144',
        clientEmailPrimary: '',
        clientEmailCc: [],
        clientSigners: [],
        authorizedUsers: []
      },
      collaborators: [],
      attachments: [],
      services: []
    }],
    APPROVED: []
  };
  reportsByStatus.APPROVED = [{
    ...reportsByStatus.PENDING[0],
    status: 'APPROVED'
  }];
  let currentStatus = 'PENDING';
  prisma.report.findMany = async () => reportsByStatus[currentStatus];
  t.after(() => {
    prisma.$queryRaw = originals.queryRaw;
    prisma.reportAttachment.findMany = originals.attachmentFindMany;
    prisma.report.findMany = originals.reportFindMany;
  });

  const auth = {
    user: {
      id: 'client-1',
      username: '11222333000144',
      role: 'CLIENT',
      accountType: 'CLIENT',
      moduleRoles: ['rdo:client']
    },
    rawUser: {}
  };

  assert.equal(await authorizeStoredFile({ auth }, 'protected/photo.jpg'), false);
  currentStatus = 'APPROVED';
  assert.equal(await authorizeStoredFile({ auth }, 'protected/photo.jpg'), true);
});
