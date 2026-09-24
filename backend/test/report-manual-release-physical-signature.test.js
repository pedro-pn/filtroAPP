import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PassThrough, Readable, Writable } from 'node:stream';
import test, { after } from 'node:test';

import { ReportStatus, ReportType } from '@prisma/client';

const uploadDir = await fs.mkdtemp(path.join(os.tmpdir(), 'report-physical-signature-'));
process.env.DATABASE_URL ||= 'postgresql://test:test@127.0.0.1:5432/test';
process.env.UPLOAD_DIR = uploadDir;
const [{ default: app }, { default: prisma }, { canClientSeeReport }] = await Promise.all([
  import('../src/app.js'),
  import('../src/lib/prisma.js'),
  import('../src/routes/resources/reports.js')
]);
after(async () => fs.rm(uploadDir, { recursive: true, force: true }));

function managerSession() {
  return {
    id: 'session-1', expiresAt: new Date(Date.now() + 60_000),
    user: {
      id: 'manager-1', username: 'manager', name: 'Manager', email: 'manager@example.com',
      role: 'MANAGER', accountType: 'ADMIN', isActive: true,
      moduleRoles: [{ role: 'RDO_MANAGER' }]
    }
  };
}

function report(overrides = {}) {
  return {
    id: 'rdo-1', projectId: 'project-1', reportType: ReportType.RDO,
    status: ReportStatus.APPROVED, updatedAt: new Date('2026-09-24T12:00:00.000Z'),
    reportDate: new Date('2026-09-20T00:00:00.000Z'), sequenceNumber: 1,
    deletedAt: null, specialConditions: {}, reportSignatures: [], clientReviews: [], versions: [],
    project: { id: 'project-1', code: 'P1', name: 'Projeto', deletedAt: null, managerOnly: false, clientCnpj: '12345678000190' },
    ...overrides
  };
}

function dispatch(method, url, body) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const req = new Readable({ read() { if (payload) this.push(payload); this.push(null); } });
    req.method = method;
    req.url = url;
    req.headers = {
      authorization: 'Bearer test-token', host: '127.0.0.1',
      ...(payload ? { 'content-type': 'application/json', 'content-length': String(payload.length) } : {})
    };
    req.socket = new PassThrough();
    req.socket.remoteAddress = '127.0.0.1';
    req.socket.encrypted = false;
    req.connection = req.socket;

    const chunks = [];
    const headers = new Map();
    const res = new Writable({ write(chunk, _encoding, callback) { chunks.push(Buffer.from(chunk)); callback(); } });
    res.statusCode = 200;
    res.setHeader = (name, value) => headers.set(String(name).toLowerCase(), value);
    res.getHeader = name => headers.get(String(name).toLowerCase());
    res.getHeaders = () => Object.fromEntries(headers);
    res.removeHeader = name => headers.delete(String(name).toLowerCase());
    res.writeHead = (statusCode, values = {}) => { res.statusCode = statusCode; Object.entries(values).forEach(([name, value]) => res.setHeader(name, value)); return res; };
    res.end = (chunk, encoding, callback) => {
      if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding));
      Writable.prototype.end.call(res, callback);
      const raw = Buffer.concat(chunks).toString('utf8');
      resolve({ statusCode: res.statusCode, json: raw ? JSON.parse(raw) : null });
      return res;
    };
    app.handle(req, res, reject);
  });
}

function stubManager(t) {
  const original = prisma.userSession.findUnique;
  prisma.userSession.findUnique = async () => managerSession();
  t.after(() => { prisma.userSession.findUnique = original; });
}

test('gestor libera e revoga apenas um relatório de serviço vinculado', async t => {
  stubManager(t);
  const parent = report();
  const service = report({ id: 'service-1', reportType: ReportType.RLQ, specialConditions: { parentRdoId: parent.id } });
  const auditActions = [];
  const originals = {
    findUnique: prisma.report.findUnique,
    findMany: prisma.report.findMany,
    transaction: prisma.$transaction
  };
  prisma.report.findUnique = async () => service;
  prisma.report.findMany = async () => [parent, service];
  prisma.$transaction = async callback => callback({
    report: {
      updateMany: async ({ data }) => { Object.assign(service, data); return { count: 1 }; },
      findUniqueOrThrow: async () => service
    },
    reportAuditLog: { create: async ({ data }) => { auditActions.push(data.action); return data; } }
  });
  t.after(() => {
    prisma.report.findUnique = originals.findUnique;
    prisma.report.findMany = originals.findMany;
    prisma.$transaction = originals.transaction;
  });

  const released = await dispatch('PATCH', '/api/reports/service-1/client-release', { release: true });
  assert.equal(released.statusCode, 200);
  assert.equal(released.json.clientReleasedAt, released.json.updatedAt);
  assert.equal(canClientSeeReport(service, new Map([[parent.id, parent], [service.id, service]])), true);

  const revoked = await dispatch('PATCH', '/api/reports/service-1/client-release', { release: false });
  assert.equal(revoked.statusCode, 200);
  assert.equal(revoked.json.clientReleasedAt, null);
  assert.equal(canClientSeeReport(service, new Map([[parent.id, parent], [service.id, service]])), false);
  assert.deepEqual(auditActions, ['CLIENT_RELEASED', 'CLIENT_RELEASE_REVOKED']);
});

test('upload do RDO assinado em papel cria versão final e bloqueia o relatório', async t => {
  stubManager(t);
  const item = report();
  const auditActions = [];
  const originals = {
    findUnique: prisma.report.findUnique,
    findMany: prisma.report.findMany,
    versionFindUnique: prisma.reportVersion.findUnique,
    transaction: prisma.$transaction
  };
  prisma.report.findUnique = async () => item;
  prisma.report.findMany = async () => [item];
  prisma.reportVersion.findUnique = async () => null;
  prisma.$transaction = async callback => callback({
    report: {
      updateMany: async ({ data }) => { Object.assign(item, data); return { count: 1 }; },
      findUniqueOrThrow: async () => item
    },
    reportVersion: {
      findMany: async () => [], count: async () => 0,
      create: async ({ data }) => {
        const version = { id: 'version-paper', ...data };
        item.versions = [version];
        return version;
      }
    },
    reportAuditLog: { create: async ({ data }) => { auditActions.push(data.action); return data; } }
  });
  t.after(() => {
    prisma.report.findUnique = originals.findUnique;
    prisma.report.findMany = originals.findMany;
    prisma.reportVersion.findUnique = originals.versionFindUnique;
    prisma.$transaction = originals.transaction;
  });

  const pdf = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF');
  const response = await dispatch('POST', '/api/reports/rdo-1/physical-signature', {
    fileName: 'rdo-assinado.pdf', pdfDataUrl: `data:application/pdf;base64,${pdf.toString('base64')}`
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json.report.status, ReportStatus.SIGNED);
  assert.ok(response.json.report.physicalSignedAt);
  assert.equal(response.json.report.versions[0].finalDocumentHash, response.json.report.versions[0].sourceDocumentHash);
  assert.deepEqual(auditActions, ['VERSION_CREATED', 'REPORT_LOCKED', 'PHYSICAL_SIGNATURE_UPLOADED']);
  const stored = await fs.readFile(path.join(uploadDir, response.json.report.versions[0].finalPdfUrl));
  assert.deepEqual(stored, pdf);
});
