import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  cleanupFailedRomaneioCreate,
  requireRomaneioManager,
  requireRomaneioModuleAccess,
  romaneioEmailFailureResult,
  visibleRomaneioWhere
} from '../src/routes/resources/romaneios.js';

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

test('Romaneio module access rejects internal accounts without romaneio roles', () => {
  const req = {
    auth: {
      user: { accountType: 'INTERNAL', moduleRoles: ['epi:technician'] }
    }
  };
  const res = responseRecorder();
  let nextCalled = false;

  requireRomaneioModuleAccess(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 403);

  req.auth.user.moduleRoles = ['romaneio:operator'];
  requireRomaneioModuleAccess(req, res, () => {
    nextCalled = true;
  });
  assert.equal(nextCalled, true);
});

test('Romaneio manager guard rejects admin accounts without manager role', () => {
  const req = {
    auth: {
      user: { accountType: 'ADMIN', moduleRoles: ['romaneio:operator'] }
    }
  };
  const res = responseRecorder();
  let nextCalled = false;

  requireRomaneioManager(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 403);

  req.auth.user.moduleRoles = ['romaneio:manager'];
  requireRomaneioManager(req, res, () => {
    nextCalled = true;
  });
  assert.equal(nextCalled, true);
});

test('cleanupFailedRomaneioCreate removes generated files and the created row', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'romaneio-cleanup-'));
  const docxPath = path.join(dir, 'romaneio.docx');
  const pdfPath = path.join(dir, 'romaneio.pdf');
  await fs.writeFile(docxPath, 'docx');
  await fs.writeFile(pdfPath, 'pdf');
  const deletes = [];

  await cleanupFailedRomaneioCreate({
    romaneioId: 'romaneio-1',
    files: {
      docx: { targetPath: docxPath },
      pdf: { targetPath: pdfPath }
    },
    client: {
      romaneio: {
        delete: async args => {
          deletes.push(args);
        }
      }
    }
  });

  await assert.rejects(() => fs.access(docxPath), /ENOENT/);
  await assert.rejects(() => fs.access(pdfPath), /ENOENT/);
  assert.deepEqual(deletes, [{ where: { id: 'romaneio-1' } }]);
});

test('romaneioEmailFailureResult stores SMTP failures without failing creation', () => {
  assert.deepEqual(
    romaneioEmailFailureResult(new Error('SMTP indisponivel')),
    { status: 'erro no envio', error: 'SMTP indisponivel' }
  );
});

test('Romaneio visibility queries exclude soft-deleted projects', () => {
  assert.deepEqual(
    visibleRomaneioWhere(),
    { project: { deletedAt: null } }
  );
  assert.deepEqual(
    visibleRomaneioWhere({ id: 'romaneio-1', project: { code: { contains: 'P-001' } } }),
    {
      id: 'romaneio-1',
      project: {
        code: { contains: 'P-001' },
        deletedAt: null
      }
    }
  );
});
