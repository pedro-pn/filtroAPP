import assert from 'node:assert/strict';
import test from 'node:test';

import {
  extractReportUploadAttachments,
  reportUploadAttachmentsNeedSync,
  syncReportUploadAttachments
} from '../src/lib/report-upload-attachments.js';
import { rememberTransientUploadAccess } from '../src/lib/transient-upload-access.js';

function attachmentClient(calls, existing = []) {
  return {
    reportAttachment: {
      findMany: async args => {
        calls.push(['findMany', args]);
        return existing;
      },
      deleteMany: async args => {
        calls.push(['deleteMany', args]);
        return { count: existing.length };
      },
      createMany: async args => {
        calls.push(['createMany', args]);
        return { count: args.data.length };
      }
    }
  };
}

test('extractReportUploadAttachments only accepts known upload containers', () => {
  const report = {
    id: 'report-1',
    project: {
      code: 'P-100',
      name: 'Projeto Seguro'
    },
    specialConditions: {
      generalUploads: [{
        label: 'Registro',
        fileName: 'foto.jpg',
        mimeType: 'image/jpeg',
        url: '/relatorios/Miss%C3%A3o%20P-100%20-%20Projeto%20Seguro/rdo/foto.jpg'
      }],
      injected: {
        url: '/relatorios/outro-projeto/privado.jpg'
      }
    },
    services: [{
      id: 'service-1',
      extraData: {
        evidence: { storagePath: '/relatorios/outro-projeto/service-injetado.jpg' },
        __uploads__: [{
          label: 'Fotos do serviço',
          files: [{
            fileName: 'servico.png',
            mimeType: 'image/png',
            url: '/relatorios/Miss%C3%A3o%20P-100%20-%20Projeto%20Seguro/servico.png'
          }]
        }]
      }
    }]
  };

  assert.deepEqual(extractReportUploadAttachments(report), [{
    label: 'Registro',
    fileName: 'foto.jpg',
    mimeType: 'image/jpeg',
    storagePath: 'Missão P-100 - Projeto Seguro/rdo/foto.jpg',
    reportId: 'report-1',
    reportServiceId: null
  }, {
    label: 'Fotos do serviço',
    fileName: 'servico.png',
    mimeType: 'image/png',
    storagePath: 'Missão P-100 - Projeto Seguro/servico.png',
    reportId: null,
    reportServiceId: 'service-1'
  }]);
});

test('syncReportUploadAttachments replaces managed report and service attachments', async () => {
  const calls = [];
  const client = attachmentClient(calls, [
    { storagePath: 'Missão P-100 - Projeto Seguro/rdo/foto.jpg' },
    { storagePath: 'Missão P-100 - Projeto Seguro/servico.jpg' }
  ]);
  const report = {
    id: 'report-1',
    project: {
      code: 'P-100',
      name: 'Projeto Seguro'
    },
    specialConditions: {
      generalUploads: ['/relatorios/Miss%C3%A3o%20P-100%20-%20Projeto%20Seguro/rdo/foto.jpg']
    },
    services: [{
      id: 'service-1',
      extraData: {
        __uploads__: [{
          label: 'Fotos do serviço',
          files: ['/relatorios/Miss%C3%A3o%20P-100%20-%20Projeto%20Seguro/servico.jpg']
        }]
      }
    }]
  };

  const result = await syncReportUploadAttachments(client, report);

  assert.deepEqual(result, { reportId: 'report-1', deleted: 2, created: 2 });
  assert.deepEqual(calls[1], ['deleteMany', {
    where: {
      OR: [
        { reportId: 'report-1' },
        { reportServiceId: { in: ['service-1'] } }
      ]
    }
  }]);
  assert.deepEqual(calls[2][1].data.map(item => ({
    reportId: item.reportId,
    reportServiceId: item.reportServiceId,
    storagePath: item.storagePath
  })), [{
    reportId: 'report-1',
    reportServiceId: null,
    storagePath: 'Missão P-100 - Projeto Seguro/rdo/foto.jpg'
  }, {
    reportId: null,
    reportServiceId: 'service-1',
    storagePath: 'Missão P-100 - Projeto Seguro/servico.jpg'
  }]);
});

test('syncReportUploadAttachments ignores known upload containers outside the report project folder', async () => {
  const calls = [];
  const client = attachmentClient(calls);
  const report = {
    id: 'report-1',
    project: {
      code: 'P-100',
      name: 'Projeto Seguro'
    },
    specialConditions: {
      generalUploads: ['/relatorios/Miss%C3%A3o%20P-200%20-%20Outro%20Projeto/rdo/foto.jpg']
    },
    services: []
  };

  const result = await syncReportUploadAttachments(client, report);

  assert.deepEqual(result, { reportId: 'report-1', deleted: 0, created: 0 });
  assert.deepEqual(calls.map(([name]) => name), ['findMany', 'deleteMany']);
});

test('syncReportUploadAttachments rejects untrusted JSON paths even inside the same project folder', async () => {
  const calls = [];
  const client = attachmentClient(calls);
  const report = {
    id: 'report-1',
    project: {
      code: 'P-100',
      name: 'Projeto Seguro'
    },
    specialConditions: {
      generalUploads: ['/relatorios/Miss%C3%A3o%20P-100%20-%20Projeto%20Seguro/rdo/foto-injetada.jpg']
    },
    services: []
  };

  const result = await syncReportUploadAttachments(client, report);

  assert.deepEqual(result, { reportId: 'report-1', deleted: 0, created: 0 });
  assert.deepEqual(calls.map(([name]) => name), ['findMany', 'deleteMany']);
});

test('syncReportUploadAttachments accepts old project folder names only in explicit legacy backfill mode', async () => {
  const calls = [];
  const client = attachmentClient(calls);
  const report = {
    id: 'report-1',
    project: {
      code: 'P-100',
      name: 'Nome Atual'
    },
    specialConditions: {
      generalUploads: ['/relatorios/Miss%C3%A3o%20P-100%20-%20Nome%20Antigo/rdo/foto.jpg']
    },
    services: []
  };

  const result = await syncReportUploadAttachments(client, report, { trustLegacyProjectScoped: true });

  assert.deepEqual(result, { reportId: 'report-1', deleted: 0, created: 1 });
  assert.equal(calls[2][1].data[0].storagePath, 'Missão P-100 - Nome Antigo/rdo/foto.jpg');
});

test('syncReportUploadAttachments accepts recently uploaded paths for the same authenticated user', async () => {
  const calls = [];
  const client = attachmentClient(calls);
  const storagePath = 'Missão P-100 - Projeto Seguro/rdo/foto-nova.jpg';
  const auth = { user: { id: 'user-upload' } };
  rememberTransientUploadAccess(storagePath, auth.user.id);
  const report = {
    id: 'report-1',
    project: {
      code: 'P-100',
      name: 'Projeto Seguro'
    },
    specialConditions: {
      generalUploads: [`/relatorios/${encodeURIComponent('Missão P-100 - Projeto Seguro')}/rdo/foto-nova.jpg`]
    },
    services: []
  };

  const result = await syncReportUploadAttachments(client, report, { auth });

  assert.deepEqual(result, { reportId: 'report-1', deleted: 0, created: 1 });
  assert.equal(calls[2][1].data[0].storagePath, storagePath);
});

test('syncReportUploadAttachments trusts organized target when source path was trusted', async () => {
  const calls = [];
  const client = attachmentClient(calls);
  const sourcePath = 'Missão P-100 - Projeto Seguro/tmp/foto.jpg';
  const targetPath = 'Missão P-100 - Projeto Seguro/Registros Fotográficos/RDO/foto.jpg';
  const auth = { user: { id: 'user-organize' } };
  rememberTransientUploadAccess(sourcePath, auth.user.id);
  const report = {
    id: 'report-1',
    project: {
      code: 'P-100',
      name: 'Projeto Seguro'
    },
    specialConditions: {
      generalUploads: [`/relatorios/${targetPath.split('/').map(encodeURIComponent).join('/')}`]
    },
    services: []
  };

  const result = await syncReportUploadAttachments(client, report, {
    auth,
    trustedUrlMap: new Map([
      [`/relatorios/${sourcePath.split('/').map(encodeURIComponent).join('/')}`, `/relatorios/${targetPath.split('/').map(encodeURIComponent).join('/')}`]
    ])
  });

  assert.deepEqual(result, { reportId: 'report-1', deleted: 0, created: 1 });
  assert.equal(calls[2][1].data[0].storagePath, targetPath);
});

test('syncReportUploadAttachments restores snapshot-trusted paths over edited attachments', async () => {
  const calls = [];
  const client = attachmentClient(calls, [
    { storagePath: 'Missão P-100 - Projeto Seguro/rdo/foto-editada.jpg' }
  ]);
  const restoredPath = 'Missão P-100 - Projeto Seguro/rdo/foto-original.jpg';
  const report = {
    id: 'report-1',
    project: {
      code: 'P-100',
      name: 'Projeto Seguro'
    },
    specialConditions: {
      generalUploads: [`/relatorios/${restoredPath.split('/').map(encodeURIComponent).join('/')}`]
    },
    services: []
  };

  const result = await syncReportUploadAttachments(client, report, {
    trustedStoragePaths: [restoredPath]
  });

  assert.deepEqual(result, { reportId: 'report-1', deleted: 1, created: 1 });
  assert.equal(calls[2][1].data[0].storagePath, restoredPath);
});

test('reportUploadAttachmentsNeedSync detects legacy JSON uploads missing persisted attachments', () => {
  const report = {
    id: 'report-1',
    project: {
      code: 'P-100',
      name: 'Projeto Seguro'
    },
    specialConditions: {
      generalUploads: ['/relatorios/Miss%C3%A3o%20P-100%20-%20Projeto%20Seguro/rdo/foto.jpg']
    },
    attachments: [],
    services: []
  };

  assert.equal(reportUploadAttachmentsNeedSync(report), true);
  assert.equal(reportUploadAttachmentsNeedSync({
    ...report,
    attachments: [{ storagePath: 'Missão P-100 - Projeto Seguro/rdo/foto.jpg' }]
  }), false);
});
